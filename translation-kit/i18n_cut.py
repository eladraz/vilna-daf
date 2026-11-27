#!/usr/bin/env python3
"""i18n_cut.py - cut a tractate's translation work into per-language batches of ~7k Hebrew words.

  python3 translation-kit/i18n_cut.py --tractate Shabbat --lang yi                 (one language)
  python3 translation-kit/i18n_cut.py --tractate Shabbat --lang all                (ru yi fr es ko)
  python3 translation-kit/i18n_cut.py --tractate Shabbat --lang yi --pages FILE --prefix pilot   (small pilot batch)

Writes data/offline-work/i18n/<Tractate>/<lang>/in/<prefix>-NNNN.json
  {"lang","batch","pages":[{"page":"Shabbat/2a","blocks":{"gemara":{"he":..,"en":..},"rashi":{"he":..}}}]}
Only blocks whose Hebrew has show=true and that lack langs[<lang>] in data/offline are included.
Pages are never split.  Re-cutting later (after merging some pages) renumbers the batches, so cut once
before launching the workers.
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import i18n_lib as L

ap = argparse.ArgumentParser()
L.add_common_args(ap)
ap.add_argument("--lang", required=True, help="ru|yi|fr|es|ko|all")
ap.add_argument("--target", type=int, default=7000, help="target Hebrew words per batch")
ap.add_argument("--max", type=int, default=8500, help="hard cap per batch (except a single big page)")
ap.add_argument("--pages", help="file with one '<Tractate>/NNx' per line (default: all pages)")
ap.add_argument("--prefix", default="batch")
a = ap.parse_args()
L.configure(a.tractate, a.work)
langs = L.LANGS if a.lang == "all" else (a.lang,)
only = [x for x in open(a.pages).read().split() if x] if a.pages else None
for lang in langs:
    if lang not in L.LANGS:
        sys.exit("unknown lang " + lang)
    batches, cur, cw = [], [], 0
    for key in (only or L.page_keys()):
        d = L.load_page(key)
        blocks = {}
        for b in L.shown_blocks(d):
            if b in d["langs"].get(lang, {}):
                continue
            e = {"he": d["langs"]["he"][b]}
            if b in d["langs"].get("en", {}):
                e["en"] = d["langs"]["en"][b]
            blocks[b] = e
        if not blocks:
            continue
        pw = sum(L.words(v["he"]) for v in blocks.values())
        if cur and (cw + pw > a.max or abs(cw + pw - a.target) >= abs(cw - a.target)):
            batches.append((cur, cw)); cur, cw = [], 0
        cur.append({"page": key, "blocks": blocks}); cw += pw
    if cur:
        batches.append((cur, cw))
    ind = L.lang_dir(lang, "in")
    os.makedirs(ind, exist_ok=True)
    os.makedirs(L.lang_dir(lang, "out"), exist_ok=True)
    for f in glob.glob(os.path.join(ind, a.prefix + "-[0-9]*.json")):
        os.remove(f)
    for i, (b, w) in enumerate(batches, 1):
        bid = "%s-%04d" % (a.prefix, i)
        json.dump({"lang": lang, "batch": bid, "pages": b},
                  open(os.path.join(ind, bid + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    tot = sum(w for _, w in batches)
    ws = [w for _, w in batches] or [0]
    print("%s: %d batches, %d pages, %d Hebrew words (batch min/avg/max %d/%d/%d)"
          % (lang, len(batches), sum(len(b) for b, _ in batches), tot, min(ws), tot // max(1, len(ws)), max(ws)))
