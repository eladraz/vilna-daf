#!/usr/bin/env python3
"""i18n_check.py - translator-facing validator (read-only; never touches data/offline).

  python3 translation-kit/i18n_check.py --tractate Shabbat --lang yi --batch batch-0007
Checks data/offline-work/i18n/<Tractate>/<lang>/out/<batch>.json (and <batch>.partK.json) against the
input batch: JSON, page/block coverage, nesting and list lengths equal to the Hebrew, no empty
strings, identical inline tags per string, correct script for the language, not a copy of the
Hebrew/English, plausible length.  Prints every problem; exit 0 only if the batch is clean.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import i18n_lib as L

ap = argparse.ArgumentParser()
L.add_common_args(ap)
ap.add_argument("--lang", required=True, choices=L.LANGS)
ap.add_argument("--batch", required=True, help="e.g. batch-0007 or pilot-0001")
ap.add_argument("--max", type=int, default=60, help="max problems to print")
a = ap.parse_args()
L.configure(a.tractate, a.work)
probs, good = L.check_batch(a.lang, a.batch)
for p in probs[:a.max]:
    print("PROBLEM", p)
if len(probs) > a.max:
    print("... %d more problems" % (len(probs) - a.max))
n = sum(len(v) for v in good.values())
print("%s %s: %s (%d blocks valid, %d problems)" % (a.lang, a.batch, "OK" if not probs else "FAILED", n, len(probs)))
sys.exit(1 if probs else 0)
