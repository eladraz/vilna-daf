#!/usr/bin/env python3
"""
fetch_daf.py — Fetch Talmud pages from Sefaria into the local data cache.

Usage:
  python3 fetch_daf.py Berachot 2a [4b 5b ...]    # specific pages
  python3 fetch_daf.py --matrix                   # the test-matrix pages
  python3 fetch_daf.py --tractate Berachot        # every page of a tractate

Output: data/{Tractate}/{page}{side}.json — the full model the renderer
consumes (gemara, rashi, tosafot, links, extras, chapter), so a cached page
renders with zero live API calls.
"""

import json, re, sys, time, urllib.request, urllib.parse, ssl
from pathlib import Path

BASE = "https://www.sefaria.org/api/v3/texts"
LINKS_BASE = "https://www.sefaria.org/api/links"
INDEX_V2 = "https://www.sefaria.org/api/v2/index"
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"

SEFARIA_MAP = {
    "Berachot": "Berakhot", "Shabbat": "Shabbat", "Eiruvin": "Eiruvin",
    "Pesachim": "Pesachim", "Shekalim": "Shekalim", "Yoma": "Yoma",
    "Sukkah": "Sukkah", "Beitzah": "Beitzah",
    "Rosh Hashanah": "Rosh Hashanah", "Taanit": "Taanit",
    "Megillah": "Megillah", "Moed Katan": "Moed Katan",
    "Chagigah": "Chagigah", "Yevamot": "Yevamot",
    "Ketubot": "Ketubot", "Nedarim": "Nedarim", "Nazir": "Nazir",
    "Sotah": "Sotah", "Gittin": "Gittin", "Kiddushin": "Kiddushin",
    "Bava Kamma": "Bava Kamma", "Bava Metzia": "Bava Metzia",
    "Bava Batra": "Bava Batra", "Sanhedrin": "Sanhedrin",
    "Makkot": "Makkot", "Shevuot": "Shevuot",
    "Avodah Zarah": "Avodah Zarah", "Horayot": "Horayot",
    "Zevachim": "Zevachim", "Menachot": "Menachot",
    "Chullin": "Chullin", "Bechorot": "Bechorot",
    "Arachin": "Arachin", "Temurah": "Temurah",
    "Keritot": "Keritot", "Meilah": "Meilah", "Niddah": "Niddah",
}

GEMARA_VERSION = "hebrew|William Davidson Edition - Aramaic"

EXTRAS = [
    ("hagahotHaBach", "Hagahot HaBach on {ref}", "הגהות הב״ח"),
    ("gilyonHaShas", "Gilyon HaShas on {ref}", "גליון הש״ס"),
    ("ravNissimGaon", "Rav Nissim Gaon on {ref}", "רב נסים גאון"),
    ("rabbeinuChananel", "Rabbeinu Chananel on {ref}", "רבינו חננאל"),
]


def api_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "VilnaDaf/2.0"})
    ctx = ssl.create_default_context()
    time.sleep(0.12)
    with urllib.request.urlopen(req, context=ctx, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_text(ref, version=None):
    q = "?version=" + urllib.parse.quote(version) if version else ""
    url = BASE + "/" + urllib.parse.quote(ref) + q
    try:
        return api_get(url)
    except Exception:
        return None


def pick_hebrew(versions):
    if not versions:
        return None
    prefs = ["Vilna", "Wikisource", "Davidson", "William Davidson", ""]
    for p in prefs:
        for v in versions:
            if v.get("language") == "he" and p in (v.get("versionTitle") or ""):
                return v
    return next((v for v in versions if v.get("language") == "he"), None)


def he_segments(data):
    """Pull the segment list out of a v3 texts response (or None)."""
    if not data:
        return []
    v = pick_hebrew(data.get("versions", []))
    return (v.get("text") or []) if v else []


# ── Chapter (perek) structure from the index alt-structure ──

DAF_RE = re.compile(r"(\d+)([ab])(?::(\d+))?")


def daf_ord(page, side):
    return page * 2 + (0 if side == "a" else 1)


def parse_whole_ref(whole_ref):
    """'Berakhot 2a:1-13a:15' → (startOrd, startSeg, endOrd, endSeg)."""
    m = DAF_RE.findall(whole_ref or "")
    if not m:
        return None
    s = m[0]
    e = m[-1] if len(m) > 1 else m[0]
    return (
        daf_ord(int(s[0]), s[1]), int(s[2] or 1),
        daf_ord(int(e[0]), e[1]), int(e[2] or 9999),
    )


def fetch_index_meta(sef_name):
    """Hebrew title + chapter list [{heTitle, num, span}] for a tractate."""
    try:
        idx = api_get(INDEX_V2 + "/" + urllib.parse.quote(sef_name))
    except Exception:
        return {"heTitle": sef_name, "chapters": []}
    chapters = []
    nodes = (idx.get("alts", {}).get("Chapters", {}) or {}).get("nodes", [])
    for i, n in enumerate(nodes):
        span = parse_whole_ref(n.get("wholeRef", ""))
        if not span:
            continue
        chapters.append({"heTitle": n.get("heTitle", ""), "num": i + 1, "span": span})
    return {"heTitle": idx.get("heTitle", sef_name), "chapters": chapters}


_index_cache = {}


def index_meta(sef_name):
    if sef_name not in _index_cache:
        _index_cache[sef_name] = fetch_index_meta(sef_name)
    return _index_cache[sef_name]


def chapter_for(sef_name, page, side):
    """{name, num, startsHere, startSeg} for the chapter containing this amud."""
    o = daf_ord(page, side)
    for ch in index_meta(sef_name)["chapters"]:
        s_ord, s_seg, e_ord, _ = ch["span"]
        if s_ord <= o <= e_ord:
            return {
                "name": ch["heTitle"],
                "num": ch["num"],
                "startsHere": o == s_ord,
                "startSeg": s_seg if o == s_ord else None,
            }
    return {"name": "", "num": 0, "startsHere": False, "startSeg": None}


# ── Per-page fetch ───────────────────────────────────────────


def fetch_daf(tractate, page, side):
    sef_name = SEFARIA_MAP.get(tractate, tractate)
    daf_ref = f"{page}{side}"
    ref = f"{sef_name}.{daf_ref}"
    print(f"Fetching {tractate} {daf_ref} (Sefaria: {sef_name})...")

    gem_data = get_text(ref, GEMARA_VERSION) or get_text(ref)
    gemara_segs = he_segments(gem_data)
    rashi = he_segments(get_text(f"Rashi on {ref}"))
    tosafot = he_segments(get_text(f"Tosafot on {ref}"))

    links = []
    try:
        ld = api_get(LINKS_BASE + "/" + urllib.parse.quote(ref))
        links = ld if isinstance(ld, list) else []
    except Exception:
        pass

    # Sefaria lists each reference once per anchor segment/direction, so the
    # same source can repeat (e.g. Torah Or on Rosh Hashanah 2b: 4 verses ->
    # 8 links). Keep the first occurrence of each source ref so the margin
    # matches the printed Vilna apparatus.
    mesoret, ein_mishpat, torah_or = [], [], []
    seen_m, seen_e, seen_t = set(), set(), set()
    KEEP = ("anchorRef", "category", "type", "sourceRef", "sourceHeRef", "he")

    def push_uniq(arr, seen, slim):
        key = slim.get("sourceRef") or slim.get("sourceHeRef")
        if key in seen:
            return
        seen.add(key)
        arr.append(slim)

    for lk in links:
        cat = (lk.get("category") or "").lower()
        typ = (lk.get("type") or "").lower()
        slim = {k: lk.get(k) for k in KEEP if lk.get(k) is not None}
        if cat == "talmud" or "mesoret" in typ or "masoret" in typ:
            slim.pop("he", None)
            push_uniq(mesoret, seen_m, slim)
        elif cat == "halakhah" or "mishpat" in typ or "ner" in typ:
            slim.pop("he", None)
            push_uniq(ein_mishpat, seen_e, slim)
        elif cat == "tanakh" or "torah or" in typ:
            push_uniq(torah_or, seen_t, slim)

    extras = {}
    for key, ref_tpl, he_title in EXTRAS:
        segs = he_segments(get_text(ref_tpl.format(ref=ref)))
        if segs:
            extras[key] = {"title": he_title, "segments": segs}

    meta = index_meta(sef_name)
    model = {
        "ref": f"{tractate} {daf_ref}",
        "tractate": tractate,
        "tractateHe": meta["heTitle"],
        "sefaria_name": sef_name,
        "page": page,
        "side": side,
        "chapter": chapter_for(sef_name, page, side),
        "gemara": gemara_segs,
        "rashi": rashi,
        "tosafot": tosafot,
        "links": {
            "mesoretHaShas": mesoret,
            "einMishpat": ein_mishpat,
            "torahOr": torah_or,
        },
        "extras": extras,
    }

    tractate_dir = DATA_DIR / tractate
    tractate_dir.mkdir(parents=True, exist_ok=True)
    out_path = tractate_dir / f"{daf_ref}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    n_r = sum(1 for r in rashi if r)
    n_t = sum(1 for t in tosafot if t)
    print(f"  Saved {out_path} — gemara {len(gemara_segs)} | rashi {n_r} | "
          f"tosafot {n_t} | extras {sorted(extras)} | chapter {model['chapter']}")
    return model


# ── Tractate metadata ──────────────────────────────────────

TRACTATES = [
    ("Berachot", "ברכות", 64, False),
    ("Shabbat", "שבת", 157, True),
    ("Eiruvin", "עירובין", 105, False),
    ("Pesachim", "פסחים", 121, True),
    ("Shekalim", "שקלים", 22, True),
    ("Yoma", "יומא", 88, False),
    ("Sukkah", "סוכה", 56, True),
    ("Beitzah", "ביצה", 40, True),
    ("Rosh Hashanah", "ראש השנה", 35, False),
    ("Taanit", "תענית", 31, False),
    ("Megillah", "מגילה", 32, False),
    ("Moed Katan", "מועד קטן", 29, False),
    ("Chagigah", "חגיגה", 27, False),
    ("Yevamot", "יבמות", 122, True),
    ("Ketubot", "כתובות", 112, True),
    ("Nedarim", "נדרים", 91, True),
    ("Nazir", "נזיר", 66, True),
    ("Sotah", "סוטה", 49, True),
    ("Gittin", "גיטין", 90, True),
    ("Kiddushin", "קידושין", 82, True),
    ("Bava Kamma", "בבא קמא", 119, True),
    ("Bava Metzia", "בבא מציעא", 119, False),
    ("Bava Batra", "בבא בתרא", 176, True),
    ("Sanhedrin", "סנהדרין", 113, True),
    ("Makkot", "מכות", 24, True),
    ("Shevuot", "שבועות", 49, True),
    ("Avodah Zarah", "עבודה זרה", 76, True),
    ("Horayot", "הוריות", 14, False),
    ("Zevachim", "זבחים", 120, True),
    ("Menachot", "מנחות", 110, False),
    ("Chullin", "חולין", 142, False),
    ("Bechorot", "בכורות", 61, False),
    ("Arachin", "ערכין", 34, False),
    ("Temurah", "תמורה", 34, False),
    ("Keritot", "כריתות", 28, True),
    ("Meilah", "מעילה", 22, False),
    ("Niddah", "נידה", 73, False),
]

MATRIX = [
    ("Berachot", 2, "a"), ("Berachot", 4, "b"), ("Berachot", 5, "b"),
    ("Berachot", 10, "a"), ("Yoma", 3, "a"), ("Chagigah", 9, "a"),
]


def build_tractates_json():
    tl = []
    for name_en, name_he, last_page, ends_on_b in TRACTATES:
        tl.append({
            "name_en": name_en, "name_he": name_he,
            "sefaria_name": SEFARIA_MAP.get(name_en, name_en),
            "last_page": last_page, "ends_on_b": ends_on_b, "first_page": 2,
        })
    with open(DATA_DIR / "tractates.json", "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)
    print(f"Built tractates.json: {len(tl)} tractates")


def main(argv):
    build_tractates_json()
    if not argv:
        print(__doc__)
        return 1
    if argv[0] == "--matrix":
        for t, p, s in MATRIX:
            fetch_daf(t, p, s)
        return 0
    if argv[0] == "--tractate":
        name = argv[1]
        info = next(t for t in TRACTATES if t[0] == name)
        for p in range(2, info[2] + 1):
            fetch_daf(name, p, "a")
            if p < info[2] or info[3]:
                fetch_daf(name, p, "b")
        return 0
    tractate = argv[0]
    for spec in argv[1:]:
        m = re.fullmatch(r"(\d+)([ab])", spec)
        if not m:
            print(f"Bad page spec: {spec}")
            return 1
        fetch_daf(tractate, int(m.group(1)), m.group(2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
