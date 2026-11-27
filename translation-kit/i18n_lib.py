"""i18n_lib.py - shared helpers for the translation pipeline (any tractate; ru yi fr es ko).

Used by i18n_cut.py (batch cutter), i18n_check.py (translator-facing validator) and
i18n_merge.py (merger).  Everything is relative to the repository root (parent of translation-kit/).
Call configure(tractate) before anything else; the work directory is
data/offline-work/i18n/<Tractate>/<lang>/{in,out}.
"""
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFFLINE = os.path.join(ROOT, "data", "offline")
LANGS = ("ru", "yi", "fr", "es", "ko")
TRACTATE = None
WORK = None


def configure(tractate, work=None):
    """Select the tractate (directory name under data/offline, e.g. "Shabbat", "Moed Katan")."""
    global TRACTATE, WORK
    if not os.path.isdir(os.path.join(OFFLINE, tractate)):
        raise SystemExit("no such tractate in data/offline: %r" % tractate)
    TRACTATE = tractate
    WORK = work or os.path.join(ROOT, "data", "offline-work", "i18n", tractate.replace(" ", "_"))


def add_common_args(ap):
    ap.add_argument("--tractate", required=True, help='directory name under data/offline, e.g. "Shabbat" or "Moed Katan"')
    ap.add_argument("--work", help="override the work directory (default data/offline-work/i18n/<Tractate>)")

TAG = re.compile(r"<[^>]*>")
HEB = re.compile(r"[֐-׿יִ-ﭏ]")
LAT = re.compile(r"[A-Za-zÀ-ɏ]")
CYR = re.compile(r"[Ѐ-ӿ]")
HAN = re.compile(r"[가-힣㄰-㆏ᄀ-ᇿ]")
EN_STOP = {"the", "of", "and", "that", "which", "is", "was", "with", "not", "this",
           "said", "because", "from", "are", "be", "by", "he", "his", "it", "to", "who"}


def words(x):
    """Hebrew word count of a (nested) block, tags stripped."""
    if isinstance(x, str):
        return len(TAG.sub("", x).split())
    if isinstance(x, list):
        return sum(words(i) for i in x)
    return 0


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, list):
        for i in x:
            yield from strings(i)


def page_path(key):
    return os.path.join(OFFLINE, key + ".json")


def load_page(key):
    with open(page_path(key), encoding="utf-8") as f:
        return json.load(f)


def save_page(key, d):
    # same serialisation as the existing offline pack (verified byte-identical round trip)
    with open(page_path(key), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))


def page_keys(tractate=None):
    tractate = tractate or TRACTATE
    fs = glob.glob(os.path.join(OFFLINE, tractate, "*.json"))

    def k(f):
        n = os.path.basename(f)[:-5]
        return (int(n[:-1]), n[-1])
    return [tractate + "/" + os.path.basename(f)[:-5] for f in sorted(fs, key=k)]


def shown_blocks(d):
    """Blocks to translate: Hebrew source flagged show=true."""
    return [b for b in d["langs"]["he"] if d["sources"].get(b, {}).get("he", {}).get("show")]


def lang_dir(lang, sub):
    return os.path.join(WORK, lang, sub)


def source_meta(d, b):
    """sources[b][lang] for a machine translation, matching the finished Berachot pages."""
    he = d["sources"][b]["he"]
    en = d["sources"][b].get("en") if b in d["langs"].get("en", {}) else None
    used = [he] + ([en] if en else [])
    lic = []   # Hebrew source first, then English; a machine-derived English is flattened to its origin
    for u in used:
        for x in (u.get("derivedFrom", []) if u.get("license") == "derived" else [u["license"]]):
            if x not in lic:
                lic.append(x)
    return {
        "title": "Machine translation from Hebrew/Aramaic with English as an aid",
        "license": "derived",
        "derivedFrom": lic,
        "pd": all(bool(u.get("pd")) for u in used),
        "special": any(bool(u.get("special")) for u in used),
        "show": bool(he.get("show", False)),
        "mt": True,
    }


# ---------------------------------------------------------------- validation
def _letters(s, rx):
    return len(rx.findall(s))


def shape_problem(he, out, path):
    if isinstance(he, list):
        if not isinstance(out, list):
            return "%s: expected a list (as in the Hebrew), got %s" % (path, type(out).__name__)
        if len(he) != len(out):
            return "%s: list has %d items but the Hebrew has %d" % (path, len(out), len(he))
        for i, (a, b) in enumerate(zip(he, out)):
            r = shape_problem(a, b, "%s[%d]" % (path, i))
            if r:
                return r
        return None
    if isinstance(he, str):
        if not isinstance(out, str):
            return "%s: expected a string, got %s" % (path, type(out).__name__)
    return None


def string_problems(lang, h, o, e, path):
    """Problems for one aligned (Hebrew, output, English) string; list of messages."""
    p = []
    ht, ot = TAG.sub("", h), TAG.sub("", o)
    if not h.strip():
        return p  # blank Hebrew segment: anything blank is fine
    if not ot.strip():
        return ["%s: empty translation for a non-empty Hebrew segment" % path]
    if sorted(TAG.findall(h)) != sorted(TAG.findall(o)):
        p.append("%s: inline tags differ: Hebrew has %s, output has %s"
                 % (path, sorted(TAG.findall(h)), sorted(TAG.findall(o))))
    if "\n" in o or "\r" in o or "\t" in o or "```" in o or "**" in o:
        p.append("%s: contains a newline/tab/markdown artefact" % path)
    n_heb, n_lat, n_cyr, n_han = (_letters(ot, r) for r in (HEB, LAT, CYR, HAN))
    tot = n_heb + n_lat + n_cyr + n_han
    if n_cyr and lang != "ru":
        p.append("%s: contains Cyrillic letters" % path)
    if lang == "ru" and n_han:
        p.append("%s: contains Hangul" % path)
    if lang in ("yi", "fr", "es") and n_han:
        p.append("%s: contains Hangul" % path)
    if lang == "ko" and n_han == 0 and tot:
        p.append("%s: no Hangul at all (script is wrong)" % path)
    if tot >= 30:
        if lang == "yi":
            if n_heb / tot < 0.85:
                p.append("%s: not Hebrew-script Yiddish (Hebrew letters %.0f%%, Latin %d)" % (path, 100 * n_heb / tot, n_lat))
        elif lang in ("fr", "es"):
            if n_lat / tot < 0.45:
                p.append("%s: not Latin-script %s (Latin %.0f%%, Hebrew %d)" % (path, lang, 100 * n_lat / tot, n_heb))
        elif lang == "ru":
            if n_cyr / tot < 0.45:
                p.append("%s: not Cyrillic Russian (Cyrillic %.0f%%)" % (path, 100 * n_cyr / tot))
        elif lang == "ko":
            if n_han / tot < 0.30:
                p.append("%s: not enough Hangul (%.0f%%)" % (path, 100 * n_han / tot))
    if lang == "yi" and ("\u05f0" in ot or "\u05f1" in ot or re.search("\u05f2(?!\u05b7)", ot)):
        p.append("%s: Yiddish ligature letters: write two vovs (וו) instead of װ, vov-yud (וי) instead of ױ, and ײַ (with pasekh) instead of ײ" % path)
    if lang == "yi" and n_lat > 10:
        p.append("%s: %d Latin letters in Yiddish (transliterate into Hebrew script)" % (path, n_lat))
    # untranslated copy of the Hebrew or the English
    if len(ht.split()) >= 6 and ot.strip() == ht.strip():
        p.append("%s: identical to the Hebrew source (not translated)" % path)
    if e:
        et = TAG.sub("", e).strip()
        if len(et.split()) >= 6 and ot.strip() == et:
            p.append("%s: identical to the English aid (copied, not translated)" % path)
    if lang in ("fr", "es", "ru"):
        ws = re.findall(r"[A-Za-z']+", ot.lower())
        if len(ws) >= 10 and sum(w in EN_STOP for w in ws) / len(ws) > 0.15:
            p.append("%s: looks like English (English function words)" % path)
    # length sanity (characters, tags stripped)
    if len(ht) >= 40:
        r = len(ot) / len(ht)
        lo, hi = {"ru": (0.7, 6), "yi": (0.7, 6), "fr": (0.8, 6), "es": (0.7, 6), "ko": (0.4, 6)}[lang]
        if r < lo:
            p.append("%s: far too short (%.2f x the Hebrew length) - truncated or skipped text?" % (path, r))
        elif r > hi:
            p.append("%s: far too long (%.2f x the Hebrew length)" % (path, r))
    return p


def walk(h, o, e, path, lang, acc):
    if isinstance(h, list):
        for i, (a, b) in enumerate(zip(h, o)):
            ee = e[i] if isinstance(e, list) and i < len(e) else None
            walk(a, b, ee, "%s[%d]" % (path, i), lang, acc)
    elif isinstance(h, str):
        acc.extend(string_problems(lang, h, o, e if isinstance(e, str) else None, path))


def check_block(lang, he, out, en=None, name=""):
    """Returns a list of problems (empty if the block is good)."""
    r = shape_problem(he, out, name)
    if r:
        return [r]
    acc = []
    walk(he, out, en, name, lang, acc)
    return acc


def load_outputs(lang, batch_id):
    """All output files for a batch: out/<prefix>-NNNN.json plus optional .partK.json.
    Returns ({page: {block: value}}, [file problems])."""
    out_dir = lang_dir(lang, "out")
    files = sorted(glob.glob(os.path.join(out_dir, batch_id + ".json"))
                   + glob.glob(os.path.join(out_dir, batch_id + ".part*.json")))
    pages, probs = {}, []
    if not files:
        return pages, ["no output file out/%s.json" % batch_id]
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception as ex:
            probs.append("%s: invalid JSON: %s" % (os.path.basename(f), ex))
            continue
        if not isinstance(doc, dict) or not isinstance(doc.get("pages"), list):
            probs.append('%s: top level must be {"pages": [...]}' % os.path.basename(f))
            continue
        for pg in doc["pages"]:
            if not isinstance(pg, dict) or "page" not in pg or not isinstance(pg.get("blocks"), dict):
                probs.append('%s: each page needs "page" and "blocks"' % os.path.basename(f))
                continue
            pages.setdefault(pg["page"], {}).update(pg["blocks"])
    return pages, probs


def check_batch(lang, batch_id):
    """Validate an output batch against the input batch and the live Hebrew.
    Returns (problems, good) with good = {page: {block: value}}."""
    inp_path = os.path.join(lang_dir(lang, "in"), batch_id + ".json")
    with open(inp_path, encoding="utf-8") as f:
        inp = json.load(f)
    outs, probs = load_outputs(lang, batch_id)
    good = {}
    want = {pg["page"]: pg for pg in inp["pages"]}
    for k in outs:
        if k not in want:
            probs.append("%s: page is not part of this batch" % k)
    for key, pg in want.items():
        live = load_page(key)
        for b, src in pg["blocks"].items():
            name = "%s %s" % (key, b)
            if live["langs"]["he"].get(b) != src["he"]:
                probs.append("%s: Hebrew in data/offline changed since the batch was cut; re-cut" % name)
                continue
            if key not in outs or b not in outs[key]:
                probs.append("%s: block missing from the output" % name)
                continue
            bp = check_block(lang, src["he"], outs[key][b], src.get("en"), b)
            if bp:
                probs.extend("%s: %s" % (key, x) for x in bp)
            else:
                good.setdefault(key, {})[b] = outs[key][b]
        for b in outs.get(key, {}):
            if b not in pg["blocks"]:
                probs.append("%s %s: block not in the input batch" % (key, b))
    return probs, good
