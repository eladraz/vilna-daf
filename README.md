# Vilna Daf — צורת הדף

A browser-based static HTML renderer for Talmud pages in the classic **Vilna "Tzurat HaDaf"**
layout. Renders the Gemara (center), Rashi (inner column), and Tosafot (outer column) with
full marginal apparatus (Masoret HaShas, Ein Mishpat, Torah Or), reference-key linking, and
cross-column hover highlighting. All text sourced from the [Sefaria](https://www.sefaria.org)
API (William Davidson / Koren Noé Talmud).

## Why

Written by **Elad Raz** ([e@eladraz.com](mailto:e@eladraz.com)). This library is my way of
giving anyone a way to add Torah on the Gemara — chiddushim, notes, and commentary — in the
form everyone already loves to read: the classic printed Vilna daf. The same page renders
beautifully on screen and prints cleanly, so Torah you publish with it can live both in the
browser and on paper, exactly where learners expect to find it — on the daf itself.

## Quick Start

```bash
# Serve the static site
python3 -m http.server 8000

# Open in browser
open http://localhost:8000

# Or load a specific daf directly:
open "http://localhost:8000/?tractate=Berachot&page=2&side=a"
```

## Library Usage

The renderer is a self-contained library (`vilna-daf.js`, 22 KB, zero dependencies).

### Script Tag

```html
<link rel="stylesheet" href="css/daf.css">
<script src="vilna-daf.js"></script>
<script>
  const renderer = new VilnaDaf({ container: '#daf-content' });
  await renderer.load('Berachot', 2, 'a');
</script>
```

### API

#### `new VilnaDaf(opts)`

| Option | Type | Description |
|--------|------|-------------|
| `container` | `string \| HTMLElement` | CSS selector or DOM element to render into |

#### `await renderer.load(tractate, page, side)`

Load and render a specific daf.

| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `tractate` | `string` | `'Berachot'`, `'Shabbat'` | English tractate name |
| `page` | `number` | `2` | Daf number (Talmud starts at 2) |
| `side` | `string` | `'a'`, `'b'` | Amud side |

Returns the parsed model object.

#### `await renderer.loadFromURL()`

Reads `?tractate=...&page=...&side=...` from the URL query string and loads that daf.
Supports short form: `?m=Berachot&d=3&s=b`.

#### `await renderer.getTractates()`

Returns the tractate metadata array (37 tractates with Hebrew/English names, page counts).

#### `renderer.onLoad(fn)`

Register a callback invoked after each successful load. Receives the model object.

#### `renderer.current`

The most recently loaded model (or `null`).

#### Static helpers

```js
VilnaDaf.heb(15);          // → 'ט״ו'  (Hebrew numeral)
VilnaDaf.HEBREW_NUMERAL(2); // → 'ב׳'
```

### URL Parameters

| Parameter | Aliases | Example | Description |
|-----------|---------|---------|-------------|
| `tractate` | `masechet`, `m` | `Berachot` | Tractate name |
| `page` | `daf`, `d` | `2` | Daf number |
| `side` | `amud`, `s` | `a` | Amud side |

## How It Works

### Architecture

```
┌────────────────────────────────────────────────┐
│                  vilna-daf.js                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Data    │  │  Layout  │  │   Renderer   │  │
│  │  Layer   │  │  Engine  │  │   (DOM+CSS)  │  │
│  │ (Sefaria │  │ (Bands + │  │              │  │
│  │   API)   │  │Absorption│  │              │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└────────────────────────────────────────────────┘
```

### Layout Law

The page is tiled top-to-bottom in horizontal **bands**. In each band, streams that are
"alive" at that height share the full core width by an **absorption rule**: when a stream
ends, the adjacent alive stream absorbs its column.

```
Band sequence (top→bottom):
  {Rashi, Tosafot}  →  50/50 split (above Gemara)
  {Rashi, Gemara, Tosafot}  →  C0 · center · C0
  {Gemara, Tosafot} →  Gemara absorbs Rashi column (one-sided widening)
  {Tosafot}         →  full width (both ended)
```

Commentaries anchor at `y=0` (top of page). Gemara anchors at `y_top_gem` (small inset for
the first-word box). Only **end positions** are computed; starts are fixed.

### Fonts

| Stream | Font | Source |
|--------|------|--------|
| Gemara | FrankRuehl CLM (square Hebrew) | Self-hosted WOFF2 (GPL) |
| Rashi / Tosafot | Noto Rashi Hebrew (semi-cursive) | Self-hosted WOFF2 (SIL) |
| Margins | FrankRuehl CLM (tiny) | Self-hosted WOFF2 |

### Features

- **Cross-column hover**: Hover any Gemara segment → highlights matching Rashi + Tosafot
  comments (and vice versa). Uses CSS Highlight API with class-based fallback.
- **Reference-key linking**: In-text Hebrew letter keys (א ב ג) link to margin apparatus
  notes. Click scrolls + highlights.
- **Zoom/pan**: Ctrl+wheel to zoom, drag to pan, double-click to reset.
- **Text selection**: Native selection works — no per-word span wrapping.
- **Offline-first**: Pre-fetch data as JSON to `data/{Tractate}/{page}{side}.json`.
- **Generalized**: Same code renders any daf. Zero per-daf tuning.

## Project Structure

```
├── vilna-daf.js     # Self-contained library (data + layout + render)
├── index.html           # Example page with navigation bar
├── css/daf.css          # Stylesheet (fonts, layout, highlights)
├── fonts/               # FrankRuehl + Noto Rashi Hebrew WOFF2
├── data/
│   ├── tractates.json   # Tractate metadata
│   └── Berachot/        # Pre-fetched daf JSON (one file per amud)
│       ├── 2a.json
│       └── ...
├── scripts/
│   └── fetch_daf.py     # Pre-fetch dapim from Sefaria into data/
├── harness/             # Acceptance matrix (check.mjs + run.sh)
├── PROGRESS.md          # Fix log + matrix results + screenshots
├── CALIBRATION.md       # Layout calibration data
└── README.md
```

## Running Tests

```bash
# Refresh cached test data (optional; matrix pages are committed)
python3 scripts/fetch_daf.py --matrix

# Run the acceptance matrix (starts its own static server)
bash harness/run.sh            # full matrix + one random held-out daf
bash harness/run.sh Berachot 5 b   # single page
```

Each page is checked for: sheet aspect 0.707, Gemara width/widening, zero stream
overlaps, no empty plan-occupied cells, sanitizer/diacritics health, loaded Rashi font,
Hebrew-only header, < 2 s cached load, and relaxation convergence (≤ 8 rounds).

## Goals & Non-Goals

**Goals:**
- Faithful reproduction of the Vilna Tzurat HaDaf layout
- Two distinct fonts (square Hebrew + Rashi script)
- Full marginal apparatus where data exists
- Text-exact rendering (no truncation, no fabrication)
- Generalized: works on any daf with zero code changes
- Accessible: keyboard navigation, touch support, zoom

**Non-goals:**
- Pixel-identical match to metal-type scans (font differences are a known residual)
- Server-side rendering
- Vocalized/pointed text (uses plain Vilna edition where available)

## Credits

Text from [Sefaria](https://www.sefaria.org) — the William Davidson digital edition of the
Koren Noé Talmud, with commentary by Rabbi Adin Even-Israel Steinsaltz. Licensed under
[CC-BY-NC](https://creativecommons.org/licenses/by-nc/4.0/). See [LICENSE.md](LICENSE.md)
for details.

Fonts: FrankRuehl CLM (Culmus Project, GPL) and Noto Rashi Hebrew (Google Fonts, SIL Open
Font License).

## License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md).
