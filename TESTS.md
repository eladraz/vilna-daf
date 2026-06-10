# Tests

The acceptance harness lives in `harness/` and tests **the shipped engine**
(`index.html` + `vilna-daf.js`) — nothing else.

```bash
bash harness/run.sh                # full matrix + one random held-out daf
bash harness/run.sh Berachot 5 b   # single page
```

`harness/check.mjs` serves the repo root itself, drives headless Chromium
(Playwright), and asserts per page:

1. Sheet aspect ratio within 2% of the reference 0.707 (w/h).
2. Gemara narrow-band line width ≥ 0.40·coreW, and widening below any
   commentary that ends above the Gemara's end.
3. No two stream text fragments intersect (line rects sampled via `Range`).
4. No empty plan-occupied cell in a 3×3 grid over the core.
5. Rendered text contains no Hebrew diacritics (U+0591–U+05C7 strip) and no
   literal `<`, `&nbsp;`, or `class=` (sanitizer health).
6. `document.fonts.check('16px RashiScript')` is true and the computed
   font-family of the Rashi stream resolves to it.
7. Header is Hebrew-only and contains the perek/amud pattern.
8. Cached pages load in < 2 s; the relaxation loop converged in ≤ 8 rounds
   (read from `core._vilnaResult` / the `[vilna-daf]` console log).

Matrix: Berachot 2a (chapter start) · 4b (asymmetric) · 5b · 10a · Yoma 3a
(commentary-dominant) · one random held-out daf per run (live-fetched, zero
per-daf code). A fix that regresses another page is a failure.

Screenshots land in `harness/out/`; the committed evidence set is under
`docs/screenshots/` and embedded in [PROGRESS.md](PROGRESS.md).
