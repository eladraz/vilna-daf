#!/usr/bin/env python3
"""i18n_merge.py - merge validated translations into data/offline/<Tractate> (one language at a time).

  python3 translation-kit/i18n_merge.py --tractate Shabbat --lang yi --batch pilot-0001      (one batch)
  python3 translation-kit/i18n_merge.py --tractate Shabbat --lang yi --all                   (every batch with an output file)
  python3 translation-kit/i18n_merge.py --tractate Shabbat --lang yi --all --dry-run         (validate and report only)
  python3 translation-kit/i18n_merge.py --tractate Shabbat --lang yi --status                (coverage: merged / pending)

Only blocks that pass validation are merged.  Merging writes ONLY langs[<lang>][block] and
sources[block][<lang>] of the pages in the batch; other languages, other blocks, apparatus, other
tractates are left byte-for-byte alone.  An existing langs[<lang>][block] is never overwritten
(use --overwrite).  Exit 1 if any problem was seen.
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import i18n_lib as L

ap = argparse.ArgumentParser()
L.add_common_args(ap)
ap.add_argument("--lang", required=True, choices=L.LANGS)
ap.add_argument("--batch")
ap.add_argument("--all", action="store_true")
ap.add_argument("--status", action="store_true")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--overwrite", action="store_true")
a = ap.parse_args()
L.configure(a.tractate, a.work)
lang = a.lang

if a.status:
    tot = done = 0
    for key in L.page_keys():
        d = L.load_page(key)
        for b in L.shown_blocks(d):
            tot += 1
            done += b in d["langs"].get(lang, {})
    print("%s: %d/%d shown blocks translated" % (lang, done, tot))
    sys.exit(0)

if a.batch:
    ids = [a.batch]
elif a.all:
    ids = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(L.lang_dir(lang, "in"), "*.json")))
else:
    sys.exit("give --batch ID, --all or --status")

bad = nb = npg = skipped = 0
for bid in ids:
    outs, _ = L.load_outputs(lang, bid)
    if not outs:
        print("%s: no output yet" % bid); skipped += 1
        continue
    probs, good = L.check_batch(lang, bid)
    for p in probs:
        print("PROBLEM %s: %s" % (bid, p))
    bad += len(probs)
    for key, blocks in good.items():
        d = L.load_page(key)
        for b, val in blocks.items():
            if b in d["langs"].get(lang, {}) and not a.overwrite:
                print("SKIP %s %s: %s already present" % (key, b, lang)); continue
            if not a.dry_run:
                d["langs"].setdefault(lang, {})[b] = val
                d["sources"][b][lang] = L.source_meta(d, b)
            nb += 1
        if not a.dry_run:
            L.save_page(key, d)
        npg += 1
print("%s: %s %d blocks on %d pages; %d problems; %d batches without output"
      % (lang, "would merge" if a.dry_run else "merged", nb, npg, bad, skipped))
sys.exit(1 if bad else 0)
