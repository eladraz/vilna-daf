# Translation kit: adding translated text to Vilna Daf

This folder has everything needed to translate a tractate into Russian, Yiddish, French,
Spanish or Korean (`ru yi fr es ko`). The translations can be done by Claude, another LLM agent,
or a person. The kit is how Berachot (all languages) and Shabbat (`yi fr es ko`) were translated.

| File | Purpose |
|---|---|
| `README.md` | This guide: the data model, the pipeline, how to run agents, and what can go wrong. |
| `TRANSLATOR.md` | The full brief for one translator (agent or person) working on one batch: formats, rules and style per language. Give it to every worker. |
| `i18n_lib.py` | Shared code: loading pages, validation and source metadata. |
| `i18n_cut.py` | Cuts a tractate into batches of about 7,000 Hebrew words per language. |
| `i18n_check.py` | Validates one translated batch. It is read-only, and workers run it themselves. |
| `i18n_merge.py` | Merges validated batches into `data/offline/`, and reports coverage. |

The scripts need only Python 3 (standard library). Run every command from the repository root,
the folder that contains `translation-kit/` and `data/`.

---

## 1. The data

Each amud is one file, `data/offline/<Tractate>/<daf><side>.json` (schema `vilna-text/1`):

```
{
  "schema": "vilna-text/1",
  "ref": "Shabbat.12a",
  "langs": {
    "he": {"gemara": [...], "rashi": [[...], ...], "tosafot": [[...], ...], "gilyonHaShas": [...], ...},
    "en": {"gemara": [...], ...},            // Sefaria English: used as an aid only
    "ru": {...}, "yi": {...}, ...            // machine translations, written by i18n_merge.py
  },
  "sources": {                               // one licence record per block and language
    "gemara": {"he": {...}, "en": {...}, "fr": {"title": "Machine translation from Hebrew/Aramaic with English as an aid",
                                               "license": "derived", "derivedFrom": ["CC-BY-NC"], "pd": false,
                                               "special": true, "show": true, "mt": true}},
    ...
  },
  "apparatus": {...}                         // Masoret HaShas / Ein Mishpat / Torah Or: NOT handled here (see section 8)
}
```

**Blocks to translate.** A block is translated when the Hebrew has text and
`sources[block].he.show` is `true`. Typical blocks are `gemara`, `rashi`, `tosafot`, `gilyonHaShas`
and `ravNissimGaon`, plus `rashbam`, `ran` and others on some tractates. Blocks with `show: false`
are skipped, for example `rabbeinuChananel` on Shabbat.

**Shapes.** A translation has exactly the same nesting and list lengths as the Hebrew:
- `gemara` is a list of segment strings;
- `rashi` and `tosafot` are a list per Gemara segment, each a list of comments, often empty `[]`.

The viewer pairs translated and Hebrew text by position, so one Hebrew string always gives
exactly one translated string.

**Tractate names** are the directory names under `data/offline/`, which are Sefaria's spellings:
`Shabbat`, `Moed Katan`, `Bava Batra`, and so on. Berakhot's directory is `Berachot`.

**Licence.** Every translated block is derived from the Hebrew (and, where used, the English) of
Sefaria's William Davidson edition, licensed CC-BY-NC. `i18n_merge.py` writes the
`sources[block][lang]` record (title, `derived`, `derivedFrom`, `pd`, `special`, `show`, `mt`), and the
viewer shows it in the sources note. Never translate from, or copy, anything that is not in these
files: no PDFs, no other websites.

---

## 2. The pipeline

```
cut  ──►  translate (one worker per batch)  ──►  check (worker loops until OK)  ──►  merge (one process, serial)  ──►  look at it
```

### Step 1: cut the batches

```
python3 translation-kit/i18n_cut.py --tractate "Moed Katan" --lang all      # ru yi fr es ko
python3 translation-kit/i18n_cut.py --tractate Shabbat --lang fr            # one language
python3 translation-kit/i18n_cut.py --tractate Shabbat --lang yi --pages pages.txt --prefix pilot   # pilot
```

- **Output:** `data/offline-work/i18n/<Tractate>/<lang>/in/batch-NNNN.json`. Spaces in the tractate
  name become `_`. Pass `--work DIR` to use another folder; `--work` must then be given to all three
  scripts.
- **What goes in:** only blocks that are shown and not yet translated in that language, so a cut
  after a partial merge picks up only what is missing.
- **Batch size:** `--target 7000` Hebrew words by default (`--max 8500`). Pages are never split.
  Use `--target 4500` for small-context models.
- **Cut once, before you launch workers.** Cutting again renumbers the batches and deletes the
  `in/` files that have the same prefix.

The cutter prints the batch count and total words. For scale: Moed Katan is 55 amudim and about
134k Hebrew words, which is 19 batches per language. Shabbat is 312 amudim and about 419k words,
which is 61 batches per language.

### Step 2: translate (workers)

Each worker gets one batch, and this instruction is enough:

> Translate batch `batch-0007` of tractate `Moed Katan` into `fr`. Read `translation-kit/TRANSLATOR.md`
> completely and follow it exactly.

The worker:
1. reads `<WORK>/<lang>/in/batch-0007.json`;
2. writes `<WORK>/<lang>/out/batch-0007.json`. Large batches go in parts, `batch-0007.part1.json`,
   `.part2.json` and so on, split by pages;
3. runs the check and fixes what it reports, until the last line says `OK`.

`TRANSLATOR.md` covers the formats, the content rules (dialogue, lemmas, references, brackets) and
the per-language style, including transliteration tables that match the finished Berachot pages.

### Step 3: check (read-only)

```
python3 translation-kit/i18n_check.py --tractate "Moed Katan" --lang fr --batch batch-0007
```

The check fails a batch for any of these:
- bad JSON, or missing or extra pages or blocks;
- a list length or nesting that differs from the Hebrew;
- an empty string where the Hebrew has text;
- inline tags (`<b>`, `<big>`, `<br>` …) that are not exactly those of the Hebrew string;
- a newline or markdown in a string;
- the wrong script for the language: ru Cyrillic, yi Hebrew letters (with no `װ`/`ױ` ligatures), ko
  Hangul, fr/es Latin, and no stray Cyrillic or Hangul;
- an unchanged copy of the Hebrew or the English, or English-looking French or Spanish;
- an implausible length, which usually means truncated text.

On the finished Berachot translations it gives 1 false positive in 26,736 strings.

### Step 4: merge (one process at a time)

```
python3 translation-kit/i18n_merge.py --tractate "Moed Katan" --lang fr --all --dry-run   # report only
python3 translation-kit/i18n_merge.py --tractate "Moed Katan" --lang fr --all             # merge every finished batch
python3 translation-kit/i18n_merge.py --tractate "Moed Katan" --lang fr --batch batch-0007
python3 translation-kit/i18n_merge.py --tractate "Moed Katan" --lang fr --status          # e.g. "fr: 1234/1311 shown blocks translated"
```

- **What gets written:** only blocks that pass the check, and only `langs[lang][block]` and
  `sources[block][lang]` on the batch's pages. Every other byte of the file is kept.
- **Existing translations:** never overwritten unless you pass `--overwrite`. Re-running a merge is
  safe, because it skips blocks that are already there.
- **Merge serially. Never merge from inside parallel workers.** The `yi` and `fr` batches with the same
  number cover the same page files, so two merges at once would overwrite each other's changes.

### Step 5: look at it

Serve the repository and open an amud in the new language:

```
python3 -m http.server 8080        # from the repository root
# http://localhost:8080/?tractate=Moed%20Katan&page=3&side=a&textlang=fr
```

`textlang` is one of `he en ru yi fr es ko`. Check four things:
- the direction: Yiddish is right-to-left;
- the language tag;
- that no Hebrew is left in Rashi or Tosafot;
- that the sources note at the bottom shows *Machine translation from Hebrew/Aramaic with English as
  an aid*.

The Vilna sheet layout of a translated page also needs the layout layers (section 7). Without them,
the page shows the flowing layout, which is still correct.

---

## 3. Running many workers

Any agent can be a worker if it can read and write files and run `python3`. Rules for every worker:
- write only inside `<WORK>/<lang>/out/`;
- never edit `data/offline/` or the input batch;
- never run `i18n_merge.py`;
- translate the text itself: no machine-translation API and no script that generates text. Python
  is only for patching JSON and running the check;
- reply with `<lang> <batch> OK` or the problems it could not fix.

**Claude Code workflow.** This is the script used for Shabbat: 244 Haiku workers, about 14 at a time.

```js
export const meta = { name: 'translate-tractate', description: 'Translate one tractate, one agent per batch',
                      phases: [{ title: 'Translate' }] }
const T = args.tractate, LANGS = args.langs, N = args.batches     // e.g. {tractate:'Moed Katan', langs:['fr','es'], batches:19}
const items = []
for (let i = 1; i <= N; i++) for (const lang of LANGS) items.push({ lang, batch: 'batch-' + String(i).padStart(4, '0') })
const SCHEMA = { type: 'object', properties: { lang: {type:'string'}, batch: {type:'string'}, ok: {type:'boolean'}, notes: {type:'string'} },
                 required: ['lang', 'batch', 'ok'] }
const res = await parallel(items.map(it => () => agent(
  `Translate batch ${it.batch} of tractate "${T}" into "${it.lang}". cd to the repository root first.
   Read translation-kit/TRANSLATOR.md completely and follow it exactly. Write the output in parts of at most
   ~2,500 Hebrew words each. Run translation-kit/i18n_check.py --tractate "${T}" --lang ${it.lang} --batch ${it.batch}
   and fix every problem until it passes. Do NOT run i18n_merge.py; write nothing outside the out/ folder.`,
  { label: `${it.lang}:${it.batch}`, model: 'haiku', schema: SCHEMA })))
return { failed: items.filter(it => !res.some(r => r && r.lang === it.lang && r.batch === it.batch && r.ok)) }
```

When it finishes:
1. Run `i18n_merge.py --all` once per language, one language after another.
2. Re-run the failed batches; a later cut also picks up anything missing.
3. Check `--status`.

**Other agents and tools.** Send the same one-paragraph instruction per batch, plus the file
`TRANSLATOR.md`. Agents without file access can work on JSON text, as long as you save each reply to
the `out/` path yourself and run the check for them.

**Cost per batch** (about 7k Hebrew words):
- **Input:** about 33k tokens (Hebrew, the English aid and TRANSLATOR.md).
- **Output:** about 20–35k tokens. Korean and Yiddish are the largest.
- **With fix rounds:** budget 60–100k tokens.

Big outputs can exceed a single write; that is why workers write in parts.

**Quality pass (recommended).** For a second pass, give a stronger model (or a fluent person) a batch
together with its output, and ask it to correct mistranslations, names that don't follow the tables
in TRANSLATOR.md, and missing sentences. Then run the check and the merge with `--overwrite` for that
batch. Berachot Russian went through such a review: about 1,400 corrected leaves.

---

## 4. Common problems

| Symptom | Cause and fix |
|---|---|
| `list has 14 items but the Hebrew has 15` | The worker merged or dropped a segment. Each Hebrew string maps to exactly one output string; empty `[]` lists stay empty. |
| `inline tags differ` | A tag was dropped, or an English `<i>`/`<sup>` was added. Copy the Hebrew string's tags only. |
| `Hebrew in data/offline changed since the batch was cut; re-cut` | The source changed after cutting. Re-cut the remaining pages (`--pages`, with a new `--prefix`). |
| Invalid JSON | An ASCII `"` inside a string. Use `« »` / `„ ”`, as TRANSLATOR.md says. |
| Yiddish `ligature letters` | Write `וו`, `וי` and `ײַ`, never `װ ױ ײ`. |
| Output cut off mid-batch | The model's output limit. Write in `.partK.json` files, or cut with a smaller `--target`. |
| `far too short` | Text was skipped or summarised. Translate in full. |
| Two merges ran at once, and one language vanished from a page | Merges ran in parallel. Re-run the merge for that language: it re-adds what is missing and skips what is present. |

---

## 5. After merging

- **Licence:** `LICENSE.md` already covers the machine-translated languages (Russian, Yiddish, French,
  Spanish, Korean, made by Elad Raz using AI models, under the Vilna-Daf licence). A new language
  needs its line added there.
- **Git:** `data/offline/` is versioned; `data/offline-work/` is local and ignored. Commit only the
  merged `data/offline/<Tractate>/*.json` files.

---

## 6. Adding a new language

1. **The kit.** Add the code to `LANGS` in `i18n_lib.py`, plus a script rule and a length range in
   `string_problems`, and a section in TRANSLATOR.md with the transliteration table. Translate one
   page by hand as a pilot.
2. **The viewer.** Edit `vilna-daf.js`:
   - the language list near the top (`{ id, label, dir, mt }`);
   - `TSHEET_I18N`, the sheet labels;
   - `TSHEET.FAMILY`, the font stack;
   - the CSS language stacks in `css/daf.css`.

   If the script needs a font that isn't bundled, add a subset to `fonts/` with its OFL licence and
   list it in `LICENSE.md`.
3. **Apparatus translations** for the new language (section 8).

---

## 7. Vilna sheet layouts for translated pages (optional, after merging)

The strict Vilna layout of a translated amud is a refs-only layer file,
`data/vilna-layout/vilna-ref1/<Tractate>/<amud>.<lang>.json`, built by the layout builder (rule
tsplit/1, and tsplit/2 for tractates other than Berachot). The builder scripts are development tools
and not part of this kit. Ask the maintainer to run them after a tractate is merged. Translations
must be merged before layers are built, because a layer stores token ranges into the merged text,
and changing the text later invalidates them.

---

## 8. Not covered here

- **Apparatus** (Masoret HaShas, Ein Mishpat and Torah Or titles and verses). These are built by a
  separate apparatus pipeline and already exist in all seven languages for every tractate.
- **English.** It comes from Sefaria (William Davidson edition, Tosafot by Jan Buckler where
  available) and is never machine-translated.
