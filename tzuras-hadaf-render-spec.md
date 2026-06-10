# Build a faithful "צורת הדף" (Vilna Shas) renderer — implementation prompt

**Target page for v1:** Talmud Bavli, Berakhot 2a (`ברכות ב׳ ע״א`).
**Data source:** Sefaria v3 API.
**Goal:** A single HTML page that visually reproduces the classic Vilna daf — central
Gemara, Rashi (inner) and Tosafot (outer) wrapping around it, full marginal apparatus,
letter-keyed cross-references, balanced to the bottom margin. Print-faithful, not "a
three-column web layout."

Read this whole spec before writing code. The single most important rule is in §3.

---

## 0. Non-negotiables (read first)

1. The Gemara is **not** a column. It is a fixed-size block that the commentary text
   **flows around**. If you implement three side-by-side columns of independent height,
   you have failed. See §3.
2. Content per amud is **fixed** by the data source. Never paginate, truncate, or "fit by
   cutting text." Render the entire segment array Sefaria returns for the daf, then
   balance by typography (§5), the way a typesetter did by hand.
3. Commentaries are **semi-cursive Rashi script**, the Gemara is **square Hebrew**. Two
   different fonts. (§4)
4. No nikud, no modern punctuation in the main streams — request the plain Vilna/Wikisource
   Hebrew version, not a vocalized or heavily punctuated edition. (§1)
5. Preserve Sefaria's inline HTML — especially `<b>` bolded דיבור־המתחיל catchwords in
   Rashi/Tosafot. They are part of the look. Sanitize, don't strip.

---

## 1. Data layer — Sefaria v3

All endpoints are GET, return JSON, support CORS. Base: `https://www.sefaria.org`.

**Primary texts** (`/api/v3/texts/{ref}`), ref uses dot for daf:

| Stream      | ref                          | notes |
|-------------|------------------------------|-------|
| Gemara      | `Berakhot.2a`                | opens with Mishnah, then `גמ׳` |
| Rashi       | `Rashi on Berakhot.2a`       | segments align 1:1 to Gemara segments |
| Tosafot     | `Tosafot on Berakhot.2a`     | same |

For each call the response has `versions: [...]`. Pick the Hebrew source version:
prefer `?version=hebrew` and, among returned versions, the plain Vilna/Wikisource text
(versionTitle without "punctuated"/"vocalized"/"Steinsaltz"/"William Davidson" if you want
maximum print fidelity; Davidson is acceptable but adds punctuation). The daf's content is
`version.text` — an **array of segments** (one entry per numbered section of the amud). Join
with a single space; keep each segment's inline HTML.

**Marginal apparatus.** Coverage varies by tractate, so **probe, render what exists, lay out
nothing for what doesn't** (positions stay fixed — see §6). Try these refs and also resolve
names via `/api/name/{q}` or `/api/index`:
- `Ein Mishpat Ner Mitzvah on Berakhot.2a`  (outer top)
- `Mesorat HaShas on Berakhot.2a`  (inner top — Talmud→Talmud cross-refs)
- `Torah Or on Berakhot.2a`  (verse references)
- `Hagahot HaBach on Berakhot.2a`, `Gilyon HaShas on Berakhot.2a`, `Mussaf Rashi …`
- `Rabbeinu Chananel on Berakhot.2a` (bottom), and Rav Nissim Gaon / `Sefer HaMafteach …` if present.

Several of these are sparse or absent for the main Bavli on Sefaria; that is expected. **Do
not fabricate** apparatus content. If a stream 404s or returns empty, omit it and let its
margin slot collapse.

**Cross-references (the keyed notes).** Two ways, use both:
- The apparatus texts above, when present, are already keyed per Gemara segment.
- `/api/links/Berakhot.2a` returns every connection per segment with `category`,
  `sourceRef`, `anchorRef`. Use it to build Masoret HaShas (category `Talmud`/parallel),
  Ein Mishpat (`Halakhah` → Rambam/Tur/Shulchan Arukh), and Torah Or (`Tanakh`) notes,
  grouped by `anchorRef` segment.

Build one normalized model:
```js
{
  ref: "Berakhot 2a",
  chapterName: "פרק ראשון",      // from /api/index or text "heRef"
  isChapterStart: true,           // 2a starts a chapter → boxed first word + Mishnah header
  firstWord: "מאימתי",
  gemara:  [{ i:1, html:"…", anchors:[…] }, …],
  rashi:   [{ i:1, html:"…" }, …],
  tosafot: [{ i:1, html:"…" }, …],
  margins: {
    inner:  { mesoretHaShas:[…], hagahotHaBach:[…] },
    outer:  { einMishpat:[…], torahOr:[…] },
    bottom: { rabbeinuChananel:[…], ravNissimGaon:[…] }
  }
}
```

Cache responses; never hammer the API on re-render.

---

## 2. Page frame (CSS grid) — the fixed scaffold

The outer page is a parchment-colored sheet with a thin ruled border. Use CSS **grid** for
the macro frame; floats only for the inner wrap (§3).

```
┌───────────────────────────────────────────────────────────┐
│                    running header (full width)             │
├──────┬────────────────────────────────────────────┬───────┤
│margin│                                            │margin │
│outer │            CORE  (commentary wrap +        │inner  │
│ (Ein │             Gemara overlay)                │(Mesoret│
│Mishpat│                                            │HaShas, │
│/Torah│                                            │Hagahot)│
│ Or)  │                                            │       │
├──────┴────────────────────────────────────────────┴───────┤
│        bottom commentary (Rabbeinu Chananel, R.N. Gaon)    │
└───────────────────────────────────────────────────────────┘
```

- `dir="rtl"` on the page root.
- Grid columns: `[outer] var(--margin-w) [core] 1fr [inner] var(--margin-w)`.
  **Inner = binding side = Rashi side. Outer = page-edge = Tosafot side.** For Berakhot 2a
  render **Rashi on the right, Tosafot on the left** (matches the Vilna print). Expose
  `--rashi-side: right` as a variable and flip it by amud parity if you later do spreads;
  verify against the source scan.
- `--margin-w ≈ 9–11%` of sheet width each. Margin columns use the tiny apparatus type (§4).
- Header and bottom span all three columns.

---

## 3. The CORE — Gemara block + commentary wrap (the heart of it)

This is the only part that is hard, and it is the part the current build got wrong. Do
**not** use fl/grid columns here. Use a float + `shape-outside` reservation.

### DOM
```html
<div class="core">
  <aside class="commentary">
    <div class="rashi">…rashi html…</div>            <!-- floated to --rashi-side -->
    <div class="gemara-reserve" aria-hidden="true"></div> <!-- transparent obstacle -->
    <div class="tosafot">…tosafot html…</div>         <!-- normal flow; wraps around both -->
  </aside>
  <section class="gemara">
    <span class="first-word">מאימתי</span> …rest of mishnah/gemara html…
  </section>
</div>
```

### CSS skeleton
```css
.core      { position: relative; }
.commentary{ font-family: var(--font-rashi); font-size: var(--fs-comm);
             line-height: var(--lh-comm); text-align: justify; }

/* Rashi is a SHORT floated block toward the binding side */
.rashi     { float: var(--rashi-side);
             width: calc(50% - var(--col-gap)/2);
             margin-inline-start: var(--col-gap); }

/* Invisible obstacle the size of the Gemara box, floated the same side,
   placed in flow so BOTH rashi and tosafot wrap around it at the top.   */
.gemara-reserve{
   float: var(--rashi-side);
   width:  var(--gem-reserve-w);     /* set by JS from rendered .gemara */
   height: var(--gem-reserve-h);     /* set by JS */
   shape-outside: inset(0);
   shape-margin: var(--gem-gap);
}

/* Tosafot is the normal-flow text; it wraps the reserve + rashi, then
   reclaims full width below them. */
.tosafot   { /* no float, no width — it fills and wraps */ }

/* The actual Gemara is drawn on top of the reserved hole. */
.gemara{
   position: absolute; top: 0;
   left: 50%; transform: translateX(-50%);
   width: var(--gem-w);
   font-family: var(--font-gemara); font-size: var(--fs-gem);
   line-height: var(--lh-gem); text-align: justify;
}
```

### What this produces
- Top of page: reserve pushes Rashi to one side and Tosafot to the other → Gemara center,
  Rashi inner, Tosafot outer. ✔ the flank.
- Below the Gemara box (reserve height ends): Rashi float ends / Tosafot flows back across
  center → the **staircase wrap**. ✔ the signature shape.

### JS measurement (must run after fonts load)
1. Lay out `.gemara` first (it's absolute, so it doesn't affect flow yet); measure its
   rendered `width`/`height` via `getBoundingClientRect()`.
2. Set `--gem-w` (target ≈ 46–52% of core width), then re-measure height.
3. Set `--gem-reserve-w = gem-w + 2*--gem-gap` and `--gem-reserve-h = measured height`.
4. Position `.gemara` over the reserve (centered horizontally, top-aligned under the
   Mishnah/header).
5. Run the balance pass (§5).

Use `document.fonts.ready` before measuring; webfont metrics differ from fallback.

### First word + section markers
- If `isChapterStart`, wrap `firstWord` in `.first-word`: a large boxed glyph
  (double ruled border, ~2.2× `--fs-gem`), floated to the reading start of `.gemara`.
- Render the Mishnah, then the `גמ׳` marker (small caps-like boxed/bold abbreviation)
  introducing the Gemara, exactly as the text segments indicate. On amudim that open
  mid-sugya (not a chapter start) there is **no** boxed word — start with running text.

---

## 4. Typography

Self-host the fonts; don't rely on system Hebrew.

| Region            | Font (recommended → fallback)                          | Size (relative to --fs-gem) | line-height |
|-------------------|--------------------------------------------------------|------------------------------|-------------|
| Gemara (square)   | **Frank Ruehl Libre** or Taamey Frank CLM → Tinos/serif| **1.00** (base ≈ 18–20px)    | 1.5         |
| First word (box)  | same square font, heavy                                | ~2.2                         | 1.0         |
| Rashi / Tosafot   | **true Rashi-script webfont** → square Hebrew if none  | ~0.80                        | 1.35        |
| Margin apparatus  | square Hebrew (Frank Ruehl Libre)                      | ~0.58                        | 1.2         |
| Running header    | square Hebrew, bold                                    | ~0.9                         | 1.0         |

Define everything as CSS custom properties so the balance pass can nudge them:
```css
:root{
  --fs-gem: 19px; --lh-gem: 1.5;
  --fs-comm: calc(var(--fs-gem) * 0.80); --lh-comm: 1.35;
  --fs-margin: calc(var(--fs-gem) * 0.58); --lh-margin: 1.2;
  --col-gap: 1.1em; --gem-gap: 0.55em;
  --rashi-side: right;
  --paper: #f3ead6; --ink: #1c1206; --rule: #b9a77c;
}
```
- Square Hebrew + `text-align: justify` is what gives the dense block edges. Hebrew does not
  hyphenate — rely on justification, not `hyphens`.
- If no acceptable Rashi-script webfont is available, fall back to square Hebrew at the
  reduced size (this is what Sefaria itself does); note the substitution in a code comment.
- Bold catchwords (`<b>`) inside Rashi/Tosafot must remain bold — they are the דיבור־המתחיל.

---

## 5. Balance pass (kill the "variable length" look)

After §3 measurement, equalize the three bottoms to the page bottom margin, mimicking
hand-typesetting. Pure CSS cannot do this; use a short JS loop with **tight** bounds so text
stays legible:

```
target = core bottom margin (y)
for stream in [gemara, rashi, tosafot]:
    binary-search font-size in [0.92, 1.06] × base   (and/or line-height in [1.25,1.55])
    until stream.bottom ≈ target (±a few px)
re-measure gemara box → re-set reserve → repeat once (2–3 iterations converge)
```
Adjust in this priority: line-height first (least ugly), then letter-spacing (±0.2px), then
font-size last. Never compress beyond the bounds; if a stream still overflows, that daf
genuinely has more text — let it run slightly longer rather than shrink to unreadable, and
log it. Accept ±1 line of raggedness at the bottom; the **top wrap is what the eye reads as
authentic**, so prioritize that.

---

## 6. Marginal apparatus + cross-reference keying

**Fixed positions** (render only streams that have content; slot collapses if empty):
- Inner margin, top→down: **Masoret HaShas**, then Hagahot HaBach / Gilyon HaShas / Mussaf Rashi.
- Outer margin, top→down: **Ein Mishpat Ner Mitzvah**, then **Torah Or**.
- Bottom band: **Rabbeinu Chananel**, then **Rav Nissim Gaon** (Sefer HaMafteach), full width.

**Keying system** (the superscript letters):
1. Walk the Gemara segments in reading order. For each cross-ref/halacha/verse note anchored
   to a segment, assign the next Hebrew letter in sequence: א, ב, ג … (restart per amud).
2. Insert a small superscript marker (`<sup class="key">א</sup>`) at that segment's anchor
   point in the main text. Segment-level placement is the pragmatic default; true word-level
   placement requires matching the note's lemma — only attempt if the link payload gives a
   usable dibur-hamatchil.
3. Prefix the matching margin note with the same letter.
4. Keep separate letter sequences per apparatus type if the edition does (Masoret vs Ein
   Mishpat use independent runs in the Vilna print) — make this a config flag.

Apparatus type: `--fs-margin`, line-height 1.2, justified, very narrow measure.

---

## 7. Generalization rules (any future daf)

Make the renderer take `(tractate, daf, amud)` and apply:

1. **Always fetch the exact daf ref** (`{Tractate}.{N}{a|b}`); render the full returned
   segment array. The data source defines the fixed content — do not re-paginate.
2. **Rashi inner, Tosafot outer**, always. `--rashi-side` follows binding/amud parity if you
   render two-page spreads; for standalone single dapim, match the printed Vilna for that
   amud and verify against a scan.
3. **Boxed first word + Mishnah header only when the amud begins a chapter or tractate**
   (`isChapterStart`/new Mishnah). Otherwise the amud opens with running Gemara, no box.
4. **Probe each apparatus stream; render present, omit absent.** Positions are tradition-
   fixed (§6) regardless of which exist. Never invent content to fill a slot.
5. **Re-run measurement + balance per page** — every daf has different text volume; the
   font-size/line-height nudges are computed, never hard-coded per daf.
6. **Keep all size ratios constant** via the CSS variables in §4; only the base `--fs-gem`
   and the per-stream nudges change. This keeps every daf recognizably the same edition.
7. **Cross-ref letters restart per amud**, assigned in reading order.
8. **Preserve inline HTML** (bold lemmas, `<br>`, footnotes) on every stream; sanitize once,
   centrally.
9. **Degrade gracefully**: missing Rashi or Tosafot (rare, but happens) → the present
   commentary takes the freed space; the wrap still keys off the Gemara reserve.

---

## 8. Acceptance checklist (compare against a Vilna scan of the daf)

- [ ] Gemara is a centered block; Rashi and Tosafot **flank it at top and flow under it**.
- [ ] Two distinct fonts (square Gemara, semi-cursive commentary).
- [ ] Boxed first word (chapter-start dapim only) + `גמ׳` marker.
- [ ] Bold catchwords visible in Rashi/Tosafot.
- [ ] Apparatus in correct fixed margins; superscript letters match margin notes.
- [ ] All three core streams reach within ~1 line of the bottom margin.
- [ ] Justified text, no nikud, RTL throughout, parchment sheet with ruled border.
- [ ] Re-rendering a *different* daf (e.g., `Berakhot.3a`) needs zero per-daf code changes.

---

### Reference reading for the implementer
- Sefaria v3 API: `https://www.sefaria.org/api/v3/texts/Berakhot.2a`; links:
  `https://www.sefaria.org/api/links/Berakhot.2a`; dev docs at developers.sefaria.org.
- The float + `shape-outside` daf technique is the established approach (see Noah Liebman's
  "Talmud CSS" write-up); this spec adapts it with a measured reserve + balance pass.
