/**
 * vilna-daf.js — Vilna Tzuras HaDaf renderer (the ONLY engine).
 *
 * Layout machinery (MASTER-SPEC §2 realization):
 *   1. SOLVER  — pure band/absorption law: per horizontal band, which streams
 *      are alive and the exact [right,left] extent each one owns.
 *   2. RENDERER — per stream, one absolutely-positioned container holding
 *      exactly two full-height floats whose shape-outside polygons carve away
 *      everything that is NOT that stream's staircase. The text itself has no
 *      float, no width, no overflow:hidden — it flows into what the polygons
 *      leave open.
 *   3. RELAXATION — widths→heights is a fixpoint: render, measure each
 *      stream's true text end (Range around the last text node), re-solve,
 *      re-emit polygons; ≤ 8 rounds.
 *   4. FILL — the sheet is a fixed page (aspect w/h = 0.707); a single global
 *      font scale is searched so the text ends at the bottom of the core.
 *
 * Public API (unchanged):
 *   const renderer = new VilnaDaf({ container: '#daf-content' });
 *   await renderer.load('Berachot', 2, 'a');
 */
(function (global) {
  'use strict';

  // ═════════════════════════ Configuration ═════════════════════════

  const SEFARIA_TEXTS = 'https://www.sefaria.org/api/v3/texts';
  const SEFARIA_LINKS = 'https://www.sefaria.org/api/links';
  const SEFARIA_INDEX = 'https://www.sefaria.org/api/v2/index';
  const GEMARA_VERSION = 'hebrew|William Davidson Edition - Aramaic';

  const SEFARIA_MAP = {
    Berachot: 'Berakhot', Shabbat: 'Shabbat', Eiruvin: 'Eiruvin', Pesachim: 'Pesachim',
    Shekalim: 'Shekalim', Yoma: 'Yoma', Sukkah: 'Sukkah', Beitzah: 'Beitzah',
    'Rosh Hashanah': 'Rosh Hashanah', Taanit: 'Taanit', Megillah: 'Megillah',
    'Moed Katan': 'Moed Katan', Chagigah: 'Chagigah', Yevamot: 'Yevamot',
    Ketubot: 'Ketubot', Nedarim: 'Nedarim', Nazir: 'Nazir', Sotah: 'Sotah',
    Gittin: 'Gittin', Kiddushin: 'Kiddushin', 'Bava Kamma': 'Bava Kamma',
    'Bava Metzia': 'Bava Metzia', 'Bava Batra': 'Bava Batra', Sanhedrin: 'Sanhedrin',
    Makkot: 'Makkot', Shevuot: 'Shevuot', 'Avodah Zarah': 'Avodah Zarah',
    Horayot: 'Horayot', Zevachim: 'Zevachim', Menachot: 'Menachot', Chullin: 'Chullin',
    Bechorot: 'Bechorot', Arachin: 'Arachin', Temurah: 'Temurah', Keritot: 'Keritot',
    Meilah: 'Meilah', Niddah: 'Niddah',
  };

  // ── Source catalogs (Settings feature) ─────────────────────────
  // The page reconstructs around whatever the user selects here; the
  // shipped defaults reproduce the classic Vilna page exactly.

  /** Editions of the main (center) text. `strip` = apply the Vilna
   *  diacritics/punctuation strip; `dir` = text direction of the stream. */
  const EDITIONS = {
    vocalized: { he: 'ארמית מנוקדת', version: 'hebrew|William Davidson Edition - Vocalized Aramaic', strip: false, dir: 'rtl' },
    aramaic: { he: 'ארמית ללא ניקוד', version: 'hebrew|William Davidson Edition - Aramaic', strip: true, dir: 'rtl' },
    wikisource: { he: 'ויקיטקסט תלמוד בבלי', version: 'hebrew|Wikisource Talmud Bavli', strip: true, dir: 'rtl' },
    english: { he: 'English — William Davidson', version: 'english|William Davidson Edition - English', strip: false, dir: 'ltr' },
  };

  const refOn = name => m => `${name} on ${m}`;
  const refFixed = ref => () => ref;

  /** Texts that can occupy the two wrap columns (inner/outer). */
  const WRAP_COMMENTARIES = [
    { id: 'rashi', he: 'רש״י', ref: refOn('Rashi') },
    { id: 'tosafot', he: 'תוספות', ref: refOn('Tosafot') },
    { id: 'rashbam', he: 'רשב״ם', ref: refOn('Rashbam') },
    { id: 'ran', he: 'ר״ן', ref: refOn('Ran') },
    { id: 'rif', he: 'רי״ף', ref: m => `Rif ${m}` },
    { id: 'rosh', he: 'רא״ש', ref: refOn('Rosh') },
    { id: 'rabbeinuChananel', he: 'רבינו חננאל', ref: refOn('Rabbeinu Chananel') },
    { id: 'rabbeinuGershom', he: 'רבינו גרשום', ref: refOn('Rabbeinu Gershom') },
    { id: 'mefaresh', he: 'מפרש (תמיד)', ref: refFixed('Mefaresh on Tamid') },
    { id: 'ktavYadRashi', he: 'כתב יד רש״י', ref: refOn('Ktav Yad Rashi') },
    { id: 'tosafotYeshanim', he: 'תוספות ישנים', ref: refOn('Tosafot Yeshanim') },
    { id: 'tosafotRid', he: 'תוספות רי״ד', ref: refOn('Tosafot Rid') },
    { id: 'tosafotShantz', he: 'תוספות שאנץ', ref: refOn('Tosafot Shantz') },
    { id: 'tosafotHaRosh', he: 'תוספות הרא״ש', ref: refOn('Tosafot HaRosh') },
    { id: 'tosafotRiHaZaken', he: 'תוספות ר״י הזקן', ref: refOn('Tosafot Ri HaZaken') },
    { id: 'tosafotChadMikamei', he: 'תוספות חד מקמאי (יבמות)', ref: refFixed('Tosafot Chad Mikamei on Yevamot') },
    { id: 'piskeiTosafot', he: 'פסקי תוספות', ref: refOn('Piskei Tosafot') },
    { id: 'steinsaltz', he: 'שטיינזלץ', ref: refOn('Steinsaltz') },
  ];

  /** Additional commentaries, toggled on/off. `slot:'margin'` renders in the
   *  inner margin; everything else in the strip below the core. A commentary
   *  that does not exist for the current daf is silently omitted. */
  const EXTRA_COMMENTARIES = [
    // ── ראשונים ──
    { id: 'rabbeinuChananel', he: 'רבינו חננאל', ref: refOn('Rabbeinu Chananel'), group: 'rishonim' },
    { id: 'ravNissimGaon', he: 'רב נסים גאון', ref: refOn('Rav Nissim Gaon'), group: 'rishonim' },
    { id: 'chiddusheiRamban', he: 'חידושי הרמב״ן', ref: refOn('Chiddushei Ramban'), group: 'rishonim' },
    { id: 'rashba', he: 'רשב״א', ref: refOn('Rashba'), group: 'rishonim' },
    { id: 'ritva', he: 'ריטב״א', ref: refOn('Ritva'), group: 'rishonim' },
    { id: 'meiri', he: 'מאירי', ref: refOn('Meiri'), group: 'rishonim' },
    { id: 'yadRamah', he: 'יד רמ״ה', ref: refOn('Yad Ramah'), group: 'rishonim' },
    { id: 'riMigash', he: 'ר״י מיגאש', ref: refOn('Ri Migash'), group: 'rishonim' },
    { id: 'commentaryRosh', he: 'פירוש הרא״ש', ref: refOn('Commentary of the Rosh'), group: 'rishonim' },
    { id: 'mordechai', he: 'מרדכי (בבא בתרא)', ref: refFixed('Mordechai on Bava Batra'), group: 'rishonim' },
    { id: 'chiddusheiRaah', he: 'חידושי הרא״ה (כתובות)', ref: refFixed("Chiddushei HaRa'ah on Ketubot"), group: 'rishonim' },
    { id: 'chiddusheiRambam', he: 'חידושי הרמב״ם (ר״ה)', ref: refFixed('Chiddushei HaRambam on Rosh Hashanah'), group: 'rishonim' },
    // ── אחרונים ──
    { id: 'hagahotHaBach', he: 'הגהות הב״ח', ref: refOn('Hagahot HaBach'), group: 'acharonim', slot: 'margin' },
    { id: 'gilyonHaShas', he: 'גליון הש״ס', ref: refOn('Gilyon HaShas'), group: 'acharonim', slot: 'margin' },
    { id: 'arukhLaNer', he: 'ערוך לנר', ref: refOn('Arukh LaNer'), group: 'acharonim' },
    { id: 'benYehoyada', he: 'בן יהוידע', ref: refOn('Ben Yehoyada'), group: 'acharonim' },
    { id: 'benayahu', he: 'בניהו', ref: refOn('Benayahu'), group: 'acharonim' },
    { id: 'akivaEiger', he: 'חידושי רבי עקיבא איגר', ref: refOn('Chiddushei Rabbi Akiva Eiger'), group: 'acharonim' },
    { id: 'chidusheiAgadot', he: 'חידושי אגדות (מהר״ל)', ref: refOn('Chidushei Agadot'), group: 'acharonim' },
    { id: 'chidusheiHalachot', he: 'חידושי הלכות (מהרש״א)', ref: refOn('Chidushei Halachot'), group: 'acharonim' },
    { id: 'chatamSofer', he: 'חידושי חתם סופר', ref: refOn('Chidushei Chatam Sofer'), group: 'acharonim' },
    { id: 'chokhmatShlomo', he: 'חכמת שלמה', ref: refOn('Chokhmat Shlomo'), group: 'acharonim' },
    { id: 'einAyah', he: 'עין איה', ref: refOn('Ein Ayah'), group: 'acharonim' },
    { id: 'haflaah', he: 'הפלאה (כתובות)', ref: refFixed('Haflaah on Ketubot'), group: 'acharonim' },
    { id: 'yaavetz', he: 'הגהות יעב״ץ', ref: refOn("Haggahot Ya'avetz"), group: 'acharonim' },
    { id: 'maharam', he: 'מהר״ם', ref: refOn('Maharam'), group: 'acharonim' },
    { id: 'maharamSchiff', he: 'מהר״ם שיף', ref: refOn('Maharam Schiff'), group: 'acharonim' },
    { id: 'maritHaAyin', he: 'מראית העין', ref: refOn('Marit HaAyin'), group: 'acharonim' },
    { id: 'peneiYehoshua', he: 'פני יהושע', ref: refOn('Penei Yehoshua'), group: 'acharonim' },
    { id: 'petachEinayim', he: 'פתח עינים', ref: refOn('Petach Einayim'), group: 'acharonim' },
    { id: 'rashash', he: 'רש״ש', ref: refOn('Rashash'), group: 'acharonim' },
    { id: 'shaareiToratBavel', he: 'שערי תורת בבל', ref: refOn("Sha'arei Torat Bavel"), group: 'acharonim' },
    { id: 'shitaMekubetzet', he: 'שיטה מקובצת', ref: refOn('Shita Mekubetzet'), group: 'acharonim' },
    { id: 'tzlach', he: 'צל״ח', ref: refOn('Tziyyun LeNefesh Chayyah'), group: 'acharonim' },
    { id: 'beerSheva', he: 'באר שבע', ref: refOn("Be'er Sheva"), group: 'acharonim' },
    { id: 'chiddusheiHaRim', he: 'חידושי הרי״ם', ref: refOn('Chiddushei HaRim'), group: 'acharonim' },
    { id: 'dorRevii', he: 'דור רביעי (חולין)', ref: refFixed("Dor Revi'i on Chullin"), group: 'acharonim' },
    { id: 'gevuratAri', he: 'גבורת ארי', ref: refOn('Gevurat Ari'), group: 'acharonim' },
    // ── בני ימינו ──
    { id: 'steinsaltz', he: 'שטיינזלץ', ref: refOn('Steinsaltz'), group: 'modern' },
    { id: 'dafShevui', he: 'דף שבועי', ref: m => `Daf Shevui to ${m}`, group: 'modern' },
    { id: 'reshimotShiurim', he: 'רשימות שיעורים', ref: refOn('Reshimot Shiurim'), group: 'modern' },
    { id: 'beurReuven', he: 'באור ראובן (ב״ק)', ref: refFixed('Beur Reuven on Bava Kamma'), group: 'modern' },
    { id: 'ahevukha', he: 'אהבוך עד מות', ref: refOn('Ahevukha Ad Mavet'), group: 'modern' },
    { id: 'rereadingRabbis', he: 'Rereading the Rabbis', ref: refOn("Rereading the Rabbis; A Woman's Voice"), group: 'modern' },
  ];

  const WRAP_BY_ID = Object.fromEntries(WRAP_COMMENTARIES.map(c => [c.id, c]));
  const EXTRA_BY_ID = Object.fromEntries(EXTRA_COMMENTARIES.map(c => [c.id, c]));

  /** The shipped defaults — exactly the classic Vilna page rendered so far. */
  const DEFAULT_SETTINGS = {
    edition: 'aramaic',   // key into EDITIONS
    inner: 'rashi',       // wrap column on the binding side
    outer: 'tosafot',     // wrap column on the page edge
    lang: 'he',           // commentary language preference: 'he' | 'en'
    extras: [],           // ראשונים / אחרונים / בני ימינו all off by default (opt-in)
    hidden: [],           // printed apparatus block ids switched off by the user (applies on every amud that prints them)
    // Typography. Fonts take 'rashi' | 'frank' | any CSS font-family string.
    commFont: 'rashi',    // commentary columns, margins, bottom strip
    gemaraFont: 'frank',  // the center text
    fontScale: 1,         // user multiplier on all font sizes (0.7–1.5)
    // Text language (design D6). An id of TEXT_LANGS. Only 'he' keeps the classic page.
    textLang: 'he',
    // Licence filter for special (non-free) sources: 'all' | 'pd' (URL-only for now).
    licenseMode: 'all',
  };

  /** Text languages offered by the UI. `dir` is the stream direction; `mt` tags machine translation. */
  const TEXT_LANGS = [
    { id: 'he', label: 'עברית', dir: 'rtl' },
    { id: 'en', label: 'English', dir: 'ltr' },
    { id: 'ru', label: 'Русский', dir: 'ltr', mt: true },
    { id: 'yi', label: 'ייִדיש', dir: 'rtl', mt: true },
    { id: 'fr', label: 'Français', dir: 'ltr', mt: true },
    { id: 'es', label: 'Español', dir: 'ltr', mt: true },
    { id: 'ko', label: '한국어', dir: 'ltr', mt: true },
  ];
  const LICENSE_MODES = ['all', 'pd'];

  /** True when the language id is a known left-to-right text language (unknown ids are not). */
  function isLtrLang(code) {
    const t = TEXT_LANGS.find(l => l.id === code);
    return !!t && t.dir === 'ltr';
  }

  /**
   * Text language of the streams: textLang when it is not 'he' (any translation
   * replaces the whole page text), otherwise the commentary language setting
   * `lang` ('he' | 'en').
   */
  function effectiveLang(s) {
    return s.textLang && s.textLang !== 'he' ? s.textLang : s.lang;
  }

  /**
   * Choke point for store text. The ONLY reader of
   * sources.*.show / sources.*.special. Segments come from store.langs[lang][block] (fallback:
   * src.segs). Returns {segs, src, lang, fallbackFrom} with the language actually used, or null
   * when the block is not rendered. Fallback is lang -> 'he' only, never ru <-> en.
   */
  function resolveBlock(store, block, lang, settings) {
    const pdOnly = !!settings && settings.licenseMode === 'pd';
    const pick = (l) => {
      const src = store && store.sources && store.sources[block] && store.sources[block][l];
      if (!src || !src.show) return null;
      if (pdOnly && src.special) return null;
      const segs = (store.langs && store.langs[l] && store.langs[l][block]) || src.segs;
      if (!Array.isArray(segs) || !segs.length) return null;
      return { segs, src };
    };
    const first = pick(lang);
    if (first) return { segs: first.segs, src: first.src, lang, fallbackFrom: null };
    if (lang !== 'he') {
      const he = pick('he');
      if (he) return { segs: he.segs, src: he.src, lang: 'he', fallbackFrom: lang };
    }
    return null;
  }

  /** Resolve a font setting to a CSS font-family value. */
  function fontFamilyCSS(v, fallback) {
    if (!v || v === fallback) return null; // keep the stylesheet default
    if (v === 'rashi') return 'var(--font-rashi)';
    if (v === 'frank') return 'var(--font-gemara)';
    return `"${String(v).replace(/"/g, '')}", var(--font-gemara), serif`;
  }

  // Sheet aspect ratio w/h of a Vilna amud (matches the reference PDFs).
  const SHEET_ASPECT = 0.707;

  const LAYOUT = {
    C0: 0.26,          // flanking commentary column width, fraction of core W
    yTopLines: 4,      // Gemara top inset, in commentary lines
    fsGem: 16,         // base Gemara font px (before global scale)
    ratioComm: 0.80,   // commentary font = ratioComm * fsGem
    lhGem: 1.5,
    lhComm: 1.35,
    scaleMin: 0.85,
    scaleMax: 1.15,
    relaxRounds: 8,
    fillProbes: 5,
  };

  function gutterPx(fsA, fsB) { return Math.round(0.7 * Math.max(fsA, fsB) + 2); }

  function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ═════════════════ Hashes (docs/VILNA_PIXEL_PLAN.md §2.3) ═════════════════
  // fnv1a64 over UTF-8 → 16 lowercase hex chars. Byte-identical to the
  // Python implementation in scripts/vilna_ref (BigInt arithmetic, mod 2^64).

  const _te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const FNV_OFFSET = BigInt('0xcbf29ce484222325');
  const FNV_PRIME = BigInt('0x100000001b3');
  const FNV_MASK = BigInt('0xffffffffffffffff');

  function fnv1a64(str) {
    const bytes = _te.encode(String(str));
    let h = FNV_OFFSET;
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = (h * FNV_PRIME) & FNV_MASK;
    }
    return h.toString(16).padStart(16, '0');
  }

  /** Depth-first leaf strings of a raw Sefaria stream (null → ''). */
  function leafStrings(x, out) {
    if (Array.isArray(x)) { for (const y of x) leafStrings(y, out); }
    else out.push(x == null ? '' : String(x));
    return out;
  }

  /** sefariaHash of a RAW model (before normalizeModel). */
  function modelHash(rawModel) {
    let s = '';
    for (const stream of ['gemara', 'rashi', 'tosafot']) {
      s += `#${stream}\n`;
      for (const leaf of leafStrings(rawModel ? rawModel[stream] : null, [])) s += `${leaf}\n`;
    }
    return fnv1a64(s);
  }

  /** Logical text of a profile line's content (string | runs | null). */
  function profileLineText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    return content.map(r => (r && r[1] != null ? String(r[1]) : '')).join('');
  }

  /** textHash of a per-amud profile (canonical string of plan §2.3). */
  function profileTextHash(profilePage) {
    let s = '';
    for (const r of (profilePage && profilePage.regions) || []) {
      s += `#${r.id}${r.part ? `:${r.part}` : ''}\n`;
      for (const ln of r.lines || []) s += `${profileLineText(ln[3])}\n`;
    }
    return fnv1a64(s);
  }

  // ═════════════════ Pixel layout without PDF text (docs/VILNA_LAYOUT_SPEC.md §3, §7) ═════════════════
  // A vilna-layout/1 page carries geometry and token references into the offline store; hydration
  // turns it back into a vilna-profile/1 page (same shape as the local reference profile).

  const LAYOUT_SCHEMA = 'vilna-layout/1';
  const LAYOUT_INDEX_SCHEMA = 'vilna-layout-index/1';
  const LAYOUT_BASE = 'data/vilna-layout';
  const LAYOUT_LAYER_SCHEMA = 'vilna-layout-layer/1';
  const LAYOUT_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

  /** Token stream of a block value (spec §3): [{text, seg, sub}] in reading order. */
  function layoutTokenStream(value) {
    const out = [];
    const leaf = (x, seg, sub) => {
      const t = String(x == null ? '' : x)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m, k) => LAYOUT_ENTITIES[k]);
      for (const text of t.split(/\s+/)) if (text) out.push({ text, seg, sub });
    };
    const deep = (x, seg, sub) => {
      if (Array.isArray(x)) for (const y of x) deep(y, seg, sub);
      else leaf(x, seg, sub);
    };
    const top = Array.isArray(value) ? value : [value];
    top.forEach((s, i) => {
      if (!Array.isArray(s)) { leaf(s, i, null); return; }
      s.forEach((u, j) => deep(u, i, j));
    });
    return out;
  }

  /**
   * A layout stream's text from one offline store, with the source entry it is licensed under
   * (spec §4 names: print.<block> → store.print / printSources; <block> → langs[lang] / sources), or null.
   */
  function layoutStreamEntry(store, name, lang) {
    if (!store || typeof store !== 'object') return null;
    if (name.startsWith('print.')) {
      const block = name.slice(6);
      const ps = store.printSources && store.printSources[block];
      if (!ps || ps.show !== true) return null;
      const v = store.print && store.print[block];
      return v != null ? { value: v, block, entry: ps } : null;
    }
    const s = store.sources && store.sources[name] && store.sources[name][lang];
    if (!s || s.show !== true) return null;
    const langs = store.langs && store.langs[lang];
    const v = langs && langs[name];
    return v != null ? { value: v, block: name, entry: s } : null;
  }

  /**
   * Punctuation patches of a run ref (spec §4 `p`): [pos, del, ins] applied in order; pos and del
   * are UTF-16 code-unit counts into the current text. A patch may not delete a Hebrew letter and
   * its insertion may not contain a Hebrew, Latin or Cyrillic letter (words come from Sefaria only).
   */
  const PATCH_HEB_RE = /[א-תװ-ײיִ-ﭏ]/;
  const PATCH_NOINS_RE = /[א-תװ-ײיִ-ﭏA-Za-zÀ-ÖØ-öø-ɏЀ-ԯ]/;
  function applyRunPatches(text, ops) {
    if (!Array.isArray(ops)) throw LAYOUT_BAD;
    let s = text;
    for (const op of ops) {
      if (!Array.isArray(op) || op.length !== 3) throw LAYOUT_BAD;
      const [pos, del, ins] = op;
      if (!Number.isInteger(pos) || !Number.isInteger(del) || pos < 0 || del < 0 || pos + del > s.length) throw LAYOUT_BAD;
      if (typeof ins !== 'string' || PATCH_NOINS_RE.test(ins)) throw LAYOUT_BAD;
      if (PATCH_HEB_RE.test(s.slice(pos, pos + del))) throw LAYOUT_BAD;
      s = s.slice(0, pos) + ins + s.slice(pos + del);
    }
    return s;
  }

  /**
   * vilna-layout/1 page + offline store → vilna-profile/1 page (spec §7), or null on any mismatch
   * (layer missing, stream count/hash, unknown stream, bad span, malformed line). `layer` is the
   * sibling layer object for `lang`; by default the page's own layers[lang]. Inputs are never mutated.
   */
  function hydrateLayout(layoutPage, store, lang = 'he', layer = null, opts = {}) {
    const bad = () => { throw LAYOUT_BAD; };
    const pdOnly = !!opts && opts.licenseMode === 'pd';
    const info = new Map(), usedOrder = [];
    try {
      const lp = layoutPage;
      if (!lp || lp.schema !== LAYOUT_SCHEMA || !lp.page || !Array.isArray(lp.faces) || !Array.isArray(lp.regions)) bad();
      if (!Number.isInteger(lp.daf) || typeof lp.side !== 'string') bad();
      // Only the immediately previous and next amud may be referenced (spec §8.1; same as the builder).
      const allowed = layoutNeighbourKeys(lp.daf, lp.side);
      const L = layer || (lp.layers && lp.layers[lang]) || null;
      if (!L || typeof L !== 'object' || (L.lang != null && L.lang !== lang)) bad();
      if (!L.streams || typeof L.streams !== 'object' || !Array.isArray(L.regions) || L.regions.length !== lp.regions.length) bad();
      const streams = new Map();
      const gemSegs = new Set();
      for (const name of Object.keys(L.streams)) {
        const want = L.streams[name] || {};
        // <name>@<daf><side>: the same stream of the neighbouring amud (spec §8.1).
        const at = name.indexOf('@');
        const suffix = at < 0 ? null : name.slice(at + 1);
        if (at >= 0 && !allowed.includes(suffix)) bad();
        const st = at < 0 ? store : (opts && opts.stores && Object.prototype.hasOwnProperty.call(opts.stores, suffix) ? opts.stores[suffix] : null);
        const got = layoutStreamEntry(st, at < 0 ? name : name.slice(0, at), lang);
        if (!got) bad();
        // Licence mode 'pd': a non-PD or special source is never used (spec §8.2).
        if (pdOnly && (got.entry.special || got.entry.pd !== true)) bad();
        const toks = layoutTokenStream(got.value);
        if (toks.length !== want.n || fnv1a64(toks.map(t => t.text).join(' ')) !== want.h) bad();
        streams.set(name, toks);
        info.set(name, { stream: name, block: got.block, title: got.entry.title || null,
          license: got.entry.license || null, special: !!got.entry.special, page: suffix });
      }
      // Segment (1-based) of each Gemara token, for the key letters of a translated sheet.
      const layerTokSegs = streams.has('gemara') ? streams.get('gemara').map(t => t.seg + 1) : null;
      const refText = ref => {
        if (typeof ref === 'string' || ref == null) return ref;
        if (typeof ref !== 'object' || !Array.isArray(ref.r)) bad();
        const parts = [];
        for (const span of ref.r) {
          if (!Array.isArray(span) || span.length !== 3 || !streams.has(span[0])) bad();
          const toks = streams.get(span[0]);
          const i0 = span[1], i1 = span[2];
          if (!Number.isInteger(i0) || !Number.isInteger(i1) || i0 < 0 || i0 > i1 || i1 > toks.length) bad();
          if (i1 > i0) parts.push(toks.slice(i0, i1).map(t => t.text).join(' '));
          if (span[0] === 'gemara') for (let t = i0; t < i1; t++) gemSegs.add(toks[t].seg + 1);
          if (!usedOrder.includes(span[0])) usedOrder.push(span[0]);
        }
        let text = parts.join(' ') + (ref.sp ? ' ' : '');
        if (ref.p !== undefined) text = applyRunPatches(text, ref.p);
        return text;
      };
      const regions = [];
      lp.regions.forEach((shared, i) => {
        const lr = L.regions[i];
        if (lr == null) return; // not shown in this language
        if (!shared || typeof shared !== 'object' || typeof lr !== 'object') bad();
        if (lr.flow !== undefined) {
          // Apparatus flow slot (spec §9.4): geometry only, no text, no lines.
          if (typeof lr.flow !== 'string' || !Array.isArray(lr.box) || lr.box.length !== 4 ||
              !lr.box.every(v => Number.isFinite(v)) || !Number.isFinite(lr.maxBottom)) bad();
          regions.push(Object.assign({}, shared, {
            flow: lr.flow, box: lr.box.slice(), maxBottom: lr.maxBottom,
            face: lr.face != null ? lr.face : shared.face, titleFace: lr.titleFace != null ? lr.titleFace : null,
          }));
          return;
        }
        if (!Array.isArray(lr.lines)) bad();
        const lines = lr.lines.map(ln => {
          if (!Array.isArray(ln) || ln.length < 4) bad();
          const nl = ln.slice();
          const content = ln[3];
          if (content == null || typeof content === 'string') return nl;
          if (!Array.isArray(content)) bad();
          nl[3] = content.map(run => {
            if (!Array.isArray(run) || run.length < 2) bad();
            const nr = run.slice();
            nr[1] = refText(run[1]);
            return nr;
          });
          return nl;
        });
        const out = Object.assign({}, shared, { lines });
        if (lr.segs !== undefined) out.segs = lr.segs;
        // Gemara segment starts on this sheet (T2e key letters): [{line, word, seg}], words = tokens of the line.
        if (shared.id === 'gemara' && streams.has('gemara') && layerTokSegs) {
          const starts = []; let lastSeg = null;
          lr.lines.forEach((ln, li) => {
            const c = ln[3];
            if (!Array.isArray(c)) return;
            let w = 0;
            for (const run of c) {
              const ref = run && run[1];
              if (!ref || typeof ref !== 'object' || !Array.isArray(ref.r)) continue;
              for (const span of ref.r) {
                if (span[0] !== 'gemara') continue;
                for (let t = span[1]; t < span[2]; t++, w++) {
                  const sg = layerTokSegs[t];
                  if (sg !== lastSeg) { starts.push({ line: li, word: w, seg: sg }); lastSeg = sg; }
                }
              }
            }
          });
          out.segStarts = starts;
        }
        regions.push(out);
      });
      // Margin text of a translated page (margin stack, spec §9.12 / §10.2): {id: {r: [[id, a, b]]}} → per id, one
      // note per source segment [{seg, text, n}] (n = tokens), checked against the verified streams like any ref.
      let marginText = null;
      if (L.marginText != null) {
        if (typeof L.marginText !== 'object') bad();
        marginText = {};
        for (const id of Object.keys(L.marginText)) {
          const ref = L.marginText[id];
          if (!ref || typeof ref !== 'object' || !Array.isArray(ref.r)) bad();
          const notes = [];
          for (const span of ref.r) {
            if (!Array.isArray(span) || span.length !== 3 || span[0] !== id || !streams.has(id)) bad();
            const toks = streams.get(id);
            const i0 = span[1], i1 = span[2];
            if (!Number.isInteger(i0) || !Number.isInteger(i1) || i0 < 0 || i0 > i1 || i1 > toks.length) bad();
            for (let t = i0; t < i1; t++) {
              const sg = toks[t].seg;
              const last = notes[notes.length - 1];
              if (last && last.seg === sg) { last.text += ' ' + toks[t].text; last.n++; }
              else notes.push({ seg: sg, text: toks[t].text, n: 1 });
            }
            if (i1 > i0 && !usedOrder.includes(id)) usedOrder.push(id);
          }
          marginText[id] = notes;
        }
      }
      return {
        schema: PROFILE_SCHEMA, marginText,
        profileId: lp.profileId, tractateKey: lp.tractateKey, daf: lp.daf, side: lp.side,
        certifiable: L.certifiable, page: lp.page,
        faces: Array.isArray(L.faces) ? L.faces : lp.faces, ornaments: lp.ornaments || [],
        regions,
        // Streams actually referenced by the page, in first-use order (for the sources note).
        sourcesUsed: usedOrder.map(n => info.get(n)),
        // Gemara segments (1-based) this page's Gemara lines show: a translated sheet's apparatus goes here.
        gemaraSegs: [...gemSegs].sort((a, b) => a - b),
      };
    } catch (e) {
      if (e !== LAYOUT_BAD) console.warn('[vilna-daf] layout hydration failed', e);
      return null;
    }
  }
  const LAYOUT_BAD = { layoutBad: true };

  // ─── Translation layers, layer/2 (spec §10.6; renderer-3 T4) ───
  const LAYOUT_LAYER2_SCHEMA = 'vilna-layout-layer/2';
  /** Labels the engine draws on a translated sheet (spec §10.6: no label is stored in a layer). */
  const TSHEET_I18N = {
    en: { cont: '(cont.)', rashi: 'Rashi', tosafot: 'Tosafot', mesoretHaShas: 'Masoret HaShas', einMishpat: 'Ein Mishpat', torahOr: 'Torah Or', gilyonHaShas: 'Gilyon HaShas', ravNissimGaon: 'Rav Nissim Gaon' },
    ru: { cont: '(продолж.)', rashi: 'Раши', tosafot: 'Тосафот', mesoretHaShas: 'Масорет ха-Шас', einMishpat: 'Эйн Мишпат', torahOr: 'Тора Ор', gilyonHaShas: 'Гилйон ха-Шас', ravNissimGaon: 'Рав Ниссим Гаон' },
    fr: { cont: '(suite)', rashi: 'Rachi', tosafot: 'Tossafot', mesoretHaShas: 'Massorète HaShas', einMishpat: 'Ein Mishpat', torahOr: 'Torah Or', gilyonHaShas: 'Guilyon HaShas', ravNissimGaon: 'Rav Nissim Gaon' },
    es: { cont: '(cont.)', rashi: 'Rashi', tosafot: 'Tosafot', mesoretHaShas: 'Masoret HaShas', einMishpat: 'Ein Mishpat', torahOr: 'Torá Or', gilyonHaShas: 'Guilyón HaShás', ravNissimGaon: 'Rav Nisim Gaón' },
    yi: { cont: '(המשך)', rashi: 'רש״י', tosafot: 'תוספות', mesoretHaShas: 'מסורת הש״ס', einMishpat: 'עין משפט נר מצוה', torahOr: 'תורה אור', gilyonHaShas: 'גליון הש״ס', ravNissimGaon: 'רבינו נסים גאון' },
    ko: { cont: '(계속)', rashi: '라시', tosafot: '토사포트', mesoretHaShas: '마소라 하-샤스', einMishpat: '에인 미슈파트', torahOr: '토라 오르', gilyonHaShas: '길욘 하-샤스', ravNissimGaon: '라브 니심 가온' },
  };

  /**
   * Layer/2 refs-only check (spec §10.6, T1): every run is a ref into the language's streams, no bare
   * string carries a letter, and no punctuation patch. Returns a reason string, or null when it passes.
   */
  function layer2RefsOnly(regions) {
    for (const r of regions) {
      if (r == null) continue;
      if (typeof r !== 'object') return 'schema';
      if (r.flow !== undefined) continue;
      if (!Array.isArray(r.lines)) return 'schema';
      for (const ln of r.lines) {
        if (!Array.isArray(ln) || ln.length < 4) return 'schema';
        const c = ln[3];
        if (c == null) continue;
        if (typeof c === 'string') { if (/\p{L}/u.test(c)) return 'literal'; continue; }
        if (!Array.isArray(c)) return 'schema';
        for (const run of c) {
          if (!Array.isArray(run) || run.length < 2) return 'schema';
          const ref = run[1];
          if (typeof ref === 'string') { if (/\p{L}/u.test(ref)) return 'literal'; continue; }
          if (!ref || typeof ref !== 'object' || !Array.isArray(ref.r)) return 'schema';
          if (ref.p !== undefined) return 'patch';
        }
      }
    }
    return null;
  }

  /**
   * Faces of a layer/2 page (spec §10.4, §10.6). The builder writes the Hebrew page's face table and the
   * index of each line's face into it; the printed size of a translated line is that table's size × the
   * amud's scale k (build.k, as in layoutTranslationSheet's faceSize × k), and its typeface is the bundled
   * stack of the language (TSHEET.FAMILY): gemara region → gem stack, every commentary region → comm stack.
   * Returns [[stack, printedPt], …] in the layer's index order, or null when k or the table is unusable.
   */
  function translationFaces(lp, layer, lang) {
    const k = layer.build && Number(layer.build.k);
    if (!(k > 0) || !Array.isArray(layer.faces)) return null;
    const fam = TSHEET.FAMILY[lang] || TSHEET.FAMILY.def;
    const gem = lp.regions.find(r => r && r.id === 'gemara');
    const gemFace = gem && gem.face != null ? gem.face : 0;
    const out = [];
    for (let i = 0; i < layer.faces.length; i++) {
      const f = layer.faces[i];
      if (!Array.isArray(f) || !Number.isFinite(Number(f[1]))) return null;
      // A face already given as a CSS stack (quoted family) keeps its size; anything else is scaled.
      if (/^['"]/.test(String(f[0]))) out.push([String(f[0]), Number(f[1])]);
      else out.push([i === gemFace ? fam.gem : fam.comm, Number(f[1]) * k]);
    }
    return out;
  }

  /**
   * Margin stack plan of a layout page (spec §9.12): the two margin columns of the Hebrew page and, per column,
   * its blocks in their printed top-to-bottom order. Blocks: the apparatus flow slots (masoretHaShas, einMishpat,
   * torahOr; kind 'flow') and the line-based margin text (gilyonHaShas, ravNissimGaon; kind 'text'), each on the
   * physical side (L/R) of its printed centre. A column's x-range is the union of its narrow blocks (narrower than
   * 0.2 of the page; a wide block, e.g. Rav Nissim Gaon printed under a column, takes the column of its side),
   * mapped by mapX (σ on a translated sheet); a side without a narrow block mirrors the other column.
   * Returns {cols: {L?, R?: {x0, x1, top, blocks}}, pw} or null when the page has no margin block.
   */
  function marginPlanOf(lp, mapX) {
    const he = lp && lp.layers && lp.layers.he;
    if (!he || !Array.isArray(he.regions) || !Array.isArray(lp.regions)) return null;
    const pw = Number(lp.page && lp.page.w) || 0;
    const mx = mapX || (x => x);
    const blocks = [];
    lp.regions.forEach((r, i) => {
      if (!r || r.kind !== 'margin') return;
      const lr = he.regions[i];
      if (!lr || typeof lr !== 'object') return;
      if (lr.flow !== undefined) {
        if (!Array.isArray(lr.box) || lr.box.length !== 4) return;
        blocks.push({ id: apparatusKeyOf(lr.flow), region: r.id, kind: 'flow', x0: +lr.box[0], x1: +lr.box[2],
          top: +lr.box[1], bottom: +lr.box[3], face: lr.face != null ? lr.face : r.face,
          titleFace: lr.titleFace != null ? lr.titleFace : null });
      } else if (Array.isArray(lr.lines) && lr.lines.some(Array.isArray)) {
        const ls = lr.lines.filter(Array.isArray);
        const sz = lp.faces && lp.faces[r.face] ? Number(lp.faces[r.face][1]) || 7 : 7;
        blocks.push({ id: r.id, region: r.id, kind: 'text', x0: Math.min(...ls.map(l => +l[1])), x1: Math.max(...ls.map(l => +l[2])),
          top: Math.min(...ls.map(l => +l[0])) - sz, bottom: Math.max(...ls.map(l => +l[0])) + 0.3 * sz,
          face: r.face, titleFace: null });
      }
    });
    if (!blocks.length || !(pw > 0)) return null;
    for (const b of blocks) {
      b.side = (b.x0 + b.x1) / 2 < pw / 2 ? 'L' : 'R';
      b.narrow = (b.x1 - b.x0) < 0.2 * pw;
    }
    const raw = {};
    for (const side of ['L', 'R']) {
      const nar = blocks.filter(b => b.side === side && b.narrow);
      if (nar.length) raw[side] = [Math.min(...nar.map(b => b.x0)), Math.max(...nar.map(b => b.x1))];
    }
    if (!raw.L && !raw.R) return null;
    if (!raw.L) raw.L = [pw - raw.R[1], pw - raw.R[0]];
    if (!raw.R) raw.R = [pw - raw.L[1], pw - raw.L[0]];
    const cols = {};
    for (const side of ['L', 'R']) {
      const bs = blocks.filter(b => b.side === side).sort((p, q) => p.top - q.top);
      if (!bs.length) continue;
      cols[side] = { side, x0: Math.max(3, mx(raw[side][0])), x1: Math.min(pw - 3, mx(raw[side][1])), heX: raw[side].slice(),
        top: Math.min(...bs.map(b => b.top)), blocks: bs };
    }
    return { cols, pw };
  }

  /**
   * layer/2 → one hydrated profile page per sheet (each through hydrateLayout, so every stream's n/h is
   * verified), or {layoutUnusable, reason} when the layer is rejected (the page then renders adaptive).
   */
  function hydrateLayer2(lp, store, lang, layer, opts) {
    const bad = reason => ({ layoutUnusable: true, reason });
    if (layer.schema !== LAYOUT_LAYER2_SCHEMA || layer.lang !== lang || !layer.streams || typeof layer.streams !== 'object') return bad('schema');
    if (!Array.isArray(layer.sheets) || !layer.sheets.length) return bad('schema');
    if (opts && opts.licenseMode === 'pd') return bad('pd');
    const faces = translationFaces(lp, layer, lang);
    if (!faces) return bad('faces');
    const pages = [];
    // Margin stack geometry (spec §9.12): the Hebrew page's margin columns and block order, σ-mapped (K4).
    const fr = layer.frame || {};
    const sig = Number(fr.stretch) || TSHEET.SIGMA;
    const x0f = fr.x0f != null ? Number(fr.x0f) : TSHEET.X0F;
    const plan = marginPlanOf(lp, x => x0f + (x - TSHEET.X0F) * sig);
    if (layer.marginText != null && (typeof layer.marginText !== 'object' || Array.isArray(layer.marginText))) return bad('schema');
    for (const [si, sh] of layer.sheets.entries()) {
      if (!sh || !Array.isArray(sh.regions)) return bad('schema');
      const why = layer2RefsOnly(sh.regions);
      if (why) return bad(why);
      const page = hydrateLayout(lp, store, lang, {
        schema: 'vilna-layout-layer/1', lang, dir: layer.dir, certifiable: layer.certifiable,
        streams: layer.streams, faces, regions: sh.regions, marginText: si === 0 ? (layer.marginText || null) : null,
      }, opts);
      if (!page) return bad('hydrate');
      page.carryIn = sh.carryIn || null;
      // Hebrew ornaments sit at Hebrew positions: a translated sheet draws none (spec §10.6); the margin stack
      // draws its own dividers (spec §9.12).
      page.ornaments = [];
      page.marginPlan = plan;
      pages.push(page);
    }
    const mt = pages[0].marginText || null;
    for (const pg of pages) pg.marginText = mt;
    // Every shown stream on every sheet (spec §10.4: the sources note lists every stream shown).
    const used = new Map();
    for (const pg of pages) for (const u of pg.sourcesUsed) if (u && !used.has(u.stream)) used.set(u.stream, u);
    for (const pg of pages) { pg.sourcesUsed = [...used.values()]; pg.layoutSheets = pages.length; }
    return { sheets: pages };
  }

  // ═════════════════ Translation sheets (spec §10.4; plan §2–§5, renderer-1 T2) ═════════════════
  // One translated sheet of a vilna-layout/2 layer: Gemara centre, Rashi inner, Tosafot outer, placed
  // in the Hebrew amud's own column x-ranges (modal line x0/x1 of he layer, σ-mapped by K4). All
  // coordinates are layout pt; printed size = layout size × K3. Advances are measured in the DOM with
  // the face named by the font stack (bundled faces only; no generic fallback in any stack).
  // Not in this function: margin blocks, apparatus slots, header, catchword, the (cont.) labels and
  // the M-loop (builder, T3). See exportSheetLines for the layer/2 line shape.
  const TSHEET = {
    PRINT: 720 / 826,                // K3
    SIGMA: 1.0698,                   // K4 (frame.stretch overrides)
    X0F: 58,                         // K1 frame left
    CORE_TOP: 47, CORE_BOTTOM: 832,  // K1 core y
    LEAD: { gem: 1.30, comm: 1.22 }, // K14
    KEY_EM: 0.5,                     // apparatus key box = 0.5 × Gemara size (viewer: insertTranslatedKeys)
    TOP_LINES: 4,                    // later sheets: commentary lines above the Gemara (§10.4)
    GUTTER: 15,                      // K26 (pt, layout units x sigma)
    MARGIN_MIN_PT: 6.0,              // K7 apparatus/margin minimum, printed pt (yi + K9 0.5): §9.4, margin text is never below it
    RHO: [0.75, 1.50],               // K23 Gemara band factor bounds (0.05 grid)
    COMM_W: { def: 0.262, min: 0.15, max: 0.40 }, // K24 canonical commentary column (fractions of the core)
    FAMILY: {                        // bundled faces only (css/daf.css @font-face names)
      // Stacks of css/daf.css --font-gemara / --font-rashi (fonts worker: NotoSerif-extra covers Ḥ ḥ һ). Builder
      // measurement and viewer read this one table; keep it in step with the CSS when a face changes.
      def: { gem: "'VilnaExtra', 'VilnaCyrFrank', 'FrankRuhl', 'RashiScript'", comm: "'VilnaExtra', 'VilnaCyrRashi', 'RashiScript', 'FrankRuhl'" },
      ko: { gem: "'VilnaKR', 'VilnaExtra', 'FrankRuhl'", comm: "'VilnaKR', 'VilnaExtra', 'RashiScript'" },
      yi: { gem: "'VilnaExtra', 'FrankRuhl'", comm: "'VilnaExtra', 'FrankRuhl'" },
    },
  };

  function tsFamily(lang, which) {
    const f = TSHEET.FAMILY[lang] || TSHEET.FAMILY.def;
    return f[which];
  }

  let _tsHost = null;
  function tsHost() {
    if (!_tsHost) {
      _tsHost = document.createElement('div');
      _tsHost.setAttribute('aria-hidden', 'true');
      _tsHost.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:pre;';
      document.body.appendChild(_tsHost);
    }
    return _tsHost;
  }

  // Font readiness (T3e): every face of the TSHEET.FAMILY stacks is loaded before the first translation
  // measurement (tsFontsReady), and no measure taken while a face is loading is cached (it may be a fallback).
  const TS_FONT_SAMPLE = 'אבגדהוזחטיכלמנסעפצקרשתךםןףץ ײַ װױײ ׳״ ־ AaZz ÀÉÑßÖüéèêçñ ‘’“”„«»—–… ' +
    'АБВЖЙЯабвжйяё\u0301\u0300\u0306\u0323\u0331 һҺӣғқүҳәӡ ḤḥĤĥḵẒẓāōŌěəśšʻʼʿΧ\u00AD\u2011‟‡№⅓ ' +
    '가나다라마바사아자차카타파하 수장';
  let _tsFontsOk = false, _tsUnstable = 0;
  function tsFontsLoaded() { return typeof document !== 'undefined' && !!document.fonts && document.fonts.status === 'loaded'; }
  async function tsFontsReady() {
    if (typeof document === 'undefined' || !document.fonts) return false;
    const fams = new Set();
    for (const f of Object.values(TSHEET.FAMILY)) for (const st of [f.gem, f.comm]) {
      for (const n of st.split(',')) fams.add(n.trim().replace(/^['"]|['"]$/g, ''));
    }
    for (const fam of fams) {
      try { await document.fonts.load(`16px "${fam}"`, TS_FONT_SAMPLE); } catch (e) { /* a missing family is reported by the font check */ }
    }
    await document.fonts.ready;
    _tsAdv.clear(); _tsInk.clear(); _tsBase.clear();
    _tsFontsOk = tsFontsLoaded();
    return _tsFontsOk;
  }

  const _tsAdv = new Map();
  // Advance of `text` in layout pt at face size `size` (measured at the face size, as the units files).
  function tsAdvance(family, size, text) {
    const key = family + '|' + size + '|' + text;
    let w = _tsAdv.get(key);
    if (w === undefined) {
      const s = document.createElement('span');
      s.style.fontFamily = family;
      s.style.fontSize = size + 'px';
      // The same shaping as the strict lines (css .policy-strict .vl): no kerning, no ligatures (T2e).
      s.style.fontKerning = 'none';
      s.style.fontVariantLigatures = 'none';
      s.textContent = text;
      tsHost().appendChild(s);
      w = s.getBoundingClientRect().width;
      s.remove();
      if (tsFontsLoaded()) _tsAdv.set(key, w); else _tsUnstable++;
    }
    return w;
  }

  const _tsBase = new Map();
  // Baseline offset from the top of a line box of height lh (layout pt), measured in the DOM.
  function tsBaseOffset(family, size, lh) {
    const key = family + '|' + size + '|' + lh;
    let v = _tsBase.get(key);
    if (v === undefined) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:0;left:0;white-space:pre;font-family:' + family +
        ';font-size:' + size + 'px;line-height:' + lh + 'px;';
      const t = document.createElement('span');
      t.textContent = 'Hx';
      const m = document.createElement('span');
      m.style.cssText = 'display:inline-block;width:0;height:0;';
      d.appendChild(t);
      d.appendChild(m);
      tsHost().appendChild(d);
      v = m.getBoundingClientRect().top - d.getBoundingClientRect().top;
      d.remove();
      if (tsFontsLoaded()) _tsBase.set(key, v); else _tsUnstable++;
    }
    return v;
  }

  // Modal [x0, x1] of a region's lines (ties: first seen), layer/1 line = [baseline, x0, x1, runs].
  function tsModal(lines) {
    const counts = new Map();
    let best = null, bestN = 0;
    for (const ln of lines || []) {
      const key = Math.round(ln[1] * 1000) + '|' + Math.round(ln[2] * 1000);
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      if (n > bestN) { bestN = n; best = [ln[1], ln[2]]; }
    }
    return best;
  }

  // Narrowest Gemara range that recurs (>= 3 lines): the Gemara's band beside both commentary columns.
  // (A wide modal, e.g. full width where one commentary column is absent, is not the narrow band.)
  function tsNarrowModal(lines) {
    const counts = new Map();
    for (const ln of lines || []) {
      const key = Math.round(ln[1] * 1000) + '|' + Math.round(ln[2] * 1000);
      const c = counts.get(key) || { n: 0, x0: ln[1], x1: ln[2] };
      c.n++;
      counts.set(key, c);
    }
    let best = null;
    for (const c of counts.values()) {
      if (c.n < 3) continue;
      if (!best || (c.x1 - c.x0) < (best.x1 - best.x0) - 1e-9 || (Math.abs((c.x1 - c.x0) - (best.x1 - best.x0)) < 1e-9 && c.n > best.n)) best = c;
    }
    return best ? [best.x0, best.x1] : tsModal(lines);
  }

  // First slot at or after y where a line of height lh fits inside one band and above the bottom.
  function tsNextSlot(bands, y, lh, bottom) {
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi];
      const s = Math.max(y == null ? -Infinity : y, b.y0);
      if (s + lh <= b.y1 + 1e-9 && s + lh <= bottom + 1e-9) return { y: s, bi };
    }
    return null;
  }

  // Glyph extents of a line (canvas actualBoundingBox*, bundled faces, layout pt): ascent above and descent
  // below its baseline. Used for the ink-clearance leading rule (T2d item 3).
  const _tsInk = new Map();
  let _tsInkCtx = null;
  const TS_INK_GAP = 0.25;   // pt of clear space between one line's ink bottom and the next line's ink top
  function tsInk(family, size, text) {
    const key = family + '|' + size + '|' + text;
    let v = _tsInk.get(key);
    if (v === undefined) {
      if (!_tsInkCtx) _tsInkCtx = document.createElement('canvas').getContext('2d');
      // Measured at 200 px and scaled: canvas ink metrics are whole pixels at small sizes (up to 0.5 px error).
      _tsInkCtx.font = `200px ${family}`;
      _tsInkCtx.fontKerning = 'none';
      const m = _tsInkCtx.measureText(text);
      v = { asc: m.actualBoundingBoxAscent * size / 200, desc: m.actualBoundingBoxDescent * size / 200 };
      if (tsFontsLoaded()) _tsInk.set(key, v); else _tsUnstable++;
    }
    return v;
  }

  // Greedy line breaking of tokens [start, end) of one column. Words only: a token wider than its band
  // stops the column (reported as tooWide). A paragraph start (paras) always begins a new line.
  // Leading (T2d): a line's top is at least the nominal pitch below the previous top, and its ink top clears
  // the previous line's ink bottom by TS_INK_GAP, so the layout never produces ink contact.
  function tsBreakColumn(c) {
    const lines = [];
    const sp = tsAdvance(c.fam, c.size, ' ');
    const lh = c.lh;
    const boff = tsBaseOffset(c.fam, c.size, lh);
    let i = c.start, y = null, tooWide = 0, prevInk = null;
    while (i < c.end) {
      let pos = tsNextSlot(c.bands, y, lh, c.bottom);
      if (!pos) break;
      let top = pos.y, bi = pos.bi, j = i, w = 0, ink = null, placed = false, band = null;
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        band = c.bands[bi];
        const W = band.x1 - band.x0;
        j = i; w = 0;
        while (j < c.end) {
          const tw = tsAdvance(c.fam, c.size, c.texts[j]) + (c.extra ? c.extra[j] || 0 : 0);
          const nw = j === i ? tw : w + sp + tw;
          if (nw > W + 1e-6) break;
          w = nw;
          j++;
          if (j < c.end && c.paras.has(j)) break;
        }
        if (j === i) break;
        ink = tsInk(c.fam, c.size, c.texts.slice(i, j).join(' '));
        let need = prevInk == null ? -Infinity : prevInk + ink.asc + TS_INK_GAP - boff;
        // Cross-region ink rule (T3e): the ink of a line of another region (c.obstacles: lines of the other
        // columns) under the band's x-range is cleared by TS_INK_GAP; the line moves below it.
        if (c.obstacles) {
          const bl = top + boff;
          for (const o of c.obstacles) {
            if (!(o.x0 < band.x1 - 1e-6 && band.x0 < o.x1 - 1e-6)) continue;
            if (bl - ink.asc < o.baseline + o.inkD + TS_INK_GAP - 1e-6 && o.baseline - o.inkA < bl + ink.desc + TS_INK_GAP - 1e-6) {
              need = Math.max(need, o.baseline + o.inkD + TS_INK_GAP + ink.asc - boff);
            }
          }
        }
        if (top >= need - 1e-9) { placed = true; break; }
        const p2 = tsNextSlot(c.bands, need, lh, c.bottom);
        if (!p2) break;
        top = p2.y; bi = p2.bi;
      }
      if (!placed) { if (j === i) tooWide++; break; }
      y = top;
      const last = j === c.end || c.paras.has(j);
      const x0 = !last ? band.x0 : (c.rtl ? band.x1 - w : band.x0);
      const x1 = !last ? band.x1 : (c.rtl ? band.x1 : band.x0 + w);
      lines.push({ id: c.id, stream: c.stream, face: c.face, size: c.size, top: y, bottom: y + lh,
        baseline: y + boff, x0, x1, natW: w, a: i, b: j, last, inkA: ink.asc, inkD: ink.desc });
      prevInk = y + boff + ink.desc;
      y += lh;
      i = j;
    }
    return { lines, next: i, tooWide };
  }

  function tsCapacity(bands, lh, bottom) {
    let n = 0, y = null;
    for (;;) {
      const pos = tsNextSlot(bands, y, lh, bottom);
      if (!pos) break;
      n++;
      y = pos.y + lh;
    }
    return n;
  }

  /**
   * Lays out ONE translated sheet (spec §10.4, §10.4a). Returns a plain object; see exportSheetLines.
   *  frame      { box:[58,15,621,841], stretch:1.0698, x0f?:58, coreTop?:47, coreBottom?:832,
   *               rho?: Gemara band factor (K23: 0.75–1.50 on a 0.05 grid; default 1) }
   *  heGeom     { faces: page.faces, coreTop?, regions: [{ id:'gemara'|'inner'|'outer', face, lines }] }
   *             lines = the amud's he layer/1 lines [baseline, x0, x1, runs] (Hebrew geometry only).
   *             inner / outer may be missing (absent column, §10.4a rule 5); null entries are ignored.
   *  sheetUnits { first: bool, gem:[i0,i1), rashi:[i0,i1), tosafot:[i0,i1),
   *               streams:{gemara, rashi, tosafot} (layoutTokenStream arrays: {text,...}),
   *               paras?:{gemara, rashi, tosafot} (token indices that start a new paragraph) }
   *  carryIn    { rashi: tokenIdx|null, tosafot: tokenIdx|null } from the previous sheet (null on sheet 1)
   *  k          scale (K12 grid; the caller checks the grid and the bounds)
   *  lang       'en' | 'ru' | 'fr' | 'es' | 'ko' | 'yi'
   */
  function layoutTranslationSheet(frame, heGeom, sheetUnits, carryIn, k, lang) {
    if (typeof document === 'undefined') throw new Error('layoutTranslationSheet needs a DOM');
    if (!_tsFontsOk) throw new Error('layoutTranslationSheet: await VilnaDaf.tsFontsReady() before the first measurement');
    const unstable0 = _tsUnstable;
    const fr = frame || {};
    const su = sheetUnits || {};
    const ci = carryIn || {};
    const L = String(lang || 'en');
    const sig = Number(fr.stretch) || TSHEET.SIGMA;
    const x0f = fr.x0f != null ? Number(fr.x0f) : TSHEET.X0F;
    const coreTop = fr.coreTop != null ? Number(fr.coreTop) : TSHEET.CORE_TOP;
    const coreBottom = fr.coreBottom != null ? Number(fr.coreBottom) : TSHEET.CORE_BOTTOM;
    const rho = fr.rho != null ? Number(fr.rho) : 1;
    if (!(rho >= TSHEET.RHO[0] - 1e-9 && rho <= TSHEET.RHO[1] + 1e-9) || Math.abs(rho * 20 - Math.round(rho * 20)) > 1e-6) {
      throw new Error(`translation sheet: rho ${fr.rho} is outside K23 (0.75–1.50, 0.05 grid)`);
    }
    const mapX = x => x0f + (x - TSHEET.X0F) * sig;
    const reg = id => (heGeom.regions || []).find(r => r && r.id === id) || null;
    const gemR = reg('gemara'), innR = reg('inner'), outR = reg('outer');
    if (!gemR) throw new Error('translation sheet: he geometry needs the gemara region');
    const faceSize = r => Number(heGeom.faces[r.face][1]);
    const gemFirst = Math.min(...gemR.lines.map(l => l[0]));
    const heCoreTop = heGeom.coreTop != null ? Number(heGeom.coreTop) : TSHEET.CORE_TOP;
    const belowGem = lines => (lines || []).filter(l => l[0] >= gemFirst);
    // Absent column (§10.4a rule 5): no lines of that column below the Gemara start (Berachot 32a, 56b, 64a).
    const inP = !!innR && belowGem(innR.lines).length > 0;
    const outP = !!outR && belowGem(outR.lines).length > 0;
    if (!inP && !outP) throw new Error('translation sheet: he geometry has no commentary column');
    const colLines = { in: inP ? innR.lines : [], out: outP ? outR.lines : [] };
    const present0 = { in: inP, out: outP };
    const Fg = faceSize(gemR), Fc = faceSize(inP ? innR : outR);
    const first = !!su.first;
    const sG = k * Fg, sC = k * Fc;
    const lhG = TSHEET.LEAD.gem * sG, lhC = TSHEET.LEAD.comm * sC;
    // Last sheet with a catchword: one Gemara line stays free at the bottom for it (T2d item 2).
    const catchOn = !!(su.last && su.catch && Array.isArray(su.catch.tokens) && su.catch.tokens.length);
    const coreBottomX = catchOn ? coreBottom - lhG : coreBottom;
    // Margin text blocks (T2e): heGeom.margins = [{id, lines (he layer lines of that region)}]. Each block keeps
    // its he region's x-range and top; it grows down to the next slot or block below it, or the core bottom.
    const gut = TSHEET.GUTTER * sig;                       // K26
    const gemTop = first ? coreTop + (gemFirst - heCoreTop) * k : coreTop + TSHEET.TOP_LINES * lhC;

    // ---- §10.4a rule 1: canonical columns from the he layer (all lines of the three regions, σ-mapped).
    const allX = [...gemR.lines, ...colLines.in, ...colLines.out].flatMap(l => [mapX(l[1]), mapX(l[2])]);
    const cL = Math.min(...allX), cR = Math.max(...allX), Wc = cR - cL, cmid = (cL + cR) / 2;
    const cen = ls => ls.reduce((s, l) => s + (l[1] + l[2]) / 2, 0) / ls.length;
    let cLeft;
    if (inP && outP) {
      cLeft = cen(innR.lines) <= cen(outR.lines) ? 'in' : 'out';
    } else {
      // One column only: it is on the side of the Gemara it sits beside; the absent one takes the other side.
      const pc = tsModal(belowGem(inP ? innR.lines : outR.lines));
      const gm = tsNarrowModal(gemR.lines);
      const presentLeft = !(pc[0] > (gm[0] + gm[1]) / 2);
      cLeft = (presentLeft === inP) ? 'in' : 'out';
    }
    const cRight = cLeft === 'in' ? 'out' : 'in';
    // K24: modal narrow-line width of the column (below the Gemara start), if within [0.15, 0.40] of the core
    // and supported by >= 3 lines; else 0.262 of the core. An absent column has width 0.
    const ccol = lines => {
      const nl = belowGem(lines).filter(l => (l[2] - l[1]) * sig <= TSHEET.COMM_W.max * Wc);
      const m = nl.length >= 3 ? tsModal(nl) : null;
      const w = m ? (m[1] - m[0]) * sig : null;
      return (w != null && w >= TSHEET.COMM_W.min * Wc && w <= TSHEET.COMM_W.max * Wc) ? w : TSHEET.COMM_W.def * Wc;
    };
    const wcol = { in: inP ? ccol(innR.lines) : 0, out: outP ? ccol(outR.lines) : 0 };
    const wl = wcol[cLeft], wr = wcol[cRight];
    // Canonical Gemara band (between the commentary columns with K26 gutters; core edge beside an absent column).
    const gemC = [cL + wl + (wl ? gut : 0), cR - wr - (wr ? gut : 0)];
    // ---- §10.4a rule 2: Gemara band factor rho. The change (rho - 1) x width is taken from / given to the two
    // commentary columns in proportion to their canonical widths; their outer core edges never move.
    const d = (rho - 1) * (gemC[1] - gemC[0]);
    const fl = wl + wr > 0 ? wl / (wl + wr) : 0.5;
    const nl = wl ? [cL, cL + wl - d * fl] : [cL, cL];
    const nr = wr ? [cR - (wr - d * (1 - fl)), cR] : [cR, cR];
    if ((wl && !(nl[1] > nl[0])) || (wr && !(nr[1] > nr[0]))) throw new Error(`translation sheet: rho ${rho} leaves a commentary column with no width`);
    const narrow = { [cLeft]: nl, [cRight]: nr };
    const gemN = [wl ? nl[1] + gut : cL, wr ? nr[0] - gut : cR];
    // ---- §10.4a rule 3: wrap bands (half of the core while the partner column is present).
    const half = { [cLeft]: [cL, cmid - gut / 2], [cRight]: [cmid + gut / 2, cR] };

    const toks = arr => (arr || []).map(t => (t && typeof t === 'object' ? String(t.text) : String(t)));
    const streams = su.streams || {};
    const texts = { gemara: toks(streams.gemara), rashi: toks(streams.rashi), tosafot: toks(streams.tosafot) };
    const paras = name => new Set((su.paras && su.paras[name]) || []);
    const rtl = L === 'yi';
    const famG = tsFamily(L, 'gem'), famC = tsFamily(L, 'comm');
    const gemRange = su.gem || [0, 0];
    const rRange = [ci.rashi != null ? ci.rashi : (su.rashi || [0, 0])[0], (su.rashi || [0, 0])[1]];
    const tRange = [ci.tosafot != null ? ci.tosafot : (su.tosafot || [0, 0])[0], (su.tosafot || [0, 0])[1]];
    // Key reservation (T2g): su.keySegs = {segNum: count} (apparatus entries anchored to that Gemara segment, from
    // page.links). A key box is TS_KEY_EM × the Gemara size wide; it is reserved in front of the first token of its
    // segment, as the viewer draws it, so the line is laid out with the keys in place.
    const keyCountAt = {};
    const gemStreamTok = streams.gemara || [];
    if (su.keySegs && gemStreamTok.length) {
      gemStreamTok.forEach((tok, t) => {
        if (t > 0 && tok.seg === gemStreamTok[t - 1].seg) return;
        const cnt = su.keySegs[(Number(tok.seg) || 0) + 1] || 0;
        if (cnt > 0) keyCountAt[t] = cnt;
      });
    }
    const keyAdv = sG * TSHEET.KEY_EM;
    const extraG = gemStreamTok.map((_, t) => (keyCountAt[t] ? keyCountAt[t] * keyAdv : 0));
    const run = (id, stream, face, fam, size, lh, bands, range, obstacles) => tsBreakColumn({
      id, stream, face, fam, size, lh, bands, bottom: coreBottomX, rtl, texts: texts[stream],
      start: range[0], end: range[1], paras: paras(stream),
      extra: stream === 'gemara' ? extraG : null, obstacles: obstacles && obstacles.length ? obstacles : null,
    });
    // Ink contacts between lines of different regions (T3e): x-ranges cross and the ink intervals (plus
    // TS_INK_GAP) meet. 0 by construction when the solver converges; the loop runs until it is 0.
    const inkMeet = (A, B) => A.x0 < B.x1 - 1e-6 && B.x0 < A.x1 - 1e-6
      && A.baseline - A.inkA < B.baseline + B.inkD + TS_INK_GAP - 1e-6 && B.baseline - B.inkA < A.baseline + A.inkD + TS_INK_GAP - 1e-6;
    const crossInkOf = groups => {
      let n = 0;
      for (let p = 0; p < groups.length; p++) for (let q = p + 1; q < groups.length; q++)
        for (const A of groups[p]) for (const B of groups[q]) if (inkMeet(A, B)) n++;
      return n;
    };
    // Band solver (staircase, canonical columns). A column is "present" at y while y is above its content
    // end (ends.in / ends.out) and the Gemara while y is above ends.gem.
    //  - Gemara: narrow; a side widens to the core edge where the commentary column on that side ended.
    //  - Commentary column c: above the Gemara start, its half band while the other column is present (else
    //    full core width); beside the Gemara, its narrow band; below the Gemara end, its half band while the
    //    other column is present, else full core width.
    // Solved by iterating the content ends (fixed order, at most 8 rounds from all-present).
    // §10.4 item 4: the margin/apparatus slots of the he layer, σ-mapped to this sheet (same boxes on every
    // sheet; their entries are placed by anchor segment). A band that a slot overlaps gives way to it.
    // A slot's σ-mapped right edge may pass the page edge (the stretch widens the margins): it is clamped to
    // the page (heGeom.pageW, default the Berachot page width 643.575 pt), so no note is drawn off the sheet.
    const pageW = Number(heGeom.pageW) || 643.575;
    const slots = (heGeom.flows || []).map(f => ({ id: f.id, face: f.face, titleFace: f.titleFace,
      box: [Math.max(3, mapX(f.box[0])), f.box[1], Math.min(mapX(f.box[2]), pageW - 3), f.box[3]], maxBottom: f.maxBottom }))
      .filter(sl => sl.box[2] - sl.box[0] > 10);
    const flowYs = slots.flatMap(sl => [sl.box[1], sl.box[3]]);
    const flowCut = (a, b, xr) => {
      let x0 = xr[0], x1 = xr[1];
      for (const sl of slots) {
        if (!(sl.box[1] < b - 1e-9 && sl.box[3] > a + 1e-9)) continue;
        if ((sl.box[0] + sl.box[2]) / 2 > cmid) x1 = Math.min(x1, sl.box[0] - gut);
        else x0 = Math.max(x0, sl.box[2] + gut);
      }
      return [x0, x1];
    };
    const bandsFrom = (fn, cutsY) => {
      const cuts = [...new Set([coreTop, gemTop, ...cutsY, ...flowYs, coreBottomX].filter(v => v >= coreTop && v <= coreBottomX))].sort((x, y) => x - y);
      const out = [];
      for (let q = 0; q + 1 < cuts.length; q++) {
        const a = cuts[q], b = cuts[q + 1];
        if (b - a <= 1e-9) continue;
        const xr = flowCut(a, b, fn((a + b) / 2));
        if (!(xr[1] > xr[0])) continue;
        const last = out[out.length - 1];
        if (last && last.y1 === a && Math.abs(last.x0 - xr[0]) < 1e-9 && Math.abs(last.x1 - xr[1]) < 1e-9) last.y1 = b;
        else out.push({ y0: a, y1: b, x0: xr[0], x1: xr[1] });
      }
      return out;
    };
    const endOf = (res, range) => (res.next < range[1] ? coreBottomX : (res.lines.length ? Math.max(...res.lines.map(l => l.bottom)) : coreTop));
    let ends = { gem: coreBottomX, in: inP ? coreBottomX : coreTop, out: outP ? coreBottomX : coreTop };
    let G, R, T, bandsG, bandsR, bandsT, it = 0, crossInk = 0;
    for (it = 0; it < 12; it++) {
      const present = (c, y) => y < ends[c] - 1e-9;
      bandsG = bandsFrom(y => [present(cLeft, y) ? gemN[0] : cL, present(cRight, y) ? gemN[1] : cR],
        [ends.in, ends.out]).map(b => ({ y0: Math.max(b.y0, gemTop), y1: b.y1, x0: b.x0, x1: b.x1 })).filter(b => b.y1 > b.y0 + 1e-9);
      G = run('gemara', 'gemara', 0, famG, sG, lhG, bandsG, gemRange, R && T ? [...R.lines, ...T.lines] : null);
      const gemEnd = G.next < gemRange[1] ? coreBottomX : (G.lines.length ? Math.max(...G.lines.map(l => l.bottom)) : gemTop);
      const gPresent = y => y < gemEnd - 1e-9;
      const colBand = (c, y) => {
        const other = c === 'in' ? 'out' : 'in';
        if (y < gemTop) return present(other, y) ? half[c] : [cL, cR];
        if (gPresent(y)) return narrow[c];
        return present(other, y) ? half[c] : [cL, cR];
      };
      bandsR = bandsFrom(y => colBand('in', y), [gemEnd, ends.out]);
      bandsT = bandsFrom(y => colBand('out', y), [gemEnd, ends.in]);
      R = run('inner', 'rashi', 1, famC, sC, lhC, bandsR, rRange, [...G.lines, ...(T ? T.lines : [])]);
      T = run('outer', 'tosafot', 1, famC, sC, lhC, bandsT, tRange, [...G.lines, ...R.lines]);
      const next = { gem: gemEnd, in: endOf(R, rRange), out: endOf(T, tRange) };
      crossInk = crossInkOf([G.lines, R.lines, T.lines]);
      const same = next.gem === ends.gem && next.in === ends.in && next.out === ends.out && crossInk === 0;
      ends = next;
      if (same) break;
    }
    const lines = [...G.lines, ...R.lines, ...T.lines];
    // ---- Margin text blocks (T2e, §10.2 unanchored margin entries): in order over the sheets. A block's text
    // (su.margins[id].tokens, from store.langs[lang][id]) is set in its box, on every sheet, from its carried
    // position; what does not fit carries to the next sheet. A block without a translation (no tokens) is empty.
    const marginOut = {}, marginCarry = {};
    const faceBaseN = (heGeom.faces || []).length, facesExtra = [];
    let marginStalls = 0;
    const mBlocks = (heGeom.margins || []).filter(m => m && Array.isArray(m.lines) && m.lines.length);
    const mBoxes = mBlocks.map(m => {
      const xs = m.lines.flatMap(l => [mapX(l[1]), mapX(l[2])]);
      const ys = m.lines.map(l => l[0]);
      const x0 = Math.max(3, Math.min(...xs)), x1 = Math.min(pageW - 3, Math.max(...xs));
      const y0 = Math.max(coreTop, Math.min(...ys) - sC);
      // Margin text is set in the margin region's own he face (its printed size × k), as the he layer does, but
      // never below the margin minimum (§9.4, K7: 6.0 pt printed, yi 6.5): margin text is sized independently of k.
      // A raised size is a facesExtra entry stored as size / k at 3 decimals (exportSheetLines): it is rounded UP on
      // that grid, so that the size the viewer prints (stored × k) is never below the minimum (T3e).
      const sMin = (TSHEET.MARGIN_MIN_PT + (L === 'yi' ? 0.5 : 0)) / TSHEET.PRINT;
      const sHe = k * Number(heGeom.faces[m.face][1]);
      const sMinQ = (Math.ceil(sMin / k * 1000 - 1e-6) / 1000) * k;
      const sM = sHe >= sMin ? sHe : sMinQ;
      return { id: m.id, x0, x1, y0, y1: coreBottomX, face: m.face, size: sM, sMin: Math.min(sM, sMinQ), raised: sM > sHe + 1e-9 };
    });
    // Blocks that share a margin column split its largest free stretch (between the slots beside it) into equal
    // parts, in the order of their he regions. A block alone takes the whole free stretch.
    const groups = [];
    for (const bx of [...mBoxes].sort((p, q) => p.y0 - q.y0)) {
      const g = groups.find(gr => gr.some(o => o.x0 < bx.x1 && bx.x0 < o.x1));
      if (g) g.push(bx); else groups.push([bx]);
    }
    for (const g of groups) {
      const gx0 = Math.min(...g.map(b => b.x0)), gx1 = Math.max(...g.map(b => b.x1));
      const busy = slots.filter(o => o.box[0] < gx1 && gx0 < o.box[2] && o.box[3] > coreTop && o.box[1] < coreBottomX)
        .map(o => [o.box[1] - gut, o.box[3] + gut]).sort((p, q) => p[0] - q[0]);
      const free = [];
      let cur = coreTop;
      for (const [a, b] of busy) { if (a > cur) free.push([cur, a]); cur = Math.max(cur, b); }
      if (cur < coreBottomX) free.push([cur, coreBottomX]);
      const best = free.reduce((m, f) => (f[1] - f[0] > m[1] - m[0] ? f : m), [coreTop, coreTop]);
      const h = (best[1] - best[0]) / g.length;
      g.forEach((bx, i) => { bx.y0 = best[0] + i * h; bx.y1 = best[0] + (i + 1) * h - gut; });
    }
    // facesExtra entry of a margin size (size / k on the 3-decimal grid of exportSheetLines) -> face index
    const extraFace = (size, tid) => {
      let fe = facesExtra.findIndex(x => Math.abs(x.size - size / k) < 1e-6);
      if (fe < 0) { facesExtra.push({ tid, size: size / k }); fe = facesExtra.length - 1; }
      return faceBaseN + fe;
    };
    for (const bx of mBoxes) {
      const mt = su.margins && su.margins[bx.id];
      const toksM = mt && Array.isArray(mt.tokens) ? toks(mt.tokens) : [];
      // carried position: a block finished on an earlier sheet has null there (nothing more to place)
      const endM = mt && mt.range ? mt.range[1] : toksM.length;
      const startM = ci.margins && bx.id in ci.margins ? (ci.margins[bx.id] == null ? endM : ci.margins[bx.id]) : (mt && mt.range ? mt.range[0] : 0);
      marginOut[bx.id] = { lines: [], next: startM, box: [bx.x0, bx.y0, bx.x1, bx.y1] };
      if (!toksM.length || !(endM > startM) || !(bx.y1 > bx.y0 + lhC) || !(bx.x1 > bx.x0)) { marginCarry[bx.id] = startM < endM ? startM : null; continue; }
      const bands = flowCut(bx.y0, bx.y1, [bx.x0, bx.x1]);
      const band = [{ y0: bx.y0, y1: bx.y1, x0: bands[0], x1: bands[1] }];
      if (!(band[0].x1 > band[0].x0)) { marginCarry[bx.id] = startM < endM ? startM : null; continue; }
      // No word may be dropped (T2f): a block whose widest word does not fit its column is set in a smaller size
      // (down to 0.7 of its face), as its own face entry (facesExtra) appended after the he faces. Below that: stall.
      const bandW = band[0].x1 - band[0].x0;
      let sMx = bx.size, longest = 0;
      for (let q = startM; q < endM; q++) longest = Math.max(longest, tsAdvance(famC, sMx, toksM[q]));
      let faceIdx = bx.face, tid = bx.raised ? 'margin-min' : null;
      if (longest > bandW * 0.98) {
        // size / k floored on the 3-decimal grid (the stored size is the printed one)
        const f2 = (Math.floor(sMx * (bandW * 0.98 / longest) / k * 1000) / 1000) * k;
        // reduced at most to 0.7 of the face, and never below the margin minimum (§9.4)
        if (f2 >= 0.7 * bx.size && f2 >= bx.sMin - 1e-9) { sMx = f2; tid = 'margin-reduced'; }
      }
      if (tid) faceIdx = extraFace(sMx, tid);
      const res = tsBreakColumn({ id: bx.id, stream: bx.id, face: faceIdx, fam: famC, size: sMx, lh: TSHEET.LEAD.comm * sMx, bands: band,
        bottom: bx.y1, rtl, texts: toksM, start: startM, end: endM, paras: new Set() });
      const stalled = res.next === startM && startM < endM;
      if (stalled) marginStalls += endM - startM;
      marginOut[bx.id] = { lines: res.lines, next: res.next, box: [bx.x0, bx.y0, bx.x1, bx.y1], face: faceIdx, size: sMx };
      marginCarry[bx.id] = res.next < endM ? res.next : null;
    }
    // §10.6 catchword (last sheet only): the first words of the next amud's Gemara (stream su.catch.stream,
    // e.g. gemara@3a), under the Gemara's last line in the Gemara band, where no line or slot is in the way.
    let catchLine = null;
    const cs = su.catch;
    if (su.last && cs && Array.isArray(cs.tokens) && cs.tokens.length) {
      const cw = cs.tokens.map(t => (t && typeof t === 'object' ? String(t.text) : String(t)));
      const bw = tsBaseOffset(famG, sG, lhG);
      const cx0 = gemN[0], cx1 = gemN[1];
      let m = 0, wsum = 0;
      while (m < cw.length) {
        const nw = m === 0 ? tsAdvance(famG, sG, cw[0]) : wsum + tsAdvance(famG, sG, ' ') + tsAdvance(famG, sG, cw[m]);
        if (nw > (cx1 - cx0) + 1e-6) break;
        wsum = nw; m++;
      }
      if (m > 0) {
        const w = wsum;
        const x0 = rtl ? cx1 - w : cx0;
        const cInk = tsInk(famG, sG, cw.slice(0, m).join(' '));
        const top0 = G.lines.length ? Math.max(...G.lines.map(l => l.bottom)) : gemTop;
        // Candidate tops (T3e): under the Gemara's last line, under each line or slot, the ink clearance of each
        // line, and the reserved last line (coreBottom - lhG); the first free one in reading order is taken.
        const cand = [top0, coreBottom - lhG, ...lines.map(l => l.bottom), ...slots.map(sl => sl.box[3]),
          ...lines.map(l => l.baseline + l.inkD + TS_INK_GAP + cInk.asc - bw + 1e-6)]
          .filter(t => t >= top0 - 1e-9 && t + lhG <= coreBottom + 1e-9).sort((p, q) => p - q);
        for (const top of cand) {
          const bx0 = x0, bx1 = x0 + w, by0 = top, by1 = top + lhG;
          const probe = { x0: bx0, x1: bx1, baseline: by0 + bw, inkA: cInk.asc, inkD: cInk.desc };
          const hit = lines.some(l => (l.x0 < bx1 - 1e-6 && bx0 < l.x1 - 1e-6 && l.top < by1 - 1e-6 && by0 < l.bottom - 1e-6) || inkMeet(probe, l))
            || slots.some(sl => sl.box[0] < bx1 && bx0 < sl.box[2] && sl.box[1] < by1 && by0 < sl.box[3]);
          if (!hit) {
            catchLine = { region: 'catchword', stream: cs.stream, face: 0, size: sG, top: by0, bottom: by1,
              baseline: by0 + bw, x0: bx0, x1: bx1, a: 0, b: m, natW: w, last: true, inkA: cInk.asc, inkD: cInk.desc };
            break;
          }
        }
      }
    }
    // Ink contacts (T2d): consecutive lines of one column whose glyph extents touch or cross.
    let inkContacts = 0;
    const allCols = ['gemara', 'inner', 'outer', ...mBoxes.map(b => b.id)];
    for (const colId of allCols) {
      const cl = [...lines, ...Object.values(marginOut).flatMap(m => m.lines)].filter(l => l.id === colId).sort((p, q) => p.baseline - q.baseline);
      for (let p = 0; p + 1 < cl.length; p++) {
        const A = cl[p], B = cl[p + 1];
        if (B.baseline - B.inkA < A.baseline + A.inkD + TS_INK_GAP - 1e-6) inkContacts++;
      }
    }
    // Lines over an apparatus slot (T2d: 0 by construction; counted for the reviewer).
    let flowOverlaps = 0;
    const marginLines = Object.values(marginOut).flatMap(m => m.lines);
    for (const sl of slots) for (const l of [...lines, ...marginLines]) {
      if (l.x0 < sl.box[2] - 1e-6 && sl.box[0] < l.x1 - 1e-6 && l.top < sl.box[3] - 1e-6 && sl.box[1] < l.bottom - 1e-6) flowOverlaps++;
    }
    const capOf = (bands, lh) => tsCapacity(bands, lh, coreBottom);
    const capacity = capOf(bandsG, lhG) + capOf(bandsR, lhC) + capOf(bandsT, lhC);
    const placedN = (x) => x.lines.length;
    const overlaps = (() => {
      let n = 0;
      for (let p = 0; p < lines.length; p++) for (let q = p + 1; q < lines.length; q++) {
        const a = lines[p], b = lines[q];
        if (a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.top < b.bottom - 1e-6 && b.top < a.bottom - 1e-6) n++;
      }
      return n;
    })();
    const commW = R.lines.concat(T.lines).reduce((s, l) => s + l.natW, 0);
    const allW = lines.reduce((s, l) => s + l.natW, 0);
    const sheet = {
      lang: L, k, rtl, rho,
      faces: [[famG, sG], [famC, sC]],
      flows: slots, catch: catchLine, margins: marginOut, marginCarry, facesExtra, faceBaseN,
      lines: lines.map(l => ({ region: l.id, stream: l.stream, face: l.face, baseline: l.baseline,
        x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom, a: l.a, b: l.b, size: l.size, last: l.last })),
      placed: { gemara: [gemRange[0], G.next], rashi: [rRange[0], R.next], tosafot: [tRange[0], T.next] },
      carryOut: { rashi: R.next < rRange[1] ? R.next : null, tosafot: T.next < tRange[1] ? T.next : null, margins: marginCarry },
      geometry: {
        coreTop, coreBottom, gemTop, first, rho,
        core: [cL, cR], gemCanon: gemC, gemNarrow: gemN,
        columns: { leftC: cLeft, rightC: cRight, absent: ['in', 'out'].filter(c => !present0[c]),
          width: { in: wcol.in, out: wcol.out }, narrow, half },
        bands: { gem: bandsG, rashi: bandsR, tosafot: bandsT }, ends, iterations: it + 1,
      },
      measures: {
        overflowGem: gemRange[1] - G.next,           // tokens of the Gemara not placed (must be 0)
        carryRashi: rRange[1] - R.next > 0 ? rRange[1] - R.next : 0,
        carryTosafot: tRange[1] - T.next > 0 ? tRange[1] - T.next : 0,
        tooWide: G.tooWide + R.tooWide + T.tooWide,
        overlaps,
        inkContacts, flowOverlaps, catchword: !!catchLine,
        crossInk: crossInk + (catchLine ? lines.filter(l => inkMeet(catchLine, l)).length : 0),
        fontsUnstable: _tsUnstable - unstable0,   // measures taken while a face was loading (must be 0)
        marginLines: marginLines.length, marginStalls,
        lines: lines.length,
        fill: capacity > 0 ? (placedN(G) + placedN(R) + placedN(T)) / capacity : 0,
        fillCol: { gemara: placedN(G) / Math.max(1, capOf(bandsG, lhG)), rashi: placedN(R) / Math.max(1, capOf(bandsR, lhC)), tosafot: placedN(T) / Math.max(1, capOf(bandsT, lhC)) },
        minPrintPt: { gemara: lines.some(l => l.id === 'gemara') ? sG * TSHEET.PRINT : null,
          comm: R.lines.length + T.lines.length ? sC * TSHEET.PRINT : null },
        commShare: allW > 0 ? commW / allW : 0,
      },
    };
    return sheet;
  }

  /**
   * Serialisable layer/2 sheet shape for the builder (renderer-1 T2). Input: array of sheets from
   * layoutTranslationSheet, in order. Output per sheet: regions (ids gemara|inner|outer, each line
   * [baseline, x0, x1, [[face, {r:[[stream, i0, i1]]}]]]; face 0 = gemara face, 1 = commentary face,
   * see `faces`), rho (K23) and geometry.columns (§10.4a), placed/carryOut and measures.
   */
  function exportSheetLines(sheets) {
    return (sheets || []).map((s, j) => {
      const byId = { gemara: [], inner: [], outer: [] };
      const sorted = s.lines.slice().sort((p, q) => (p.region === q.region ? p.top - q.top : (p.region < q.region ? -1 : 1)));
      const r3 = v => Math.round(v * 1000) / 1000;
      for (const ln of sorted) {
        byId[ln.region].push([r3(ln.baseline), r3(ln.x0), r3(ln.x1),
          [[ln.face, { r: [[ln.stream, ln.a, ln.b]] }]]]);
      }
      const streamOf = { gemara: 'gemara', inner: 'rashi', outer: 'tosafot' };
      return {
        j, lang: s.lang, k: s.k, rho: s.rho, faces: s.faces,
        regions: ['gemara', 'inner', 'outer'].map(id => ({ id, stream: streamOf[id], lines: byId[id] })),
        // Apparatus/margin slots of the sheet (he layer flow regions, σ-mapped; face = he face index).
        flows: (s.flows || []).map(f => ({ id: f.id, box: f.box.map(r3), maxBottom: r3(f.maxBottom), face: f.face, titleFace: f.titleFace })),
        // Catchword line (last sheet): [baseline, x0, x1, [[0, {r:[[stream, 0, n]]}]]] (face 0 = gemara face), else null.
        catchword: s.catch ? [[r3(s.catch.baseline), r3(s.catch.x0), r3(s.catch.x1), [[0, { r: [[s.catch.stream, 0, s.catch.b]] }]]]] : null,
        // Margin text blocks (T2e): id -> lines [baseline, x0, x1, [[heFace, {r:[[stream, a, b]]}]]] (heFace = the margin region's face index).
        // Extra faces for reduced margin text: append to the layer's faces at index faceBase + j (faceBase = he faces count).
        facesExtra: (s.facesExtra || []).map(f => [f.tid, Math.round(f.size * 1000) / 1000]), faceBase: s.faceBaseN,
        margins: Object.fromEntries(Object.entries(s.margins || {}).map(([id, m]) => [id, m.lines.map(ln => [r3(ln.baseline), r3(ln.x0), r3(ln.x1), [[ln.face, { r: [[id, ln.a, ln.b]] }]]])])),
        placed: s.placed, carryOut: s.carryOut, measures: s.measures, geometry: s.geometry,
        minPrintPt: s.measures.minPrintPt,
      };
    });
  }

  // ═════════════════ Layout policy (one engine, two policies) ═════════════════
  //   strict-vilna — effective settings equal DEFAULT_SETTINGS and a per-amud
  //                  reference profile exists: place the printed lines exactly.
  //   adaptive     — anything else: band solver + relaxation + pagination.

  const PROFILE_SCHEMA = 'vilna-profile/1';
  const PROFILE_BASE = 'data/vilna-profiles';

  /** Settings with every known key filled; extras as a sorted set. */
  function canonicalSettings(s) {
    const e = Object.assign({}, DEFAULT_SETTINGS);
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const v = s ? s[k] : undefined;
      if (v !== undefined && v !== null && v !== '') e[k] = v;
    }
    e.extras = [...new Set((Array.isArray(e.extras) ? e.extras : []).map(String))].sort();
    e.hidden = [...new Set((Array.isArray(e.hidden) ? e.hidden : []).map(String))].sort();
    e.fontScale = Math.round((Number(e.fontScale) || 1) * 100) / 100;
    // Unknown ids fall back to the default instead of reaching the renderer.
    if (!TEXT_LANGS.some(l => l.id === e.textLang)) e.textLang = DEFAULT_SETTINGS.textLang;
    if (!LICENSE_MODES.includes(e.licenseMode)) e.licenseMode = DEFAULT_SETTINGS.licenseMode;
    return e;
  }

  function isDefaultSettings(s) {
    const a = canonicalSettings(s), d = canonicalSettings(DEFAULT_SETTINGS);
    return Object.keys(d).every(k => (Array.isArray(d[k])
      ? a[k].length === d[k].length && a[k].every((x, i) => x === d[k][i])
      : a[k] === d[k]));
  }

  /** Hebrew names of the printed apparatus blocks (design §2.2). */
  const APPARATUS_HE = {
    masoretHaShas: 'מסורת הש״ס', einMishpat: 'עין משפט נר מצוה', torahOr: 'תורה אור',
    gilyonHaShas: 'גליון הש״ס', hagahotHaBach: 'הגהות הב״ח', mosafRashi: 'מוסף רש״י',
    mosafTosafot: 'מוסף תוספות', rabbeinuChananel: 'רבינו חננאל', ravNissimGaon: 'רב נסים גאון',
    rabbeinuGershom: 'רבינו גרשום', laazeiRashi: 'לעזי רש״י', shitaMekubetzet: 'שיטה מקובצת',
    hagahotRansburg: 'הגהות ר״ב רנשבורג', hagahotHaGra: 'הגהות הגר״א', perushHaRosh: 'פירוש הרא״ש',
    shinuyeiNuschaot: 'שינויי נוסחאות', tosafotYeshanim: 'תוספות ישנים', hagahotHaTosafot: 'הגהות התוספות',
    nuschatHaRivan: 'נוסחת הריב״ן', tosafotMargin: 'תוספות (גליון)', tosafotRiHazaken: 'תוספות ר״י הזקן',
    tosafotRid: 'תוספות רי״ד', likutim: 'ליקוטים', piskeiRid: 'פסקי רי״ד',
    tosafotChadMikamai: 'תוספות חד מקמאי', tosafotHaRosh: 'תוספות הרא״ש', tosafotShantz: 'תוספות שאנץ',
    hagahotMaharyLanda: 'הגהות מהר״י לנדא', nuschatHaBavli: 'נוסחת הבבלי',
    bottom: 'פירושים בשולי הדף', footnote: 'הערות שוליים',
  };

  /**
   * Toggle-able printed apparatus blocks of one amud (design §2.2), page order.
   * Regions of the same id (e.g. two parts of `bottom`) are merged.
   */
  function printedBlocks(pp) {
    const byId = new Map();
    for (const r of (pp && pp.regions) || []) {
      if (!['margin', 'bottom', 'footnote'].includes(r.kind)) continue;
      if (!Array.isArray(r.lines) || !r.lines.length) continue;
      const id = String(r.id);
      if (id.startsWith('block:')) continue;
      let b = byId.get(id);
      if (!b) {
        const first = profileLineText(r.lines[0][3]).trim();
        const words = first ? first.split(/\s+/).length : 0;
        const he = APPARATUS_HE[id] || (r.kind === 'margin' && words > 0 && words <= 4 ? first : id);
        b = { id, he, kind: r.kind, side: r.side, lines: 0, rights: r.rights };
        byId.set(id, b);
      }
      b.lines += r.lines.length;
    }
    return [...byId.values()];
  }

  /**
   * Anchored-policy plan from the settings (design §3.1). PURE. pp = per-amud profile.
   * Only derived from settings and the printed regions of the amud.
   */
  function anchorPlan(settings, pp) {
    const s = canonicalSettings(settings), d = DEFAULT_SETTINGS;
    const printed = new Set(printedBlocks(pp).map(b => b.id));
    const plan = {
      scale: s.fontScale,
      restyle: { gemara: s.gemaraFont !== d.gemaraFont ? s.gemaraFont : null,
                 comm:   s.commFont   !== d.commFont   ? s.commFont   : null },
      flow: { gemara: s.edition !== d.edition,
              inner:  s.inner !== d.inner || s.lang !== d.lang,
              outer:  s.outer !== d.outer || s.lang !== d.lang },
      hidden: s.hidden.filter(id => printed.has(id)),
      extras: s.extras.filter(id => !printed.has(id) && !s.hidden.includes(id)),
      lang: s.lang,
    };
    plan.needsFlow = plan.flow.gemara || plan.flow.inner || plan.flow.outer || plan.extras.length > 0;
    plan.noop = plan.scale === 1 && !plan.restyle.gemara && !plan.restyle.comm
             && !plan.needsFlow && !plan.hidden.length;
    return plan;
  }

  /**
   * Pure policy decision (plan §3.1). profilePage = parsed per-amud profile
   * or null. Returns {policy, fallback, reason}.
   */
  /** Restyle family for a font setting (design §3.3 (3)). */
  function restyleFamily(v) {
    return v === 'rashi' ? 'RashiScript' : v === 'frank' ? 'FrankRuhl' : String(v).replace(/["\\]/g, '');
  }

  /** Catchword regions (design §3.3 (3)); side 'center' belongs to the Gemara. */
  function isCatchwordRegion(r) { return String(r.id) === 'catchword' || r.kind === 'catchword'; }

  /** Regions a restyle target covers (design §3.3 (3)). */
  function restyleRegionsOf(pp, target) {
    return (pp.regions || []).filter(r => {
      if (target === 'comm') return r.id !== 'gemara' && r.kind !== 'header' && !(isCatchwordRegion(r) && r.side === 'center');
      return r.id === 'gemara' || (isCatchwordRegion(r) && r.side === 'center');
    });
  }

  /** Calls fn(faceIndex, text) for every text piece of a region (string or runs content). */
  function eachRunOf(region, fn) {
    const rf = region.face != null ? region.face : 0;
    for (const ln of region.lines || []) {
      if (!Array.isArray(ln) || ln[3] == null) continue;
      const c = ln[3];
      if (typeof c === 'string') { fn(rf, c); continue; }
      if (!Array.isArray(c)) continue;
      for (const run of c) {
        if (!Array.isArray(run)) continue;
        fn(run[0] != null ? run[0] : rf, run[1] == null ? '' : String(run[1]));
      }
    }
  }

  /** Face index → typeface id, for the faces a restyle target re-fonts (script match, never ornament). */
  function restyleFaceMap(pp, edition, target) {
    const map = new Map();
    const ed = edition || {};
    const want = target === 'comm' ? 'rashi' : 'square';
    for (const r of restyleRegionsOf(pp, target)) {
      eachRunOf(r, fi => {
        if (map.has(fi)) return;
        const face = pp.faces && pp.faces[fi];
        if (!face) return;
        const tid = String(face[0]);
        if (tid === 'ornament') return;
        const tf = ed.typefaces && ed.typefaces[tid];
        if (!tf || tf.script !== want) return;
        map.set(fi, tid);
      });
    }
    return map;
  }

  /**
   * Restyle fit (design §3.6). Async (loads the target family). Returns
   * { [tid@target]: sizeScale }. Pure letter statistics of this amud's targeted text.
   */
  async function measureRestyleFits(pp, edition, plan) {
    const fits = {};
    const ed = edition || {};
    let ctx = null;
    try { ctx = document.createElement('canvas').getContext('2d'); } catch (e) { ctx = null; }
    for (const target of ['comm', 'gemara']) {
      const setting = plan.restyle && plan.restyle[target];
      if (!setting) continue;
      const F = restyleFamily(setting);
      const map = restyleFaceMap(pp, ed, target);
      const counts = new Map(); // tid -> Map(ch -> n)
      for (const r of restyleRegionsOf(pp, target)) {
        eachRunOf(r, (fi, text) => {
          const tid = map.get(fi);
          if (tid == null) return;
          if (!counts.has(tid)) counts.set(tid, new Map());
          const cm = counts.get(tid);
          for (const ch of text) {
            if (/\s/.test(ch) || /\p{M}/u.test(ch)) continue;
            cm.set(ch, (cm.get(ch) || 0) + 1);
          }
        });
      }
      for (const [tid, cm] of counts) {
        const wf = (ed.webFonts && ed.webFonts[tid]) || {};
        const W = Number(wf.wght) || 400;
        try { await ensureWebFont({ family: F, wght: W, file: null }); } catch (e) { /* fallback face */ }
        await document.fonts.load(W + ' 100px "' + F + '"', 'אבגדהוזחטיכלמנסעפצקרשת').catch(() => null);
        const tf = (ed.typefaces && ed.typefaces[tid]) || {};
        const adv = Object.assign({}, tf.punctAdvEm, tf.advEm);
        let ref = 0, web = 0;
        if (ctx) ctx.font = W + ' 100px "' + F + '"';
        for (const [ch, n] of cm) {
          if (adv[ch] == null) continue;
          ref += n * Number(adv[ch]);
          web += ctx ? n * ctx.measureText(ch).width / 100 : 0;
        }
        const fb = Number(wf.sizeScale) || 1;
        fits[tid + '@' + target] = web > 0 ? clampN(ref / web, 0.55, 1.30) : fb;
      }
    }
    return fits;
  }

  /**
   * Hide one printed apparatus block (design §3.3 (1)). Mutates pp (a clone).
   */
  function applyHide(pp, id, dropped) {
    const B = (pp.regions || []).filter(r => String(r.id) === id);
    if (!B.length) return;
    const kind = B[0].kind, side = B[0].side;
    const regionTop = r => (Array.isArray(r.lines) && r.lines.length ? +r.lines[0][0] : 0);
    const removedOrn = new Set();
    if (kind === 'bottom' || kind === 'footnote') {
      // Nothing is below these: remove; a path rule just above a footnote goes with it.
      if (kind === 'footnote') {
        const fl = regionTop(B[0]);
        for (const o of pp.ornaments || []) {
          if (o.k === 'path-rule' && Array.isArray(o.b) && o.b[3] <= fl && fl - o.b[3] <= 12) removedOrn.add(o);
        }
      }
      pp.regions = pp.regions.filter(r => String(r.id) !== id);
      pp.ornaments = (pp.ornaments || []).filter(o => !removedOrn.has(o));
      dropped.push({ id, kind, side, reason: 'hidden' });
      return;
    }
    if (kind !== 'margin') return;
    const margins = pp.regions.filter(r => r.kind === 'margin' && r.side === side);
    let x0 = Infinity, x1 = -Infinity;
    for (const r of margins) for (const ln of r.lines || []) if (Array.isArray(ln)) { x0 = Math.min(x0, +ln[1]); x1 = Math.max(x1, +ln[2]); }
    const ornsCol = (pp.ornaments || []).filter(o => {
      if (!Array.isArray(o.b)) return false;
      const cx = (+o.b[0] + +o.b[2]) / 2;
      return cx >= x0 && cx <= x1;
    });
    // Core x-range (gemara, inner, outer lines).
    let cx0 = Infinity, cx1 = -Infinity;
    for (const r of pp.regions) {
      if (!['gemara', 'inner', 'outer'].includes(String(r.id))) continue;
      for (const ln of r.lines || []) if (Array.isArray(ln)) { cx0 = Math.min(cx0, +ln[1]); cx1 = Math.max(cx1, +ln[2]); }
    }
    const clean = margins.every(r => (r.lines || []).every(ln => !Array.isArray(ln) || +ln[2] <= cx0 || +ln[1] >= cx1));
    // Column items sorted by top (region: first baseline; ornament: b[1]).
    const items = [];
    for (const r of margins) items.push({ t: 'r', top: regionTop(r), r });
    for (const o of ornsCol) items.push({ t: 'o', top: +o.b[1], o });
    items.sort((a, b) => a.top - b.top);
    const bIdx = items.map((it, i) => (it.t === 'r' && String(it.r.id) === id ? i : -1)).filter(i => i >= 0);
    const firstB = bIdx[0], lastB = bIdx[bIdx.length - 1];
    const bTop = items[firstB].top;
    let nextIdx = -1;
    for (let i = lastB + 1; i < items.length; i++) if (items[i].t === 'r') { nextIdx = i; break; }
    // Divider ornament(s) adjacent to B.
    if (nextIdx >= 0) {
      for (let i = lastB + 1; i < nextIdx; i++) if (items[i].t === 'o') removedOrn.add(items[i].o);
    } else {
      let prevIdx = -1;
      for (let i = firstB - 1; i >= 0; i--) if (items[i].t === 'r') { prevIdx = i; break; }
      for (let i = prevIdx + 1; i < firstB; i++) if (items[i].t === 'o') removedOrn.add(items[i].o);
    }
    const gone = new Set(bIdx.map(i => items[i].r));
    const blockLines = [...gone].reduce((n, r) => n + (r.lines || []).length, 0);
    pp.regions = pp.regions.filter(r => !gone.has(r));
    pp.ornaments = (pp.ornaments || []).filter(o => !removedOrn.has(o));
    if (clean && nextIdx >= 0) {
      const delta = items[nextIdx].top - bTop;
      for (let i = lastB + 1; i < items.length; i++) {
        const it = items[i];
        if (it.t === 'o' && removedOrn.has(it.o)) continue;
        if (it.t === 'r') {
          for (const ln of it.r.lines || []) if (Array.isArray(ln)) ln[0] = +ln[0] - delta;
        } else {
          it.o.b[1] = +it.o.b[1] - delta; it.o.b[3] = +it.o.b[3] - delta;
        }
      }
    }
    dropped.push({ id, kind, side, reason: 'hidden', lines: blockLines, shifted: clean && nextIdx >= 0 });
  }

  // ── Slots (design §3.4). Pure: printed geometry of one region → staircase bands (pt). ──
  function faceSizeOf(pp, fi) {
    const f = pp.faces && pp.faces[fi];
    return f ? Number(f[1]) || 0 : 0;
  }
  /** Printed lines of the regions picked by pred → {bl, x0, x1, size, id}; size = largest face of the line. */
  function regionLinesOf(pp, pred) {
    const out = [];
    for (const r of pp.regions || []) {
      if (!pred(String(r.id), r)) continue;
      const rf = r.face != null ? r.face : 0;
      for (const ln of r.lines || []) {
        if (!Array.isArray(ln)) continue;
        let size = 0;
        if (Array.isArray(ln[3])) {
          for (const run of ln[3]) if (Array.isArray(run)) size = Math.max(size, faceSizeOf(pp, run[0] != null ? run[0] : rf));
        }
        if (!size) size = faceSizeOf(pp, rf);
        out.push({ id: String(r.id), bl: +ln[0], x0: +ln[1], x1: +ln[2], size });
      }
    }
    return out;
  }
  /** Rows = lines grouped by baseline (|dbl| <= 2.5 pt), extent = hull of the pieces. */
  function slotRows(lines) {
    const rows = [];
    for (const l of lines.slice().sort((a, b) => a.bl - b.bl || a.x0 - b.x0)) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(l.bl - last.bl) <= 2.5) {
        last.x0 = Math.min(last.x0, l.x0); last.x1 = Math.max(last.x1, l.x1); last.size = Math.max(last.size, l.size);
      } else rows.push({ bl: l.bl, x0: l.x0, x1: l.x1, size: l.size });
    }
    return rows;
  }
  /** Median positive pitch between consecutive rows (fallback when the region has one row). */
  function slotPitch(rows, fallback) {
    const ps = [];
    for (let i = 0; i + 1 < rows.length; i++) { const d = rows[i + 1].bl - rows[i].bl; if (d > 0) ps.push(d); }
    if (!ps.length) return fallback;
    ps.sort((a, b) => a - b);
    const m = ps.length >> 1;
    return ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
  }
  /** H-rule (§3.4): a row inherits the hull of its contiguous neighbours (i-1, i, i+1). */
  function slotHRule(rows, L) {
    const contig = (i, j) => Math.abs(rows[j].bl - rows[i].bl) <= 1.6 * L;
    return rows.map((row, i) => {
      let hx0 = row.x0, hx1 = row.x1;
      for (const j of [i - 1, i, i + 1]) {
        if (j < 0 || j >= rows.length || (j !== i && !contig(i, j))) continue;
        hx0 = Math.min(hx0, rows[j].x0); hx1 = Math.max(hx1, rows[j].x1);
      }
      return { hx0, hx1 };
    });
  }
  /**
   * Round 3: a row of a flow region that sits on a kept header line (same baseline band, overlapping
   * extent) is print furniture (title / daf marks in the header zone), not a text lane of the stream.
   * Such rows are dropped from the slot so the flow never starts inside the header.
   */
  function headerZoneRow(pp, row) {
    const hdr = regionLinesOf(pp, (_id, r) => r.kind === 'header');
    return hdr.some(O => Math.abs(O.bl - row.bl) <= 0.9 * Math.max(row.size, O.size)
      && O.x0 < row.x1 && O.x1 > row.x0);
  }
  /** Rows, pitch and H-rule extents of one flow region (no obstacles). Null when it has no lines. */
  function slotGeometry(pp, id, edition) {
    const lines = regionLinesOf(pp, rid => rid === id);
    if (!lines.length) return null;
    let rows = slotRows(lines);
    const textRows = rows.filter(r => !headerZoneRow(pp, r));
    if (textRows.length) rows = textRows;
    const dd = (edition && edition.defaults) || {};
    const lead = id === 'gemara' ? (dd.gemara && dd.gemara.leading) : (dd.wrap && dd.wrap.leading);
    const L = slotPitch(rows, Number(lead) || rows[0].size * 1.35);
    const G = Math.max(4, (Number(dd.columns644 && dd.columns644.gutter) || 11.4) - 1);
    const contig = (i, j) => Math.abs(rows[j].bl - rows[i].bl) <= 1.6 * L;
    return { rows, L, G, asc: 0.8 * L, contig, hr: slotHRule(rows, L) };
  }
  /** Core-mask pad (design §3.4), in slot units (pt). */
  const CORE_PAD = 1.5;
  /**
   * Core pad in slot units for a page magnification (fontScale). A render at scale s draws slot pt
   * at s times the device px, so the pad is divided by s and the clearance stays CORE_PAD device px.
   */
  function corePadFor(scale) {
    const s = Number(scale);
    return s > 0 && Math.abs(s - 1) > 1e-9 ? CORE_PAD / s : CORE_PAD;
  }
  /** Bands of one slot before pairwise separation (obstacle clipping, §3.4). */
  function slotRawBands(pp, id, flowIds, edition, pad) {
    const g = slotGeometry(pp, id, edition);
    if (!g) return null;
    const CP = pad == null ? CORE_PAD : pad;
    // Core mask (design §3.4): every kept line box (all non-flowing regions, incl. the kept Gemara)
    // and every ornament, inflated by the pad. Kept header and bottom/footnote blocks also enter as
    // one hull per block (their band), so the flow never threads the gaps inside a kept block.
    // Flow bands are clipped against it; a band never reaches past its printed extent toward a core
    // box, so the flow cannot cover the core.
    const obs = [];
    for (const O of regionLinesOf(pp, rid => rid !== id && !flowIds.includes(rid))) {
      obs.push({ x0: O.x0 - CP, x1: O.x1 + CP, y0: O.bl - 0.9 * O.size - CP,
        y1: O.bl + 0.35 * O.size + CP, core: true });
    }
    for (const r of pp.regions || []) {
      const rid = String(r.id);
      if (rid === id || flowIds.includes(rid)) continue;
      if (!['header', 'bottom', 'footnote'].includes(r.kind)) continue;
      const lines = regionLinesOf(pp, (_id, reg) => reg === r).filter(O => O.x1 > O.x0);
      if (!lines.length) continue;
      obs.push({ x0: Math.min(...lines.map(O => O.x0)) - CP, x1: Math.max(...lines.map(O => O.x1)) + CP,
        y0: Math.min(...lines.map(O => O.bl - 0.9 * O.size)) - CP,
        y1: Math.max(...lines.map(O => O.bl + 0.35 * O.size)) + CP, core: true });
    }
    for (const fid of flowIds) {
      if (fid === id) continue;
      const og = slotGeometry(pp, fid, edition);
      if (!og) continue;
      og.rows.forEach((row, i) => obs.push({ x0: og.hr[i].hx0, x1: og.hr[i].hx1,
        y0: row.bl - 0.9 * row.size, y1: row.bl + 0.35 * row.size }));
    }
    for (const o of pp.ornaments || []) {
      if (Array.isArray(o.b)) obs.push({ x0: +o.b[0] - CP, x1: +o.b[2] + CP,
        y0: +o.b[1] - CP, y1: +o.b[3] + CP, core: true });
    }
    const { rows, L, G, asc, contig } = g;
    const bands = rows.map((row, i) => {
      let hx0 = g.hr[i].hx0, hx1 = g.hr[i].hx1;
      const y0 = row.bl - asc;
      const y1 = i + 1 < rows.length && contig(i, i + 1) ? rows[i + 1].bl - asc : y0 + L;
      for (const O of obs) {
        if (!(O.y0 < y1 && O.y1 > y0)) continue;
        if (O.x1 <= row.x0 + 0.5) hx0 = Math.max(hx0, Math.min(row.x0, O.x1 + G));
        else if (O.x0 >= row.x1 - 0.5) hx1 = Math.min(hx1, Math.max(row.x1, O.x0 - G));
        else if (O.core) {
          // The core overlaps the printed extent itself: the print sits against it, so the hull
          // may not extend past the printed row toward the core (clip, never extend into it).
          if (O.x0 < row.x0) hx0 = Math.max(hx0, row.x0);
          if (O.x1 > row.x1) hx1 = Math.min(hx1, row.x1);
        }
      }
      return { y0, y1, x0: hx0, x1: hx1, row };
    });
    return { bands, G, L, asc, obs };
  }
  /**
   * Slot of one flow region (design §3.4). flowIds = every flowing region id of the amud.
   * Returns {id, bands, box, L, asc, tid, size, firstBl, rows} or null when the region has no lines.
   * Throws Error code 'slot-invariant' when a band does not contain its printed row, is narrower
   * than min(30 pt, its printed extent), or the bands are not ordered.
   */
  function computeSlot(pp, id, flowIds, edition, pad) {
    const sid = String(id);
    const fl = (flowIds || []).map(String);
    const own = slotRawBands(pp, sid, fl, edition, pad);
    if (!own) return null;
    const G = own.G;
    // Pairwise separation against the other flow slots. Both sides see the same raw pair and
    // each moves only its own rows, so the result is symmetric.
    const mine = own.bands.map(b => ({ y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1, row: b.row }));
    for (const oid of fl) {
      if (oid === sid) continue;
      const other = slotRawBands(pp, oid, fl, edition, pad);
      if (!other) continue;
      for (const a of mine) {
        for (const b of other.bands) {
          if (!(a.y0 < b.y1 && a.y1 > b.y0)) continue;
          if (!(a.x0 < b.x1 + G && b.x0 < a.x1 + G)) continue;
          const aRight = (a.x0 + a.x1) / 2 >= (b.x0 + b.x1) / 2;
          const leftX1 = aRight ? b.x1 : a.x1;
          const rightX0 = aRight ? a.x0 : b.x0;
          const m = (leftX1 + rightX0) / 2;
          if (aRight) a.x0 = Math.min(a.row.x0, Math.max(a.x0, m + G / 2));
          else a.x1 = Math.max(a.row.x1, Math.min(a.x1, m - G / 2));
        }
      }
    }
    // merge equal consecutive bands that touch; a vertical gap stays a gap
    const out = [];
    for (const b of mine) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x0 - b.x0) <= 0.5 && Math.abs(last.x1 - b.x1) <= 0.5 && b.y0 <= last.y1 + 0.01) {
        last.y1 = Math.max(last.y1, b.y1);
        last.x0 = Math.min(last.x0, b.x0); last.x1 = Math.max(last.x1, b.x1);
        last.rows.push(b.row);
      } else out.push({ y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1, rows: [b.row] });
    }
    const bad = why => Object.assign(new Error(`slot-invariant ${sid}: ${why}`), { code: 'slot-invariant' });
    out.forEach((b, i) => {
      for (const row of b.rows) {
        if (b.x0 > row.x0 + 0.01 || b.x1 < row.x1 - 0.01) {
          throw bad(`band [${b.x0.toFixed(2)},${b.x1.toFixed(2)}] y=${b.y0.toFixed(2)} does not contain row [${row.x0.toFixed(2)},${row.x1.toFixed(2)}] bl=${row.bl}`);
        }
      }
      const need = Math.min(30, ...b.rows.map(r => r.x1 - r.x0));
      if (b.x1 - b.x0 < need - 0.01) throw bad('band narrower than 30 pt');
      if (!(b.y1 > b.y0)) throw bad('empty band');
      if (i && out[i - 1].y1 > b.y0 + 0.01) throw bad('bands overlap or are unordered');
    });
    const region = (pp.regions || []).find(r => String(r.id) === sid);
    const face = region && region.face != null ? region.face : 0;
    const f = (pp.faces && pp.faces[face]) || [null, 0];
    // Round 3: a wrap stream (inner / outer) may use the free column height below its printed extent,
    // down to the first kept block (or other flow row) under its last band, before the text is cut to
    // the continuation sheet. The Gemara keeps its own printed bottom (its outline is the anchor).
    if (id !== 'gemara' && out.length) {
      const last = out[out.length - 1];
      let lim = Infinity;
      for (const O of own.obs) {
        if (O.y0 < last.y1 - 0.01) continue;
        if (O.x1 <= last.x0 || O.x0 >= last.x1) continue;
        lim = Math.min(lim, O.y0);
      }
      if (lim < Infinity && lim > last.y1) last.y1 = lim;
    }
    const bandsOut = out.map(b => ({ y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1 }));
    const box = {
      x0: Math.min(...bandsOut.map(b => b.x0)), x1: Math.max(...bandsOut.map(b => b.x1)),
      y0: bandsOut[0].y0, y1: bandsOut[bandsOut.length - 1].y1,
    };
    return {
      id: sid, bands: bandsOut, box, L: own.L, asc: own.asc,
      tid: f[0] != null ? String(f[0]) : null, size: Number(f[1]) || 0,
      firstBl: own.bands[0].row.bl, rows: own.bands.length,
    };
  }

  /** Catchword owner by side (design §3.3 (2)): inner → inner, center → gemara, outer → outer. */
  function catchwordOwner(r) {
    return r.side === 'inner' ? 'inner' : r.side === 'center' ? 'gemara' : r.side === 'outer' ? 'outer' : null;
  }

  /**
   * Pure transform of the per-amud profile + edition for an anchored plan (design §3.3).
   * Inputs are never mutated. Order: hide → slots (all computed before any flow region is
   * removed) → remove flow regions and their catchwords → restyle → flow typefaces.
   */
  function transformProfile(pp, edition, plan, fits) {
    const pp2 = JSON.parse(JSON.stringify(pp));
    const edition2 = JSON.parse(JSON.stringify(edition || {}));
    edition2.typefaces = edition2.typefaces || {};
    edition2.webFonts = edition2.webFonts || {};
    const dropped = [];
    const slots = {};
    for (const id of plan.hidden || []) applyHide(pp2, String(id), dropped);
    // (2) slots
    const flowIds = ['gemara', 'inner', 'outer'].filter(id => plan.flow && plan.flow[id]);
    const computed = flowIds.map(id => ({ id, slot: computeSlot(pp2, id, flowIds, edition2, corePadFor(plan.scale)) }));
    for (const { id, slot } of computed) {
      if (!slot) throw Object.assign(new Error(`no slot for ${id}`), { code: 'no-slot' });
      slots[id] = slot;
    }
    for (const id of flowIds) {
      pp2.regions = pp2.regions.filter(r => !(String(r.id) === id || (isCatchwordRegion(r) && catchwordOwner(r) === id)));
    }
    // (3) restyle
    for (const target of ['comm', 'gemara']) {
      const setting = plan.restyle && plan.restyle[target];
      if (!setting) continue;
      const F = restyleFamily(setting);
      const map = restyleFaceMap(pp2, edition2, target);
      if (!map.size) continue;
      const faceMap = new Map();
      const made = new Set();
      for (const fi of [...map.keys()].sort((a, b) => a - b)) {
        const tid = map.get(fi);
        const tid2 = tid + '@' + target;
        if (!made.has(tid)) {
          made.add(tid);
          edition2.typefaces[tid2] = JSON.parse(JSON.stringify(edition2.typefaces[tid]));
          const wf = edition2.webFonts[tid] || {};
          const fit = fits && fits[tid2] != null ? fits[tid2] : (Number(wf.sizeScale) || 1);
          edition2.webFonts[tid2] = {
            family: F, file: null, wght: Number(wf.wght) || 400, sizeScale: fit,
            baselineShiftEm: 0, inkShiftXEm: 0, fitted: true,
          };
        }
        pp2.faces.push([tid2, pp2.faces[fi][1]]);
        faceMap.set(fi, pp2.faces.length - 1);
      }
      for (const r of restyleRegionsOf(pp2, target)) {
        const rf = r.face != null ? r.face : 0;
        if (faceMap.has(rf)) r.face = faceMap.get(rf);
        for (const ln of r.lines || []) {
          if (!Array.isArray(ln) || !Array.isArray(ln[3])) continue;
          for (const run of ln[3]) {
            if (Array.isArray(run) && run[0] != null && faceMap.has(run[0])) run[0] = faceMap.get(run[0]);
          }
        }
      }
    }
    // Flow typefaces: the restyled face of the target when a restyle is active (design §3.3 (3)).
    for (const id of flowIds) {
      const target = id === 'gemara' ? 'gemara' : 'comm';
      const setting = plan.restyle && plan.restyle[target];
      const slot = slots[id];
      slot.fontTid = slot.tid;
      if (!setting || !slot.tid) continue;
      const tid2 = slot.tid + '@' + target;
      if (!edition2.webFonts[tid2]) {
        const wf = edition2.webFonts[slot.tid] || {};
        const fit = fits && fits[tid2] != null ? fits[tid2] : (Number(wf.sizeScale) || 1);
        edition2.typefaces[tid2] = JSON.parse(JSON.stringify(edition2.typefaces[slot.tid] || {}));
        edition2.webFonts[tid2] = {
          family: restyleFamily(setting), file: null, wght: Number(wf.wght) || 400, sizeScale: fit,
          baselineShiftEm: 0, inkShiftXEm: 0, fitted: true,
        };
      }
      slot.fontTid = tid2;
    }
    return { pp2, edition2, slots, dropped };
  }

  function resolvePolicy(settings, opts, profilePage) {
    const o = opts || {};
    if (o.layoutPolicy === 'adaptive') return { policy: 'adaptive', fallback: 'none', reason: 'forced-adaptive' };
    // Translations (design §2.5): en/ru store text is laid out by the band solver, even with a profile.
    if (settings && settings.textLang && settings.textLang !== 'he') {
      // A translated layer/2 page (spec §10.6) is drawn as strict sheets; any other translation stays adaptive.
      if (profilePage && profilePage.layoutSheets && settings.licenseMode !== 'pd') {
        return { policy: 'strict-vilna', fallback: 'best-effort', reason: 'translation-layout' };
      }
      return { policy: 'adaptive', fallback: 'best-effort', reason: 'translation' };
    }
    const def = isDefaultSettings(settings);
    const okProfile = !!profilePage && profilePage.schema === PROFILE_SCHEMA && !!profilePage.page && Array.isArray(profilePage.regions);
    if (!def && !okProfile) return { policy: 'adaptive', fallback: 'none', reason: 'non-default-settings' };
    if (!profilePage) return { policy: 'adaptive', fallback: 'best-effort', reason: 'no-profile' };
    if (!okProfile) return { policy: 'adaptive', fallback: 'best-effort', reason: 'profile-schema-mismatch' };
    const fb = profilePage.certifiable === false ? 'best-effort' : 'certified';
    if (def) return { policy: 'strict-vilna', fallback: fb, reason: fb === 'certified' ? 'profile-certified' : 'profile-uncertified' };
    const plan = anchorPlan(settings, profilePage);
    if (plan.noop) return { policy: 'strict-vilna', fallback: fb, reason: 'no-effective-change' };
    return { policy: 'anchored', fallback: fb, reason: 'anchored', plan };
  }

  /** Tractate key: app name with spaces → underscores (Bava Kamma → Bava_Kamma). */
  function tractateKey(t) { return String(t || '').trim().replace(/\s+/g, '_'); }

  /** App tractate name from either form (Bava_Kamma → Bava Kamma). */
  function appTractateName(t) {
    const s = String(t || '');
    if (SEFARIA_MAP[s]) return s;
    const spaced = s.replace(/_/g, ' ');
    return SEFARIA_MAP[spaced] ? spaced : s;
  }

  async function fetchJSONQuiet(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  const _profileIndex = {};
  const _editionProfile = {};
  function profileIndex(base) {
    if (!(base in _profileIndex)) _profileIndex[base] = fetchJSONQuiet(`${base}/index.json`);
    return _profileIndex[base];
  }
  async function resolveProfileId(base, id) {
    if (id) return id;
    const idx = await profileIndex(base);
    return idx && idx.schema === 'vilna-profile-index/1' && idx.default ? idx.default : null;
  }
  function editionProfile(base, id) {
    const k = `${base}|${id}`;
    if (!(k in _editionProfile)) {
      _editionProfile[k] = (async () => {
        const idx = await profileIndex(base);
        const rel = (idx && idx.profiles && idx.profiles[id] && idx.profiles[id].path) || `${id}/profile.json`;
        return fetchJSONQuiet(`${base}/${rel}`);
      })();
    }
    return _editionProfile[k];
  }
  function loadProfilePage(base, id, tractate, page, side) {
    if (!id) return Promise.resolve(null);
    return fetchJSONQuiet(`${base}/${id}/${tractateKey(tractate)}/${page}${side}.json`);
  }

  /** The immediately previous and next amud of `page`/`side`, keyed by "<daf><side>" (spec §8.1). */
  function amudNeighbours(page, side) {
    const m = {};
    for (const k of layoutNeighbourKeys(page, side)) m[k] = { page: parseInt(k, 10), side: k.slice(-1) };
    return m;
  }

  /** Keys ("28a" style) of the immediately previous and next amud (spec §8.1; as the builder). */
  function layoutNeighbourKeys(daf, side) {
    const out = [];
    if (side === 'a') { if (daf > 1) out.push(`${daf - 1}b`); out.push(`${daf}b`); }
    else { out.push(`${daf}a`); out.push(`${daf + 1}a`); }
    return out;
  }

  // Layout index and edition profile are memoised per base, like the profile index.
  const _layoutIndex = {};
  const _layoutEdition = {};
  function layoutIndex(base) {
    if (!(base in _layoutIndex)) {
      _layoutIndex[base] = fetchJSONQuiet(`${base}/index.json`).then(idx =>
        (idx && idx.schema === LAYOUT_INDEX_SCHEMA && idx.default ? idx : null));
    }
    return _layoutIndex[base];
  }
  function layoutEdition(base, id) {
    const k = `${base}|${id}`;
    if (!(k in _layoutEdition)) _layoutEdition[k] = fetchJSONQuiet(`${base}/${id}/profile.json`);
    return _layoutEdition[k];
  }

  /** Returned by loadLayoutPage when a layout exists for the amud but cannot be used. */
  const LAYOUT_UNUSABLE = { layoutUnusable: true };
  /** A layout that exists but is rejected: the page falls back to adaptive with this diagnostic reason. */
  function layoutUnusable(reason) { return { layoutUnusable: true, reason: String(reason || 'unknown') }; }

  /**
   * Published layout (no local profiles): index → edition profile → page (+ sibling layer for a
   * translation) → neighbouring offline stores that the layer references → hydration.
   * Resolves {id, page, edition, gemaraSrc}; null when there is no layout for this amud (no index,
   * no page file, no sibling layer); LAYOUT_UNUSABLE when a layout exists but cannot be used.
   */
  async function loadLayoutPage(base, tractate, page, side, storeP, lang = 'he', licenseMode = 'all') {
    const idx = await layoutIndex(base);   // memoised; needed to locate the layout folder
    if (!idx) return null;
    const id = String(idx.default);
    const dir = `${base}/${id}/${tractateKey(tractate)}`;
    const daf = `${page}${side}`;
    // A translation needs its sibling layer: when it is missing, nothing else is fetched.
    let layer = null;
    // Translation layers never apply under ?license=pd (T7, spec §10.4): no request, adaptive as before.
    if (lang !== 'he' && licenseMode === 'pd') return null;
    if (lang !== 'he') {
      layer = await fetchJSONQuiet(`${dir}/${daf}.${lang}.json`);
      if (!layer) return null;
      if (layer.schema !== LAYOUT_LAYER_SCHEMA && layer.schema !== LAYOUT_LAYER2_SCHEMA) return layoutUnusable('schema');
    }
    const [lp, edition, store] = await Promise.all([
      fetchJSONQuiet(`${dir}/${daf}.json`),
      layoutEdition(base, id),
      Promise.resolve(storeP).then(s => s, () => null),
    ]);
    if (!lp) return null;
    if (!edition || typeof edition !== 'object') return LAYOUT_UNUSABLE;
    // Neighbour stores: only the amuds the layer references, fetched in parallel.
    const L = layer || (lp.layers && lp.layers[lang]) || {};
    const near = amudNeighbours(page, side);
    const suffixes = [];
    for (const name of Object.keys(L.streams || {})) {
      const at = name.indexOf('@');
      if (at < 0) continue;
      const suffix = name.slice(at + 1);
      if (Object.prototype.hasOwnProperty.call(near, suffix) && !suffixes.includes(suffix)) suffixes.push(suffix);
    }
    const loaded = await Promise.all(suffixes.map(s => loadTextStore(tractate, near[s].page, near[s].side)));
    const stores = {};
    suffixes.forEach((s, i) => { stores[s] = loaded[i]; });
    if (layer && layer.schema === LAYOUT_LAYER2_SCHEMA) {
      const got = hydrateLayer2(lp, store, lang, layer, { licenseMode, stores });
      if (got.layoutUnusable) return layoutUnusable(got.reason);
      const gemaraSrc = store && store.printSources && store.printSources.gemara;
      return { id, page: got.sheets[0], sheets: got.sheets, edition, gemaraSrc: gemaraSrc && gemaraSrc.show === true ? gemaraSrc : null,
        apparatusSources: store && store.apparatusSources && typeof store.apparatusSources === 'object' ? store.apparatusSources : null };
    }
    const hydrated = hydrateLayout(lp, store, lang, layer, { licenseMode, stores });
    if (!hydrated) return layoutUnusable('hydrate');
    hydrated.marginPlan = marginPlanOf(lp, null);
    const gemaraSrc = store && store.printSources && store.printSources.gemara;
    return { id, page: hydrated, edition, gemaraSrc: gemaraSrc && gemaraSrc.show === true ? gemaraSrc : null,
      apparatusSources: store && store.apparatusSources && typeof store.apparatusSources === 'object' ? store.apparatusSources : null };
  }

  /** Sources of a layout page: the Gemara text is the Wikisource print version (spec §2). */
  function applyLayoutGemaraSource(model, src) {
    if (!model || !src) return model;
    model.sources = Object.assign({}, model.sources || {}, {
      gemara: { lang: 'he', title: src.title || null, license: src.license || null, special: !!src.special,
        mt: false, derivedFrom: null, fallbackFrom: null },
    });
    return model;
  }

  function markLayoutSheets(container) {
    for (const s of container.querySelectorAll('.page-sheet')) s.dataset.profileSource = 'layout';
  }

  /** Labels of the streams a layout can name (spec §8.2); other blocks use SRC_BLOCK_HE / block id. */
  const LAYOUT_BLOCK_LABEL = { ran: 'רן / Ran', rashbam: 'רשב״ם / Rashbam', ktavYadRashi: 'כתב יד רש״י / Ktav Yad Rashi',
    mesoretHaShas: 'מסורת הש״ס / Masoret HaShas', einMishpat: 'עין משפט נר מצוה / Ein Mishpat', torahOr: 'תורה אור / Torah Or' };

  /**
   * Sources note of a layout page: one line per stream actually used (title and licence of its
   * source entry), plus the model-sourced blocks drawn by anchored flows. Appended after the sheets.
   */
  function appendLayoutSourcesNote(container, used, flowBlocks, model, apEntries) {
    const entries = [];
    const seen = new Set();
    const add = e => {
      const k = `${e.block}|${e.title}|${e.license}`;
      if (!seen.has(k)) { seen.add(k); entries.push(e); }
    };
    for (const u of used || []) if (u) add({ block: u.block, title: u.title, license: u.license, special: u.special });
    for (const a of apEntries || []) add(a);
    for (const b of flowBlocks || []) {
      const s = model && model.sources && model.sources[b];
      if (s) add({ block: b, title: s.title, license: s.license, special: s.special });
    }
    if (!entries.length) return null;
    const note = el('div', 'daf-sources');
    note.setAttribute('lang', 'he');
    note.dir = 'rtl';
    const head = el('div', 'daf-sources-h');
    head.textContent = 'מקורות הטקסט · Sources';
    note.appendChild(head);
    let anySpecial = false;
    for (const e of entries) {
      const label = LAYOUT_BLOCK_LABEL[e.block] || SRC_BLOCK_HE[e.block] || (EXTRA_COMMENTARIES.find(x => x.id === e.block) || {}).he || e.block;
      const line = el('div', 'daf-src-line');
      line.dataset.noteBlock = e.block;
      if (e.special) { anySpecial = true; line.dataset.special = '1'; }
      line.textContent = `${label} — ${e.title || e.block}${e.license ? ` · ${e.license}` : ''} · Sefaria.org${e.special ? ' †' : ''}`;
      note.appendChild(line);
    }
    if (anySpecial) {
      const key = el('div', 'daf-src-key');
      key.textContent = '† טקסט בעל רישיון מוגבל (CC-BY-NC / CC-BY-SA), שאינו נחלת הציבור.';
      note.appendChild(key);
    }
    container.appendChild(note);
    return note;
  }

  // Tractate catalogue (built in; the library needs no data files to run).
  const TRACTATES = [{"name_en":"Berachot","name_he":"ברכות","sefaria_name":"Berakhot","last_page":64,"ends_on_b":false,"first_page":2},{"name_en":"Shabbat","name_he":"שבת","sefaria_name":"Shabbat","last_page":157,"ends_on_b":true,"first_page":2},{"name_en":"Eiruvin","name_he":"עירובין","sefaria_name":"Eiruvin","last_page":105,"ends_on_b":false,"first_page":2},{"name_en":"Pesachim","name_he":"פסחים","sefaria_name":"Pesachim","last_page":121,"ends_on_b":true,"first_page":2},{"name_en":"Shekalim","name_he":"שקלים","sefaria_name":"Shekalim","last_page":22,"ends_on_b":true,"first_page":2},{"name_en":"Yoma","name_he":"יומא","sefaria_name":"Yoma","last_page":88,"ends_on_b":false,"first_page":2},{"name_en":"Sukkah","name_he":"סוכה","sefaria_name":"Sukkah","last_page":56,"ends_on_b":true,"first_page":2},{"name_en":"Beitzah","name_he":"ביצה","sefaria_name":"Beitzah","last_page":40,"ends_on_b":true,"first_page":2},{"name_en":"Rosh Hashanah","name_he":"ראש השנה","sefaria_name":"Rosh Hashanah","last_page":35,"ends_on_b":false,"first_page":2},{"name_en":"Taanit","name_he":"תענית","sefaria_name":"Taanit","last_page":31,"ends_on_b":false,"first_page":2},{"name_en":"Megillah","name_he":"מגילה","sefaria_name":"Megillah","last_page":32,"ends_on_b":false,"first_page":2},{"name_en":"Moed Katan","name_he":"מועד קטן","sefaria_name":"Moed Katan","last_page":29,"ends_on_b":false,"first_page":2},{"name_en":"Chagigah","name_he":"חגיגה","sefaria_name":"Chagigah","last_page":27,"ends_on_b":false,"first_page":2},{"name_en":"Yevamot","name_he":"יבמות","sefaria_name":"Yevamot","last_page":122,"ends_on_b":true,"first_page":2},{"name_en":"Ketubot","name_he":"כתובות","sefaria_name":"Ketubot","last_page":112,"ends_on_b":true,"first_page":2},{"name_en":"Nedarim","name_he":"נדרים","sefaria_name":"Nedarim","last_page":91,"ends_on_b":true,"first_page":2},{"name_en":"Nazir","name_he":"נזיר","sefaria_name":"Nazir","last_page":66,"ends_on_b":true,"first_page":2},{"name_en":"Sotah","name_he":"סוטה","sefaria_name":"Sotah","last_page":49,"ends_on_b":true,"first_page":2},{"name_en":"Gittin","name_he":"גיטין","sefaria_name":"Gittin","last_page":90,"ends_on_b":true,"first_page":2},{"name_en":"Kiddushin","name_he":"קידושין","sefaria_name":"Kiddushin","last_page":82,"ends_on_b":true,"first_page":2},{"name_en":"Bava Kamma","name_he":"בבא קמא","sefaria_name":"Bava Kamma","last_page":119,"ends_on_b":true,"first_page":2},{"name_en":"Bava Metzia","name_he":"בבא מציעא","sefaria_name":"Bava Metzia","last_page":119,"ends_on_b":false,"first_page":2},{"name_en":"Bava Batra","name_he":"בבא בתרא","sefaria_name":"Bava Batra","last_page":176,"ends_on_b":true,"first_page":2},{"name_en":"Sanhedrin","name_he":"סנהדרין","sefaria_name":"Sanhedrin","last_page":113,"ends_on_b":true,"first_page":2},{"name_en":"Makkot","name_he":"מכות","sefaria_name":"Makkot","last_page":24,"ends_on_b":true,"first_page":2},{"name_en":"Shevuot","name_he":"שבועות","sefaria_name":"Shevuot","last_page":49,"ends_on_b":true,"first_page":2},{"name_en":"Avodah Zarah","name_he":"עבודה זרה","sefaria_name":"Avodah Zarah","last_page":76,"ends_on_b":true,"first_page":2},{"name_en":"Horayot","name_he":"הוריות","sefaria_name":"Horayot","last_page":14,"ends_on_b":false,"first_page":2},{"name_en":"Zevachim","name_he":"זבחים","sefaria_name":"Zevachim","last_page":120,"ends_on_b":true,"first_page":2},{"name_en":"Menachot","name_he":"מנחות","sefaria_name":"Menachot","last_page":110,"ends_on_b":false,"first_page":2},{"name_en":"Chullin","name_he":"חולין","sefaria_name":"Chullin","last_page":142,"ends_on_b":false,"first_page":2},{"name_en":"Bechorot","name_he":"בכורות","sefaria_name":"Bechorot","last_page":61,"ends_on_b":false,"first_page":2},{"name_en":"Arachin","name_he":"ערכין","sefaria_name":"Arachin","last_page":34,"ends_on_b":false,"first_page":2},{"name_en":"Temurah","name_he":"תמורה","sefaria_name":"Temurah","last_page":34,"ends_on_b":false,"first_page":2},{"name_en":"Keritot","name_he":"כריתות","sefaria_name":"Keritot","last_page":28,"ends_on_b":true,"first_page":2},{"name_en":"Meilah","name_he":"מעילה","sefaria_name":"Meilah","last_page":22,"ends_on_b":false,"first_page":2},{"name_en":"Niddah","name_he":"נידה","sefaria_name":"Niddah","last_page":73,"ends_on_b":false,"first_page":2}];

  // Optional offline data pack: data/offline/<Tractate>/<daf><side>.json (schema vilna-offline/1)
  // holds every text in every language plus the page metadata (chapter, links). When the pack is
  // absent (404, network error, foreign schema) the loader resolves to null and the page is fetched
  // live from Sefaria. Base path is set with `new VilnaDaf({offlineBase})`; offlineBase:false disables it.
  let OFFLINE_BASE = 'data/offline';
  const OFFLINE_SCHEMAS = ['vilna-offline/1', 'vilna-text/1'];
  const _textStoreMemo = new Map();
  const TEXT_STORE_MEMO_MAX = 4;
  function loadTextStore(tractate, page, side) {
    const key = `${tractate}|${page}|${side}`;
    if (_textStoreMemo.has(key)) {
      const hit = _textStoreMemo.get(key);
      _textStoreMemo.delete(key);
      _textStoreMemo.set(key, hit);
      return hit;
    }
    const p = !OFFLINE_BASE ? Promise.resolve(null)
      : fetchJSONQuiet(`${OFFLINE_BASE}/${encodeURIComponent(tractate)}/${page}${side}.json`)
        .then(j => (j && OFFLINE_SCHEMAS.includes(j.schema) ? j : null), () => null);
    _textStoreMemo.set(key, p);
    while (_textStoreMemo.size > TEXT_STORE_MEMO_MAX) {
      _textStoreMemo.delete(_textStoreMemo.keys().next().value);
    }
    return p;
  }

  function withTimeout(p, ms, fallback) {
    let t;
    return Promise.race([
      Promise.resolve(p).catch(() => fallback),
      new Promise(r => { t = setTimeout(() => r(fallback), ms); }),
    ]).finally(() => clearTimeout(t));
  }

  // ═════════════════════════ Hebrew utilities ═════════════════════════

  function heb(num) {
    if (num <= 0) return '';
    if (num === 15) return 'ט״ו';
    if (num === 16) return 'ט״ז';
    const u = { 1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה', 6: 'ו', 7: 'ז', 8: 'ח', 9: 'ט' };
    const t = { 10: 'י', 20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס', 70: 'ע', 80: 'פ', 90: 'צ' };
    const h = { 100: 'ק', 200: 'ר', 300: 'ש', 400: 'ת' };
    let r = '', n = num;
    for (const grp of [h, t, u]) {
      for (const [v, l] of Object.entries(grp).sort((a, b) => +b[0] - +a[0])) {
        while (n >= +v) { r += l; n -= +v; }
      }
    }
    if (r.length === 1) r += '׳';
    else if (r.length > 1) r = r.slice(0, -1) + '״' + r.slice(-1);
    return r;
  }

  function hebLetter(idx) {
    const u = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const t = ['י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    const h = ['ק', 'ר', 'ש', 'ת'];
    let n = idx + 1, r = '';
    if (n >= 100) { r += h[Math.floor(n / 100) - 1]; n %= 100; }
    if (n === 15) return r + 'טו';
    if (n === 16) return r + 'טז';
    if (n >= 10) { r += t[Math.floor(n / 10) - 1]; n %= 10; }
    if (n > 0) r += u[n - 1];
    return r;
  }

  const ORDINALS = [
    'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי',
    'עשירי', 'אחד עשר', 'שנים עשר', 'שלשה עשר', 'ארבעה עשר', 'חמשה עשר',
    'ששה עשר', 'שבעה עשר', 'שמנה עשר', 'תשעה עשר', 'עשרים',
    'עשרים ואחד', 'עשרים ושנים', 'עשרים ושלשה', 'עשרים וארבעה',
  ];
  function perekOrdinal(n) { return ORDINALS[n - 1] || heb(n); }

  // ═════════════════════ Normalization (ONE place) ═════════════════════
  // Every Sefaria segment — gemara, rashi, tosafot, extras — passes through
  // here before any HTML assembly. RC6: strip te'amim+nikud and modern
  // punctuation; keep ׳ ״ ( ) : which the Vilna text uses.

  const DIACRITICS_RE = /[֑-ֽֿ-ׇׅ]/g;
  const PUNCT_RE = /[,.;?!…]/g;

  function stripText(s) {
    return s.replace(/ /g, ' ').replace(DIACRITICS_RE, '').replace(PUNCT_RE, '');
  }

  /** HTML-escape a data string (apparatus text comes from the offline store) for innerHTML or an attribute. */
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Strip only outside of tags so attribute values are untouched.
  function stripHtml(html) {
    return html.split(/(<[^>]*>)/)
      .map(p => (p.startsWith('<') ? p : stripText(p)))
      .join('');
  }

  const KEEP_TAGS = new Set(['B', 'I', 'EM', 'STRONG', 'BIG', 'SMALL', 'BR', 'SUP', 'SPAN']);

  function sanitizeHtml(raw) {
    if (!raw) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    for (const n of tpl.content.querySelectorAll('.footnote, .footnote-marker')) n.remove();
    const nodes = [];
    (function collect(node) {
      for (const c of node.children) collect(c);
      if (node !== tpl.content && node.nodeType === 1) nodes.push(node);
    })(tpl.content);
    for (const node of nodes) {
      if (KEEP_TAGS.has(node.tagName)) {
        while (node.attributes.length) node.removeAttribute(node.attributes[0].name);
      } else {
        const parent = node.parentNode;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
    }
    const div = document.createElement('div');
    div.appendChild(tpl.content.cloneNode(true));
    return div.innerHTML;
  }

  // Bold the dibbur hamatchil if the source didn't already.
  function boldDH(html) {
    if (!html) return '';
    if (/<b[\s>]|<strong[\s>]/i.test(html)) return html;
    const e = html.search(/[.׃–—-]/);
    if (e > 0) return `<b>${html.slice(0, e)}</b>${html.slice(e)}`;
    const w = html.split(/\s+/);
    const n = Math.min(4, w.length);
    return `<b>${w.slice(0, n).join(' ')}</b> ${w.slice(n).join(' ')}`;
  }

  // string | string[] | null → array of clean HTML strings
  function normSeg(seg) {
    if (!seg) return [];
    const arr = Array.isArray(seg) ? seg : [seg];
    return arr.filter(s => s && String(s).trim()).map(s => String(s));
  }

  // U+00A0 from &nbsp; always becomes a plain space, strip or no strip.
  function softClean(s) { return sanitizeHtml(s).replace(/ /g, ' '); }

  function cleanGemara(s) { return stripHtml(sanitizeHtml(s)); }
  function cleanComment(s) { return stripHtml(boldDH(sanitizeHtml(s))); }

  /**
   * Normalize a raw model (cached JSON or live fetch) into render-ready form.
   * The Vilna diacritics/punctuation strip applies only where the selected
   * sources call for it: vocalized and English editions keep their pointing
   * and punctuation; English commentaries are sanitized but not stripped.
   */
  function normalizeModel(model, settings) {
    const s = settings || model.settings || DEFAULT_SETTINGS;
    const ed = EDITIONS[s.edition] || EDITIONS.aramaic;
    // Hebrew strip rules run only on the Hebrew source itself. Every translation
    // (Cyrillic/Latin, and Yiddish in Hebrew script) keeps its punctuation and
    // diacritics — stripping would eat Yiddish rafe/patah combinations.
    const heSourceText = !s.textLang || s.textLang === 'he';
    const cleanG = ed.strip && heSourceText ? cleanGemara : softClean;
    const cleanC = (!heSourceText || isLtrLang(effectiveLang(s))) ? softClean : cleanComment;
    const gemara = (model.gemara || []).map(seg => normSeg(seg).map(cleanG).join(' '));
    const rashi = (model.rashi || []).map(seg => normSeg(seg).map(cleanC));
    const tosafot = (model.tosafot || []).map(seg => normSeg(seg).map(cleanC));
    const extras = {};
    for (const [key, ex] of Object.entries(model.extras || {})) {
      const parts = (ex.segments || []).flatMap(normSeg).map(cleanC);
      if (parts.length) extras[key] = { title: ex.title, html: parts.join(' ') };
    }
    return Object.assign({}, model, { gemara, rashi, tosafot, extras });
  }

  // ═════════════════════════ Data layer ═════════════════════════

  async function fetchJSON(url, timeoutMs = 12000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function pickHebrew(versions) {
    if (!versions) return null;
    for (const pref of ['Vilna', 'Wikisource', 'Davidson', 'William Davidson', '']) {
      for (const v of versions) {
        if (v.language === 'he' && (v.versionTitle || '').includes(pref)) return v;
      }
    }
    return versions.find(v => v.language === 'he') || null;
  }

  function heSegments(data) {
    if (!data) return [];
    const v = pickHebrew(data.versions || []);
    return (v && v.text) || [];
  }

  /** Segments in the preferred language, falling back to the other. */
  function segmentsByLang(data, lang) {
    if (!data || !data.versions || !data.versions.length) return [];
    const v = data.versions.find(x => x.language === lang)
      || (lang === 'he' ? pickHebrew(data.versions) : null)
      || data.versions[0];
    return (v && v.text) || [];
  }

  async function getText(ref, version) {
    const q = version ? `?version=${encodeURIComponent(version)}` : '';
    try { return await fetchJSON(`${SEFARIA_TEXTS}/${encodeURIComponent(ref)}${q}`); }
    catch (e) { return null; }
  }

  // Chapter (perek) from the index alt-structure — no per-daf hacks.
  const DAF_RE = /(\d+)([ab])(?::(\d+))?/g;
  function dafOrd(page, side) { return page * 2 + (side === 'a' ? 0 : 1); }

  function parseWholeRef(wholeRef) {
    const m = [...(wholeRef || '').matchAll(DAF_RE)];
    if (!m.length) return null;
    const s = m[0], e = m[m.length - 1];
    return {
      startOrd: dafOrd(+s[1], s[2]), startSeg: +(s[3] || 1),
      endOrd: dafOrd(+e[1], e[2]),
    };
  }

  const _indexCache = {};
  async function indexMeta(sefName) {
    if (!_indexCache[sefName]) {
      _indexCache[sefName] = (async () => {
        const idx = await fetchJSON(`${SEFARIA_INDEX}/${encodeURIComponent(sefName)}`).catch(() => null);
        const chapters = [];
        const nodes = ((idx && idx.alts && idx.alts.Chapters) || {}).nodes || [];
        nodes.forEach((n, i) => {
          const span = parseWholeRef(n.wholeRef);
          if (span) chapters.push({ heTitle: n.heTitle || '', num: i + 1, span });
        });
        return { heTitle: (idx && idx.heTitle) || '', chapters };
      })();
    }
    return _indexCache[sefName];
  }

  function chapterFor(meta, page, side) {
    const o = dafOrd(page, side);
    for (const ch of meta.chapters) {
      if (ch.span.startOrd <= o && o <= ch.span.endOrd) {
        return {
          name: ch.heTitle, num: ch.num,
          startsHere: o === ch.span.startOrd,
          startSeg: o === ch.span.startOrd ? ch.span.startSeg : null,
        };
      }
    }
    return { name: '', num: 0, startsHere: false, startSeg: null };
  }

  const EXTRAS_DEFS = [
    ['hagahotHaBach', 'Hagahot HaBach on', 'הגהות הב״ח'],
    ['gilyonHaShas', 'Gilyon HaShas on', 'גליון הש״ס'],
    ['ravNissimGaon', 'Rav Nissim Gaon on', 'רב נסים גאון'],
    ['rabbeinuChananel', 'Rabbeinu Chananel on', 'רבינו חננאל'],
  ];

  /** Live fallback — same model shape as scripts/fetch_daf.py writes. */
  async function fetchDafLive(tractate, page, side) {
    const sefName = SEFARIA_MAP[tractate] || tractate;
    const ref = `${sefName}.${page}${side}`;

    const [gemDataV, rashiData, tosData, linksData, meta, ...extrasData] = await Promise.all([
      getText(ref, GEMARA_VERSION),
      getText(`Rashi on ${ref}`),
      getText(`Tosafot on ${ref}`),
      fetchJSON(`${SEFARIA_LINKS}/${encodeURIComponent(ref)}`).catch(() => []),
      indexMeta(sefName),
      ...EXTRAS_DEFS.map(([, prefix]) => getText(`${prefix} ${ref}`)),
    ]);
    const gemData = heSegments(gemDataV).length ? gemDataV : await getText(ref);

    // Sefaria returns each apparatus reference once per anchor segment (and
    // per direction), so the same source can appear several times — e.g. the
    // 4 Torah Or verses on Rosh Hashanah 2b arrive as 8 links. Keep only the
    // first occurrence of each source ref so the margin matches the printed
    // Vilna apparatus.
    const mesoret = [], einMishpat = [], torahOr = [];
    const seenM = new Set(), seenE = new Set(), seenT = new Set();
    const pushUniq = (arr, seen, lk) => {
      const key = lk.sourceRef || lk.sourceHeRef || JSON.stringify(lk);
      if (seen.has(key)) return;
      seen.add(key); arr.push(lk);
    };
    for (const lk of (Array.isArray(linksData) ? linksData : [])) {
      const cat = (lk.category || '').toLowerCase();
      const typ = (lk.type || '').toLowerCase();
      if (cat === 'talmud' || typ.includes('mesoret') || typ.includes('masoret')) pushUniq(mesoret, seenM, lk);
      else if (cat === 'halakhah' || typ.includes('mishpat') || typ.includes('ner')) pushUniq(einMishpat, seenE, lk);
      else if (cat === 'tanakh' || typ.includes('torah or')) pushUniq(torahOr, seenT, lk);
    }

    const extras = {};
    EXTRAS_DEFS.forEach(([key, , title], i) => {
      const segs = heSegments(extrasData[i]);
      if (segs.length) extras[key] = { title, segments: segs };
    });

    return {
      ref: `${tractate} ${page}${side}`,
      tractate, tractateHe: meta.heTitle, sefaria_name: sefName, page, side,
      chapter: chapterFor(meta, page, side),
      gemara: heSegments(gemData),
      rashi: heSegments(rashiData),
      tosafot: heSegments(tosData),
      links: { mesoretHaShas: mesoret, einMishpat, torahOr },
      extras,
    };
  }

  /** Does a raw model carry any renderable text (Gemara / commentary / extras)? */
  function modelHasContent(m) {
    if (!m) return false;
    const any = arr => (arr || []).some(x =>
      Array.isArray(x) ? x.some(y => y && String(y).trim()) : (x && String(x).trim()));
    return any(m.gemara) || any(m.rashi) || any(m.tosafot)
      || (m.extras && Object.keys(m.extras).length > 0);
  }

  /**
   * `storeP` is the page's text-store promise. load() passes the one it started so the memo is not
   * touched twice; callers that do not pass it get the memoised store; null means no store.
   */
  /** Raw model (same shape as fetchDafLive) rebuilt from an offline pack page, or null. */
  function modelFromOffline(store) {
    if (!store || !store.page || !store.langs || !store.langs.he) return null;
    const he = store.langs.he, pg = store.page, extras = {};
    for (const [k, title] of Object.entries(pg.extraTitles || {})) {
      if (he[k]) extras[k] = { title, segments: he[k] };
    }
    return {
      ref: pg.ref, tractate: pg.tractate, tractateHe: pg.tractateHe, sefaria_name: pg.sefaria_name,
      page: pg.page, side: pg.side, chapter: pg.chapter,
      gemara: he.gemara || [], rashi: he.rashi || [], tosafot: he.tosafot || [],
      links: pg.links || {}, extras,
    };
  }

  async function loadModel(tractate, page, side, settings, storeP = loadTextStore(tractate, page, side)) {
    const store = await storeP;
    let base = modelFromOffline(store);
    if (!base) {
      base = await fetchDafLive(tractate, page, side);
      if (!base.tractateHe) {
        // Header is Hebrew-only — never fall back to the English name.
        const ti = TRACTATES.find(x => x.name_en === tractate);
        if (ti) base.tractateHe = ti.name_he;
      }
    }
    const s = settings || DEFAULT_SETTINGS;
    const model = await applySettings(base, s);
    return applyTextStore(model, store, s);
  }

  /**
   * Reconstruct the model around the user's source selection. The cached
   * model covers the defaults; anything else is fetched live, in parallel.
   * A selected text that does not exist for this daf yields an empty stream
   * (probe-and-render: omit, never fabricate).
   */
  async function applySettings(base, s) {
    const model = Object.assign({}, base);
    Object.defineProperty(model, '_base', { value: base, enumerable: false });
    const sefName = base.sefaria_name || SEFARIA_MAP[base.tractate] || base.tractate;
    const daf = `${base.page}${base.side}`;
    const jobs = [];

    model.settings = s;
    const ed = EDITIONS[s.edition] || EDITIONS.aramaic;
    if (s.edition !== DEFAULT_SETTINGS.edition) {
      jobs.push((async () => {
        const d = await getText(`${sefName}.${daf}`, ed.version);
        let segs = (d && d.versions && d.versions[0] && d.versions[0].text) || [];
        if (!segs.length) segs = segmentsByLang(await getText(`${sefName}.${daf}`), s.edition === 'english' ? 'en' : 'he');
        model.gemara = segs;
      })());
    }

    const fetchWrap = async id => {
      const def = WRAP_BY_ID[id];
      if (!def) return [];
      return segmentsByLang(await getText(`${def.ref(sefName)}.${daf}`), s.lang);
    };
    // The internal stream names stay rashi/tosafot (= inner/outer columns);
    // the selected texts are poured into them.
    if (s.inner !== DEFAULT_SETTINGS.inner || s.lang !== 'he') {
      jobs.push(fetchWrap(s.inner).then(t => { model.rashi = t; }));
    }
    if (s.outer !== DEFAULT_SETTINGS.outer || s.lang !== 'he') {
      jobs.push(fetchWrap(s.outer).then(t => { model.tosafot = t; }));
    }

    const extras = {};
    for (const id of s.extras || []) {
      const def = EXTRA_BY_ID[id];
      if (!def) continue;
      const cached = s.lang === 'he' && base.extras && base.extras[id];
      if (cached) { extras[id] = { title: def.he, segments: cached.segments }; continue; }
      jobs.push((async () => {
        const segs = segmentsByLang(await getText(`${def.ref(sefName)}.${daf}`), s.lang);
        if (segs.length) extras[id] = { title: def.he, segments: segs };
      })());
    }

    await Promise.all(jobs);
    model.extras = extras;
    return model;
  }

  /** Store segments → model segments: each segment becomes a flat list of non-empty strings. */
  function flatSegs(segs) {
    return segs.map(x => leafStrings(x, []).filter(t => t && t.trim()));
  }

  /**
   * Store text on top of the model. Records every store
   * block that renders in model.sources and every block that does not in model.hiddenBlocks
   * ({block, reason: 'licence' | 'missing'}). For textLang !== 'he' it also replaces
   * gemara/rashi/tosafot and the selected extras with the resolved text (a block that does not
   * resolve becomes empty, never Hebrew). Mutates and returns `model`. A null store changes nothing.
   * Reads sources.*.show/special only through resolveBlock (plus copying `special` into the record).
   */
  function applyTextStore(model, store, settings) {
    const s = settings || model.settings || DEFAULT_SETTINGS;
    const lang = s.textLang || 'he';
    const sources = {};
    const hiddenBlocks = [];
    const blocks = store && store.sources && typeof store.sources === 'object' ? Object.keys(store.sources) : [];
    for (const block of blocks) {
      const r = resolveBlock(store, block, lang, s);
      if (r) {
        sources[block] = {
          lang: r.lang,
          title: r.src.title || null,
          license: r.src.license || null,
          special: !!r.src.special,
          mt: !!(TEXT_LANGS.find(l => l.id === r.lang) || {}).mt || !!r.src.mt,
          derivedFrom: Array.isArray(r.src.derivedFrom) ? r.src.derivedFrom.slice() : null,
          fallbackFrom: r.fallbackFrom,
        };
      } else {
        const anyLicence = resolveBlock(store, block, lang, { licenseMode: 'all' });
        hiddenBlocks.push({ block, reason: anyLicence ? 'licence' : 'missing' });
      }
    }
    model.sources = sources;
    model.hiddenBlocks = hiddenBlocks;
    // Apparatus text (spec §9.1) and its licence entries; read by buildKeyIndex / the sources note.
    model.apparatus = store && store.apparatus && typeof store.apparatus === 'object' ? store.apparatus : null;
    model.apparatusSources = store && store.apparatusSources && typeof store.apparatusSources === 'object' ? store.apparatusSources : null;
    if (lang === 'he' || !store) return model;

    const seg = block => { const r = resolveBlock(store, block, lang, s); return r ? r.segs : []; };
    model.gemara = seg('gemara').map(x => leafStrings(x, []).join(' '));
    // Wrap columns: only the default commentary carries store text (rashi = inner, tosafot = outer).
    if (s.inner === DEFAULT_SETTINGS.inner) model.rashi = flatSegs(seg('rashi'));
    if (s.outer === DEFAULT_SETTINGS.outer) model.tosafot = flatSegs(seg('tosafot'));
    const extras = {};
    for (const [key, ex] of Object.entries(model.extras || {})) {
      extras[key] = { title: ex.title, segments: flatSegs(seg(key)) };
    }
    model.extras = extras;
    return model;
  }

  // ═════════════════════════ SOLVER (pure, no DOM) ═════════════════════════
  //
  // Coordinates: x measured from the core's PHYSICAL RIGHT edge, y from the
  // core's top. Roles: 'inner' commentary = Rashi, 'outer' = Tosafot.
  // On amud a the inner side is the physical right; on amud b it mirrors.
  //
  // Band law (§2.1):
  //   Gemara alive:   each alive commentary gets C0·W; Gemara absorbs the rest
  //   Gemara dead:    alive commentaries split evenly (→ 50/50 top band)
  //   one alive:      full width

  function solve(ends, ctx) {
    const W = ctx.W;
    const cw = Math.round((ctx.C0 || LAYOUT.C0) * W);
    const g = ctx.gutter;
    // slackK > 1 is the collision-retry setting (see layoutPage safety pass).
    const k = ctx.slackK || 1;
    const slack = {
      rashi: 0.9 * k * ctx.lhComm, tosafot: 0.9 * k * ctx.lhComm, gemara: 0.9 * k * ctx.lhGem,
    };
    // Stream X stops absorbing into Y's region a little after Y's measured
    // end, so a final line that protrudes < 1 line can never collide.
    const dieAt = {
      rashi: ctx.has.rashi ? ends.rashi + slack.rashi : 0,
      tosafot: ctx.has.tosafot ? ends.tosafot + slack.tosafot : 0,
      gemara: ctx.has.gemara ? Math.max(ends.gemara, ctx.yTop) + slack.gemara : 0,
    };

    const cuts = new Set([0, ctx.yTop, dieAt.rashi, dieAt.tosafot, dieAt.gemara]);
    if (ctx.box) cuts.add(ctx.yTop + ctx.box.h);
    const maxY = Math.max(...cuts) + 10;
    cuts.add(maxY);
    const ys = [...cuts].filter(y => y >= 0).sort((a, b) => a - b);

    const streams = {
      rashi: { start: 0, end: dieAt.rashi, bands: [] },
      tosafot: { start: 0, end: dieAt.tosafot, bands: [] },
      gemara: { start: ctx.yTop, end: dieAt.gemara, bands: [] },
    };

    for (let i = 0; i < ys.length - 1; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      if (y1 - y0 < 0.5) continue;
      const mid = (y0 + y1) / 2;
      const aR = mid < dieAt.rashi;
      const aT = mid < dieAt.tosafot;
      const aG = ctx.has.gemara && mid >= ctx.yTop && mid < dieAt.gemara;

      // regions in inner-origin coords: [a, b], 0 = inner edge
      const reg = {};
      if (aG) {
        if (aR) reg.rashi = [0, cw];
        if (aT) reg.tosafot = [W - cw, W];
        let ga = aR ? cw + g : 0;
        let gb = aT ? W - cw - g : W;
        // First-word box footprint: always at the reading start of the line,
        // i.e. the PHYSICAL right edge of the Gemara — which in inner-origin
        // coords is `ga` on amud a but `gb` on the mirrored amud b.
        if (ctx.box && mid < ctx.yTop + ctx.box.h) {
          if (ctx.mirror !== !!ctx.ltr) gb -= ctx.box.w + ctx.boxGutter;
          else ga += ctx.box.w + ctx.boxGutter;
        }
        reg.gemara = [Math.min(ga, gb - 10), gb];
      } else if (aR && aT) {
        reg.rashi = [0, W / 2 - g / 2];
        reg.tosafot = [W / 2 + g / 2, W];
      } else if (aR) {
        reg.rashi = [0, W];
      } else if (aT) {
        reg.tosafot = [0, W];
      }

      for (const [name, r] of Object.entries(reg)) {
        const bands = streams[name].bands;
        const prev = bands[bands.length - 1];
        if (prev && prev.y1 === y0 && prev.a === r[0] && prev.b === r[1]) prev.y1 = y1;
        else bands.push({ y0, y1, a: r[0], b: r[1] });
      }
    }

    // Mirror for amud b: inner side is physical left there.
    if (ctx.mirror) {
      for (const s of Object.values(streams)) {
        for (const b of s.bands) {
          const na = W - b.b, nb = W - b.a;
          b.a = na; b.b = nb;
        }
      }
    }
    return streams;
  }

  // ═════════════════ RENDERER: two polygon carves per stream ═════════════════

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /**
   * Emit the two carve floats for one stream container.
   * bands are absolute core coords (physical, x from RIGHT edge); the
   * container spans [start, end) vertically and the full core width.
   */
  function emitStream(container, plan, W) {
    const { start, end, bands } = plan;
    container.style.top = `${Math.round(start)}px`;
    container.style.height = `${Math.max(0, Math.round(end - start))}px`;
    container.style.display = bands.length ? '' : 'none';
    const H = Math.max(1, Math.round(end - start));

    const maxR = Math.max(0, ...bands.map(b => b.a));
    const maxL = Math.max(0, ...bands.map(b => W - b.b));

    const carveR = container.querySelector('.carve-r');
    const carveL = container.querySelector('.carve-l');

    // Right carve blocks the rightmost a(y) px; in its own box (width maxR,
    // anchored at the core's right edge) the blocked region is x ≥ maxR−a.
    if (maxR >= 1) {
      const pts = [`${maxR}px 0px`];
      for (const b of bands) {
        const x = Math.round(maxR - b.a);
        pts.push(`${x}px ${Math.round(b.y0 - start)}px`, `${x}px ${Math.round(b.y1 - start)}px`);
      }
      pts.push(`${maxR}px ${H}px`);
      carveR.style.cssText =
        `float:right;width:${Math.round(maxR)}px;height:100%;shape-outside:polygon(${pts.join(',')});`;
      carveR.style.display = '';
    } else carveR.style.display = 'none';

    if (maxL >= 1) {
      const pts = [`0px 0px`];
      for (const b of bands) {
        const x = Math.round(Math.min(W - b.b, maxL));
        pts.push(`${x}px ${Math.round(b.y0 - start)}px`, `${x}px ${Math.round(b.y1 - start)}px`);
      }
      pts.push(`0px ${H}px`);
      carveL.style.cssText =
        `float:left;width:${Math.round(maxL)}px;height:100%;shape-outside:polygon(${pts.join(',')});`;
      carveL.style.display = '';
    } else carveL.style.display = 'none';
  }

  /** True text end of a stream: Range around the last text node (§2.3). */
  function measureTextEnd(container, coreTop) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      // The first-word box is positioned at the top — never the text end.
      acceptNode: n => (n.textContent.trim() && !(n.parentElement && n.parentElement.closest('.first-word'))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let last = null, node;
    while ((node = walker.nextNode())) last = node;
    if (!last) return 0;
    const range = document.createRange();
    range.selectNodeContents(last);
    let bottom = 0;
    for (const r of range.getClientRects()) bottom = Math.max(bottom, r.bottom);
    if (!bottom) bottom = range.getBoundingClientRect().bottom;
    return Math.max(0, bottom - coreTop);
  }

  // ═════════════════════════ HTML assembly ═════════════════════════

  /** Apparatus blocks with a store text (spec §9.1), in margin order. */
  const APP_BLOCKS = ['mesoretHaShas', 'einMishpat', 'torahOr'];
  const APP_TITLE_HE = { mesoretHaShas: 'מסורת הש״ס', einMishpat: 'עין משפט נר מצוה', torahOr: 'תורה אור' };
  /** Language of the apparatus text: the page's textLang when it is a translation, else Hebrew. */
  function apparatusLang(model) {
    const t = model && model.settings && model.settings.textLang;
    return t && t !== 'he' ? t : 'he';
  }
  /** store.apparatus[lang][block] items, falling back to he; null when neither has them. */
  function apparatusItems(model, block, lang) {
    const ap = model && model.apparatus;
    if (!ap) return null;
    for (const l of [lang, 'he']) {
      const arr = ap[l] && ap[l][block];
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return null;
  }
  /** Licence lines of the apparatus blocks (spec §9.3: Torah Or verse entry and its refs entry). */
  function apparatusEntriesFor(apSources, blocks, lang) {
    const out = [];
    if (!apSources) return out;
    for (const b of blocks) {
      const per = apSources[b];
      const e = per && (per[lang] || per.he);
      if (!e) continue;
      out.push({ block: b, title: e.title, license: e.license, special: !!e.special });
      if (e.refs) out.push({ block: b, title: e.refs.title, license: e.refs.license, special: !!e.refs.special });
    }
    return out;
  }
  /**
   * Licence mode 'pd' (spec §9.7): an apparatus block whose source is special (Sefaria link data,
   * citations, and any translation derived from them) is not shown. A block with no declared source
   * entry is link-derived text, i.e. citations, and is hidden too.
   */
  function apparatusHiddenInPd(model, block, lang) {
    if (!model || !model.settings || model.settings.licenseMode !== 'pd') return false;
    const per = model.apparatusSources && model.apparatusSources[block];
    const e = per && (per[lang] || per.he);
    if (!e) return true;
    return !!(e.special || e.pd === false || (e.refs && (e.refs.special || e.refs.pd === false)));
  }
  /** Apparatus blocks that a layout page prints as flow slots. */
  function flowBlocksOf(pp) {
    return ((pp && pp.regions) || []).filter(r => r && r.flow).map(r => apparatusKeyOf(r.flow));
  }
  /** Region id → apparatus key (spec §9.1 names the block mesoretHaShas; the region is masoretHaShas). */
  function apparatusKeyOf(id) {
    return id === 'masoretHaShas' ? 'mesoretHaShas' : String(id);
  }
  /** Flow-slot blocks of a layout page that have entries (an empty block is not shown). */
  function renderedFlowBlocks(pp, model) {
    const k = buildKeyIndex(model);
    return flowBlocksOf(pp).filter(b => k[b] && k[b].entries.length);
  }
  /** Adaptive pages: licence lines of the apparatus blocks that are printed on the page. */
  function adaptiveApparatusEntries(model) {
    if (!model || !model.apparatusSources) return [];
    const keyIdx = buildKeyIndex(model);
    const blocks = APP_BLOCKS.filter(b => keyIdx[b] && keyIdx[b].entries.length);
    return apparatusEntriesFor(model.apparatusSources, blocks, apparatusLang(model));
  }

  function buildKeyIndex(model) {
    const links = model.links || {};
    const defs = [
      { key: 'einMishpat', cls: 'key-em', title: 'עין משפט נר מצוה' },
      { key: 'mesoretHaShas', cls: 'key-ms', title: 'מסורת הש״ס' },
      { key: 'torahOr', cls: 'key-to', title: 'תורה אור' },
    ];
    const idx = {};
    // LTR translation pages cite the source in Latin (sourceRef); Hebrew and
    // Yiddish pages (both RTL) keep sourceHeRef.
    const latinRefs = !!(model.settings && isLtrLang(model.settings.textLang));
    const apLang = apparatusLang(model);
    for (const d of defs) {
      idx[d.key] = { cls: d.cls, title: d.title, entries: [] };
      // Licence mode 'pd': a block from a special source (citations) has no entries (spec §9.10).
      if (apparatusHiddenInPd(model, d.key, apLang)) continue;
      const items = apparatusItems(model, d.key, apLang);
      const itemByI = new Map();
      for (const x of items || []) if (x && !itemByI.has(x.i)) itemByI.set(x.i, x);
      (links[d.key] || []).forEach((lk, i) => {
        const m = (lk.anchorRef || '').match(/:(\d+)/);
        // Margin shows only the ONE quoted pasuk (first verse if the ref is a
        // range); the full chapter context lives in the hover popup.
        const heArr = Array.isArray(lk.he) ? lk.he.flat(3).filter(Boolean) : (lk.he ? [lk.he] : []);
        const oneVerse = heArr.length ? String(heArr[0]) : '';
        // Apparatus text (spec §9.2): entry i of store.apparatus[lang][block] (fallback he), else the link text.
        const it = itemByI.get(i) || null;
        idx[d.key].entries.push({
          id: `note-${d.key}-${i}`,
          segNum: m ? parseInt(m[1]) : 0,
          letter: hebLetter(i),
          ref: it && it.ref ? stripText(String(it.ref)) : stripText(latinRefs ? (lk.sourceRef || lk.sourceHeRef || '') : (lk.sourceHeRef || lk.sourceRef || '')),
          short: it && it.short ? stripText(String(it.short)) : '',
          verse: it ? (it.verse ? String(it.verse) : '') : (oneVerse ? cleanGemara(oneVerse) : ''),
          cls: d.cls,
        });
      });
    }
    return idx;
  }

  /**
   * Gemara stream HTML. Letter-keys stay inline (<sup>, no added spaces).
   * If the chapter starts at the top of this page, the first word is pulled
   * out of the flow — it is rendered as an absolutely-positioned box whose
   * footprint is part of the Gemara polygon (ctx.box), not an extra float.
   */
  function buildGemaraHTML(model, keyIdx) {
    const segKeys = {};
    for (const at of Object.values(keyIdx)) {
      for (const e of at.entries) (segKeys[e.segNum] = segKeys[e.segNum] || []).push(e);
    }
    const segs = model.gemara || [];
    let boxWord = null;
    let html = '';
    for (let i = 0; i < segs.length; i++) {
      let segHtml = segs[i];
      const sn = i + 1;
      const keys = (segKeys[sn] || [])
        .map(e => `<sup class="ref-key ${e.cls}" data-target="${e.id}" data-seg="${sn}">${e.letter}</sup>`)
        .join('');
      if (i === 0 && model.chapter && model.chapter.startsHere && model.chapter.startSeg === 1) {
        const ext = extractFirstWord(segHtml);
        if (ext) { boxWord = ext.word; segHtml = ext.rest; }
      }
      html += `${keys}<span class="gseg" data-seg="${sn}">${segHtml}</span> `;
    }
    return { html, boxWord };
  }

  /** Remove the first word from a segment's HTML, returning {word, rest}. */
  function extractFirstWord(segHtml) {
    const tpl = document.createElement('template');
    tpl.innerHTML = segHtml;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.textContent;
      const m = txt.match(/^\s*(\S+)/);
      if (!m) continue;
      const word = m[1];
      node.textContent = txt.slice(m.index + m[0].length);
      const div = document.createElement('div');
      div.appendChild(tpl.content.cloneNode(true));
      return { word, rest: div.innerHTML };
    }
    return null;
  }

  /** First plain (stripped) word of a raw model's Gemara — the catchword. */
  function firstGemaraWord(rawModel) {
    for (const seg of (rawModel && rawModel.gemara) || []) {
      const html = Array.isArray(seg) ? seg.join(' ') : String(seg || '');
      if (!html.trim()) continue;
      const ext = extractFirstWord(html);
      const w = ext && stripText(ext.word).trim();
      if (w) return w;
    }
    return '';
  }

  /**
   * Catchword (custos) source: the first word of the next amud in the
   * selected edition. Cached JSON first, else ONE Sefaria request. Started
   * in parallel with the page load and awaited (with a time budget) BEFORE
   * the final layout, so it never mutates the page after ready.
   */
  const _catchCache = {};
  function fetchCatchword(tractate, page, side, settings) {
    const s = settings || DEFAULT_SETTINGS;
    const nextSide = side === 'a' ? 'b' : 'a';
    const nextPage = side === 'a' ? page : page + 1;
    const key = `${tractate}|${nextPage}${nextSide}|${s.edition}`;
    if (!_catchCache[key]) {
      _catchCache[key] = (async () => {
        let segs = null;
        if ((s.edition || DEFAULT_SETTINGS.edition) === DEFAULT_SETTINGS.edition) {
          const next = await loadTextStore(tractate, nextPage, nextSide);
          const g = next && next.langs && next.langs.he && next.langs.he.gemara;
          if (Array.isArray(g)) segs = g;
        }
        if (!segs) {
          const sefName = SEFARIA_MAP[tractate] || tractate;
          const ed = EDITIONS[s.edition] || EDITIONS.aramaic;
          const d = await getText(`${sefName}.${nextPage}${nextSide}`, ed.version);
          segs = (d && d.versions && d.versions[0] && d.versions[0].text) || [];
        }
        return firstGemaraWord({ gemara: segs });
      })().catch(() => '');
    }
    return _catchCache[key];
  }

  /** Model used when strict mode renders without any Sefaria data. */
  async function stubModel(tractate, page, side, settings) {
    const ti = TRACTATES.find(x => x.name_en === tractate);
    const tractateHe = ti ? ti.name_he : '';
    return {
      ref: `${tractate} ${page}${side}`, tractate, tractateHe,
      sefaria_name: SEFARIA_MAP[tractate] || tractate, page, side,
      chapter: { name: '', num: 0, startsHere: false, startSeg: null },
      gemara: [], rashi: [], tosafot: [], links: {}, extras: {},
      settings: settings || DEFAULT_SETTINGS, sefaria: false,
    };
  }

  // Commentary: one continuous justified paragraph; comments separated by
  // their own trailing colons (Vilna style), each an inline span for hover.
  function buildCommHTML(layer, model) {
    const segs = model[layer] || [];
    let h = '';
    segs.forEach((comments, i) => {
      for (const c of comments) {
        h += `<span class="comment" data-layer="${layer}" data-seg="${i + 1}" tabindex="0">${c}</span> `;
      }
    });
    return h;
  }

  // Margins show only the short Hebrew ref citation (as in the printed
  // Vilna daf); the full source text lives in the hover popup. תורה אור is
  // the exception — its pasuk text is shown inline (showVerse), matching the
  // traditional layout.
  function marginNotesHTML(entries, showVerse = false) {
    return entries.map(e => {
      // Compact citation in the margin (`short`); the full citation is the hover text (title).
      // Every string here comes from the offline store, so it is escaped (spec §9.11).
      const tip = e.short && e.short !== e.ref ? ` title="${escHtml(e.ref)}"` : '';
      return `<span class="marg-note" id="${escHtml(e.id)}" data-seg="${escHtml(e.segNum)}"><span class="key">${escHtml(e.letter)}</span> ` +
        (showVerse && e.verse ? `<span class="verse-text">${escHtml(e.verse)}</span> ` : '') +
        `<span class="note-ref"${tip}>${escHtml(e.short || e.ref)}</span></span>`;
    }).join('');
  }

  // ── Attribution (design §5, D8) ──
  // Store block of a region id (vregion ids 'inner'/'outer' are the rashi/tosafot columns).
  const SRC_BLOCK_OF_VREGION = { inner: 'rashi', outer: 'tosafot' };
  const srcBlockOf = id => SRC_BLOCK_OF_VREGION[id] || String(id);
  /** data-src-block/-license/-special/-mt for a block with a store source, or null when there is none. */
  function srcAttrs(model, block) {
    const src = model && model.sources && model.sources[block];
    if (!src) return null;
    const a = { srcBlock: block, license: src.license || '', special: src.special ? '1' : '0' };
    if (src.mt) a.mt = '1';
    return a;
  }
  /** Sets the attribution data-* on an element (no-op for a block without a store source). */
  function applySrcAttrs(node, model, block) {
    const a = srcAttrs(model, block);
    if (a) Object.assign(node.dataset, a);
    return node;
  }
  /** The same attributes as an HTML string fragment (for template-built containers). */
  function srcAttrHTML(model, block) {
    const a = srcAttrs(model, block);
    if (!a) return '';
    const q = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return ` data-src-block="${q(a.srcBlock)}" data-license="${q(a.license)}" data-special="${a.special}"` +
      (a.mt ? ' data-mt="1"' : '');
  }

  function marginBlock(title, inner, vregion, model) {
    return inner
      ? `<div class="marg-block" data-vregion="${vregion}"${srcAttrHTML(model, srcBlockOf(vregion))}><span class="marg-title">${title}</span>${inner}</div>`
      : '';
  }

  /** Hebrew names of the store blocks that have no entry in EXTRA_COMMENTARIES. */
  const SRC_BLOCK_HE = { gemara: 'הגמרא', rashi: 'רש״י', tosafot: 'תוספות' };
  const SRC_BLOCK_EN = { gemara: 'Gemara', rashi: 'Rashi', tosafot: 'Tosafot' };

  /**
   * Per-page sources note (design §5, D8): one line per shown block, placed after the last sheet and
   * outside .page-sheet. `shownBlocks` are the data-src-block values of the rendered containers.
   * Returns null when no shown block has a store source.
   */
  function buildSourcesNote(model, shownBlocks) {
    const srcs = (model && model.sources) || {};
    const note = el('div', 'daf-sources');
    // Translated pages (en/ru streams) get a left-to-right note with Latin labels, so the English
    // licence lines do not lay out right-aligned among Hebrew labels.
    const ltrLang = (shownBlocks || []).map(b => srcs[b]).find(s => s && !s.fallbackFrom && isLtrLang(s.lang));
    const ltr = !!ltrLang;
    note.setAttribute('lang', ltr ? ltrLang.lang : 'he');
    note.dir = ltr ? 'ltr' : 'rtl';
    const head = el('div', 'daf-sources-h');
    head.textContent = ltr ? 'Text sources' : 'מקורות הטקסט · Sources';
    note.appendChild(head);
    let n = 0;
    let anySpecial = false;
    for (const block of shownBlocks || []) {
      const src = srcs[block];
      if (!src) continue;
      const name = ltr ? (SRC_BLOCK_EN[block] || block.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()))
        : SRC_BLOCK_HE[block] || (EXTRA_COMMENTARIES.find(e => e.id === block) || {}).he || block;
      const lic = src.license ? ` · ${src.license}` : '';
      const line = el('div', 'daf-src-line');
      line.dataset.noteBlock = block;
      if (src.special) { anySpecial = true; line.dataset.special = '1'; }
      line.textContent = `${name} — ${src.title || block}${lic} · Sefaria.org${src.special ? ' †' : ''}` +
        (src.fallbackFrom ? (ltr ? ' (Hebrew original: no translation)' : ' (מקור עברי — אין תרגום)') : '');
      note.appendChild(line);
      n++;
      if (src.mt) {
        const mt = el('div', 'daf-src-line daf-src-mt');
        mt.dataset.noteBlock = block;
        const from = Array.isArray(src.derivedFrom) && src.derivedFrom.length ? src.derivedFrom.join(', ') : (ltr ? 'the Hebrew source' : 'המקור העברי');
        mt.textContent = ltr ? `Machine translation, based on ${from}` : `תרגום מכונה — מבוסס על ${from}`;
        note.appendChild(mt);
      }
    }
    for (const e of (model && model.apparatusNoteEntries) || []) {
      const line = el('div', 'daf-src-line');
      line.dataset.noteBlock = e.block;
      if (e.special) { anySpecial = true; line.dataset.special = '1'; }
      line.textContent = `${LAYOUT_BLOCK_LABEL[e.block] || e.block} — ${e.title || e.block}${e.license ? ` · ${e.license}` : ''} · Sefaria.org${e.special ? ' †' : ''}`;
      note.appendChild(line);
      n++;
    }
    if (!n) return null;
    if (anySpecial) {
      const key = el('div', 'daf-src-key');
      key.textContent = ltr ? '† Restricted licence (CC-BY-NC / CC-BY-SA), not public domain.'
        : '† טקסט בעל רישיון מוגבל (CC-BY-NC / CC-BY-SA), שאינו נחלת הציבור.';
      note.appendChild(key);
    }
    return note;
  }

  /** Appends the sources note to a rendered page container (before the page's _finish). */
  function appendSourcesNote(container, model) {
    const shown = [];
    for (const node of container.querySelectorAll('[data-src-block]')) {
      if (!shown.includes(node.dataset.srcBlock)) shown.push(node.dataset.srcBlock);
    }
    const note = buildSourcesNote(model, shown);
    if (note) container.appendChild(note);
    return note;
  }

  // ═════════════════════════ Page assembly ═════════════════════════

  function buildHeader(model) {
    const h = el('div', 'daf-header');
    const ch = model.chapter || {};
    const sideHe = model.side === 'a' ? 'ע״א' : 'ע״ב';
    const center = el('div', 'hdr-center');
    if (ch.name) {
      center.innerHTML =
        `<span class="hdr-perek">${ch.name}</span>` +
        `<span class="hdr-pereknum">פרק ${perekOrdinal(ch.num)}</span>` +
        `<span class="hdr-masechet">${model.tractateHe || ''}</span>`;
    } else {
      center.innerHTML = `<span class="hdr-masechet">${model.tractateHe || ''}</span>`;
    }
    const daf = el('span', 'hdr-daf');
    daf.textContent = `${heb(model.page)} ${sideHe}`;
    // daf number sits at the OUTER top corner: amud a → left, amud b → right
    daf.style[model.side === 'a' ? 'left' : 'right'] = '0';
    h.appendChild(daf);
    h.appendChild(center);
    return h;
  }

  function buildMargins(model, keyIdx) {
    const inner = el('div', 'daf-margin margin-inner');
    // Margins are IN-FLOW columns (no clipping, no absolute overlay): their
    // measured height is part of the fill/pagination budget.
    inner.innerHTML = '<div class="marg-col">' +
      marginBlock('מסורת הש״ס', marginNotesHTML(keyIdx.mesoretHaShas.entries), 'masoretHaShas', model) +
      (model.extras.hagahotHaBach
        ? marginBlock(model.extras.hagahotHaBach.title, `<span class="marg-note">${model.extras.hagahotHaBach.html}</span>`, 'hagahotHaBach', model) : '') +
      (model.extras.gilyonHaShas
        ? marginBlock(model.extras.gilyonHaShas.title, `<span class="marg-note">${model.extras.gilyonHaShas.html}</span>`, 'gilyonHaShas', model) : '') +
      '</div>';
    const outer = el('div', 'daf-margin margin-outer');
    // Vilna order: תורה אור at the top of the outer margin, עין משפט below —
    // so Torah Or stays visible even when Ein Mishpat has many entries.
    outer.innerHTML = '<div class="marg-col">' +
      marginBlock('תורה אור', marginNotesHTML(keyIdx.torahOr.entries, true), 'torahOr', model) +
      marginBlock('עין משפט נר מצוה', marginNotesHTML(keyIdx.einMishpat.entries, false), 'einMishpat', model) +
      '</div>';
    return { inner, outer };
  }

  function buildBottomStrip(model) {
    const parts = [];
    // Catalog order; margin-slot extras render in the margins, not here.
    for (const def of EXTRA_COMMENTARIES) {
      if (def.slot === 'margin') continue;
      const ex = model.extras[def.id];
      if (ex) parts.push(`<div class="strip-block" data-vregion="${def.id}"${srcAttrHTML(model, def.id)}><span class="strip-title">${ex.title}</span> ${ex.html}</div>`);
    }
    if (!parts.length) return null;
    const strip = el('div', 'daf-bottom-strip');
    strip.innerHTML = parts.join('');
    return strip;
  }

  // ═════════════════════ Relaxation + fill (§2.3, §2.4) ═════════════════════

  /**
   * Layout constants of the adaptive policy. The best-effort fallback
   * (default settings, no per-amud profile) is seeded from the edition
   * profile's measured defaults (aspect, size ratios, leading, columns)
   * instead of the generic constants. Pushed to CSS via custom properties
   * so ctx arithmetic and the stylesheet always agree.
   */
  function adaptiveConstants(edition, bestEffort) {
    const L = Object.assign({ aspect: SHEET_ASPECT, seeded: 'generic' }, LAYOUT);
    if (!bestEffort || !edition) return L;
    try {
      const ps = (edition.pageSizes || [])[0];
      if (ps && ps.w > 0 && ps.h > 0) L.aspect = ps.w / ps.h;
      const d = edition.defaults || {};
      const g = d.gemara || {}, w = d.wrap || {}, cols = d.columns644 || {};
      if (g.size > 0 && w.size > 0) L.ratioComm = clampN(w.size / g.size, 0.6, 1);
      if (g.size > 0 && g.leading > 0) L.lhGem = clampN(g.leading / g.size, 0.85, 1.6);
      if (w.size > 0 && w.leading > 0) L.lhComm = clampN(w.leading / w.size, 0.85, 1.6);
      if (cols.core && cols.gemara3col) {
        const cw = cols.core[1] - cols.core[0];
        if (cw > 0) L.C0 = clampN((cols.gemara3col[0] - cols.core[0]) / cw, 0.18, 0.34);
      }
      L.seeded = 'edition-defaults';
    } catch (e) { /* keep generic constants */ }
    return L;
  }

  function applyLayoutVars(sheet, L) {
    sheet.style.setProperty('--fs-gem-base', `${L.fsGem}px`);
    sheet.style.setProperty('--ratio-comm', String(L.ratioComm));
    sheet.style.setProperty('--lh-gem', String(L.lhGem));
    sheet.style.setProperty('--lh-comm', String(L.lhComm));
  }

  function hasText(c) {
    if (!c) return false;
    for (const n of c.childNodes) {
      if (n.nodeType === 3 ? n.textContent.trim()
        : (n.nodeType === 1 && !n.classList.contains('carve') && !n.classList.contains('first-word')
          && n.textContent.trim())) return true;
    }
    return false;
  }

  function makeCtx(core, containers, model, scale, L, opt) {
    const W = core.clientWidth;
    const us = (model.settings && model.settings.fontScale) || 1;
    const fsGem = L.fsGem * scale * us;
    const fsComm = fsGem * L.ratioComm;
    const lhGem = fsGem * L.lhGem;
    const lhComm = fsComm * L.lhComm;
    return {
      W, C0: L.C0,
      fsGem, fsComm, lhGem, lhComm,
      gutter: gutterPx(fsGem, fsComm),
      boxGutter: Math.round(0.4 * fsGem),
      yTop: opt && opt.cont ? 0 : Math.round(L.yTopLines * lhComm),
      mirror: model.side === 'b',
      // LTR Gemara (en/ru): the reading start, and so the first-word box, is the physical LEFT.
      ltr: !!containers.gemara && getComputedStyle(containers.gemara).direction === 'ltr',
      has: {
        gemara: hasText(containers.gemara),
        rashi: hasText(containers.rashi),
        tosafot: hasText(containers.tosafot),
      },
      box: null, // measured after first paint when a chapter-start box exists
      slackK: 1,
    };
  }

  /**
   * Measured seeding (replaces character arithmetic): each stream's real
   * content is poured into a hidden box of its planned column width; the
   * shaped height is the seed end for the relaxation.
   */
  function measureSeeds(core, containers, ctx) {
    const cw = Math.round(ctx.C0 * ctx.W);
    const gw = Math.max(40, ctx.W - 2 * cw - 2 * ctx.gutter);
    const probe = (src, width) => {
      if (!hasText(src)) return 0;
      const box = src.cloneNode(true);
      box.removeAttribute('id');
      for (const x of box.querySelectorAll('.carve, .first-word')) x.remove();
      for (const x of box.querySelectorAll('[id]')) x.removeAttribute('id');
      box.style.cssText = `position:absolute;visibility:hidden;left:0;right:auto;top:0;` +
        `width:${Math.max(20, Math.round(width))}px;height:auto;display:block;`;
      core.appendChild(box);
      const h = box.getBoundingClientRect().height;
      box.remove();
      return h;
    };
    const { has } = ctx;
    const both = has.rashi && has.tosafot;
    const commW = has.gemara ? cw : (both ? ctx.W / 2 : ctx.W);
    return {
      gemara: has.gemara ? ctx.yTop + probe(containers.gemara, (has.rashi || has.tosafot) ? gw : ctx.W) : 0,
      rashi: has.rashi ? probe(containers.rashi, commW) : 0,
      tosafot: has.tosafot ? probe(containers.tosafot, commW) : 0,
    };
  }

  function relax(core, containers, ctx, seedEnds) {
    let ends = Object.assign({}, seedEnds);
    let rounds = 0, converged = false;
    const boxEl = core.querySelector('.first-word');
    for (let r = 0; r < LAYOUT.relaxRounds; r++) {
      rounds++;
      // The box footprint is only known after the first paint: a round
      // solved without it can never be the converged one.
      const boxPending = !!boxEl && !ctx.box;
      const plan = solve(ends, ctx);
      for (const name of ['gemara', 'rashi', 'tosafot']) emitStream(containers[name], plan[name], ctx.W);
      if (boxEl) {
        // Box sits at the reading start of the Gemara's first line — its
        // physical top-right corner. plan bands are physical (post-mirror):
        // band.a is the text's right offset, which already includes the box
        // intrusion; the box itself sits intrusion-width further right.
        const gb = plan.gemara.bands[0];
        const intr = ctx.box ? ctx.box.w + ctx.boxGutter : 0;
        boxEl.style.top = '0px';
        if (ctx.ltr) {
          boxEl.style.right = '';
          boxEl.style.left = `${Math.max(0, Math.round((gb ? ctx.W - gb.b : 0) - intr))}px`;
        } else boxEl.style.right = `${Math.max(0, Math.round((gb ? gb.a : 0) - intr))}px`;
      }
      void core.offsetHeight; // flush layout
      const coreTop = core.getBoundingClientRect().top;
      if (boxEl) {
        const br = boxEl.getBoundingClientRect();
        ctx.box = { w: Math.ceil(br.width), h: Math.max(0, Math.ceil(br.bottom - coreTop - ctx.yTop)) };
      }
      core._vilnaPlan = plan;
      core._vilnaCtx = ctx;
      const m = {
        gemara: measureTextEnd(containers.gemara, coreTop),
        rashi: measureTextEnd(containers.rashi, coreTop),
        tosafot: measureTextEnd(containers.tosafot, coreTop),
      };
      const tol = { gemara: ctx.lhGem, rashi: ctx.lhComm, tosafot: ctx.lhComm };
      const done = ['gemara', 'rashi', 'tosafot'].every(k => Math.abs(m[k] - ends[k]) < tol[k]);
      if (r >= 4) for (const k of Object.keys(m)) m[k] = (m[k] + ends[k]) / 2; // damp oscillation
      ends = m;
      if (done && !boxPending) { converged = true; break; }
    }
    return { ends, rounds, converged };
  }

  /** Visual line boxes of a flow (Range rects merged per line), client coords. */
  function lineRectsOf(container, excludeSel) {
    if (!container) return [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent.trim() && !(excludeSel && n.parentElement && n.parentElement.closest(excludeSel))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const raw = [];
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width > 2 && r.height > 2) raw.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    raw.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const r of raw) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - r.y) < r.h * 0.5) {
        const x0 = Math.min(last.x, r.x), x1 = Math.max(last.x + last.w, r.x + r.w);
        last.x = x0; last.w = x1 - x0; last.h = Math.max(last.h, r.h);
      } else lines.push(Object.assign({}, r));
    }
    return lines;
  }

  /** Line-pair collisions between the three carved streams (same rule as check.mjs). */
  function countStreamOverlaps(containers) {
    const names = ['gemara', 'rashi', 'tosafot'];
    const ls = names.map(n => lineRectsOf(containers[n], '.first-word'));
    // the chapter-opening box is its own component (it sits in the Gemara
    // stream's container but must not touch any text, its own stream's included)
    const box = containers.gemara && containers.gemara.querySelector('.first-word');
    if (box) {
      const r = box.getBoundingClientRect();
      if (r.width && r.height) ls.push([{ x: r.x, y: r.y, w: r.width, h: r.height }]);
    }
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        for (const a of ls[i]) {
          for (const b of ls[j]) {
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ox > 2 && oy > 3) n++;
          }
        }
      }
    }
    return n;
  }

  function marginNeed(sheet) {
    let h = 0;
    for (const m of sheet.querySelectorAll(':scope > .sheet-body > .daf-margin > .marg-col')) {
      h = Math.max(h, m.getBoundingClientRect().height);
    }
    return h;
  }

  /** Safe fallback: streams stacked full-width in source order (never overlaps). */
  function applyStacked(core, containers) {
    core.classList.add('stacked');
    core.style.height = '';
    for (const c of Object.values(containers)) {
      c.style.top = ''; c.style.height = ''; c.style.display = '';
    }
  }

  /**
   * Fill law + relaxation for one sheet. opt.fixedScale pins the global
   * scale (continuation sheets); otherwise the scale is searched in
   * [scaleMin, scaleMax] so the content ends at the bottom of the core.
   * Margins (in-flow) are part of the budget. Returns the diagnostics.
   */
  function layoutPage(sheet, core, containers, model, L, opt) {
    opt = opt || {};
    const targetSheetH = opt.targetSheetH || Math.round(sheet.getBoundingClientRect().width / L.aspect);
    const body = sheet.querySelector(':scope > .sheet-body');

    let scale = opt.fixedScale || 1, result = null, maxEnd = 0, targetCoreH = 0, need = 0, margH = 0;
    let seed = null, ctx = null, slackK = 1;
    const probeAt = sc => {
      sheet.style.setProperty('--s', sc);
      // Header / bottom strip / paddings scale with --s too — measure them
      // live against a fixed probe core height.
      core.style.height = '100px';
      const chromeH = sheet.getBoundingClientRect().height - body.getBoundingClientRect().height;
      // With many extra commentaries the bottom strip can exceed the sheet
      // budget; keep a sane core (the strip then paginates).
      targetCoreH = Math.max(0.45 * targetSheetH, targetSheetH - chromeH);
      ctx = makeCtx(core, containers, model, sc, L, opt);
      ctx.slackK = slackK;
      result = relax(core, containers, ctx, seed || measureSeeds(core, containers, ctx));
      seed = result.ends;
      maxEnd = Math.max(result.ends.gemara, result.ends.rashi, result.ends.tosafot);
      margH = marginNeed(sheet);
      need = Math.max(maxEnd, margH);
      scale = sc;
    };
    const fits = () => need <= targetCoreH + 0.5 * ctx.lhGem;
    const probes = [];
    const search = startScale => {
      if (opt.fixedScale) { probeAt(opt.fixedScale); return; }
      scale = startScale;
      for (let probe = 0; probe < L.fillProbes; probe++) {
        probeAt(scale);
        probes.push({ scale, need, target: targetCoreH, fits: fits(), slackK });
        if (Math.abs(need - targetCoreH) <= ctx.lhGem && fits()) break;
        const next = Math.min(LAYOUT.scaleMax,
          Math.max(LAYOUT.scaleMin, scale * Math.sqrt(targetCoreH / Math.max(1, need))));
        if (Math.abs(next - scale) < 0.004) break;
        scale = next;
      }
      // Never end the search on an overflowing probe when a smaller scale
      // fits: take the largest probed scale that fit, else try scaleMin.
      // Only content that cannot fit at scaleMin paginates.
      if (!fits()) {
        const ok = probes.filter(p => p.fits && p.slackK === slackK).sort((x, y) => y.scale - x.scale)[0];
        if (ok) probeAt(ok.scale);
        else if (scale > LAYOUT.scaleMin + 1e-6) {
          probeAt(LAYOUT.scaleMin);
          probes.push({ scale, need, target: targetCoreH, fits: fits(), slackK });
        }
      }
    };

    // Safety pass: a converged plan can still collide where a stream's last
    // line protrudes into a region another stream absorbed. Re-run the whole
    // fill search with a larger death slack; if that still collides, stack
    // the streams (safe fallback).
    search(1);
    let overlaps = countStreamOverlaps(containers);
    let fallbackLayout = false, retried = false;
    if (overlaps) {
      retried = true;
      slackK = 2.2;
      search(scale);
      overlaps = countStreamOverlaps(containers);
    }
    if (overlaps) {
      applyStacked(core, containers);
      fallbackLayout = true;
      void core.offsetHeight;
      const top = core.getBoundingClientRect().top;
      maxEnd = core.getBoundingClientRect().bottom - top;
      need = Math.max(maxEnd, marginNeed(sheet));
    } else {
      core.style.height = `${Math.round(Math.max(targetCoreH, maxEnd + 4))}px`;
    }
    const res = {
      rounds: result.rounds, converged: result.converged,
      scale, maxEnd, targetCoreH, targetSheetH, ends: result.ends, need, marginH: margH,
      retried, fallbackLayout, overlapsAfter: overlaps,
      lineTol: ctx.lhGem, probes: probes.map(p => [+p.scale.toFixed(3), Math.round(p.need), Math.round(p.target), p.fits]),
    };
    core._vilnaResult = Object.assign({ policy: 'adaptive' }, res);
    console.log(`[vilna-daf] relax rounds=${res.rounds} converged=${res.converged} ` +
      `scale=${scale.toFixed(3)} maxEnd=${Math.round(maxEnd)} targetCoreH=${Math.round(targetCoreH)}` +
      (fallbackLayout ? ' fallback=stacked' : ''));
    return res;
  }

  // ─────────────── Continuation sheets (pagination at word boundaries) ───────────────

  const MAX_SHEETS = 12;

  /** First word (text order) whose rendered line box ends below limitY. */
  /** Core check (design §3.4 step 3): kept text boxes are inflated by this many px (client space). */
  const CORE_HIT_PX = 1.5;
  /** Client-space boxes of the kept text of a sheet (everything outside the flow wrappers), inflated. */
  function keptCoreBoxes(sheet, self) {
    const out = [];
    // Kept text and the flows already placed (the flow being checked, `self`, is excluded).
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent.trim() && !(n.parentElement && n.parentElement.closest('.carve, .acont-block'))
        && !(self && self.contains(n)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) {
          out.push({ x0: r.left - CORE_HIT_PX, x1: r.right + CORE_HIT_PX, y0: r.top - CORE_HIT_PX, y1: r.bottom + CORE_HIT_PX });
        }
      }
    }
    return out;
  }
  /** Client top of the first flow word whose box intersects a core box by more than 0.5 px, or null. */
  function firstCoreHitTop(flowRoot, boxes) {
    const walker = document.createTreeWalker(flowRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent.trim() && !(n.parentElement && n.parentElement.closest('.carve, .first-word'))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    let best = null, node;
    while ((node = walker.nextNode())) {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(node.textContent))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        for (const r of range.getClientRects()) {
          if (best != null && r.top >= best) continue;
          for (const b of boxes) {
            const ox = Math.min(r.right, b.x1) - Math.max(r.left, b.x0);
            const oy = Math.min(r.bottom, b.y1) - Math.max(r.top, b.y0);
            if (ox > 0.5 && oy > 0.5) { best = best == null ? r.top : Math.min(best, r.top); break; }
          }
        }
      }
    }
    return best;
  }

  function wordStartBelow(root, limitY) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent.trim() && !(n.parentElement && n.parentElement.closest('.carve, .first-word'))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    let node;
    // Start of the word still open at the end of the previous text node (a word may span text nodes,
    // e.g. "ש" + "לא" in one word): a cut must never land inside a word, so it backs up to its start.
    let wordOpen = null;
    while ((node = walker.nextNode())) {
      const txt = node.textContent;
      const tr = /\S+$/.exec(txt);
      const nodeStart = !tr ? null : tr.index === 0 ? (wordOpen || { node, offset: 0 }) : { node, offset: tr.index };
      range.selectNodeContents(node);
      let maxB = 0;
      for (const r of range.getClientRects()) maxB = Math.max(maxB, r.bottom);
      if (maxB <= limitY) { wordOpen = nodeStart; continue; }
      const re = /\S+/g;
      let m;
      while ((m = re.exec(txt))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        let b = 0;
        for (const r of range.getClientRects()) b = Math.max(b, r.bottom);
        if (b > limitY) return m.index === 0 && wordOpen ? wordOpen : { node, offset: m.index };
      }
      wordOpen = nodeStart;
    }
    return null;
  }

  /**
   * Split a flow at pos: everything from pos to the end moves into a
   * fragment. Range.extractContents clones the partially-selected inline
   * ancestors, so .gseg/.comment[data-seg] (and marg-block[data-vregion])
   * identity is preserved on both sides of the cut. Clone ids are demoted
   * to data-cont-of (ids stay unique).
   */
  function countWordsOf(node) { return (String(node.textContent || '').match(/\S+/g) || []).length; }

  function extractTail(root, pos) {
    const r = document.createRange();
    r.setStart(pos.node, pos.offset);
    r.setEnd(root, root.childNodes.length);
    const frag = r.extractContents();
    for (const e of frag.querySelectorAll('[id]')) {
      if (document.getElementById(e.id)) { e.dataset.contOf = e.id; e.removeAttribute('id'); }
    }
    return frag.textContent.trim() ? frag : null;
  }

  function buildSheetSkeleton(model, s, cls) {
    const sheet = el('div', `page-sheet side-${model.side}${cls ? ` ${cls}` : ''}`);
    // The stylesheet keys its translation-only font fallbacks off this; the
    // Hebrew page must keep the exact pre-translation stacks.
    sheet.dataset.textLang = s.textLang && s.textLang !== 'he' ? s.textLang : 'he';
    if (s.fontScale && s.fontScale !== 1) sheet.style.setProperty('--us', String(s.fontScale));
    const commFam = fontFamilyCSS(s.commFont, 'rashi');
    const gemFam = fontFamilyCSS(s.gemaraFont, 'frank');
    if (commFam) sheet.style.setProperty('--font-comm', commFam);
    if (gemFam) sheet.style.setProperty('--font-main', gemFam);
    return sheet;
  }

  function buildBody(model, inner, outer) {
    const body = el('div', 'sheet-body');
    const coreWrap = el('div', 'core-wrap');
    const core = el('div', 'core');
    coreWrap.appendChild(core);
    // amud a: inner margin on the physical right; amud b mirrored.
    if (model.side === 'a') body.append(inner, coreWrap, outer);
    else body.append(outer, coreWrap, inner);
    return { body, core };
  }

  function buildStreams(core, model, s, htmls) {
    const containers = {};
    const ed = EDITIONS[s.edition] || EDITIONS.aramaic;
    // A non-Hebrew textLang puts every stream (Gemara included) in that language;
    // LTR for en/ru/fr/es/ko, RTL for Yiddish.
    const textLang = s.textLang && s.textLang !== 'he' ? s.textLang : null;
    for (const name of ['gemara', 'rashi', 'tosafot']) {
      const c = el('div', `stream stream-${name}`);
      c.dataset.vregion = name === 'gemara' ? 'gemara' : (name === 'rashi' ? 'inner' : 'outer');
      applySrcAttrs(c, model, name);
      c.innerHTML = `<div class="carve carve-r"></div><div class="carve carve-l"></div>${htmls[name] || ''}`;
      // A stream whose source fell back to Hebrew (no text in the selected language) keeps Hebrew
      // direction and lang; the other streams follow the selected language.
      const fellBack = !!(textLang && model.sources && model.sources[name] && model.sources[name].fallbackFrom);
      const sLang = fellBack ? 'he' : textLang;
      // Direction follows the selected source, not the page chrome.
      if (sLang ? isLtrLang(sLang) : (name === 'gemara' ? ed.dir === 'ltr' : isLtrLang(effectiveLang(s)))) {
        c.classList.add('stream-ltr');
        c.dir = 'ltr';
      } else if (fellBack) {
        c.dir = 'rtl';
      }
      if (sLang) {
        c.lang = sLang; // hyphenation needs the language (hyphens:auto)
        c.style.hyphens = 'auto';
      }
      core.appendChild(c);
      containers[name] = c;
    }
    containers.gemara.classList.add('gemara'); // legacy alias
    return containers;
  }

  /** Continuation sheet n: label + margins + core streams (filled by caller). */
  function buildContSheet(model, s, L, n, continued) {
    const sheet = buildSheetSkeleton(model, s, 'sheet-cont');
    applyLayoutVars(sheet, L);
    const sideHe = model.side === 'a' ? 'ע״א' : 'ע״ב';
    const label = el('div', 'cont-label');
    label.setAttribute('role', 'note');
    label.textContent = `המשך ${model.tractateHe || model.tractate || ''} ${heb(model.page)} ${sideHe} — גיליון ${n + 1}`;
    if (continued.length) {
      const tags = el('span', 'cont-streams');
      tags.textContent = ` (המשך: ${continued.join(' · ')})`;
      label.appendChild(tags);
    }
    sheet.appendChild(label);
    const inner = el('div', 'daf-margin margin-inner');
    const outer = el('div', 'daf-margin margin-outer');
    inner.innerHTML = '<div class="marg-col"></div>';
    outer.innerHTML = '<div class="marg-col"></div>';
    const { body, core } = buildBody(model, inner, outer);
    core.classList.add('core-cont');
    sheet.appendChild(body);
    const containers = buildStreams(core, model, s, {});
    return { sheet, core, containers, margins: { inner: inner.firstChild, outer: outer.firstChild }, strip: null };
  }

  function sheetOverflows(S, res) {
    const tol = Math.max(2, 0.5 * res.lineTol);
    if (res.need > res.targetCoreH + tol) return true;
    return S.sheet.getBoundingClientRect().height > res.targetSheetH + tol;
  }

  /**
   * Cut a sheet so it fits its target: streams and margins at the core
   * bottom, then the bottom strip at the sheet bottom. The sheet is
   * re-relaxed after each cut at the same scale. Returns the carried
   * fragments (source order), or null if nothing could be cut.
   */
  function cutSheet(S, res, model, L) {
    const carry = { gemara: [], rashi: [], tosafot: [], inner: [], outer: [], strip: [] };
    let any = false;
    for (let it = 0; it < 4; it++) {
      if (S.core.classList.contains('stacked')) break;
      S.core.style.height = `${Math.round(res.targetCoreH)}px`;
      const coreTop = S.core.getBoundingClientRect().top;
      const limit = coreTop + res.targetCoreH + 0.5;
      let cut = false;
      for (const name of ['gemara', 'rashi', 'tosafot']) {
        const pos = wordStartBelow(S.containers[name], limit);
        const frag = pos && extractTail(S.containers[name], pos);
        if (frag) { carry[name].unshift(frag); cut = true; }
      }
      for (const side of ['inner', 'outer']) {
        const col = S.margins[side];
        const pos = col && wordStartBelow(col, limit);
        const frag = pos && extractTail(col, pos);
        if (frag) { carry[side].unshift(frag); cut = true; }
      }
      if (!cut) break;
      any = true;
      res = layoutPage(S.sheet, S.core, S.containers, model, L,
        { fixedScale: res.scale, targetSheetH: res.targetSheetH, cont: S.index > 0 });
      if (res.need <= res.targetCoreH + 0.5) break;
    }
    S.core.style.height = `${Math.round(Math.max(res.targetCoreH, res.maxEnd + 4))}px`;
    // Bottom strip: cut at the sheet's bottom content edge.
    const strip = S.sheet.querySelector(':scope > .daf-bottom-strip');
    if (strip) {
      const sr = S.sheet.getBoundingClientRect();
      if (sr.height > res.targetSheetH + 2) {
        const padB = parseFloat(getComputedStyle(S.sheet).paddingBottom) || 0;
        const pos = wordStartBelow(strip, sr.top + res.targetSheetH - padB);
        const frag = pos && extractTail(strip, pos);
        if (frag) { carry.strip.push(frag); any = true; }
        if (!strip.textContent.trim()) strip.remove();
      }
    }
    return { carry, any, res };
  }

  const STREAM_LABEL = { gemara: 'גמרא', rashi: 'פירוש פנימי', tosafot: 'פירוש חיצוני' };

  /** Build continuation sheets until everything is placed (cap MAX_SHEETS). */
  function paginate(container, S0, res0, model, s, L, pol) {
    const sheets = [S0];
    const results = [res0];
    let S = S0, res = res0, capped = false;
    while (sheetOverflows(S, res)) {
      if (sheets.length >= MAX_SHEETS) { capped = true; break; }
      const c = cutSheet(S, res, model, L);
      results[results.length - 1] = c.res;
      if (!c.any) { capped = true; break; } // nothing cuttable: sheet runs long, nothing lost
      const n = sheets.length;
      const continued = ['gemara', 'rashi', 'tosafot'].filter(k => c.carry[k].length).map(k => STREAM_LABEL[k]);
      const N = buildContSheet(model, s, L, n, continued);
      N.index = n;
      N.sheet.dataset.sheet = String(n);
      N.sheet.dataset.policy = pol.policy;
      N.sheet.dataset.fallback = pol.fallback;
      N.sheet.style.width = S0.sheet.style.width;
      N.sheet.style.maxWidth = 'none';
      for (const k of ['gemara', 'rashi', 'tosafot']) for (const f of c.carry[k]) N.containers[k].appendChild(f);
      for (const k of ['inner', 'outer']) for (const f of c.carry[k]) N.margins[k].appendChild(f);
      if (c.carry.strip.length) {
        const strip = el('div', 'daf-bottom-strip');
        if (isLtrLang(effectiveLang(s))) { strip.classList.add('stream-ltr'); strip.dir = 'ltr'; }
        for (const f of c.carry.strip) strip.appendChild(f);
        N.sheet.appendChild(strip);
        N.strip = strip;
      }
      N.core.removeAttribute('id');
      container.appendChild(N.sheet);
      res = layoutPage(N.sheet, N.core, N.containers, model, L,
        { fixedScale: res0.scale, targetSheetH: res0.targetSheetH, cont: true });
      sheets.push(N);
      results.push(res);
      S = N;
    }
    return { sheets, results, capped };
  }

  // ═════════════════════════ Interactivity ═════════════════════════

  /**
   * Hover/click linking, delegated ONCE at the container level so it works
   * across every sheet (continuation sheets included) and in both policies.
   */
  const _hlEls = new Set();
  let _activeSeg = null;
  function initHover(root) {
    if (root._vilnaHover) return;
    root._vilnaHover = true;
    function clr() {
      for (const e of _hlEls) e.classList.remove('hl-seg');
      _hlEls.clear(); _activeSeg = null;
    }
    function hl(seg) {
      if (seg === _activeSeg) return;
      clr(); _activeSeg = seg;
      for (const e of root.querySelectorAll(`[data-seg="${CSS.escape(String(seg))}"]`)) {
        if (e.classList.contains('comment') || e.classList.contains('gseg') || e.classList.contains('marg-note')) {
          e.classList.add('hl-seg'); _hlEls.add(e);
        }
      }
    }
    const flash = node => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('hl-flash');
      setTimeout(() => node.classList.remove('hl-flash'), 1500);
    };
    root.addEventListener('pointerover', e => {
      const se = e.target.closest && e.target.closest('.gseg[data-seg], .comment[data-seg], .ref-key[data-seg], .marg-note[data-seg]');
      if (se) hl(se.dataset.seg);
    });
    root.addEventListener('pointerout', e => {
      if (!(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-seg]'))) clr();
    });
    root.addEventListener('click', e => {
      if (!e.target.closest) return;
      const rk = e.target.closest('.ref-key');
      if (rk) {
        const id = rk.dataset.target || '';
        // The note may have been split onto a continuation sheet; the first
        // part keeps the id, later parts carry data-cont-of.
        const note = id && (root.querySelector('#' + CSS.escape(id)) || root.querySelector(`[data-cont-of="${CSS.escape(id)}"]`));
        if (note) flash(note);
        return;
      }
      const se = e.target.closest('.gseg[data-seg]');
      if (!se) return;
      const c = root.querySelector(`.comment[data-seg="${CSS.escape(se.dataset.seg)}"]`);
      if (c) flash(c);
    });
  }
  /**
   * Zoom/pan. Mouse: ctrl+wheel zooms, drag pans once zoomed, double-click
   * resets. Touch: one finger pans the sheet ("grab and go"), two fingers
   * pinch-zoom around their midpoint. Touch panning starts only after a
   * small movement threshold, so taps still click anchors and comments.
   */
  function initZoomPan(sheet) {
    let s = 1, tx = 0, ty = 0, drag = false, sx = 0, sy = 0;
    const MIN = 0.4, MAX = 6;
    const TAP_SLOP = 8; // px before a touch becomes a pan
    const touches = new Map(); // pointerId -> {x, y}
    let pinchD = 0, touchPanning = false;

    function setTransform() {
      sheet.style.transform = `scale(${s}) translate(${tx}px,${ty}px)`;
      sheet.style.transformOrigin = 'top center';
      sheet.style.cursor = s > 1.02 ? (drag ? 'grabbing' : 'grab') : '';
      // At base scale let the browser scroll the page (reach the footer);
      // once zoomed, we own all panning so the sheet can't be lost.
      sheet.style.touchAction = s > 1.02 ? 'none' : 'pan-y';
    }
    // Keep the sheet glued to the selection bar: its top never gaps below
    // the nav at any zoom, it re-centers horizontally and snaps flush under
    // the nav when it fits, and a tall zoomed-in sheet may pan up (top under
    // the nav) but always keeps a strip visible — never lost.
    const navEl = document.querySelector('.nav-bar');
    function clamp() {
      const r = sheet.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight, M = 64;
      const top = navEl ? navEl.getBoundingClientRect().bottom : 0;
      let dx = 0, dy = 0;
      if (r.width <= vw) dx = (vw - r.width) / 2 - r.left;       // fits → center
      else if (r.right < M) dx = M - r.right;
      else if (r.left > vw - M) dx = (vw - M) - r.left;
      if (r.height <= vh - top) dy = top - r.top;               // fits → flush under nav
      else if (r.top > top) dy = top - r.top;                   // close any top gap
      else if (r.bottom < top + M) dy = (top + M) - r.bottom;   // keep a strip visible
      if (dx || dy) { tx += dx / s; ty += dy / s; setTransform(); }
    }
    function ap() { setTransform(); clamp(); }
    function zoomAt(ns, cx, cy) {
      ns = Math.max(MIN, Math.min(MAX, ns));
      const r = sheet.getBoundingClientRect();
      tx += (cx - r.left) * (1 / ns - 1 / s);
      ty += (cy - r.top) * (1 / ns - 1 / s);
      s = ns; ap();
    }

    // ── Mouse ──
    sheet.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(s * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
    }, { passive: false });
    sheet.addEventListener('mousedown', e => {
      if (s < 1.02 || e.button !== 0 || e.target.closest('.comment,.ref-key,a,button,select,input')) return;
      drag = true; sx = e.clientX; sy = e.clientY; e.preventDefault(); ap();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      tx += (e.clientX - sx) / s; ty += (e.clientY - sy) / s;
      sx = e.clientX; sy = e.clientY; ap();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = false; ap(); } });
    sheet.addEventListener('dblclick', e => {
      if (e.target.closest('.comment,.ref-key,a,button,select,input')) return;
      s = 1; tx = 0; ty = 0; ap();
    });

    // ── Touch ──
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const mid = () => {
      const [a, b] = [...touches.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    sheet.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (touches.size === 2) { pinchD = dist(); touchPanning = true; }
    });
    sheet.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      const t = touches.get(e.pointerId);
      const px = t.x, py = t.y;
      t.x = e.clientX; t.y = e.clientY;

      if (touches.size === 2) {
        // Pinch: scale by distance ratio around the midpoint, pan by its drift.
        const d = dist(), m = mid();
        if (pinchD) {
          zoomAt(s * (d / pinchD), m.x, m.y);
          tx += (t.x - px) / 2 / s; ty += (t.y - py) / 2 / s;
          ap();
        }
        pinchD = d;
        e.preventDefault();
      } else if (touches.size === 1) {
        // Only pan once zoomed in; at base scale let the page scroll
        // natively (so the Sefaria footer below the sheet is reachable).
        if (s <= 1.02) return;
        if (!touchPanning && Math.hypot(t.x - t.x0, t.y - t.y0) < TAP_SLOP) return;
        touchPanning = true;
        tx += (t.x - px) / s; ty += (t.y - py) / s;
        ap();
        e.preventDefault();
      }
    }, { passive: false });
    let lastTap = { t: 0, x: 0, y: 0 };
    const endTouch = e => {
      if (e.pointerType !== 'touch') return;
      const t = touches.get(e.pointerId);
      // Double-tap (two clean taps, close together) resets the view —
      // the touch counterpart of the desktop double-click.
      if (t && touches.size === 1 && !touchPanning
          && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) < TAP_SLOP) {
        const now = Date.now();
        if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          s = 1; tx = 0; ty = 0; ap();
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchD = 0;
      if (touches.size === 0) touchPanning = false;
    };
    sheet.addEventListener('pointerup', endTouch);
    sheet.addEventListener('pointercancel', endTouch);
  }

  // ═════════════════════ STRICT-VILNA renderer (profile placement) ═════════════════════
  //
  // The sheet IS the reference page: --pt = sheetWidth / page.w px and every
  // coordinate is calc(var(--pt) * N) in PDF points. Each profile line is an
  // absolutely positioned, non-wrapping RTL line at its printed x-extent and
  // baseline; its text comes verbatim from the profile (no stripText/boldDH).
  // Justification is explicit and measured: word-spacing, then bounded
  // letter-spacing, then last-resort scaleX — all expressed in pt so the
  // sheet rescales without re-measuring. Nothing is asynchronous after the
  // fonts load; no DOM mutation after ready.

  const KNOWN_FAMILIES = new Set(['FrankRuhl', 'RashiScript']);
  const _fontFaceLoads = {};
  const FIT = { wsMin: -0.12, wsMax: 1.2, lsMin: -0.03, lsMax: 0.06, tolPx: 0.25, sxTolPx: 0.3 };

  /**
   * Measured fallback web-font fit per script, used only for a typeface the
   * edition profile has no webFonts entry for. Provenance:
   * harness/out/c-webfont-fit.json (8 calibration pages, per-line ink-profile
   * cross-correlation + per-face IoU grid guarded by ink density / raw match).
   * baselineShiftEm: positive raises the glyphs (CSS baseline-shift sense).
   */
  const WEBFONT_FALLBACK = {
    square: { family: 'FrankRuhl', wght: 400, sizeScale: 1, baselineShiftEm: -0.077, inkShiftXEm: -0.035 },
    rashi: { family: 'RashiScript', wght: 400, sizeScale: 1, baselineShiftEm: -0.13, inkShiftXEm: -0.03 },
  };

  function webFontFor(edition, typefaceId) {
    const tf = (edition && edition.typefaces && edition.typefaces[typefaceId]) || {};
    const script = tf.script || (/rashi/i.test(String(typefaceId)) ? 'rashi' : 'square');
    const fb = WEBFONT_FALLBACK[script] || WEBFONT_FALLBACK.square;
    const own = edition && edition.webFonts && edition.webFonts[typefaceId];
    // An entry explicitly marked fitted:false is a placeholder: keep its
    // family/file/weight/size (weight distinguishes bold DH / heavy faces),
    // but take the measured baseline shift for its script.
    const fitted = !!own && own.fitted !== false;
    const wf = own || fb;
    const family = String(wf.family || fb.family).replace(/["\\]/g, '');
    const generic = script === 'rashi' ? 'var(--font-rashi)' : 'var(--font-gemara)';
    const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
    return {
      typefaceId, family, file: wf.file || null, script, fitted,
      css: `"${family}", ${generic}`,
      wght: num(wf.wght, fb.wght),
      sizeScale: num(wf.sizeScale, 1) || 1,
      shiftEm: fitted ? num(wf.baselineShiftEm, 0) : (family === fb.family ? fb.baselineShiftEm : num(wf.baselineShiftEm, 0)),
      // horizontal ink correction (sidebearing difference), em, + = right
      shiftXEm: fitted ? num(wf.inkShiftXEm, 0) : (family === fb.family ? fb.inkShiftXEm : num(wf.inkShiftXEm, 0)),
    };
  }

  /**
   * A translated layer's face (spec §10.4, D6): its entry is a bundled CSS family stack (e.g. 'VilnaKR'),
   * not an edition typeface, so it takes no Hebrew web font, no fitted shift and no sidebearing correction.
   */
  function translationFace(stack) {
    const css = String(stack);
    const family = (css.split(',')[0] || '').replace(/['"\s]/g, '');
    return { typefaceId: css, family, file: null, script: 'translation', fitted: false, css,
      wght: 400, sizeScale: 1, shiftEm: 0, shiftXEm: 0 };
  }

  async function ensureWebFont(wf) {
    if (wf.file && !KNOWN_FAMILIES.has(wf.family) && typeof FontFace !== 'undefined') {
      const k = `${wf.family}|${wf.file}`;
      if (!_fontFaceLoads[k]) {
        _fontFaceLoads[k] = (async () => {
          const ff = new FontFace(wf.family, `url(${wf.file})`, { weight: '100 900', display: 'block' });
          document.fonts.add(ff);
          await ff.load();
        })().catch(e => console.warn('[vilna-daf] web font', wf.family, e));
      }
      await _fontFaceLoads[k];
    }
    try { await document.fonts.load(`${wf.wght} 16px "${wf.family}"`, 'אבגדהוזחטיכלמנסעפצקרשת'); } catch (e) { /* fallback face */ }
  }

  /** Run-length segs → lookup(wordIndex) = mapping entry (or null). */
  function segLookup(segs) {
    if (!Array.isArray(segs) || !segs.length) return null;
    const arr = segs.filter(Array.isArray).slice().sort((a, b) => a[0] - b[0]);
    if (!arr.length) return null;
    return idx => {
      let lo = 0, hi = arr.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid][0] <= idx) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans < 0 ? null : arr[ans];
    };
  }

  /**
   * Append a run's text, wrapping words in the existing linking spans
   * (.gseg[data-seg] / .comment[data-layer][data-seg]) per the profile segs.
   * ws = per-region word state {idx, inWord, cur} (line start resets inWord).
   */
  function appendRunText(parent, text, ws, lookup, layer) {
    if (!lookup || !layer) {
      parent.appendChild(document.createTextNode(text));
      for (const ch of text) {
        if (ch === ' ') ws.inWord = false;
        else if (!ws.inWord) { ws.inWord = true; ws.idx++; }
      }
      return;
    }
    let buf = '', cur = ws.cur;
    const flush = () => {
      if (!buf) return;
      if (cur) {
        const sp = document.createElement('span');
        if (layer === 'gemara') sp.className = 'gseg';
        else {
          sp.className = 'comment';
          sp.dataset.layer = layer;
          if (cur[2] != null) sp.dataset.ci = String(cur[2]);
          sp.tabIndex = 0;
        }
        sp.dataset.seg = String(cur[1]);
        sp.textContent = buf;
        parent.appendChild(sp);
      } else parent.appendChild(document.createTextNode(buf));
      buf = '';
    };
    for (const ch of text) {
      if (ch === ' ') { ws.inWord = false; buf += ch; continue; }
      if (!ws.inWord) {
        ws.inWord = true; ws.idx++;
        const m = lookup(ws.idx);
        if (m !== cur) { flush(); cur = m; }
      }
      buf += ch;
    }
    flush();
    ws.cur = cur;
  }

  const RUN_STYLES = new Set(['sup', 'b', 'box', 'marker', 'key', 'catch']);
  const REGION_LAYER = { gemara: 'gemara', inner: 'rashi', outer: 'tosafot' };
  const REGION_BLOCK_ID = { gemara: 'gemara-block', inner: 'rashi-block', outer: 'tosafot-block' };

  function buildStrictLine(ln, i, region, lookup, layer, ws) {
    const [bl, x0, x1, content] = ln;
    const rf = region.face != null ? region.face : 0;
    const vl = el('div', `vl f${rf}`);
    vl.dataset.line = String(i);
    vl.dataset.bl = String(bl);
    vl.dataset.x0 = String(x0);
    vl.dataset.x1 = String(x1);
    vl.style.left = `calc(var(--pt) * ${x0})`;
    vl.style.width = `calc(var(--pt) * ${Math.max(0, x1 - x0)})`;
    vl.style.top = `calc(var(--pt) * ${bl})`;
    vl.appendChild(el('span', 'vbl')); // permanent zero-size baseline probe
    ws.inWord = false;
    if (content == null) { vl.dataset.withheld = '1'; return vl; }
    const runs = typeof content === 'string' ? [[rf, content]] : content;
    for (const run of runs) {
      if (!Array.isArray(run)) continue;
      const [fi, t, style, rx0, rx1, dy] = run;
      const vr = el('span', `vr f${fi != null ? fi : rf}`);
      if (style && RUN_STYLES.has(style)) vr.classList.add(`s-${style}`);
      // run[5]: measured baseline offset of the run in pt (y down), e.g. a
      // raised key letter or a DH face printed on its own baseline.
      if (dy != null && Number.isFinite(+dy) && +dy !== 0) {
        vr.classList.add('vr-dy');
        vr.style.setProperty('--dy', `calc(var(--pt) * ${+dy})`);
      }
      if (rx0 != null && rx1 != null) {
        // positioned apart (tab/centered part): own extent inside the line
        vr.classList.add('vr-abs');
        vr.dataset.x0 = String(rx0);
        vr.dataset.x1 = String(rx1);
        vr.style.left = `calc(var(--pt) * ${rx0 - x0})`;
        vr.style.width = `calc(var(--pt) * ${Math.max(0, rx1 - rx0)})`;
      }
      appendRunText(vr, t == null ? '' : String(t), ws, lookup, layer);
      vl.appendChild(vr);
    }
    return vl;
  }

  function buildOrnament(o) {
    const b = Array.isArray(o.b) ? o.b : [0, 0, 0, 0];
    const [x0, y0, x1, y1] = b;
    const kind = String(o.k || 'mark').replace(/[^\w-]/g, '');
    const d = el('div', `vorn vorn-${kind}`);
    d.dataset.k = kind;
    d.style.left = `calc(var(--pt) * ${x0})`;
    d.style.top = `calc(var(--pt) * ${y0})`;
    d.style.width = `calc(var(--pt) * ${Math.max(0, x1 - x0)})`;
    d.style.height = `calc(var(--pt) * ${Math.max(0, y1 - y0)})`;
    if (o.text) {
      // Chapter-word box: CSS frame + LIVE text sized to the box (never a scan crop).
      const t = el('span', 'vorn-text');
      t.textContent = String(o.text);
      t.style.fontSize = `calc(var(--pt) * ${Math.max(1, (y1 - y0) * 0.56).toFixed(3)})`;
      d.appendChild(t);
    } else d.setAttribute('aria-hidden', 'true');
    return d;
  }

  function graphemeCount(s) {
    let n = 0;
    for (const ch of s) if (!/\p{M}/u.test(ch)) n++;
    return n;
  }

  /** Place each line box so its probe (alphabetic baseline) lands on the
   *  printed baseline. probeY = probe offsets measured with top = baseline. */
  function applyBaselines(lines, probeY, pxPerPt) {
    lines.forEach((vl, i) => {
      const bl = +vl.dataset.bl;
      const asc = probeY[i] / pxPerPt - bl; // probe sits `asc` pt below the box top
      vl.style.top = `calc(var(--pt) * ${(bl - asc).toFixed(4)})`;
    });
  }

  /** Re-register baselines at the sheet's current scale (after a rescale). */
  function reregisterBaselines(sheet, pxPerPt) {
    const lines = [...sheet.querySelectorAll('.vl')];
    for (const vl of lines) { vl.style.top = `calc(var(--pt) * ${vl.dataset.bl})`; vl.style.translate = ''; }
    const top = sheet.getBoundingClientRect().top;
    const sc = sheet.getBoundingClientRect().height / (sheet.offsetHeight || 1); // undo zoom transform
    const probeY = lines.map(vl => (vl.firstChild.getBoundingClientRect().top - top) / (sc || 1));
    applyBaselines(lines, probeY, pxPerPt);
    compensateBaselineSnap(sheet);
  }

  /**
   * Baseline pixel-snap compensation (edition-independent rendering rule,
   * iteration 5). Measured in the pinned Chromium (harness/out/iter5-sweep/
   * snap): a text run's glyphs are painted at its layout baseline ROUNDED TO
   * A WHOLE CSS px of its transform space (top/relative offsets alike: the
   * rounding is of the summed position), whereas a CSS `translate` is applied
   * after that rounding and snaps only to device pixels. At the strict
   * page's 1 CSS px ≈ 1 pt and device scale 2, every printed line was thus
   * drawn up to ±1 device px off its printed baseline (a sawtooth of the
   * baseline's fractional position — the dominant residual of the per-face
   * vertical ink audit). Each line's layout stays exactly at the printed
   * baseline; its `translate` takes back the rounding of its runs (the
   * character-weighted best single value when faces in one line have
   * different baseline shifts), so the painted baseline lands within half a
   * device pixel of the print. Pure paint correction: no reflow, no change of
   * line content, extents or order. Recomputed by reregisterBaselines.
   */
  function compensateBaselineSnap(sheet) {
    const lines = [...sheet.querySelectorAll('.vl')];
    if (!lines.length) return 0;
    for (const vl of lines) vl.style.translate = '';
    // the transform space whose whole CSS px the glyph origins snap to
    let space = null;
    for (let e = sheet; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.transform !== 'none' || cs.translate !== 'none' || cs.scale !== 'none' || cs.rotate !== 'none') { space = e; break; }
    }
    let oy = -(window.scrollY || 0), sc = 1;
    if (space) {
      const r = space.getBoundingClientRect();
      sc = r.height / (space.offsetHeight || 1) || 1;
      oy = r.top + (space.clientTop || 0) * sc;
    }
    const plan = [];
    for (const vl of lines) {
      const p = vl.firstChild;
      if (!p || !p.classList || !p.classList.contains('vbl')) continue;
      const P = (p.getBoundingClientRect().top - oy) / sc;
      const runs = [];
      for (const vr of vl.children) {
        if (!vr.classList.contains('vr')) continue;
        const n = vr.textContent.replace(/\s+/g, '').length;
        if (!n) continue;
        const rel = vr.classList.contains('vr-abs') ? 0 : (parseFloat(getComputedStyle(vr).top) || 0);
        const y = P + rel;
        runs.push({ e: Math.round(y) - y, n }); // painted − intended (CSS px)
      }
      if (!runs.length) continue;
      // candidate corrections: each run's own; keep the one with least weighted |error|
      let best = 0, bestCost = Infinity;
      for (const c of runs) {
        let cost = 0;
        for (const r of runs) cost += r.n * Math.abs(r.e - c.e);
        if (cost < bestCost - 1e-9) { bestCost = cost; best = c.e; }
      }
      if (Math.abs(best) > 0.004) plan.push([vl, -best]);
    }
    for (const [vl, d] of plan) vl.style.translate = `0 ${d.toFixed(4)}px`;
    return plan.length;
  }

  /**
   * Per-face reference-vs-web letter advance model. For a face whose edition
   * typeface carries a per-letter advance table (advEm, from the PDF
   * /Widths), the web font's own advances are measured once per letter
   * (canvas, same family/weight/size) so a line's glyph condensation
   * k = Σ ref advances / Σ web advances is known before justification.
   */
  function makeAdvanceModel(faces, edition, pxPerPt) {
    const canvas = document.createElement('canvas').getContext('2d');
    const models = faces.map(f => {
      const tf = edition && edition.typefaces && edition.typefaces[f.tid];
      const adv = tf && tf.advEm;
      if (!adv || !Object.keys(adv).length) return null;
      const sizePx = f.size * f.wf.sizeScale * pxPerPt;
      return { adv, refPx: f.size * pxPerPt, font: `${f.wf.wght} ${sizePx}px "${f.wf.family}"`, web: {} };
    });
    const webAdv = (m, ch) => {
      if (!(ch in m.web)) { canvas.font = m.font; m.web[ch] = canvas.measureText(ch).width; }
      return m.web[ch];
    };
    /** k for a set of runs [{face, text}] or null when not determinable. */
    return runs => {
      let ref = 0, web = 0, known = 0, total = 0;
      for (const { face, text } of runs) {
        const m = models[face];
        for (const ch of text) {
          if (ch === ' ' || /\p{M}/u.test(ch)) continue;
          total++;
          if (!m || m.adv[ch] == null) continue;
          known++;
          ref += m.adv[ch] * m.refPx;
          web += webAdv(m, ch);
        }
      }
      if (!total || known / total < 0.8 || !(web > 0)) return null;
      return clampN(ref / web, 0.55, 1.5);
    };
  }

  /**
   * Letter anchoring (edition-wide layout rule, iteration 3; no per-page data).
   * Measured on the reference PDFs: a printed word's width equals the sum of
   * its letters' reference advances (typeface advEm × size; mean error
   * 0.02–0.07 pt) and the word gaps inside a justified line are uniform
   * (within-line s.d. ≈ 0.05 pt). So every letter that has a reference
   * advance is given it: its web-font advance (canvas-measured once per
   * face/letter; kerning and ligatures are off) is corrected by its own
   * pair of side margins (half each side, so the glyph is centred in its
   * reference advance), and the line's uniform word-spacing fit then puts
   * every word — and every letter in it — at its printed x. Glyphs are never
   * scaled (a scaleX transform rasterises small text measurably worse) and a
   * per-word mean correction registers worse than a per-letter one
   * (iteration-3 sweep, harness/out/iter3-sweep/results.jsonl). One span per
   * corrected letter cluster (base + marks) inside one .vw span per word.
   * Characters without a reference advance keep their web advance. Text
   * stays live and selectable; the spaces remain text nodes.
   * Returns the number of anchored words.
   */
  function anchorWords(sheet, faces, edition, pxPerPt) {
    const ctx = document.createElement('canvas').getContext('2d');
    const models = faces.map(f => {
      const tf = edition && edition.typefaces && edition.typefaces[f.tid];
      if (!tf || !tf.advEm || !Object.keys(tf.advEm).length) return null;
      // letters (/Widths registry) + in-word punctuation/digits (derived from the print, punctAdvEm)
      const adv = Object.assign({}, tf.punctAdvEm || {}, tf.advEm);
      return { adv, refPx: f.size * pxPerPt, font: `${f.wf.wght} ${f.size * f.wf.sizeScale * pxPerPt}px "${f.wf.family}"`, web: new Map() };
    });
    const webW = (m, c) => {
      if (!m.web.has(c)) { ctx.font = m.font; m.web.set(c, ctx.measureText(c).width); }
      return m.web.get(c);
    };
    const faceOf = e => { const m = /(?:^|\s)f(\d+)(?:\s|$)/.exec(e.className); return m ? +m[1] : -1; };
    const half = d => `calc(var(--pt) * ${(d / 2 / pxPerPt).toFixed(4)})`;
    let count = 0;
    for (const vr of sheet.querySelectorAll('.vl .vr')) {
      const m = models[faceOf(vr)];
      if (!m) continue;
      const tw = document.createTreeWalker(vr, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.parentElement.closest('.vr') === vr) nodes.push(n);
      for (const tn of nodes) {
        const parts = tn.data.split(/( +)/);
        let frag = null, here = 0;
        for (const p of parts) {
          if (!p) continue;
          const cl = p[0] === ' ' ? null : p.match(/\P{M}\p{M}*|\p{M}+/gu);
          const deltas = cl && cl.map(c => (m.adv[c[0]] != null ? m.adv[c[0]] * m.refPx - webW(m, c) : null));
          if (!deltas || !deltas.some(d => d != null)) {
            (frag || (frag = document.createDocumentFragment())).appendChild(document.createTextNode(p));
            continue;
          }
          frag = frag || document.createDocumentFragment();
          const w = document.createElement('span');
          w.className = 'vw';
          cl.forEach((c, i) => {
            if (deltas[i] == null || Math.abs(deltas[i]) < 0.005) { w.appendChild(document.createTextNode(c)); return; }
            // the correction is split to both sides so the glyph sits centred in
            // its reference advance, as the print's glyph does in its own
            const g = document.createElement('span');
            g.textContent = c;
            g.style.marginLeft = g.style.marginRight = half(deltas[i]);
            g._vd = deltas[i];
            w.appendChild(g);
          });
          frag.appendChild(w);
          here++;
        }
        if (here) { tn.parentNode.replaceChild(frag, tn); count += here; }
      }
    }
    // A web glyph wider than its reference advance (negative correction) would
    // stick out of the printed line extent by half the difference at the line's
    // two ends; there the whole correction goes to the inner side, so every
    // glyph box stays inside the printed x-extent.
    const sp = e => e && e.nodeType === 1 && e._vd != null && e._vd < 0;
    // Each positioned-apart run (.vr-abs) has its own printed extent and is
    // fitted to it on its own, so its two ends get the same rule (iteration 5:
    // they did not, and their outer letters stuck out — Bava_Kamma/70a).
    const ends = ws => {
      if (!ws.length) return;
      const first = ws[0].firstChild, last = ws[ws.length - 1].lastChild;
      if (sp(first)) { first.style.marginRight = '0px'; first.style.marginLeft = half(2 * first._vd); }
      if (sp(last) && last !== first) { last.style.marginLeft = '0px'; last.style.marginRight = half(2 * last._vd); }
    };
    for (const vl of sheet.querySelectorAll('.vl')) {
      ends(vl.querySelectorAll(':scope > .vr:not(.vr-abs) .vw'));
      for (const ab of vl.querySelectorAll(':scope > .vr-abs')) ends(ab.querySelectorAll('.vw'));
    }
    return count;
  }

  /**
   * Explicit measured justification of every strict line (and baseline
   * registration via the line's probe). Batched read/write passes:
   *   1. word-spacing alone, when it fits the bounds;
   *   2. else, when the edition's advance tables cover the line, the glyphs
   *      are condensed by the measured letter-advance ratio (scaleX) and the
   *      word gaps fitted with word-spacing (so word positions follow the
   *      print, not a uniform squeeze);
   *   3. else bounded letter-spacing;
   *   4. any residual > 0.3px → scaleX (last resort).
   * All lengths are emitted in pt (calc(var(--pt) * N)).
   */
  function fitStrictLines(sheet, pxPerPt, advanceK, anchoredLen, translated = false) {
    // translated (layer/2 sheet): word gaps only, within the bounds; a line that cannot be filled that way
    // keeps its natural width from its start (ragged last lines, single words). No letter-spacing and no
    // glyph scaling, so the printed letters are the bundled face at the printed size.
    const sheetR = sheet.getBoundingClientRect();
    const lines = [...sheet.querySelectorAll('.vl')];
    const faceOf = e => { const m = /(?:^|\s)f(\d+)(?:\s|$)/.exec(e.className); return m ? +m[1] : 0; };
    const flowWidth = vl => {
      let l = Infinity, r = -Infinity;
      for (const c of vl.children) {
        if (!c.classList.contains('vr') || c.classList.contains('vr-abs')) continue;
        const b = c.getBoundingClientRect();
        if (!b.width) continue;
        l = Math.min(l, b.left); r = Math.max(r, b.right);
      }
      return r > l ? r - l : 0;
    };
    // Fit units: the line's flow, or (for lines with positioned-apart runs)
    // each such run on its own; the flow then keeps its natural width.
    const units = [];
    for (const vl of lines) {
      const abs = [...vl.querySelectorAll(':scope > .vr-abs')];
      const fs = parseFloat(getComputedStyle(vl).fontSize) || 10;
      if (!abs.length) {
        const vrs = [...vl.children].filter(c => c.classList.contains('vr'));
        units.push({
          box: vl, target: (+vl.dataset.x1 - +vl.dataset.x0) * pxPerPt, fs,
          text: vrs.map(c => c.textContent).join(''),
          runs: vrs.map(c => ({ face: faceOf(c), text: c.textContent })),
          measure: () => flowWidth(vl),
        });
      } else {
        vl.dataset.fit = 'none';
        for (const vr of abs) {
          units.push({
            box: vr, target: (+vr.dataset.x1 - +vr.dataset.x0) * pxPerPt, text: vr.textContent, fs,
            runs: [{ face: faceOf(vr), text: vr.textContent }],
            measure: () => {
              const rg = document.createRange(); rg.selectNodeContents(vr);
              return rg.getBoundingClientRect().width;
            },
          });
        }
      }
    }
    for (const o of sheet.querySelectorAll('.vorn-text')) {
      units.push({
        box: o, target: o.parentElement.getBoundingClientRect().width * 0.94, text: o.textContent, runs: [],
        fs: parseFloat(getComputedStyle(o).fontSize) || 10, measure: () => o.getBoundingClientRect().width, shrinkOnly: true,
      });
    }
    const setSpacing = u => {
      u.box.style.wordSpacing = u.ws ? `calc(var(--pt) * ${(u.ws / pxPerPt).toFixed(4)})` : '';
      u.box.style.letterSpacing = u.ls ? `calc(var(--pt) * ${(u.ls / pxPerPt).toFixed(4)})` : '';
    };

    // Pass 1 (read): baselines + natural widths (no transforms applied yet).
    const probeY = lines.map(vl => vl.firstChild.getBoundingClientRect().top - sheetR.top);
    for (const u of units) {
      u.n0 = u.measure();
      u.spaces = (u.text.match(/ /g) || []).length;
      if (anchoredLen) {
        let a = 0;
        for (const w of u.box.querySelectorAll('.vw')) a += w.textContent.length;
        u.anchored = a > 0 && a >= 0.8 * (u.text.length - u.spaces);
      }
      u.chars = graphemeCount(u.text);
    }
    // Pass 2 (write): baseline registration + planned fit.
    applyBaselines(lines, probeY, pxPerPt);
    for (const u of units) {
      u.ws = 0; u.ls = 0; u.sx = 1; u.k = null; u.mode = 'none';
      if (!u.n0 || u.target <= 0) continue;
      const d = u.target - u.n0;
      if (u.shrinkOnly) { if (d < 0) u.mode = 'sx'; continue; }
      if (Math.abs(d) < FIT.tolPx) continue;
      if (u.anchored && u.spaces) {
        // Words already sit at their reference widths and the print's gaps are
        // uniform, so the whole difference is word gap — whatever its size.
        u.ws = d / u.spaces; u.mode = 'ws'; u.wide = true;
        setSpacing(u);
        continue;
      }
      const wsMin = FIT.wsMin * u.fs, wsMax = FIT.wsMax * u.fs;
      const ws0 = u.spaces ? d / u.spaces : NaN;
      if (translated) {
        // Word gaps may tighten by up to 0.12 em (the key letters inserted in a line add width to it).
        const lo = d < 0 ? -0.12 * u.fs : wsMin;
        if (u.spaces && ws0 >= lo && ws0 <= wsMax) { u.ws = ws0; u.mode = 'ws'; setSpacing(u); continue; }
        // Full justification (spec §10.4b): a line the layout set to its band's full width (every line but the
        // last of a paragraph) fills it, however few its words. Hangul text spreads the extra space over its
        // letters as well as its word gaps (letter gap : word gap = 1 : 2, letter gap at most 0.15 em); other
        // scripts open the word gaps only. A one-word line of a non-Hangul script keeps its natural width.
        if (d > 0) {
          const n = Math.max(1, u.chars - u.spaces);
          if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(u.text)) {
            u.ls = Math.min(0.15 * u.fs, d / (n + 2 * u.spaces));
            u.ws = u.spaces ? (d - u.ls * n) / u.spaces : 0;
            if (!u.spaces) u.ls = Math.min(0.15 * u.fs, d / n);
          } else if (u.spaces) u.ws = ws0;
          else continue;
          u.mode = 'tj'; u.wide = true;
          setSpacing(u);
        }
        continue;
      }
      if (u.spaces && ws0 >= wsMin && ws0 <= wsMax) { u.ws = ws0; u.mode = 'ws'; }
      else if (u.spaces && ws0 > wsMax) {
        // Sparse printed line (keys/parts set far apart): open the word gaps
        // instead of stretching glyphs. Flagged for the typography report.
        u.ws = ws0; u.mode = 'ws'; u.wide = true;
      }
      else if (advanceK && (u.k = advanceK(u.runs)) != null) {
        // condense glyphs by k; word gaps take the rest (in unscaled px)
        u.mode = 'sx';
        if (u.spaces) u.ws = clampN((u.target / u.k - u.n0) / u.spaces, wsMin, wsMax);
      } else {
        u.mode = 'ls';
        u.ws = u.spaces ? clampN(ws0, wsMin, wsMax) : 0;
        u.lsTrial = (d - u.ws * u.spaces) / Math.max(1, u.chars) || 0.01;
        u.ls = u.lsTrial;
      }
      setSpacing(u);
    }
    // Pass 3 (read, still unscaled) → refine word/letter spacing.
    for (const u of units) if (u.mode === 'ws' || u.mode === 'ls' || u.mode === 'tj') u.n1 = u.measure();
    for (const u of units) {
      if (u.mode === 'tj') {
        const r = u.target - u.n1;
        if (u.spaces) u.ws += r / u.spaces;
        else u.ls = Math.min(0.15 * u.fs, u.ls + r / Math.max(1, u.chars));
      } else if (u.mode === 'ws') {
        const ws = u.ws + (u.target - u.n1) / u.spaces;
        if (u.wide || (ws >= FIT.wsMin * u.fs && ws <= FIT.wsMax * u.fs)) u.ws = ws;
      } else if (u.mode === 'ls') {
        let k = (u.n1 - (u.n0 + u.ws * u.spaces)) / u.lsTrial;
        if (!(k > 0.5)) k = Math.max(1, u.chars);
        u.ls = clampN((u.target - u.n0 - u.ws * u.spaces) / k, FIT.lsMin * u.fs, FIT.lsMax * u.fs);
      } else continue;
      setSpacing(u);
    }
    // Pass 4 (read, unscaled) → exact horizontal scale for any residual.
    for (const u of units) u.n2 = u.mode === 'none' ? u.n0 : u.measure();
    for (const u of units) {
      if (!u.n2 || u.target <= 0) continue;
      const r = u.target - u.n2;
      if (u.shrinkOnly ? r < 0 : (!translated && u.mode !== 'none' && Math.abs(r) > FIT.sxTolPx)) {
        u.sx = u.target / u.n2;
        u.mode = 'sx';
        u.box.style.transform = `scaleX(${u.sx.toFixed(5)})`;
      }
      const b = u.box.dataset;
      b.fit = u.mode;
      b.nat = u.target > 0 ? (u.n0 / u.target).toFixed(4) : '';
      b.ws = (u.ws / pxPerPt).toFixed(4);
      b.ls = (u.ls / pxPerPt).toFixed(4);
      b.sx = u.sx.toFixed(5);
      if (u.k != null) b.k = u.k.toFixed(4);
      if (u.wide) b.wide = '1';
    }
    const counts = { none: 0, ws: 0, ls: 0, sx: 0 };
    for (const u of units) if (!u.shrinkOnly) counts[u.mode] = (counts[u.mode] || 0) + 1;
    return counts;
  }

  /** Apparatus check counts of a render result (null where the page has no layout apparatus). */
  function apparatusChecksOf(out) {
    if (!out || out.apparatusUnplaced === undefined || out.apparatusUnplaced === null) return null;
    const o = { unplaced: out.apparatusUnplaced, duplicated: out.apparatusDuplicated, offSheet: out.apparatusOffSheet,
      overlap: out.apparatusOverlap, ornamentCross: out.apparatusOrnamentCross };
    if (out.marginTextUnplaced != null) { o.marginTextUnplaced = out.marginTextUnplaced; o.marginTextDuplicated = out.marginTextDuplicated; }
    return o;
  }

  async function renderStrict(container, rawModel, pp, edition, env) {
    // env.multi: one sheet of a translated layer/2 page (renderStrictSheets); absent for every other page.
    const ms = env.multi || null;
    if (!ms || ms.j === 0) { container.innerHTML = ''; container.dir = 'rtl'; }
    const pw = +pp.page.w, ph = +pp.page.h;
    const side = pp.side || rawModel.side || 'a';
    const sheet = el('div', `page-sheet policy-strict side-${side}${ms ? ' tsheet' : ''}${ms && ms.dir === 'ltr' ? ' tsheet-ltr' : ''}`);
    sheet.dataset.policy = 'strict-vilna';
    sheet.dataset.fallback = env.pol.fallback;
    sheet.dataset.sheet = String(ms ? ms.j : 0);
    if (ms) { sheet.dataset.sheets = String(ms.N); sheet.dir = ms.dir; }
    sheet.setAttribute('lang', ms ? ms.lang : 'he');
    sheet.style.setProperty('--pw', String(pw));
    sheet.style.setProperty('--ph', String(ph));
    container.appendChild(sheet);
    if (env.opts.sheetWidth) { sheet.style.width = `${env.opts.sheetWidth}px`; sheet.style.maxWidth = 'none'; }
    // Exact requested width when given (layout snaps box sizes to 1/64 px;
    // --pt must not inherit that rounding), else the CSS width, frozen.
    const W = env.opts.sheetWidth || sheet.getBoundingClientRect().width;
    sheet.style.width = `${W}px`;
    sheet.style.maxWidth = 'none';
    const pxPerPt = W / pw;
    sheet.style.setProperty('--pt', `${pxPerPt}px`);

    // Faces → classes .f<i> (font, weight, size; baseline shift on runs).
    // baselineShiftBySize: edition-wide residual vertical correction per
    // (typeface, printed pt size), measured by the per-run raster audit
    // (iteration 5) — the same face set at different sizes sits differently.
    const faces = (pp.faces || []).map(([tid, size]) => {
      const wf = ms ? translationFace(tid) : webFontFor(edition, tid);
      const by = wf.fitted && edition && edition.webFonts && edition.webFonts[tid] && edition.webFonts[tid].baselineShiftBySize;
      const ex = by ? Number(by[(+size).toFixed(2)]) : NaN;
      return { tid, size: +size, wf: Number.isFinite(ex) && ex ? Object.assign({}, wf, { shiftEm: wf.shiftEm + ex }) : wf };
    });
    const css = faces.map((f, i) =>
      `.page-sheet.policy-strict .f${i}{font-family:${f.wf.css};font-weight:${f.wf.wght};` +
      `font-size:calc(var(--pt) * ${(f.size * f.wf.sizeScale).toFixed(4)});}` +
      `.page-sheet.policy-strict .vr.f${i}{--vsh:${(-f.wf.shiftEm).toFixed(4)}em;--hsh:${f.wf.shiftXEm.toFixed(4)}em;}`).join('\n') +
      `\n.page-sheet.policy-strict .vapp{position:absolute;margin:0;overflow:visible;direction:rtl;text-align:right;line-height:1.3;}` +
      `\n.page-sheet.policy-strict .vapp .marg-note{display:block;margin-bottom:1px;}` +
      `\n.page-sheet.policy-strict .vapp .marg-note-cont,.page-sheet.policy-strict .vapp .marg-tnote{display:block;margin-bottom:1px;}` +
      `\n.page-sheet.policy-strict .vapp-stack,.page-sheet.policy-strict .acont-block{overflow-wrap:anywhere;}` +
      `\n.page-sheet.policy-strict .vapp-stack .marg-title{border-bottom:none;margin-bottom:0;}` +
      // Tall faces (Hangul) draw a content box taller than the 1.3 line: 1 pt between notes, 1.5 pt under a title.
      `\n.page-sheet.policy-strict .vapp-stack .vapp-title,.page-sheet.policy-strict .acont-block .vapp-title{margin-bottom:calc(var(--pt) * 1.5);}` +
      `\n.page-sheet.policy-strict .vapp-stack .vapp-body>*{margin-bottom:calc(var(--pt) * 1);}`;
    const style = el('style');
    style.textContent = css;
    sheet.appendChild(style);

    const core = el('div', 'core vcore');
    core.id = ms ? `daf-core-${ms.j}` : 'daf-core';
    sheet.appendChild(core);

    const usedIds = new Set();
    const flowSlots = [];
    const isLayout = !!env.layoutPage;
    const flowKeys = isLayout || pp.regions.some(r => r.flow) ? buildKeyIndex(rawModel) : null;
    // A translated sheet shows only the apparatus entries whose anchor segment it holds (renderStrictSheets).
    if (ms && flowKeys) for (const b of Object.keys(flowKeys)) flowKeys[b].entries = flowKeys[b].entries.filter(e => ms.keep(b, e));
    // Margin stacks (spec §9.12) replace the fixed apparatus slots on a layout page: on a Hebrew page when any
    // apparatus block has entries (pd mode shows none, so a pd page is unchanged), on every translated sheet.
    const plan = isLayout && flowKeys ? pp.marginPlan || null : null;
    const stackOn = !!plan && (ms ? true : APP_BLOCKS.some(b => flowKeys[b] && flowKeys[b].entries.length));
    for (const r of pp.regions) {
      const reg = el('div', 'vregion');
      reg.dataset.vregion = String(r.id);
      applySrcAttrs(reg, rawModel, srcBlockOf(String(r.id)));
      reg.dataset.part = String(r.part || 0);
      if (r.kind) reg.dataset.kind = String(r.kind);
      if (r.side) reg.dataset.side = String(r.side);
      if (r.rights) reg.dataset.rights = String(r.rights);
      reg.classList.add(`f${r.face != null ? r.face : 0}`);
      const blockId = REGION_BLOCK_ID[r.id];
      if (blockId && !usedIds.has(blockId)) { reg.id = blockId; usedIds.add(blockId); }
      const layer = REGION_LAYER[r.id] || null;
      const lookup = env.applySegs && layer ? segLookup(r.segs) : null;
      const ws = { idx: -1, inWord: false, cur: null };
      (r.lines || []).forEach((ln, i) => {
        if (Array.isArray(ln)) reg.appendChild(buildStrictLine(ln, i, r, lookup, layer, ws));
      });
      if (r.flow && flowKeys && !stackOn) {
        const blk = buildFlowBlock(r, flowKeys, ms);
        if (blk) { reg.appendChild(blk); flowSlots.push({ div: blk, r }); }
      }
      sheet.appendChild(reg);
    }
    // The printed dividers of a margin column belong to the fixed slots: the stack draws its own (spec §9.12).
    const inCol = o => o && o.k === 'glyph-rule' && Array.isArray(o.b) &&
      Object.values(plan.cols).some(c => Math.min(+o.b[2], c.x1) - Math.max(+o.b[0], c.x0) > 1);
    for (const o of pp.ornaments || []) if (!(stackOn && inCol(o))) sheet.appendChild(buildOrnament(o));
    if (ms) addTranslatedSheetMarks(sheet, pp, ms);
    if (ms && flowKeys) insertTranslatedKeys(sheet, pp, flowKeys, faces);

    await Promise.all(faces.map(f => ensureWebFont(f.wf)));
    await document.fonts.ready;
    let lowestPt = 0;
    for (const rg of pp.regions) {
      const bls = (Array.isArray(rg.lines) ? rg.lines : []).filter(Array.isArray).map(l => +l[0]);
      if (!bls.length) continue;
      const f = faces[rg.face != null ? rg.face : 0];
      lowestPt = Math.max(lowestPt, Math.max(...bls) + 0.25 * (f ? f.size : 0));
    }
    const anchored = anchorWords(sheet, faces, edition, pxPerPt);
    // Lines made of anchored words are fitted by word gap alone (fitStrictLines);
    // the advance model (k) only serves lines that could not be anchored.
    const fitCounts = fitStrictLines(sheet, pxPerPt, makeAdvanceModel(faces, edition, pxPerPt), anchored, !!ms);
    fitCounts.anchoredWords = anchored;
    // A translated sheet keeps every line at its layer baseline: the whole-pixel paint snap (up to 0.5 px) would
    // undo the ink clearance the layout leaves between lines (T2d item 3).
    fitCounts.snapCompensated = ms ? 0 : compensateBaselineSnap(sheet);
    // Apparatus slots are fitted last, against the final printed line geometry. The entries of a block
    // are one chain over its slots in reading order: the first slot takes them, the next takes the
    // overflow, and what is left goes to the continuation sheet (spec §9.8).
    if (stackOn) {
      const st = await renderMarginStack(sheet, pp, plan, flowKeys, faces, pxPerPt, lowestPt, ms);
      let moved = st.moved;
      if (ms && !ms.last) moved = [];
      const apparatusConts = moved.length
        ? buildApparatusContinuation(sheet, moved, faces, container, env,
          { unslotted: [], face: 0, titleFace: 0, pw, ppt: pxPerPt, sheetHPt: sheet.getBoundingClientRect().height / pxPerPt,
            dir: ms ? ms.dir : 'rtl', lang: ms ? ms.lang : 'he', contLabel: ms ? ` ${ms.titles.cont}` : null,
            fontVars: ms ? { '--font-gemara': tsFamily(ms.lang, 'gem'), '--font-rashi': tsFamily(ms.lang, 'comm') } : null,
            cols: (ms && ms.dir === 'ltr' ? [0, 1] : [1, 0]).map(i => (i === 0 ? { x0: TSHEET.X0F, x1: pw / 2 - 8 } : { x0: pw / 2 + 8, x1: pw - TSHEET.X0F })) })
        : [];
      const chk = !ms ? apparatusDiagnostics(sheet, apparatusConts, flowKeys) : null;
      return { sheets: [sheet, ...apparatusConts], pxPerPt, fitCounts, apparatusFit: st.diag,
        apparatusUnplaced: chk ? chk.unplaced : null, apparatusDuplicated: chk ? chk.duplicated : null,
        apparatusOffSheet: chk ? chk.offSheet : null, apparatusOverlap: chk ? chk.overlap : null,
        apparatusOrnamentCross: chk ? chk.ornamentCross : null, marginStack: true };
    }
    const nodesByBlock = {};
    if (isLayout && flowKeys) for (const b of APP_BLOCKS) nodesByBlock[b] = apparatusNodes(b, flowKeys[b] ? flowKeys[b].entries : []);
    const fitRes = fitApparatusSlots(sheet, flowSlots, faces, pxPerPt, lowestPt, nodesByBlock);
    const apparatusFit = fitRes.diag;
    // Blocks with entries but no flow slot in the layout (spec §9.4 gap): all entries go to the continuation.
    const placedKeys = new Set(flowSlots.map(x => apparatusKeyOf(x.r.flow)));
    const unslotted = isLayout && flowKeys
      ? APP_BLOCKS.filter(b => flowKeys[b] && flowKeys[b].entries.length && !placedKeys.has(b)).map(block => ({ block, nodes: apparatusNodes(block, flowKeys[block].entries) }))
      : [];
    const ref0 = flowSlots.length ? flowSlots[0].r : null;
    // Translated page: only the last sheet builds the continuation; earlier sheets carry their leftovers on.
    let movedHere = fitRes.moved, unslottedHere = unslotted;
    if (ms && !ms.last) { ms.carryMoved.push(...fitRes.moved); ms.carryUnslotted.push(...unslotted); movedHere = []; unslottedHere = []; }
    else if (ms) { movedHere = [...ms.carryMoved, ...fitRes.moved]; unslottedHere = [...ms.carryUnslotted, ...unslotted]; }
    const apparatusConts = movedHere.length || unslottedHere.length
      ? buildApparatusContinuation(sheet, movedHere, faces, container, env,
        { unslotted: unslottedHere, face: ref0 && ref0.face != null ? ref0.face : 0, titleFace: ref0 && ref0.titleFace != null ? ref0.titleFace : 0,
          pw, ppt: pxPerPt, sheetHPt: sheet.getBoundingClientRect().height / pxPerPt })
      : [];
    // Nothing silently dropped, duplicated, off the sheet or over ink: counted per page (all must be 0).
    // A translated page is counted over all its sheets by renderStrictSheets instead.
    const apparatusCheck = isLayout && flowKeys && !ms ? apparatusDiagnostics(sheet, apparatusConts, flowKeys) : null;
    const apparatusUnplaced = apparatusCheck ? apparatusCheck.unplaced : null;
    const apparatusDuplicated = apparatusCheck ? apparatusCheck.duplicated : null;
    const apparatusOffSheet = apparatusCheck ? apparatusCheck.offSheet : null;
    const apparatusOverlap = apparatusCheck ? apparatusCheck.overlap : null;
    const apparatusOrnamentCross = apparatusCheck ? apparatusCheck.ornamentCross : null;
    return { sheets: [sheet, ...apparatusConts], pxPerPt, fitCounts, apparatusFit, apparatusUnplaced,
      apparatusDuplicated, apparatusOffSheet, apparatusOverlap, apparatusOrnamentCross };
  }

  /**
   * Engine labels of a translated sheet (spec §10.6): the sheet marker "<Tractate> <daf> · j/N" and, on
   * each commentary column that starts here, its title, or "(cont.)" when the column continues.
   */
  function addTranslatedSheetMarks(sheet, pp, ms) {
    const head = el('div', 'tsheet-head f0');
    head.textContent = `${pp.tractateKey} ${pp.daf}${pp.side} · ${ms.j + 1}/${ms.N}`;
    head.style.left = 'calc(var(--pt) * 58)';
    head.style.top = 'calc(var(--pt) * 14)';
    head.style.fontSize = 'calc(var(--pt) * 7)';
    sheet.appendChild(head);
    for (const id of ['inner', 'outer']) {
      const rg = (pp.regions || []).find(r => r && r.id === id && Array.isArray(r.lines) && r.lines.some(Array.isArray));
      if (!rg) continue;
      const x0 = Math.min(...rg.lines.filter(Array.isArray).map(l => +l[1]));
      const stream = id === 'inner' ? 'rashi' : 'tosafot';
      const t = el('div', `tsheet-title f${rg.face != null ? rg.face : 1}`);
      t.textContent = pp.carryIn && pp.carryIn[stream] ? ms.titles.cont : ms.titles[stream];
      t.style.left = `calc(var(--pt) * ${x0.toFixed(3)})`;
      t.style.top = 'calc(var(--pt) * 30)';
      t.style.fontSize = 'calc(var(--pt) * 6.5)';
      sheet.appendChild(t);
    }
  }

  /** Text position (text node, offset) of word k (whitespace-separated) of a rendered line, or null. */
  function lineWordStart(vl, k) {
    const tw = document.createTreeWalker(vl, NodeFilter.SHOW_TEXT);
    const nodes = []; let text = '';
    while (tw.nextNode()) { nodes.push({ n: tw.currentNode, s: text.length }); text += tw.currentNode.data; }
    const re = /\S+/g; let m, c = 0;
    while ((m = re.exec(text))) {
      if (c === k) {
        const a = m.index;
        const hit = nodes.filter(x => x.s <= a && a < x.s + x.n.data.length).pop();
        return hit ? { node: hit.n, offset: a - hit.s } : null;
      }
      c++;
    }
    return null;
  }

  /**
   * Key letters of a translated sheet (T2e rule): each apparatus entry shows the amud-global letter of its anchor
   * Gemara segment as a `.ref-key` (data-target = the note id, data-seg = the segment), placed inline before the
   * first word of that segment on the sheet that starts it. Keys of one word stand side by side. Inserted before
   * the lines are fitted, so the fit absorbs their width in the word gaps (no overlap with other lines).
   */
  function insertTranslatedKeys(sheet, pp, flowKeys, faces) {
    const gemR = (pp.regions || []).find(r => r && r.id === 'gemara' && Array.isArray(r.segStarts));
    if (!gemR) return 0;
    const reg = sheet.querySelector('.vregion[data-vregion="gemara"]');
    if (!reg) return 0;
    const vls = [...reg.querySelectorAll(':scope > .vl')];
    const f = faces[gemR.face != null ? gemR.face : 0];
    const ks = (f ? f.size * f.wf.sizeScale : 8) * TSHEET.KEY_EM;
    const starts = new Map(gemR.segStarts.map(x => [x.seg, x]));
    const groups = new Map();   // line|word -> [keys]
    for (const b of Object.keys(flowKeys)) for (const e of flowKeys[b].entries) {
      const st = starts.get(e.segNum);
      if (!st) continue;
      const g = `${st.line}|${st.word}`;
      if (!groups.has(g)) groups.set(g, { line: st.line, word: st.word, keys: [] });
      groups.get(g).keys.push(e);
    }
    let placed = 0;
    const placedKeysOf = [];
    for (const g of groups.values()) {
      const vl = vls[g.line];
      const pos = vl && lineWordStart(vl, g.word);
      if (!pos) continue;
      let ref = pos.node;
      if (pos.offset > 0) ref = pos.node.splitText(pos.offset);
      for (const e of g.keys) {
        const key = document.createElement('span');
        key.className = `ref-key ${e.cls || ''}`;
        key.dataset.target = e.id;
        key.dataset.seg = String(e.segNum);
        key.textContent = e.letter;
        // A key is its own inline box with its real width and a small gap, so it takes room in the word space
        // before its word: the fit absorbs that width in the gaps (no overlap, no change of the line's width).
        key.style.fontSize = `calc(var(--pt) * ${ks.toFixed(4)})`;
        // The box is exactly the width the layout reserved (TSHEET.KEY_EM × size); the letter is centred in it.
        key.style.display = 'inline-block';
        key.style.width = `calc(var(--pt) * ${ks.toFixed(4)})`;
        key.style.textAlign = 'center';
        key.style.overflow = 'visible';
        key.style.position = 'relative';
        key.style.verticalAlign = 'baseline';
        key.style.top = `calc(var(--pt) * ${(-0.35 * ks).toFixed(4)})`;
        key.style.lineHeight = '1';
        key.style.whiteSpace = 'pre';
        ref.parentNode.insertBefore(key, ref);
        // Separate keys of one word: a space-like gap (the same box, not a text run of letters).
        placedKeysOf.push(key);
        placed++;
      }
    }
    return placed;
  }

  /**
   * A translated layer/2 page (spec §10.6): each sheet is drawn as a strict page into the same container,
   * in order. An apparatus entry goes to the sheet that shows its anchor segment (the first such sheet;
   * the last sheet when none does); what does not fit goes to the continuation after the last sheet.
   * Each sheet is followed by the sources note listing every stream of the page.
   */
  async function renderStrictSheets(container, model, pages, edition, env) {
    const N = pages.length;
    const lang = env.lang || 'en';
    const T = TSHEET_I18N[lang] || TSHEET_I18N.en;
    const full = buildKeyIndex(model);
    const home = new Map();
    for (const b of APP_BLOCKS) {
      for (const e of (full[b] ? full[b].entries : [])) {
        const j = pages.findIndex(p => (p.gemaraSegs || []).includes(e.segNum));
        home.set(`${b}|${e.id}`, j < 0 ? N - 1 : j);
      }
    }
    const dir = isLtrLang(lang) ? 'ltr' : 'rtl';
    const carryMoved = [], carryUnslotted = [];
    // Margin stack (spec §9.12): one size for every apparatus and margin block of the page, max(k × the largest
    // Hebrew margin face, the margin minimum: 6.0 pt printed, yi 6.5), rounded up to 0.001 layout pt.
    const plan = pages[0].marginPlan || null;
    let mxFace = 0;
    if (plan) for (const c of Object.values(plan.cols)) for (const b of c.blocks) {
      const f = pages[0].faces && pages[0].faces[b.face];
      if (f) mxFace = Math.max(mxFace, Number(f[1]) || 0);
    }
    const minL = (TSHEET.MARGIN_MIN_PT + (lang === 'yi' ? 0.5 : 0)) / TSHEET.PRINT;
    const marginPt = Math.ceil(Math.max(mxFace, minL) * 1000 - 1e-6) / 1000;
    // Margin text (Gilyon HaShas, Rav Nissim Gaon): one note per source segment, flowed from sheet 1 on.
    const carry = {};
    let textTokens = 0;
    for (const [id, notes] of Object.entries(pages[0].marginText || {})) {
      if (!notes || !notes.length) continue;
      carry[id] = notes.map(n => {
        const sp = el('span', 'marg-tnote');
        sp.dataset.block = id;
        sp.dataset.seg = String(n.seg + 1);
        sp.textContent = n.text;
        textTokens += n.n;
        return sp;
      });
    }
    const sheets = [], fit = [];
    let pxPerPt = null;
    for (let j = 0; j < N; j++) {
      const ms = { j, N, lang, dir, titles: T, last: j === N - 1, carryMoved, carryUnslotted, carry, marginPt,
        keep: (b, e) => home.get(`${b}|${e.id}`) === j };
      const out = await renderStrict(container, model, pages[j], edition, Object.assign({}, env, { multi: ms }));
      pxPerPt = out.pxPerPt;
      sheets.push(...out.sheets);
      fit.push(...out.apparatusFit);
      if (env.note) {
        const shownB = plan ? Object.values(plan.cols).flatMap(c => c.blocks.map(b => b.id)) : pages.flatMap(p => flowBlocksOf(p));
        const blocks = [...new Set([...shownB, ...APP_BLOCKS])].filter(b => APP_BLOCKS.includes(b) && full[b] && full[b].entries.length);
        appendLayoutSourcesNote(container, env.note.used, [], env.note.model, apparatusEntriesFor(env.note.src, blocks, 'he'));
      }
    }
    // Every entry shown once over the whole page (the per-sheet check does not apply to a translated page).
    const total = APP_BLOCKS.reduce((n, b) => n + (full[b] ? full[b].entries.length : 0), 0);
    const shown = container.querySelectorAll('.marg-note').length;
    // Off-sheet, overlap and ornament checks on every sheet (continuation sheets included).
    let offSheet = 0, overlap = 0, ornamentCross = 0;
    for (const s of sheets) {
      const c = apparatusDiagnostics(s, [], null);
      offSheet += c.offSheet; overlap += c.overlap; ornamentCross += c.ornamentCross;
    }
    // Margin text: every token of the printed range shown exactly once (spec §9.12).
    let textShown = 0;
    for (const n of container.querySelectorAll('.marg-tnote')) textShown += (n.textContent.match(/\S+/g) || []).length;
    return { sheets, pxPerPt, fitCounts: null, apparatusFit: fit,
      apparatusUnplaced: Math.max(0, total - shown), apparatusDuplicated: Math.max(0, shown - total), apparatusOffSheet: offSheet,
      apparatusOverlap: overlap, apparatusOrnamentCross: ornamentCross,
      marginTextUnplaced: Math.max(0, textTokens - textShown), marginTextDuplicated: Math.max(0, textShown - textTokens) };
  }

  // ─── Margin stacks (spec §9.12) ───
  // A margin column runs the full core height; its blocks are set one below the other, each as its divider
  // (between consecutive blocks), heading and notes. Nothing has a fixed height: a divider sits where the block
  // above it ends. Printed lines, ornaments, the sheet labels and the catchword are obstacles.
  const STACK = { GAP: 2.5, DIV_W: 49, DIV_H: 4.5, PAD_X: 1, MIN_FREE: 6 };

  /** Splits note n (not in the DOM) so that its head fits fits(); returns {head, tail} or null. */
  function splitNoteToFit(n, body, fits, minHeadLines, lineH) {
    const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const cuts = [];   // word starts after the first word: {node, offset}
    let seen = false;
    while (tw.nextNode()) {
      const t = tw.currentNode, d = t.data;
      const re = /\S+/g; let m;
      while ((m = re.exec(d))) { if (seen) cuts.push({ node: t, offset: m.index }); seen = true; }
    }
    if (!cuts.length) return null;
    const part = (k, head) => {
      const rg = document.createRange();
      if (head) { rg.setStart(n, 0); rg.setEnd(cuts[k].node, cuts[k].offset); }
      else { rg.setStart(cuts[k].node, cuts[k].offset); rg.setEnd(n, n.childNodes.length); }
      const shell = n.cloneNode(false);
      shell.appendChild(rg.cloneContents());
      if (!head) {
        shell.removeAttribute('id');
        if (shell.classList.contains('marg-note')) { shell.classList.remove('marg-note'); shell.classList.add('marg-note-cont'); }
      }
      shell.dataset.split = '1';
      return shell;
    };
    // The largest head (in words) that fits; it must keep at least minHeadLines lines.
    let lo = 0, hi = cuts.length - 1, best = -1, bestEl = null, bestH = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const h = part(mid, true);
      body.appendChild(h);
      const ok = fits();
      const hh = h.getBoundingClientRect().height;
      h.remove();
      if (ok) { best = mid; bestEl = h; bestH = hh; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0 || bestH < minHeadLines * lineH - 0.5) return null;
    return { head: bestEl, tail: part(best, false) };
  }

  /**
   * Sets the margin stacks of one sheet (spec §9.12). items: {L?, R?: [{id, kind: 'flow'|'fixed', nodes, title,
   * titleFace, face, bodyPt, top, bottom}]}, in the column's block order. With opt.spill (the last sheet of a page),
   * what does not fit its own column goes on in the other margin column, below that column's own blocks, under
   * its heading with opt.contLabel. Returns {leftover: [{item, nodes, side, col}], diag}: notes that did not fit.
   */
  function stackMargins(sheet, plan, items, ppt, opt) {
    const sr = sheet.getBoundingClientRect();
    const toPt = (g) => ({ t: (g.top - sr.top) / ppt, b: (g.bottom - sr.top) / ppt, l: (g.left - sr.left) / ppt, r: (g.right - sr.left) / ppt });
    // Obstacles of the whole sheet, measured once: glyph boxes of printed lines, ornaments, sheet labels.
    const rng = document.createRange();
    const obst = [];
    for (const q of sheet.querySelectorAll('.vl')) {
      rng.selectNodeContents(q);
      for (const g of rng.getClientRects()) if (g.width > 0 && g.height > 0) obst.push(toPt(g));
    }
    for (const q of sheet.querySelectorAll('.vorn, .tsheet-head, .tsheet-title')) {
      const g = q.getBoundingClientRect();
      if (g.width > 0 || g.height > 0) obst.push(toPt(g));
    }
    const bottomPt = d => (d.getBoundingClientRect().bottom - sr.top) / ppt;
    const divider = (st, y) => {
      const dw = Math.min(STACK.DIV_W, st.W * 0.9);
      const dv = el('div', 'vorn vorn-glyph-rule vorn-stack');
      dv.dataset.k = 'glyph-rule';
      dv.setAttribute('aria-hidden', 'true');
      dv.style.left = `calc(var(--pt) * ${(st.x0 + (st.W - dw) / 2).toFixed(3)})`;
      dv.style.top = `calc(var(--pt) * ${y.toFixed(3)})`;
      dv.style.width = `calc(var(--pt) * ${dw.toFixed(3)})`;
      dv.style.height = `calc(var(--pt) * ${STACK.DIV_H})`;
      sheet.appendChild(dv);
      return dv;
    };
    // Column state: free stretches (between obstacles) and the cursor (stretch k, y).
    const state = {};
    for (const side of ['R', 'L']) {
      const col = plan.cols[side];
      if (!col) continue;
      const x0 = col.x0, x1 = col.x1;
      const top = col.top, bottom = opt.colBottom;
      const blocked = obst.filter(o => o.r > x0 - STACK.PAD_X && o.l < x1 + STACK.PAD_X && o.b > top && o.t < bottom)
        .map(o => [o.t - STACK.GAP, o.b + STACK.GAP]).sort((p, q) => p[0] - q[0]);
      const free = [];
      let cur = top;
      for (const [a, b] of blocked) { if (a > cur && a - cur >= STACK.MIN_FREE) free.push([cur, a]); cur = Math.max(cur, b); }
      if (bottom - cur >= STACK.MIN_FREE) free.push([cur, bottom]);
      state[side] = { side, col, x0, x1, W: x1 - x0, free, k: 0, y: free.length ? free[0][0] : bottom, above: false };
    }
    const goNext = st => { st.k++; if (st.k < st.free.length) st.y = st.free[st.k][0]; };
    // The cursor never moves up: a block that went on below a fixed block keeps its place above the next one.
    const seek = (st, yy) => {
      const y2 = Math.max(yy, st.y);
      while (st.k < st.free.length && st.free[st.k][1] <= y2 + 1e-6) st.k++;
      if (st.k < st.free.length) st.y = Math.max(y2, st.free[st.k][0]);
    };
    /** Places nodes of item it in column st from its cursor; returns the notes that did not fit. */
    const place = (st, it, nodes, title) => {
      let rest = nodes.slice(), first = true, dv = null, placedAny = 0, frags = 0;
      while (rest.length && st.k < st.free.length) {
        const iv = st.free[st.k];
        if (st.y < iv[0]) st.y = iv[0];
        if (st.above && !dv && first) {
          // The divider between this block and the one above it, where the block above ends.
          if (st.y + STACK.DIV_H > iv[1]) { goNext(st); continue; }
          dv = divider(st, st.y);
          st.y += STACK.DIV_H + STACK.GAP;
          if (st.y >= iv[1]) { goNext(st); continue; }
        }
        const d = el('div', `vapp vapp-stack f${it.face != null ? it.face : 0}`);
        d.dataset.flowBlock = it.id;
        d.dataset.side = st.side;
        d.style.left = `calc(var(--pt) * ${st.x0.toFixed(3)})`;
        d.style.top = `calc(var(--pt) * ${st.y.toFixed(3)})`;
        d.style.width = `calc(var(--pt) * ${st.W.toFixed(3)})`;
        d.style.direction = opt.dir;
        d.style.textAlign = 'justify';
        // A translated sheet's titles, keys and verses use the language's bundled stacks (not the Hebrew ones).
        if (opt.fontVars) for (const [k2, v] of Object.entries(opt.fontVars)) d.style.setProperty(k2, v);
        if (first) {
          const t = el('div', `vapp-title f${it.titleFace != null ? it.titleFace : 0}`);
          if (it.titlePt) t.style.fontSize = `calc(var(--pt) * ${it.titlePt.toFixed(4)})`;
          const sp = el('span', 'marg-title');
          sp.textContent = title;
          t.appendChild(sp);
          d.appendChild(t);
        }
        const body = el('div', 'vapp-body');
        body.style.fontSize = `calc(var(--pt) * ${it.bodyPt.toFixed(4)})`;
        d.appendChild(body);
        sheet.appendChild(d);
        const lineH = parseFloat(getComputedStyle(body).fontSize) * 1.3 || 8;
        if (bottomPt(d) > iv[1] + 1e-6) { d.remove(); goNext(st); continue; }   // the heading alone does not fit
        let placed = 0;
        while (rest.length) {
          const n = rest[0];
          body.appendChild(n);
          if (bottomPt(d) <= iv[1] + 1e-6) { rest.shift(); placed++; continue; }
          const h = n.getBoundingClientRect().height;
          n.remove();
          // A long note (3 lines or more), or margin text, is cut at a word: its head keeps >= 2 lines here
          // (margin text: 1), the rest goes on in the next free stretch.
          const text = n.classList.contains('marg-tnote');
          if (text || h >= 3 * lineH - 0.5) {
            const sp = splitNoteToFit(n, body, () => bottomPt(d) <= iv[1] + 1e-6, text ? 1 : 2, lineH);
            if (sp) { body.appendChild(sp.head); rest[0] = sp.tail; placed++; }
          }
          break;
        }
        if (!placed) { d.remove(); goNext(st); continue; }
        placedAny += placed; frags++;
        first = false;
        st.y = bottomPt(d) + STACK.GAP;
        if (rest.length) goNext(st);
      }
      if (!placedAny && dv) dv.remove();
      if (placedAny) st.above = true;
      return { rest, placed: placedAny, frags };
    };
    const leftover = [], diag = [];
    for (const side of ['R', 'L']) {
      const st = state[side], list = items[side] || [];
      if (!st) continue;
      for (const it of list) {
        if (it.kind === 'fixed') {
          // A printed block (Hebrew margin text lines): its lines are obstacles; the next block starts below it.
          // The divider above it sits where the block above ends, when there is room before the printed lines.
          if (st.above && st.k < st.free.length && st.y >= st.free[st.k][0] - 1e-6 &&
              st.y + STACK.DIV_H <= Math.min(st.free[st.k][1], it.top - STACK.GAP) + 1e-6) divider(st, st.y);
          seek(st, it.bottom + STACK.GAP);
          st.above = true;
          continue;
        }
        if (!it.nodes || !it.nodes.length) continue;
        const r = place(st, it, it.nodes, it.title);
        diag.push({ block: it.id, side, placed: r.placed, left: r.rest.length, frags: r.frags });
        if (r.rest.length) leftover.push({ item: it, nodes: r.rest, side, col: st.col });
      }
    }
    if (!opt.spill) return { leftover, diag };
    // Spill (last sheet): the other margin column takes what is left, below its own blocks.
    let still = [];
    for (const lo of leftover) {
      const other = state[lo.side === 'R' ? 'L' : 'R'];
      if (!other) { still.push(lo); continue; }
      const r = place(other, lo.item, lo.nodes, `${lo.item.baseTitle || lo.item.title}${opt.contLabel}`);
      diag.push({ block: lo.item.id, side: other.side, spill: true, placed: r.placed, left: r.rest.length, frags: r.frags });
      if (r.rest.length) still.push(Object.assign({}, lo, { nodes: r.rest }));
    }
    // Then the free core area under the last printed line of the sheet (a short last sheet), in columns of
    // about 120 pt between the margin columns, in reading order; only then the continuation sheet.
    if (still.length && state.L && state.R) {
      const ax0 = state.L.x1 + 2 * STACK.GAP, ax1 = state.R.x0 - 2 * STACK.GAP, bottom = opt.colBottom;
      const inArea = obst.filter(o => o.r > ax0 && o.l < ax1 && o.t < bottom);
      const top = (inArea.length ? Math.max(...inArea.map(o => o.b)) : state.L.col.top) + 3 * STACK.GAP;
      if (bottom - top >= 30 && ax1 - ax0 >= 60) {
        const n = Math.max(1, Math.floor((ax1 - ax0 + 3 * STACK.GAP) / (120 + 3 * STACK.GAP)));
        const w = (ax1 - ax0 - (n - 1) * 3 * STACK.GAP) / n;
        const area = [];
        for (let i = 0; i < n; i++) {
          const x0 = ax0 + i * (w + 3 * STACK.GAP);
          area.push({ side: 'B', col: { x0, x1: x0 + w, top }, x0, x1: x0 + w, W: w, free: [[top, bottom]], k: 0, y: top, above: false });
        }
        if (opt.dir === 'rtl') area.reverse();
        let ai = 0;
        const next = [];
        for (const lo of still) {
          let rest = lo.nodes;
          while (rest.length && ai < area.length) {
            const r = place(area[ai], lo.item, rest, `${lo.item.baseTitle || lo.item.title}${opt.contLabel}`);
            diag.push({ block: lo.item.id, side: 'B', spill: true, placed: r.placed, left: r.rest.length, frags: r.frags });
            rest = r.rest;
            if (rest.length) ai++;
          }
          if (rest.length) next.push(Object.assign({}, lo, { nodes: rest }));
        }
        still = next;
      }
    }
    return { leftover: still, diag };
  }

  /**
   * The margin stack of one sheet (spec §9.12): its items per column in the Hebrew block order, set by
   * stackMargins. Hebrew page: the apparatus blocks at their face size around the printed margin text (fixed);
   * leftovers go to the continuation. Translated sheet: every block (apparatus and margin text) at the one margin
   * size ms.marginPt; leftovers go on in the same column of the next sheet (ms.carry), after the last sheet to the
   * continuation. A block with entries that the Hebrew page does not print joins the column with fewer blocks.
   */
  async function renderMarginStack(sheet, pp, plan, flowKeys, faces, ppt, lowestPt, ms) {
    const items = {}, seen = new Set();
    const faceSize = fi => { const f = faces[fi != null ? fi : 0]; return f ? f.size * f.wf.sizeScale : 7; };
    const carry = ms ? ms.carry : null;
    const mkItem = (id, face, titleFace) => {
      if (ms) {
        const own = APP_BLOCKS.includes(id) && flowKeys[id] ? apparatusNodes(id, flowKeys[id].entries) : [];
        const car = carry[id] || [];
        delete carry[id];
        // carried from the previous sheet: the heading says "(cont.)"
        const contd = ms.j > 0 && car.length > 0;
        const tf = titleFace != null ? titleFace : face;
        const base = ms.titles[id] || APP_TITLE_HE[id] || id;
        return { id, kind: 'flow', nodes: [...car, ...own], face, titleFace: tf, bodyPt: ms.marginPt,
          titlePt: Math.max(ms.marginPt, Math.min(faceSize(tf), ms.marginPt * 1.3)),
          baseTitle: base, title: contd ? `${base} ${ms.titles.cont}` : base };
      }
      const ents = flowKeys[id] ? flowKeys[id].entries : [];
      return { id, kind: 'flow', nodes: ents.length ? apparatusNodes(id, ents) : [], face, titleFace,
        bodyPt: faceSize(face), baseTitle: APP_TITLE_HE[id] || id, title: APP_TITLE_HE[id] || id };
    };
    for (const side of ['R', 'L']) {
      const col = plan.cols[side];
      if (!col) continue;
      items[side] = [];
      for (const b of col.blocks) {
        if (seen.has(b.id)) continue;   // a block printed in two slots is set once, at its first slot
        seen.add(b.id);
        if (b.kind === 'text' && !ms) {
          // Hebrew margin text is printed lines: a fixed block of the column when it lies in it.
          if (Math.min(b.x1, col.x1) - Math.max(b.x0, col.x0) > 1) items[side].push({ id: b.id, kind: 'fixed', top: b.top, bottom: b.bottom });
          continue;
        }
        if (b.kind === 'flow' && !APP_BLOCKS.includes(b.id)) continue;
        items[side].push(mkItem(b.id, b.face, b.titleFace));
      }
    }
    // Blocks with entries (or carried text) but no slot on the Hebrew page.
    const sides = Object.keys(items);
    const extra = [...APP_BLOCKS.filter(b => !seen.has(b) && flowKeys[b] && flowKeys[b].entries.length),
      ...(ms ? Object.keys(carry).filter(id => !seen.has(id) && carry[id] && carry[id].length) : [])];
    for (const id of [...new Set(extra)]) {
      if (!sides.length) break;
      const side = sides.slice().sort((p, q) => items[p].length - items[q].length)[0];
      const ref = items[side].find(it => it.kind === 'flow') || plan.cols[side].blocks.find(b => b.kind === 'flow') || {};
      items[side].push(mkItem(id, ref.face != null ? ref.face : 0, ref.titleFace != null ? ref.titleFace : null));
      seen.add(id);
    }
    const colBottom = ms ? TSHEET.CORE_BOTTOM : Math.max(lowestPt, ...Object.values(plan.cols).flatMap(c => c.blocks.map(b => b.bottom)));
    const fontVars = ms ? { '--font-gemara': tsFamily(ms.lang, 'gem'), '--font-rashi': tsFamily(ms.lang, 'comm') } : null;
    // Every face the stack text needs is loaded before it is measured (a late face would reflow it).
    const sample = [...new Set(Object.values(items).flat().flatMap(it => [it.title || '', ...(it.nodes || []).map(n => n.textContent)])
      .join('').replace(/\s+/g, ''))].join('') || 'א';
    const stacksUsed = new Set(faces.map(f => f.wf.css));
    if (fontVars) { stacksUsed.add(fontVars['--font-gemara']); stacksUsed.add(fontVars['--font-rashi']); }
    for (const st of stacksUsed) { try { await document.fonts.load(`16px ${st}`, sample); } catch (e) { /* reported by the font check */ } }
    // A hidden probe with every item as it will be set (titles, keys, verses: bold and other faces load lazily,
    // on first layout) makes the browser load those faces now; a face loaded later would reflow measured notes.
    const probe = el('div', 'vapp vapp-stack');
    probe.style.cssText = 'visibility:hidden;left:0;top:0;width:200px;';
    if (fontVars) for (const [k2, v] of Object.entries(fontVars)) probe.style.setProperty(k2, v);
    for (const it of Object.values(items).flat()) {
      if (it.kind === 'fixed') continue;
      const t = el('div', `vapp-title f${it.titleFace != null ? it.titleFace : 0}`);
      const sp = el('span', 'marg-title'); sp.textContent = it.title; t.appendChild(sp); probe.appendChild(t);
      const body = el('div', 'vapp-body');
      body.style.fontSize = `calc(var(--pt) * ${it.bodyPt.toFixed(4)})`;
      for (const n of it.nodes || []) body.appendChild(n.cloneNode(true));
      probe.appendChild(body);
    }
    sheet.appendChild(probe);
    probe.getBoundingClientRect();
    await document.fonts.ready;
    probe.remove();
    const res = stackMargins(sheet, plan, items, ppt, { colBottom, dir: ms ? ms.dir : 'rtl', fontVars,
      spill: !ms || ms.last, contLabel: ms ? ` ${ms.titles.cont}` : ' (המשך)' });
    const moved = [];
    for (const lo of res.leftover) {
      if (ms && !ms.last) { carry[lo.item.id] = lo.nodes; continue; }
      moved.push({ block: lo.item.id, nodes: lo.nodes, title: lo.item.baseTitle, titlePt: lo.item.titlePt || null,
        bodyPt: lo.item.bodyPt, r: { box: [lo.col.x0, 0, lo.col.x1, 0], face: lo.item.face, titleFace: lo.item.titleFace } });
    }
    return { diag: res.diag, moved };
  }

  /** Apparatus flow slot (spec §9.4): the block heading and an empty body; fitApparatusSlots fills it. */
  function buildFlowBlock(r, keyIdx, ms) {
    const key = apparatusKeyOf(r.flow);
    const ents = (keyIdx[key] && keyIdx[key].entries) || [];
    if (!ents.length) return null; // a block with no links shows no block
    const div = el('div', `vapp f${r.face != null ? r.face : 0}`);
    div.dataset.flowBlock = key;
    const [x0, t, x1, b] = r.box;
    div.style.left = `calc(var(--pt) * ${x0})`;
    div.style.top = `calc(var(--pt) * ${t})`;
    div.style.width = `calc(var(--pt) * ${(x1 - x0).toFixed(3)})`;
    div.style.height = `calc(var(--pt) * ${(b - t).toFixed(3)})`;
    const title = (ms && ms.titles[key]) || APP_TITLE_HE[key] || key;
    div.innerHTML = `<div class="vapp-title f${r.titleFace != null ? r.titleFace : 0}"><span class="marg-title">${title}</span></div>` +
      `<div class="vapp-body"></div>`;
    return div;
  }

  /** The margin notes of one block as DOM nodes, one per entry, in entry order. */
  function apparatusNodes(block, entries) {
    const tmp = el('div');
    tmp.innerHTML = marginNotesHTML(entries, block === 'torahOr');
    return [...tmp.children];
  }

  /**
   * Fit each apparatus slot (spec §9.4). The entries of a block are one chain over its slots in reading
   * order (spec §9.8): a slot takes the entries waiting for it and fits at the printed size inside its box;
   * else it grows down to maxBottom, stopping at the first printed line or printed ornament below it
   * (spec §9.7); else the font scales down to 0.75. Entries that still do not fit wait for the next slot
   * of the chain or, from the last slot, go to the continuation sheet (`moved`).
   */
  function fitApparatusSlots(sheet, slots, faces, ppt, lowestPt, nodesByBlock) {
    const out = [], moved = [];
    // Printed obstacles, measured once per page: glyph boxes of printed lines and printed ornaments.
    const rng = document.createRange();
    const printed = [];
    for (const q of sheet.querySelectorAll('.vl')) {
      rng.selectNodeContents(q);
      for (const g of rng.getClientRects()) if (g.width > 0 && g.height > 0) printed.push(g);
    }
    for (const q of sheet.querySelectorAll('.vorn')) {
      const g = q.getBoundingClientRect();
      if (g.width > 0 || g.height > 0) printed.push(g);
    }
    // Chains: per block, its slots in reading order (top first, then right to left).
    const chains = new Map();
    for (const s of slots) {
      const k = apparatusKeyOf(s.r.flow);
      if (!chains.has(k)) chains.set(k, []);
      chains.get(k).push(s);
    }
    const seq = [];
    const queue = new Map(); // block -> nodes waiting for the next slot of that block
    for (const [k, list] of chains) {
      list.sort((a, b) => (a.r.box[1] - b.r.box[1]) || (b.r.box[0] - a.r.box[0]));
      list.forEach((s, i) => seq.push({ div: s.div, r: s.r, last: i === list.length - 1 }));
      queue.set(k, (nodesByBlock && nodesByBlock[k]) || []);
    }
    const sTop = sheet.getBoundingClientRect().top;
    for (const { div, r, last } of seq) {
      const block = apparatusKeyOf(r.flow);
      const f = faces[r.face != null ? r.face : 0];
      const size = f ? f.size * f.wf.sizeScale : 1;
      const body = div.querySelector(':scope > .vapp-body');
      const waiting = queue.get(block) || [];
      queue.set(block, []);
      body.append(...waiting);
      if (!waiting.length) {
        div.remove();
        out.push({ block, scale: 1, grewPt: 0, overflowEntries: 0, empty: true });
        continue;
      }
      const top = r.box[1] * ppt;
      const own = div.getBoundingClientRect();
      // Growth stops at the first printed line, ornament or other block below the box in the same horizontal band.
      let obstacleTop = Infinity;
      const rects = printed.slice();
      for (const q of sheet.querySelectorAll('.vapp')) {
        if (q !== div && !div.contains(q)) rects.push(q.getBoundingClientRect());
      }
      const blockers = [];
      for (const qr of rects) {
        if (qr.right <= own.left || qr.left >= own.right) continue;
        if (qr.top > own.top + 1) { obstacleTop = Math.min(obstacleTop, qr.top); blockers.push(qr); }
      }
      // A fitted note's glyph boxes may not touch a blocker (spec §9.7): the line box can end above its ink.
      const noteTouches = n => {
        rng.selectNodeContents(n);
        for (const g of rng.getClientRects()) {
          if (g.width <= 0 || g.height <= 0) continue;
          for (const b of blockers) {
            // The glyph box is padded by the ink overhang (up to ~1.5 px below the line box, measured on the sheet).
            if (Math.min(g.right, b.right) - Math.max(g.left, b.left) > 0.5 && Math.min(g.bottom + 1.5, b.bottom) - Math.max(g.top - 1.5, b.top) > 0.5) return true;
          }
        }
        return false;
      };
      const touchesBlocker = () => [...body.querySelectorAll('.marg-note')].some(noteTouches);
      const obstacle = Number.isFinite(obstacleTop) ? (obstacleTop - sTop) / ppt : Infinity;
      // The printed box itself never extends into an obstacle (a box past the next line is cut there).
      const boxBottomPt = Math.min(r.box[3], obstacle);
      const boxH = Math.max(0, (boxBottomPt - r.box[1]) * ppt);
      const maxB = Math.min(Math.max(boxBottomPt, Math.min(r.maxBottom, lowestPt)), obstacle);
      const growH = Math.max(boxH, maxB * ppt - top);
      const fits = () => div.scrollHeight <= div.clientHeight + 0.5 && !touchesBlocker();
      const set = (s, h) => { body.style.fontSize = `calc(var(--pt) * ${(size * s).toFixed(4)})`; div.style.height = `${h}px`; };
      let scale = 1, h = boxH, overflow = 0;
      set(1, h);
      if (!fits()) {
        h = growH; set(1, h);
        if (!fits()) {
          let ok = false;
          for (let s = 0.9875; s >= 0.75 - 1e-9; s -= 0.0125) {
            set(s, h);
            if (fits()) { scale = s; ok = true; break; }
          }
          if (!ok) {
            scale = 0.75; set(0.75, h);
            const notes = [...body.querySelectorAll('.marg-note')];
            const first = notes.findIndex(note => note.offsetTop + note.offsetHeight > h + 0.5 || noteTouches(note));
            if (first >= 0) {
              const nodes = notes.slice(first);
              nodes.forEach(n => n.remove());
              overflow = nodes.length;
              if (last) moved.push({ r, block, nodes });
              else queue.set(block, nodes);
            }
          }
        }
      }
      out.push({ block, scale: Math.round(scale * 10000) / 10000,
        grewPt: Math.round(((h - boxH) / ppt) * 1000) / 1000, overflowEntries: overflow });
    }
    return { diag: out, moved };
  }

  /**
   * Continuation sheets of the apparatus blocks (spec §9.9). Overflow notes are set in the
   * columns of the continuation sheet: a block's heading, then its notes, stacked down the column. A
   * column that fills flows to the next column; a sheet that fills gets another continuation sheet.
   * Nothing is set below the sheet or over another block. Returns the continuation sheets (may be none).
   */
  function buildApparatusContinuation(sheet, moved, faces, container, env, extra) {
    const ppt = extra.ppt;
    const limitPt = extra.sheetHPt - 2;
    // Columns: the distinct x-ranges of the slots, rightmost first (Hebrew reading order).
    const cols = [];
    for (const m of moved) {
      const x0 = m.r.box[0], x1 = m.r.box[2];
      if (!cols.some(c => c.x0 === x0 && c.x1 === x1)) cols.push({ x0, x1 });
    }
    cols.sort((a, b) => b.x0 - a.x0);
    if (!cols.length) cols.push({ x0: 30, x1: extra.pw - 30 });
    // Margin stack pages (spec §9.12): two columns of the core width, in reading order.
    if (extra.cols) cols.splice(0, cols.length, ...extra.cols);
    const items = [
      ...moved.map(m => ({ block: m.block, nodes: m.nodes, face: m.r.face != null ? m.r.face : 0, titleFace: m.r.titleFace, cont: true,
        title: m.title || null, bodyPt: m.bodyPt || null, titlePt: m.titlePt || null })),
      ...extra.unslotted.map(u => ({ block: u.block, nodes: u.nodes, face: extra.face, titleFace: extra.titleFace, cont: false })),
    ];
    const conts = [];
    const newSheet = () => {
      const cont = el('div', 'page-sheet policy-strict sheet-cont apparatus-cont');
      cont.dataset.policy = 'strict-vilna';
      cont.dataset.sheet = String(conts.length + 1);
      cont.dataset.fallback = env.pol.fallback;
      cont.setAttribute('lang', extra.lang || 'he');
      cont.style.width = sheet.style.width;
      cont.style.maxWidth = 'none';
      for (const v of ['--pw', '--ph', '--pt']) cont.style.setProperty(v, sheet.style.getPropertyValue(v));
      container.appendChild(cont); // measured below, so it must be in the page
      conts.push(cont);
      return cont;
    };
    let cur = newSheet(), ci = 0, y = 0;
    const bottomOf = blk => (blk.getBoundingClientRect().bottom - cur.getBoundingClientRect().top) / ppt;
    const nextColumn = () => {
      ci += 1; y = 0;
      if (ci >= cols.length) { cur = newSheet(); ci = 0; }
    };
    for (const it of items) {
      let rest = it.nodes.slice(), frag = 0;
      while (rest.length) {
        const col = cols[ci];
        const f = faces[it.face] || null;
        const blk = el('div', `acont-block vapp-cont f${it.face}`);
        blk.dataset.vregion = it.block;
        blk.dataset.flowBlock = it.block;
        if (!it.cont) blk.dataset.unslotted = '1';
        blk.style.position = 'absolute';
        blk.style.left = `calc(var(--pt) * ${col.x0})`;
        blk.style.top = `calc(var(--pt) * ${y.toFixed(3)})`;
        blk.style.width = `calc(var(--pt) * ${(col.x1 - col.x0).toFixed(3)})`;
        blk.style.direction = extra.dir || 'rtl';
        if (extra.fontVars) for (const [k2, v] of Object.entries(extra.fontVars)) blk.style.setProperty(k2, v);
        blk.style.textAlign = it.bodyPt ? 'justify' : 'right';
        const t = el('div', `vapp-title f${it.titleFace != null ? it.titleFace : 0}`);
        if (it.titlePt) t.style.fontSize = `calc(var(--pt) * ${it.titlePt.toFixed(4)})`;
        const tm = el('span', 'marg-title');
        tm.textContent = `${it.title || APP_TITLE_HE[it.block] || it.block}${it.cont || frag > 0 ? (extra.contLabel || ' (המשך)') : ''}`;
        t.appendChild(tm);
        const body = el('div', 'vapp-body');
        body.style.fontSize = it.bodyPt ? `calc(var(--pt) * ${it.bodyPt.toFixed(4)})`
          : (f ? `calc(var(--pt) * ${(f.size * f.wf.sizeScale).toFixed(4)})` : '');
        blk.appendChild(t);
        blk.appendChild(body);
        cur.appendChild(blk);
        let placed = 0;
        for (let k = 0; k < rest.length; k++) {
          body.appendChild(rest[k]);
          // A note taller than an empty column is kept (it is then reported as off-sheet).
          if (bottomOf(blk) <= limitPt || (placed === 0 && y === 0)) { placed++; continue; }
          rest[k].remove();
          break;
        }
        if (placed === 0) { blk.remove(); nextColumn(); continue; }
        y = bottomOf(blk) + 4;
        rest = rest.slice(placed);
        if (rest.length) { nextColumn(); frag++; }
      }
    }
    return conts;
  }

  /**
   * Apparatus checks of a layout page (spec §9.9), reported in the diagnostics: entries unplaced or
   * duplicated against the store; notes whose box lies outside their sheet (offSheet); pairs of overlapping
   * apparatus boxes, or apparatus boxes over printed glyph boxes (overlap); apparatus boxes over printed
   * ornaments (ornamentCross). Boxes are the client rects of each note's and title's text.
   */
  function apparatusDiagnostics(sheet, conts, flowKeys) {
    const all = [sheet, ...conts];
    const EPS = 0.5;
    const rng = document.createRange();
    const boxesOf = node => {
      rng.selectNodeContents(node);
      return [...rng.getClientRects()].filter(g => g.width > 0 && g.height > 0)
        .map(g => ({ l: g.left, t: g.top, r: g.right, b: g.bottom }));
    };
    let offSheet = 0, unplaced = 0, duplicated = 0;
    const app = [];
    for (const s of all) {
      const sr = s.getBoundingClientRect();
      for (const n of s.querySelectorAll('.marg-note, .marg-note-cont, .marg-tnote')) {
        const nr = n.getBoundingClientRect();
        if (nr.top < sr.top - EPS || nr.bottom > sr.bottom + EPS || nr.left < sr.left - EPS || nr.right > sr.right + EPS) offSheet++;
        app.push({ o: n.id || `note-${app.length}`, boxes: boxesOf(n) });
      }
      for (const n of s.querySelectorAll('.marg-title')) app.push({ o: `title-${app.length}`, boxes: boxesOf(n) });
    }
    const printed = [];
    for (const q of sheet.querySelectorAll('.vl')) printed.push(...boxesOf(q));
    const orn = [];
    for (const q of sheet.querySelectorAll('.vorn')) {
      const g = q.getBoundingClientRect();
      if (g.width > 0 || g.height > 0) orn.push({ l: g.left, t: g.top, r: g.right, b: g.bottom });
    }
    const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > EPS && Math.min(a.b, b.b) - Math.max(a.t, b.t) > EPS;
    const crosses = (A, list) => A.boxes.some(a => list.some(b => hit(a, b)));
    let overlap = 0, ornamentCross = 0;
    for (let i = 0; i < app.length; i++) {
      const A = app[i];
      for (let j = i + 1; j < app.length; j++) {
        const B = app[j];
        if (A.boxes.some(a => B.boxes.some(b => hit(a, b)))) overlap++;
      }
      if (crosses(A, printed)) overlap++;
      if (crosses(A, orn)) ornamentCross++;
    }
    if (flowKeys) {
      for (const b of APP_BLOCKS) {
        const n = flowKeys[b] ? flowKeys[b].entries.length : 0;
        let shown = 0;
        for (const s of all) shown += s.querySelectorAll(`[data-flow-block="${b}"] .marg-note`).length;
        unplaced += Math.max(0, n - shown);
        duplicated += Math.max(0, shown - n);
      }
    }
    return { unplaced, duplicated, offSheet, overlap, ornamentCross };
  }

  const FLOW_CLS = { gemara: 'gemara', inner: 'rashi', outer: 'tosafot' };
  /** True when any segment (string, or array of comment strings) holds visible text. */
  function segsHaveText(segs) {
    return (segs || []).some(x => (Array.isArray(x) ? x.some(c => String(c || '').trim()) : String(x || '').trim()));
  }
  /** Band list in px for emitStream: printed bands plus a blocker band in every vertical gap (§3.5). */
  function flowBandsPx(slot, ppt, W, dy) {
    const bx0 = slot.box.x0, bx1 = slot.box.x1;
    const bs = slot.bands.map(b => ({
      y0: b.y0 * ppt + dy, y1: b.y1 * ppt + dy, a: (bx1 - b.x1) * ppt, b: W - (b.x0 - bx0) * ppt,
    }));
    const out = [];
    bs.forEach((b, i) => {
      if (i && b.y0 - bs[i - 1].y1 > 0.01) out.push({ y0: bs[i - 1].y1, y1: b.y0, a: W / 2 - 1, b: W / 2 + 1 });
      out.push(b);
    });
    return out;
  }

  /**
   * Anchored policy render (design §8 Step 4, item 3): a pure profile transform, the unchanged
   * renderStrict, then flows poured into their slots (§3.5) and a continuation sheet (§3.7).
   * Magnification (fontScale) scales the sheet width (design D-1).
   */
  async function renderAnchored(container, rawModel, pp, edition, env) {
    const t0 = performance.now();
    const plan = Object.assign({}, env.pol.plan, { flow: env.flows || env.pol.plan.flow });
    const fits = await measureRestyleFits(pp, edition, plan);
    const T = transformProfile(pp, edition, plan, fits);
    let opts = env.opts;
    if (plan.scale !== 1) {
      let W0 = env.opts.sheetWidth;
      if (!W0) {
        const p = el('div', 'page-sheet policy-strict');
        container.innerHTML = '';
        container.appendChild(p);
        W0 = p.getBoundingClientRect().width;
        p.remove();
      }
      opts = Object.assign({}, env.opts, { sheetWidth: W0 * plan.scale });
    }
    const out = await renderStrict(container, rawModel, T.pp2, T.edition2, Object.assign({}, env, { opts }));
    const sheet = out.sheets[0];
    sheet.classList.add('policy-anchored');
    sheet.dataset.policy = 'anchored';
    const ppt = out.pxPerPt;
    const H = sheet.getBoundingClientRect().height;
    const norm = env.norm || normalizeModel(rawModel, env.settings);
    const s = env.settings || canonicalSettings(DEFAULT_SETTINGS);
    const streams = {};
    const hadRegion = id => (pp.regions || []).some(r => String(r.id) === id);
    const hasImageBox = (pp.ornaments || []).some(o => o.k === 'image' && o.text);
    const flowRecs = [];
    for (const id of ['gemara', 'inner', 'outer']) {
      if (!plan.flow[id]) { streams[id] = hadRegion(id) ? 'kept' : 'absent'; continue; }
      const slot = T.slots[id];
      const key = id === 'gemara' ? 'gemara' : id === 'inner' ? 'rashi' : 'tosafot';
      const hasText = segsHaveText(norm[key]);
      const cls = FLOW_CLS[id];
      const ltr = id === 'gemara' ? (EDITIONS[s.edition] || {}).dir === 'ltr' : isLtrLang(effectiveLang(s));
      const name = id === 'gemara' ? (EDITIONS[s.edition] || {}).he || 'הגמרא'
        : ((WRAP_BY_ID[id === 'inner' ? s.inner : s.outer] || {}).he || (id === 'inner' ? s.inner : s.outer));
      let html;
      if (!hasText) {
        html = `<span class="aslot-note">${name} — אין טקסט לדף זה</span>`;
      } else if (id === 'gemara') {
        const nb = Object.assign({}, norm, { chapter: Object.assign({}, norm.chapter || {}, { startsHere: hasImageBox }) });
        html = buildGemaraHTML(nb, {}).html;
      } else html = buildCommHTML(key, norm);
      streams[id] = hasText ? 'flow' : 'empty';
      flowRecs.push({
        id, cls, slot, html, ltr, name, empty: !hasText,
        contTitle: id === 'gemara' ? 'המשך הגמרא' : `המשך ${name}`,
        wf: webFontFor(T.edition2, slot.fontTid),
      });
    }
    await Promise.all(flowRecs.map(r => ensureWebFont(r.wf)));
    await document.fonts.ready;

    const flows = [];
    for (const rec of flowRecs) {
      const { slot, wf } = rec;
      const W = (slot.box.x1 - slot.box.x0) * ppt;
      const wrap = el('div', 'aflow-core');
      wrap.style.left = `${slot.box.x0 * ppt}px`;
      wrap.style.top = '0px';
      wrap.style.width = `${W}px`;
      wrap.style.height = `${H}px`;
      sheet.appendChild(wrap);
      const c = el('div', `stream stream-${rec.cls} aflow`);
      c.dataset.vregion = rec.id;
      applySrcAttrs(c, rawModel, srcBlockOf(rec.id));
      c.id = `${rec.cls}-block`;
      if (rec.ltr) { c.classList.add('stream-ltr'); c.dir = 'ltr'; }
      c.innerHTML = '<div class="carve carve-r"></div><div class="carve carve-l"></div>' + rec.html;
      wrap.appendChild(c);
      const fsOf = z => slot.size * wf.sizeScale * z * ppt;
      const lhOf = z => slot.L * z * ppt;
      const applyFont = z => {
        c.style.fontFamily = wf.css;
        c.style.fontWeight = String(wf.wght);
        c.style.fontSize = `${fsOf(z)}px`;
        c.style.lineHeight = `${lhOf(z)}px`;
      };
      const place = dy => emitStream(c, {
        start: flowBandsPx(slot, ppt, W, dy)[0].y0,
        end: (() => { const b = flowBandsPx(slot, ppt, W, dy); return b[b.length - 1].y1; })(),
        bands: flowBandsPx(slot, ppt, W, dy),
      }, W);
      // Baseline lock (z = 1): the first flow baseline lands on the printed first baseline.
      applyFont(1);
      place(0);
      const wordsBefore = countWordsOf(c);
      const probeEl = el('span', 'vbl');
      probeEl.style.display = 'inline-block';
      probeEl.style.width = '0';
      probeEl.style.height = '0';
      probeEl.style.verticalAlign = 'baseline';
      const lead = c.querySelector('.carve-l');
      if (lead) lead.after(probeEl); else c.insertBefore(probeEl, c.firstChild);
      const beta = probeEl.getBoundingClientRect().top - c.getBoundingClientRect().top;
      probeEl.remove();
      const delta = slot.asc * ppt - beta;
      place(delta);
      const top = slot.bands[0].y0 * ppt + delta;
      const bottom = slot.bands[slot.bands.length - 1].y1 * ppt + delta;
      const sheetTop = sheet.getBoundingClientRect().top;
      const zMin = LAYOUT.scaleMin, zMax = LAYOUT.scaleMax;
      let probes = 0;
      const probe = z => {
        probes++;
        applyFont(z);
        const e = measureTextEnd(c, sheetTop);
        return { e, ok: e <= bottom + 0.3 * lhOf(z) };
      };
      const tails = [];
      let z = 1, fitOk = true, cuts = 0;
      if (!rec.empty) {
        const r1 = probe(1);
        if (r1.ok) {
          if (bottom - r1.e > 1.5 * lhOf(1)) {
            if (probe(zMax).ok) z = zMax;
            else {
              let lo = 1, hi = zMax;
              for (let k = 0; k < LAYOUT.fillProbes; k++) { const m = (lo + hi) / 2; if (probe(m).ok) lo = m; else hi = m; }
              z = lo;
            }
          }
        } else if (probe(zMin).ok) {
          let lo = zMin, hi = 1;
          for (let k = 0; k < LAYOUT.fillProbes; k++) { const m = (lo + hi) / 2; if (probe(m).ok) lo = m; else hi = m; }
          z = lo;
        }
        fitOk = probe(z).ok;
        if (!fitOk) {
          // Does not fit even at zMin: keep z = 1 and move the tail to the continuation sheet.
          z = 1;
          applyFont(1);
          for (cuts = 0; cuts < 3; cuts++) {
            if (measureTextEnd(c, sheetTop) <= bottom + 0.3 * lhOf(1)) break;
            const pos = wordStartBelow(c, sheetTop + bottom + 0.3 * lhOf(1));
            if (!pos) break;
            const frag = extractTail(c, pos);
            if (!frag) break;
            tails.unshift(frag); // cuts come from the bottom up: keep document order
          }
          fitOk = measureTextEnd(c, sheetTop) <= bottom + 0.3 * lhOf(1);
          if (!fitOk) throw Object.assign(new Error(`flow ${rec.id} not contained`), { code: 'flow-not-contained' });
        }
      }
      applyFont(z);
      // Core check (design §3.4 step 3): no flow word may intersect kept text or an earlier flow by more than 0.5 px.
      // A word that does is moved, with everything after it, to the continuation sheet (no text loss).
      // Each core cut takes text that precedes the earlier cuts, so fragments are kept in document order.
      let coreCuts = 0;
      const keptBoxes = keptCoreBoxes(sheet, wrap);
      const coreFrags = [];
      for (let k = 0; k < 3; k++) {
        const hitTop = firstCoreHitTop(c, keptBoxes);
        if (hitTop == null) break;
        const pos = wordStartBelow(c, hitTop + 0.5);
        const frag = pos ? extractTail(c, pos) : null;
        if (!frag) break;
        coreFrags.unshift(frag);
        coreCuts++;
      }
      tails.unshift(...coreFrags);
      const wordsInSlot = countWordsOf(c);
      const wordsTotal = wordsInSlot + tails.reduce((n, f) => n + countWordsOf(f), 0);
      // Word conservation (diagnostic): every word of the stream is in the carve or in a tail.
      const wordsLost = Math.max(0, wordsBefore - wordsTotal);
      const endNow = measureTextEnd(c, sheetTop);
      flows.push({
        id: rec.id, z, probes, fits: fitOk, cut: tails.length > 0, cuts, coreCuts,
        fill: rec.empty ? 0 : Math.max(0, Math.min(1, (endNow - top) / Math.max(1e-6, bottom - top))),
        wordsInSlot, wordsTotal, wordsLost,
      });
      rec.tails = tails;
      rec.fsPx = `${fsOf(z)}px`;
      rec.lhPx = `${lhOf(z)}px`;
    }

    // Continuation sheet (§3.7): tails of flows and non-printed extras with text.
    const extrasIds = (plan.extras || []).filter(id => norm.extras && norm.extras[id]);
    const tailed = flowRecs.filter(r => r.tails && r.tails.length);
    let cont = null;
    if (tailed.length || extrasIds.length) {
      cont = buildSheetSkeleton(rawModel, { commFont: s.commFont, gemaraFont: s.gemaraFont, fontScale: 1 },
        'sheet-cont anchored-cont');
      cont.dataset.sheet = '1';
      cont.dataset.policy = 'anchored';
      cont.dataset.fallback = env.pol.fallback;
      cont.setAttribute('lang', 'he');
      cont.style.width = sheet.style.width;
      cont.style.maxWidth = 'none';
      cont.style.setProperty('--pt', sheet.style.getPropertyValue('--pt'));
      const label = el('div', 'cont-label');
      label.setAttribute('role', 'note');
      label.textContent = `המשך ${rawModel.tractateHe || ''} ${heb(rawModel.page)} ${rawModel.side === 'b' ? 'ע״ב' : 'ע״א'}`
        .replace(/\s+/g, ' ').trim();
      cont.appendChild(label);
      for (const rec of tailed) {
        for (const frag of rec.tails) {
          const blk = el('div', `acont-block stream-${rec.cls}`);
          blk.dataset.vregion = rec.id;
          applySrcAttrs(blk, rawModel, srcBlockOf(rec.id));
          const t = el('span', 'acont-title');
          t.textContent = rec.contTitle;
          blk.appendChild(t);
          blk.style.fontFamily = rec.wf.css;
          blk.style.fontWeight = String(rec.wf.wght);
          blk.style.fontSize = rec.fsPx;
          blk.style.lineHeight = rec.lhPx;
          blk.appendChild(frag);
          cont.appendChild(blk);
        }
      }
      if (extrasIds.length) {
        const commSlot = T.slots.inner || T.slots.outer || null;
        const xWf = webFontFor(T.edition2, commSlot ? commSlot.fontTid : 'rashi');
        await ensureWebFont(xWf);
        const xSize = commSlot ? commSlot.size : 9;
        const xL = commSlot ? commSlot.L : xSize * 1.35;
        for (const id of extrasIds) {
          const ex = norm.extras[id];
          const blk = el('div', 'acont-block acont-extra');
          blk.dataset.vregion = id;
          applySrcAttrs(blk, rawModel, srcBlockOf(id));
          blk.style.fontFamily = xWf.css;
          blk.style.fontWeight = String(xWf.wght);
          blk.style.fontSize = `${xSize * xWf.sizeScale * ppt}px`;
          blk.style.lineHeight = `${xL * ppt}px`;
          const t = el('span', 'acont-title');
          t.textContent = ex.title || id;
          blk.appendChild(t);
          const body = el('span');
          body.innerHTML = ex.html;
          blk.appendChild(body);
          cont.appendChild(blk);
        }
      }
      container.appendChild(cont);
    }
    container.style.overflowX = sheet.getBoundingClientRect().width > container.clientWidth + 1 ? 'auto' : '';
    return Object.assign(out, {
      sheets: [sheet].concat(cont ? [cont] : [], out.sheets.slice(1)),
      pp2: T.pp2, edition2: T.edition2,
      anchored: {
        plan, scale: plan.scale, streams, flows, hidden: plan.hidden, extras: extrasIds,
        continuation: !!cont, converged: flows.every(f => f.fits),
        dropped: T.dropped, fits, layoutMs: performance.now() - t0,
      },
    });
  }

  // ═════════════════════ ADAPTIVE renderer (solver + relax + pagination) ═════════════════════

  async function loadAdaptiveFonts(sheet) {
    const fams = new Set();
    for (const e of sheet.querySelectorAll('.stream, .marg-col, .daf-header, .daf-bottom-strip')) {
      fams.add(getComputedStyle(e).fontFamily);
    }
    const jobs = [];
    // Non-Hebrew streams also need their unicode-range subsets loaded: Cyrillic
    // for ru, accented Latin for fr/es, Hangul for ko, Yiddish ligatures for yi.
    let probe = 'אבגדה abc éèàç ñáíóú';
    if (sheet.querySelector('.stream[lang="ru"]')) probe += ' Жж';
    if (sheet.querySelector('.stream[lang="ko"]')) probe += ' 한국어';
    if (sheet.querySelector('.stream[lang="yi"]')) probe += ' ײַװױ';
    for (const f of fams) {
      jobs.push(document.fonts.load(`16px ${f}`, probe).catch(() => null));
      jobs.push(document.fonts.load(`700 16px ${f}`, probe).catch(() => null));
    }
    await Promise.all(jobs);
    await document.fonts.ready;
  }

  async function renderAdaptive(container, rawModel, s, env) {
    const model = normalizeModel(rawModel, s);
    // Render whenever there's any content. A daf may legitimately have no
    // Gemara — e.g. Nazir 33b is entirely the overflow of 33a's long
    // Tosafot — and should still show its commentary. Only fail when there
    // is nothing at all (e.g. Bavli-printed Shekalim is the Yerushalmi).
    const hasGemara = model.gemara.some(x => x && x.trim());
    const hasComm = model.rashi.some(c => c.length) || model.tosafot.some(c => c.length)
      || Object.keys(model.extras).length > 0;
    if (!hasGemara && !hasComm) {
      throw new Error('אין טקסט זמין לדף זה');
    }
    container.innerHTML = '';
    container.dir = 'rtl';

    const L = adaptiveConstants(env.edition, env.pol.fallback === 'best-effort');
    // The Hebrew print leading (~0.87 of the size) leaves no room for Latin/Cyrillic ascenders and
    // descenders, Hangul, or Yiddish vowel points (komets, pasekh, rafe): every translated stream
    // gets a readable minimum leading. Without it lines overlap and the page falls back to stacking.
    if (isLtrLang(effectiveLang(s)) || (s.textLang && s.textLang !== 'he')) {
      L.lhGem = Math.max(L.lhGem, 1.3);
      L.lhComm = Math.max(L.lhComm, 1.22);
    }
    const sheet = buildSheetSkeleton(model, s, '');
    applyLayoutVars(sheet, L);
    sheet.dataset.policy = 'adaptive';
    sheet.dataset.fallback = env.pol.fallback;
    sheet.dataset.sheet = '0';
    sheet.appendChild(buildHeader(model));
    if (model.continuationOf) {
      const note = el('div', 'daf-continuation');
      note.textContent = `המשך הפירוש מעמוד ${model.continuationOf}`;
      sheet.appendChild(note);
    }
    const keyIdx = buildKeyIndex(model);
    const { inner, outer } = buildMargins(model, keyIdx);
    const { body, core } = buildBody(model, inner, outer);
    core.id = 'daf-core';
    sheet.appendChild(body);
    const strip = buildBottomStrip(model);
    if (strip) {
      if (isLtrLang(effectiveLang(s))) { strip.classList.add('stream-ltr'); strip.dir = 'ltr'; strip.lang = effectiveLang(s); }
      sheet.appendChild(strip);
    }
    container.appendChild(sheet);

    const gem = buildGemaraHTML(model, keyIdx);
    const containers = buildStreams(core, model, s, {
      gemara: gem.html,
      rashi: buildCommHTML('rashi', model),
      tosafot: buildCommHTML('tosafot', model),
    });
    for (const name of ['gemara', 'rashi', 'tosafot']) containers[name].id = `${name}-block`;
    if (gem.boxWord) {
      const box = el('span', 'first-word');
      box.textContent = gem.boxWord;
      box.dataset.seg = '1';
      // Reading order: the box word precedes the flow (it is absolutely
      // positioned, so DOM position does not affect the carve layout).
      const carveL = containers.gemara.querySelector('.carve-l');
      containers.gemara.insertBefore(box, carveL.nextSibling);
    }

    // Sheet width: exact (sheetw hook) or frozen at the CSS width so the
    // baked polygons can't desync; reflow-on-resize re-renders instead.
    if (env.opts.sheetWidth) { sheet.style.width = `${env.opts.sheetWidth}px`; sheet.style.maxWidth = 'none'; }
    const sheetW = sheet.getBoundingClientRect().width;
    sheet.style.width = `${sheetW}px`;
    sheet.style.maxWidth = 'none';

    // Catchword: awaited (time-budgeted) BEFORE layout so it is part of the
    // measured flow and never arrives after ready.
    // Status is reported in diagnostics (adaptive.catchword) so a slow network
    // (word dropped after 6 s) is visible instead of silently changing layout.
    let catchwordStatus = 'none';
    if (hasText(containers.gemara)) {
      const TIMEOUT = {};
      const got = await withTimeout(env.catchwordP, 6000, TIMEOUT);
      const word = got === TIMEOUT ? '' : got;
      catchwordStatus = got === TIMEOUT ? 'timeout' : (word ? 'placed' : 'none');
      if (word) {
        const cw = el('div', 'catchword'); // own line at the end of the flow
        cw.textContent = word;
        containers.gemara.appendChild(cw);
      }
    }

    await loadAdaptiveFonts(sheet);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res0 = layoutPage(sheet, core, containers, model, L, {});
    const S0 = {
      index: 0, sheet, core, containers,
      margins: { inner: inner.querySelector('.marg-col'), outer: outer.querySelector('.marg-col') }, strip,
    };
    // Narrow/mobile sheets: an explicitly longer single sheet (documented),
    // never clipped. Otherwise paginate into real continuation sheets.
    const narrow = sheetW < 520;
    let pag = { sheets: [S0], results: [res0], capped: false };
    if (!narrow) pag = paginate(container, S0, res0, model, s, L, env.pol);
    const last = pag.results[pag.results.length - 1];
    const longSheet = sheetOverflows(pag.sheets[pag.sheets.length - 1], last);
    const r0 = pag.results[0];
    core._vilnaResult = Object.assign({}, r0, {
      policy: 'adaptive', fallback: env.pol.fallback, seeded: L.seeded, catchword: catchwordStatus,
      sheets: pag.sheets.length, capped: pag.capped, longSheet, narrow,
      fallbackLayout: pag.results.some(r => r.fallbackLayout),
      converged: pag.results.every(r => r.converged),
      rounds: Math.max(...pag.results.map(r => r.rounds)),
    });
    return { sheets: pag.sheets.map(x => x.sheet), result: core._vilnaResult, model };
  }

  /** Hand-offs shared by both policies; runs BEFORE ready is flagged. */
  function attachIntegrations(container, sheets, rawModel, model, interactive) {
    if (interactive) for (const sh of sheets) initZoomPan(sh);
    // Optional Context Sidebar (js/context-sidebar.js). Renders entirely
    // outside the sheet; it queries anchors under the container (all sheets).
    if (global.VilnaDafContextSidebar) {
      try {
        global.VilnaDafContextSidebar.attach({
          sheet: container,
          anchors: buildContextAnchors(model).concat(buildPrintedAnchors(container, model)),
          fetchSnippet: fetchContextSnippet,
          fetchVerseContext,
          appRouteFor,
        });
      } catch (e) { console.error('[vilna-daf] context sidebar:', e); }
    }
    // Optional AI chavruta (js/chavruta/*). Same guarded pattern: hand it
    // the raw model; it lives entirely outside the sheet (container-level menu).
    if (global.VilnaChavruta && global.VilnaChavruta.controller) {
      try {
        global.VilnaChavruta._heb = heb;
        // Neighbor loader for the context builder: cache, else live fetch,
        // so the AI gets the prev/next amud even when they aren't pre-cached.
        // Null store: DEFAULT_SETTINGS is he, where applyTextStore replaces nothing, and this path
        // must not add entries to the 2-page store memo.
        global.VilnaChavruta._neighborLoader = (tractate, page, side) =>
          loadModel(tractate, page, side, DEFAULT_SETTINGS, null);
        global.VilnaChavruta.controller.setDaf({ model: rawModel, sheet: container });
      } catch (e) { console.error('[vilna-daf] chavruta:', e); }
    }
  }

  // ═════════════════════ Diagnostics (plan §7.5, measured from the live DOM) ═════════════════════

  const _ascentCache = {};
  let _measureCanvas = null;
  function fontAscentPx(cs) {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!(font in _ascentCache)) {
      _measureCanvas = _measureCanvas || document.createElement('canvas');
      const c = _measureCanvas.getContext('2d');
      c.font = font;
      const m = c.measureText('אבג');
      _ascentCache[font] = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    }
    return _ascentCache[font];
  }

  function relRect(r, o) { return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; }
  function unionRect(rs) {
    const v = rs.filter(r => r && (r.w > 0 || r.h > 0));
    if (!v.length) return null;
    const x0 = Math.min(...v.map(r => r.x)), y0 = Math.min(...v.map(r => r.y));
    const x1 = Math.max(...v.map(r => r.x + r.w)), y1 = Math.max(...v.map(r => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const collapse = t => String(t || '').replace(/\s+/g, ' ').trim();

  /** Strict: one entry per .vl, text/rect/baseline/fit read from the DOM. */
  function diagStrictRegions(sheet, o) {
    const out = [];
    const range = document.createRange();
    for (const reg of sheet.querySelectorAll(':scope > .vregion')) {
      const lines = [];
      for (const vl of reg.querySelectorAll(':scope > .vl')) {
        const text = collapse(vl.textContent);
        range.selectNodeContents(vl);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => relRect(r, o));
        const probe = vl.querySelector(':scope > .vbl');
        const d = vl.dataset;
        // Sparse printed lines (parts positioned apart / opened gaps): their
        // union rect spans empty paper, so collisions use per-word boxes.
        const sparse = d.wide === '1' || !!vl.querySelector(':scope > .vr-abs');
        // Per-word (non-whitespace) rects: the line rect is their union, i.e. the ink-bearing
        // extent. A whole-contents Range also yields rects for spaces / trailing spacing at a
        // run edge, ~1 px outside the printed x0/x1 on apart-positioned runs (Nazir 58b).
        const words = [];
        {
          const w = document.createTreeWalker(vl, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const re = /\S+/g;
            let m;
            while ((m = re.exec(n.textContent))) {
              range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
              const br = range.getBoundingClientRect();
              if (br.width || br.height) words.push(relRect(br, o));
            }
          }
        }
        const boxes = sparse ? words : null;
        lines.push({
          boxes: boxes || undefined,
          i: +d.line, text, words: text ? text.split(' ') : [],
          rect: unionRect(words.length ? words : rects) || relRect(vl.getBoundingClientRect(), o),
          baseline: probe ? probe.getBoundingClientRect().top - o.top : null,
          // natRatio = natural (unjustified) width / printed width: the
          // web-font advance gap the fit had to absorb (typography metric).
          fit: {
            mode: d.fit || 'none', ws: +(d.ws || 0), ls: +(d.ls || 0), sx: +(d.sx || 1),
            natRatio: d.nat ? +d.nat : null, advK: d.k ? +d.k : null, wide: d.wide === '1' || undefined,
          },
          withheld: d.withheld === '1' || undefined,
          // printed geometry of this line (pt): reference for the strict collision guard
          _ref: { x0: +d.x0, x1: +d.x1, bl: +d.bl,
            faces: [...vl.querySelectorAll('.vr')].map(v => { const m = /(?:^|\s)f(\d+)(?:\s|$)/.exec(v.className); return m ? +m[1] : null; }).filter(x => x != null) },
        });
      }
      out.push({
        id: reg.dataset.vregion, part: +(reg.dataset.part || 0), sheet: 0,
        rect: unionRect(lines.map(l => l.rect)), lines,
      });
    }
    return out;
  }

  /** Adaptive: visual lines of a flow from per-word Range rects (DOM order). */
  function flowLines(root, o, excludeSel) {
    const skip = excludeSel ? `.carve, ${excludeSel}` : '.carve';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent.trim() && !(n.parentElement && n.parentElement.closest(skip))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    const lines = [];
    let cur = null, node, prevEndsSpace = true;
    while ((node = walker.nextNode())) {
      const txt = node.textContent;
      const cs = getComputedStyle(node.parentElement);
      const asc = fontAscentPx(cs);
      const re = /\S+/g;
      let m;
      while ((m = re.exec(txt))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rr = range.getBoundingClientRect();
        if (!rr.width && !rr.height) continue;
        // A word hyphenated across a line break has one client rect per line; its bounding rect
        // would span both lines (and the column beside them), so each fragment joins its own line.
        const frags = [...range.getClientRects()].filter(c => c.width || c.height);
        const parts = frags.length > 1 ? frags.map(c => relRect(c, o)) : [relRect(rr, o)];
        const spaced = m.index > 0 ? /\s/.test(txt[m.index - 1]) : prevEndsSpace;
        parts.forEach((r, k) => {
          const cy = r.y + r.h / 2;
          if (!cur || Math.abs(cy - cur.cy) > 0.45 * Math.max(r.h, cur.h)) {
            cur = { cy, h: r.h, tokens: [], rects: [], baselines: [] };
            lines.push(cur);
          }
          if (!k) cur.tokens.push((spaced && cur.tokens.length ? ' ' : '') + m[0]);
          cur.rects.push(r);
          cur.baselines.push(r.y + asc);
        });
      }
      prevEndsSpace = /\s$/.test(txt);
    }
    return lines.map((l, i) => {
      const text = l.tokens.join('');
      const bs = l.baselines.slice().sort((a, b) => a - b);
      return {
        i, text, words: text.split(' ').filter(Boolean), rect: unionRect(l.rects),
        baseline: bs[bs.length >> 1], fit: { mode: 'none', ws: 0, ls: 0, sx: 1 },
      };
    });
  }

  function diagAdaptiveRegions(sheets, o) {
    const out = [];
    const push = (id, part, si, root) => {
      if (!root) return;
      const lines = flowLines(root, o);
      if (!lines.length) return;
      out.push({ id, part, sheet: si, rect: unionRect(lines.map(l => l.rect)), lines });
    };
    sheets.forEach((sh, si) => {
      push('header', 0, si, sh.querySelector(':scope > .daf-header') || sh.querySelector(':scope > .cont-label'));
      for (const st of sh.querySelectorAll('.core > .stream')) {
        // the catchword is reported as its own region
        const lines = flowLines(st, o, '.catchword');
        if (lines.length) out.push({ id: st.dataset.vregion, part: si, sheet: si, rect: unionRect(lines.map(l => l.rect)), lines });
        push('catchword', si, si, st.querySelector(':scope > .catchword'));
      }
      for (const mb of sh.querySelectorAll('.daf-margin .marg-block[data-vregion]')) {
        push(`margin:${mb.dataset.vregion}`, si, si, mb);
      }
      push('bottom', si, si, sh.querySelector(':scope > .daf-bottom-strip'));
    });
    return out;
  }

  /** Anchored: kept Gemara/commentary lines (strict-style) + flow lines (sheet 0) + continuation blocks. */
  function diagAnchoredRegions(sheets, o) {
    const out = diagStrictRegions(sheets[0], o);
    const push = (entry, root, excl) => {
      const lines = flowLines(root, o, excl);
      if (lines.length) out.push(Object.assign(entry, { rect: unionRect(lines.map(l => l.rect)), lines }));
    };
    for (const st of sheets[0].querySelectorAll(':scope > .aflow-core > .stream')) {
      push({ id: st.dataset.vregion, part: 0, sheet: 0, flow: true }, st, null);
    }
    sheets.slice(1).forEach((sh, k) => {
      const si = k + 1;
      const lab = sh.querySelector(':scope > .cont-label');
      if (lab) push({ id: 'header', part: 0, sheet: si }, lab, null);
      for (const b of sh.querySelectorAll(':scope > .acont-block')) {
        push({ id: b.dataset.vregion, part: 1, sheet: si, cont: true }, b, '.acont-title');
      }
    });
    return out;
  }

  function diagSafety(container, sheets, regions, o, st) {
    const sheetRects = sheets.map(s => relRect(s.getBoundingClientRect(), o));
    const offSheet = [], overlaps = [], clipped = [];
    const all = [];
    // strict-vilna: the same glyph-box model as harness/compare-vilna.mjs (baseline - 0.75 size,
    // height 1.05 size, printed size) on the rendered x-extent AND on the printed geometry of the
    // line; a pair collides only by overlap IN EXCESS of the print's own (> 1 px). Content-area
    // boxes flag the print's tight leading and tall title brackets (Berachot 47a) as collisions.
    const ppt = (st.policy === 'strict-vilna' || st.policy === 'anchored') && st.pxPerPt ? st.pxPerPt : null;
    const faces = (st.profilePage && st.profilePage.faces) || [];
    const sizeOf = l => {
      const sz = (l._ref && l._ref.faces || []).map(f => faces[f] && +faces[f][1]).filter(x => x > 0);
      return sz.length ? Math.max(...sz) : null;
    };
    for (const r of regions) {
      const S = sheetRects[r.sheet] || sheetRects[0];
      for (const l of r.lines) {
        if (!l.rect) continue;
        let gb = null, ref = null;
        const sz = ppt ? sizeOf(l) : null;
        if (sz && l._ref && l.baseline != null) {
          gb = { y: l.baseline - 0.75 * sz * ppt, h: 1.05 * sz * ppt };
          ref = { x: l._ref.x0 * ppt, w: (l._ref.x1 - l._ref.x0) * ppt, y: (l._ref.bl - 0.75 * sz) * ppt, h: 1.05 * sz * ppt };
        }
        for (const b of l.boxes || [l.rect]) {
          all.push({ reg: `${r.id}:${r.part}`, sheet: r.sheet, i: l.i, ref,
            rect: gb ? { x: b.x, w: b.w, y: gb.y, h: gb.h } : b });
        }
        const R = l.rect;
        if (R.x < S.x - 1 || R.y < S.y - 1 || R.x + R.w > S.x + S.w + 1 || R.y + R.h > S.y + S.h + 1) {
          offSheet.push({ region: r.id, part: r.part, line: l.i });
        }
      }
    }
    // Cross-region collisions of line boxes.
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.reg === b.reg || a.sheet !== b.sheet) continue;
        const ox = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
        const oy = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
        // Line boxes are font content areas (taller than the ink and than a
        // tight printed leading), so a collision needs > 70% of the smaller
        // box of vertical overlap — adjacent baselines never trigger it.
        if (a.ref && b.ref) {
          if (!(ox > 1 && oy > 1)) continue;
          const rx = Math.min(a.ref.x + a.ref.w, b.ref.x + b.ref.w) - Math.max(a.ref.x, b.ref.x);
          const ry = Math.min(a.ref.y + a.ref.h, b.ref.y + b.ref.h) - Math.max(a.ref.y, b.ref.y);
          if (ox <= Math.max(0, rx) + 1 && oy <= Math.max(0, ry) + 1) continue;
          if (overlaps.some(q => q.a === a.reg && q.ai === a.i && q.b === b.reg && q.bi === b.i)) continue;
          overlaps.push({ a: a.reg, ai: a.i, b: b.reg, bi: b.i, ox: +ox.toFixed(1), oy: +oy.toFixed(1), excessOfPrint: true });
          if (overlaps.length > 200) break;
          continue;
        }
        if (ox > 1 && oy > 0.7 * Math.min(a.rect.h, b.rect.h)) {
          if (overlaps.some(q => q.a === a.reg && q.ai === a.i && q.b === b.reg && q.bi === b.i)) continue;
          overlaps.push({ a: a.reg, ai: a.i, b: b.reg, bi: b.i, ox: +ox.toFixed(1), oy: +oy.toFixed(1) });
          if (overlaps.length > 200) break;
        }
      }
      if (overlaps.length > 200) break;
    }
    for (const e of container.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) {
        clipped.push(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}.${[...e.classList].join('.')}`);
      }
    }
    return {
      offSheet, overlaps, clipped,
      lateMutations: st.lateMutations || 0,
      missingStreams: st.missingStreams ? st.missingStreams() : [],
    };
  }

  // ── Context Sidebar integration (Masoret HaShas, Torah Or, Ein Mishpat) ──

  function buildContextAnchors(model) {
    const sideHe = model.side === 'a' ? 'ע״א' : 'ע״ב';
    const cur = `${model.tractate} ${model.page}${model.side}`;
    const curHe = `${model.tractateHe || model.tractate} ${heb(model.page)} ${sideHe}`;
    const links = model.links || {};
    // The popup opens toward the physical margin its commentary lives in,
    // and the margins flip between amud א and ב (see renderDaf's append
    // order): inner margin (מסורת הש״ס) is right on amud א, left on amud ב;
    // outer margin (עין משפט, תורה אור) is the opposite.
    const innerSide = model.side === 'a' ? 'right' : 'left';
    const outerSide = model.side === 'a' ? 'left' : 'right';
    const kinds = [
      { kind: 'mesoret-hashas', short: 'ms', label: 'מסורת הש״ס', linkKey: 'mesoretHaShas', side: innerSide },
      { kind: 'torah-or', short: 'to', label: 'תורה אור', linkKey: 'torahOr', side: outerSide },
      { kind: 'ein-mishpat', short: 'em', label: 'עין משפט נר מצוה', linkKey: 'einMishpat', side: outerSide },
    ];
    return kinds.flatMap(def =>
      (links[def.linkKey] || []).map((lk, i) => ({
        id: `ctx-${def.short}-${i}`,
        kind: def.kind,
        side: def.side,
        sourceRef: cur,
        sourceDisplay: curHe,
        targetRef: lk.sourceRef || '',
        label: def.label,
        displayText: stripText(lk.sourceHeRef || lk.sourceRef || ''),
        source: def.kind,
        confidence: 1,
        raw: lk,
        domId: `note-${def.linkKey}-${i}`,
      }))
    ).filter(a => a.targetRef);
  }

  // ── Printed-apparatus anchors (strict-vilna / anchored pages) ──
  // Those pages draw מסורת הש״ס and תורה אור from the print (profile lines),
  // so the `note-<linkKey>-<i>` elements of the adaptive renderer do not exist.
  // The references are read from the printed text itself — the citation as
  // the reader sees it — and the existing run/word spans become the anchors
  // (id + class only: no new elements, so the strict paint is unchanged).

  const HE_TRACTATES = {
    'ברכות': 'Berachot', 'שבת': 'Shabbat', 'עירובין': 'Eiruvin', 'ערובין': 'Eiruvin',
    'פסחים': 'Pesachim', "פסחי'": 'Pesachim', 'שקלים': 'Shekalim', 'יומא': 'Yoma',
    'סוכה': 'Sukkah', 'ביצה': 'Beitzah', 'ר"ה': 'Rosh Hashanah', 'ראש השנה': 'Rosh Hashanah',
    'תענית': 'Taanit', 'מגילה': 'Megillah', 'מו"ק': 'Moed Katan', 'מ"ק': 'Moed Katan',
    'מועד קטן': 'Moed Katan', 'חגיגה': 'Chagigah', 'יבמות': 'Yevamot', 'כתובות': 'Ketubot',
    'נדרים': 'Nedarim', 'נזיר': 'Nazir', 'סוטה': 'Sotah', 'גיטין': 'Gittin',
    'קידושין': 'Kiddushin', 'קדושין': 'Kiddushin', 'ב"ק': 'Bava Kamma', 'בבא קמא': 'Bava Kamma',
    'ב"מ': 'Bava Metzia', 'בבא מציעא': 'Bava Metzia', 'ב"ב': 'Bava Batra', 'בבא בתרא': 'Bava Batra',
    'סנהדרין': 'Sanhedrin', "סנהד'": 'Sanhedrin', 'מכות': 'Makkot', 'שבועות': 'Shevuot',
    'ע"ז': 'Avodah Zarah', 'עבודה זרה': 'Avodah Zarah', 'הוריות': 'Horayot', 'זבחים': 'Zevachim',
    'מנחות': 'Menachot', 'חולין': 'Chullin', 'בכורות': 'Bechorot', 'ערכין': 'Arachin',
    'תמורה': 'Temurah', 'כריתות': 'Keritot', 'מעילה': 'Meilah', 'נדה': 'Niddah', 'תמיד': 'Tamid',
  };
  const SEFARIA_EXTRA = { Tamid: 'Tamid' }; // Bavli tractates with no page in this app
  const HE_BOOKS = {
    'בראשית': 'Genesis', 'שמות': 'Exodus', 'ויקרא': 'Leviticus', 'במדבר': 'Numbers',
    'דברים': 'Deuteronomy', 'יהושע': 'Joshua', 'שופטים': 'Judges', 'ישעיהו': 'Isaiah',
    'ישעיה': 'Isaiah', 'ירמיהו': 'Jeremiah', 'ירמיה': 'Jeremiah', 'יחזקאל': 'Ezekiel',
    'הושע': 'Hosea', 'יואל': 'Joel', 'עמוס': 'Amos', 'עובדיה': 'Obadiah', 'יונה': 'Jonah',
    'מיכה': 'Micah', 'נחום': 'Nahum', 'חבקוק': 'Habakkuk', 'צפניה': 'Zephaniah', 'חגי': 'Haggai',
    'זכריה': 'Zechariah', 'מלאכי': 'Malachi', 'תהלים': 'Psalms', 'תהילים': 'Psalms',
    'משלי': 'Proverbs', 'איוב': 'Job', 'שיר השירים': 'Song of Songs', 'רות': 'Ruth',
    'איכה': 'Lamentations', 'קהלת': 'Ecclesiastes', 'אסתר': 'Esther', 'דניאל': 'Daniel',
    'עזרא': 'Ezra', 'נחמיה': 'Nehemiah',
    'שמואל א': 'I Samuel', 'שמואל ב': 'II Samuel', 'ש"א': 'I Samuel', 'ש"ב': 'II Samuel',
    'מלכים א': 'I Kings', 'מלכים ב': 'II Kings', 'מ"א': 'I Kings', 'מ"ב': 'II Kings',
    'דברי הימים א': 'I Chronicles', 'דברי הימים ב': 'II Chronicles',
    'דה"א': 'I Chronicles', 'דה"ב': 'II Chronicles',
  };
  const HE_VAL = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10,
    'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80,
    'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
  const normQ = s => String(s).replace(/[״”“]/g, '"').replace(/[׳’‘`]/g, "'");
  /** Hebrew numeral ("כ", "נ\"ז", "קמ'") → number, or null. */
  function heNum(s) {
    const t = normQ(s).replace(/["']/g, '');
    if (!/^[א-ת]{1,4}$/.test(t)) return null;
    let n = 0;
    for (const c of t) n += HE_VAL[c];
    return n;
  }
  function tractateSefaria(app) {
    return SEFARIA_MAP[app] || SEFARIA_EXTRA[app] || null;
  }

  /** Tokens (word element + printed text) of one printed region, in reading order. */
  function regionWordTokens(reg) {
    const toks = [];
    for (const vr of reg.querySelectorAll('.vl .vr')) {
      const words = vr.querySelectorAll('.vw');
      if (words.length) {
        for (const w of words) if (w.closest('.vr') === vr) toks.push({ el: w, run: vr, t: normQ(w.textContent) });
      } else {
        for (const t of normQ(vr.textContent).split(/\s+/)) if (t) toks.push({ el: vr, run: vr, t });
      }
    }
    return toks;
  }

  /** מסורת הש״ס: Bavli page references read from the printed entries. */
  function parseMasoretRefs(toks, curApp) {
    const refs = [];
    const bare = t => t.replace(/^[[(]+/, '').replace(/[\],);]+$/, '');
    const dafOf = t => {
      const m = /^([א-ת]{1,3}(?:["'][א-ת]?)?)([.:])/.exec(bare(t));
      if (!m) return null;
      const n = heNum(m[1]);
      return n && n >= 2 && n <= 180 ? { daf: n, side: m[2] === '.' ? 'a' : 'b' } : null;
    };
    const SAME = /^(?:ו|ד|וד)?(?:לעיל|לקמן|דף|לדף|בדף)$/;
    let last = curApp;
    for (let i = 0; i < toks.length; i++) {
      const w = bare(toks[i].t);
      let app = null, span = 1;
      const two = i + 1 < toks.length ? `${w} ${bare(toks[i + 1].t)}` : null;
      if (two && HE_TRACTATES[two]) { app = HE_TRACTATES[two]; span = 2; }
      else if (HE_TRACTATES[w]) app = HE_TRACTATES[w];
      else {
        const m = /^(?:וב|וד|ו|ב|ד)(.+)$/.exec(w);
        if (m && HE_TRACTATES[m[1]]) app = HE_TRACTATES[m[1]];
        else if (SAME.test(w)) app = curApp;
        else if (/^ו?שם$/.test(w)) app = last;
      }
      if (!app) continue;
      let j = i + span;
      if (j < toks.length && /^ו?(?:דף|לדף|בדף)$/.test(bare(toks[j].t))) j++;
      const d = j < toks.length ? dafOf(toks[j].t) : null;
      if (!d) continue;
      const sef = tractateSefaria(app);
      if (!sef) continue;
      last = app;
      const name = toks.slice(i, i + span).map(x => bare(x.t)).join(' ');
      refs.push({
        targetRef: `${sef} ${d.daf}${d.side}`,
        display: toks.slice(i, j + 1).map(x => bare(x.t)).join(' ').replace(/[,;]+$/, ''),
        els: toks.slice(i, j + 1).map(x => x.el),
      });
      // a list of pages of the same tractate ("ב\"מ סה. עג. קי:"): one reference each
      while (j + 1 < toks.length) {
        const d2 = dafOf(toks[j + 1].t);
        if (!d2) break;
        j++;
        refs.push({ targetRef: `${sef} ${d2.daf}${d2.side}`, display: `${name} ${bare(toks[j].t).replace(/[,;]+$/, '')}`, els: [toks[j].el] });
      }
      i = j;
    }
    return refs;
  }

  /** תורה אור: one verse citation run ("דברים ו ז") → Sefaria ref. */
  function parseVerseCitation(text) {
    const parts = normQ(text).replace(/[():,.]/g, ' ').trim().split(/\s+/);
    for (let k = Math.min(3, parts.length - 2); k >= 1; k--) {
      const book = HE_BOOKS[parts.slice(0, k).join(' ')];
      if (!book) continue;
      // chapter, then one verse, a range ("ז-ח") or a list ("ב, ג" / "א ב ג") → first–last
      const rest = parts.slice(k).join(' ').split(/[\s-]+/).filter(Boolean);
      if (rest.length < 2 || rest.length > 6) continue;
      const nums = rest.map(heNum);
      if (nums.some(v => !v)) continue;
      const [ch, ...vs] = nums;
      const lo = Math.min(...vs), hi = Math.max(...vs);
      return `${book} ${ch}:${lo === hi ? lo : `${lo}-${hi}`}`;
    }
    return null;
  }

  function buildPrintedAnchors(container, model) {
    const out = [];
    const sideHe = model.side === 'a' ? 'ע״א' : 'ע״ב';
    const cur = `${model.tractate} ${model.page}${model.side}`;
    const curHe = `${model.tractateHe || model.tractate} ${heb(model.page)} ${sideHe}`;
    const physical = s => (s === 'inner') === (model.side === 'a') ? 'right' : 'left';
    let n = 0;
    const add = (el, kind, label, targetRef, display, side) => {
      if (!el.id) el.id = `pnote-${kind}-${n++}`;
      else if (out.some(a => a.domId === el.id)) return; // one anchor per element
      out.push({
        id: `ctx-p-${el.id}`, kind, side, sourceRef: cur, sourceDisplay: curHe, targetRef,
        label, displayText: display, source: kind, confidence: 1, raw: null, domId: el.id,
      });
    };
    for (const sheet of container.querySelectorAll('.page-sheet')) {
      for (const reg of sheet.querySelectorAll('.vregion[data-vregion="masoretHaShas"]')) {
        const side = physical(reg.dataset.side);
        const toks = regionWordTokens(reg);
        const refs = parseMasoretRefs(toks, model.tractate);
        for (const r of refs) for (const el of r.els) add(el, 'mesoret-hashas', 'מסורת הש״ס', r.targetRef, r.display, side);
        // An entry's key letter ("א)") opens the entry's first reference.
        let pendingKeys = [];
        for (const t of toks) {
          if (/^[[(]?[א-ת]{1,2}\)$/.test(t.t)) { pendingKeys.push(t.el); continue; }
          const r = refs.find(x => x.els.includes(t.el));
          if (r && pendingKeys.length) {
            for (const k of pendingKeys) add(k, 'mesoret-hashas', 'מסורת הש״ס', r.targetRef, r.display, side);
            pendingKeys = [];
          }
        }
      }
      for (const reg of sheet.querySelectorAll('.vregion[data-vregion="torahOr"]')) {
        const side = physical(reg.dataset.side);
        // Entry = key number, verse text runs, citation run. Every run of the
        // entry opens the cited verse (title line excluded).
        let entry = [];
        for (const vl of reg.querySelectorAll('.vl')) {
          if (/^\s*תורה אור/.test(vl.textContent)) continue; // block title
          for (const vr of vl.querySelectorAll('.vr')) {
            let ref = parseVerseCitation(vr.textContent);
            let display = normQ(vr.textContent).trim();
            // a citation broken over two runs/lines ("שיר" | "השירים א ג")
            const prev = entry[entry.length - 1];
            if (!ref && prev && !/[\u0591-\u05C7]/.test(prev.textContent + vr.textContent)) {
              const joined = `${normQ(prev.textContent).trim()} ${display}`;
              ref = parseVerseCitation(joined);
              if (ref) display = joined;
            }
            entry.push(vr);
            if (!ref) continue;
            for (const e of entry) add(e, 'torah-or', 'תורה אור', ref, display, side);
            entry = [];
          }
        }
      }
    }
    return out;
  }

  /**
   * Verse context for a Tanakh ref ("Hosea 5:11"): the whole chapter with
   * the target verse marked, so the popup can show the surrounding paragraph
   * / chapter (scrollable). Returns { verses:[{n,text}], target } or null.
   */
  async function fetchVerseContext(targetRef) {
    const m = /^(.+?)\s+(\d+[ab]?):(\d+)/.exec(targetRef || '');
    if (!m) return null;
    const target = +m[3];
    const segs = heSegments(await getText(`${m[1]} ${m[2]}`));
    if (!Array.isArray(segs) || !segs.length) return null;
    const clean = s => stripText(htmlToPlain(Array.isArray(s) ? s.join(' ') : (s || '')))
      .replace(/\s+/g, ' ').trim();
    const verses = segs.map((s, i) => ({ n: i + 1, text: clean(s) })).filter(v => v.text);
    return verses.length ? { verses, target } : null;
  }

  /**
   * HTML → plain text via the DOM: decodes entities (&thinsp; &nbsp; …)
   * and drops tags without splitting words; <br> still becomes a space.
   * Entity decoding must happen BEFORE stripText, which would otherwise
   * eat the entity's semicolon and leave a literal "&thinsp".
   */
  function htmlToPlain(s) {
    const d = document.createElement('div');
    d.innerHTML = String(s).replace(/<br\s*\/?>/gi, ' ');
    return d.textContent;
  }

  /** Fetch a plain-text snippet of a referenced source (Hebrew, stripped). */
  async function fetchContextSnippet(targetRef) {
    const segs = heSegments(await getText(targetRef));
    const flat = (Array.isArray(segs) ? segs : [segs]).flat(3).filter(Boolean);
    const text = flat.map(s => stripText(htmlToPlain(s)))
      .join(' ').replace(/\s+/g, ' ').trim();
    return text || null;
  }

  /** Map a Sefaria Bavli ref to this app's route, if it has one. */
  function appRouteFor(targetRef) {
    const m = /^(.+?)\s+(\d+)([ab])\b/.exec(targetRef || '');
    if (!m) return null;
    const en = Object.keys(SEFARIA_MAP).find(k => SEFARIA_MAP[k] === m[1]);
    return en ? { tractate: en, page: +m[2], side: m[3] } : null;
  }

  // ═════════════════════════ PUBLIC API ═════════════════════════

  class VilnaDaf {
    /**
     * opts: container (required), settings, reflowOnResize,
     *   layoutPolicy: 'auto' (default) | 'adaptive'
     *   profileBase:  'data/vilna-profiles' (default)
     *   layoutBase:   'data/vilna-layout' (default) — used only when there is no local profile index
     *                 (published build): geometry-only layout hydrated from the offline pack; false = off
     *   offlineBase:  'data/offline' (default) — optional offline text pack; false = always live Sefaria
     *   profileId:    profile id (default: index.json's default)
     *   sheetWidth:   exact sheet width in CSS px (comparison hook)
     *   interactive:  false disables zoom/pan (comparison hook)
     */
    constructor(opts = {}) {
      this._container = typeof opts.container === 'string'
        ? document.querySelector(opts.container)
        : opts.container;
      if (!this._container) throw new Error('VilnaDaf: container not found');
      this._tractates = null;
      this._current = null;
      this._loc = null;
      this._state = null;
      this._token = 0;
      this.settings = canonicalSettings(Object.assign({}, DEFAULT_SETTINGS, opts.settings));
      // Off by default: when true, the daf re-lays-out to fit a narrower
      // container (window resize / AI panel). Forced off on mobile.
      this.reflowOnResize = !!opts.reflowOnResize;
      this._opts = {
        layoutPolicy: opts.layoutPolicy === 'adaptive' ? 'adaptive' : 'auto',
        profileBase: String(opts.profileBase || PROFILE_BASE).replace(/\/+$/, ''),
        layoutBase: opts.layoutBase === false ? null : String(opts.layoutBase || LAYOUT_BASE).replace(/\/+$/, ''),
        profileId: opts.profileId || null,
        sheetWidth: Number(opts.sheetWidth) > 0 ? Number(opts.sheetWidth) : null,
        interactive: opts.interactive !== false,
      };
      if (opts.offlineBase === false) OFFLINE_BASE = null;
      else if (opts.offlineBase) OFFLINE_BASE = String(opts.offlineBase).replace(/\/+$/, '');
      initHover(this._container);
    }

    get layoutPolicy() { return this._opts.layoutPolicy; }

    async load(tractate, page, side) {
      tractate = appTractateName(tractate);
      page = parseInt(page, 10);
      side = String(side || 'a').toLowerCase();
      const token = ++this._token;
      this._teardown();
      this._loc = { tractate, page, side };
      this._state = null;
      this._profilePage = null;
      this._edition = null;
      this._layoutUsed = false;
      this._layoutSheets = null;
      this._layoutGemaraSrc = null;
      this._layoutApparatusSources = null;
      this._container.innerHTML =
        `<div class="page-sheet"><div class="loading"><span class="spinner"></span>טוען ${tractate} ${heb(page)}${side}...</div></div>`;
      this._container.dir = 'rtl';
      this._container.style.overflowX = '';
      const o = this._opts;
      const settings = this.settings;
      try {
        this._textStoreP = loadTextStore(tractate, page, side);
        const modelP = loadModel(tractate, page, side, settings, this._textStoreP).then(m => ({ m }), e => ({ e }));
        let profileId = null, profilePage = null, edition = null, layoutFailed = false, layoutWhy = null;
        if (o.layoutPolicy !== 'adaptive') {
          const profileIdx = await profileIndex(o.profileBase);
          profileId = await resolveProfileId(o.profileBase, o.profileId);
          if (profileId) {
            [profilePage, edition] = await Promise.all([
              loadProfilePage(o.profileBase, profileId, tractate, page, side),
              editionProfile(o.profileBase, profileId),
            ]);
            this._profilePage = profilePage;
            this._edition = edition;
          } else if (!profileIdx && o.layoutBase && !(settings && settings.licenseMode === 'pd')) {
            // Licence 'pd' never uses a layout (its text is not PD-clean): HEAD's path, no requests.
            const lang = settings && settings.textLang ? settings.textLang : 'he';
            const lay = await loadLayoutPage(o.layoutBase, tractate, page, side, this._textStoreP, lang,
              settings && settings.licenseMode ? settings.licenseMode : 'all');
            if (lay && lay.layoutUnusable) { layoutFailed = true; layoutWhy = lay.reason; }
            else if (lay) {
              profileId = lay.id;
              profilePage = lay.page;
              edition = lay.edition;
              this._profilePage = profilePage;
              this._edition = edition;
              this._layoutUsed = true;
              this._layoutSheets = lay.sheets || null;
              this._layoutGemaraSrc = lay.gemaraSrc;
              this._layoutApparatusSources = lay.apparatusSources;
            }
          }
        }
        let pol = resolvePolicy(settings, o, profilePage);
        if (layoutFailed && pol.reason === 'no-profile') pol = Object.assign({}, pol, { reason: layoutWhy ? `layout-unavailable:${layoutWhy}` : 'layout-unavailable' });
        if (pol.policy === 'strict-vilna') return await this._loadStrict(token, modelP, pol, profileId, profilePage, edition);
        if (pol.policy === 'anchored') {
          try {
            return await this._loadAnchored(token, modelP, pol, profileId, profilePage, edition);
          } catch (e) {
            console.warn('[vilna-daf] anchor failed', e);
            return await this._loadAdaptive(token, modelP,
              { policy: 'adaptive', fallback: 'none', reason: 'anchor-failed:' + (e.code || 'exception') }, profileId, edition);
          }
        }
        return await this._loadAdaptive(token, modelP, pol, profileId, edition);
      } catch (err) {
        if (token === this._token) {
          this._container.innerHTML =
            `<div class="page-sheet"><div class="error-state"><p>❌ ${err.message}</p></div></div>`;
        }
        throw err;
      }
    }

    async _loadStrict(token, modelP, pol, profileId, profilePage, edition) {
      const { tractate, page, side } = this._loc;
      const r = await modelP;
      let model = r.m || null;
      const hasModel = !!(model && modelHasContent(model));
      if (!model) model = await stubModel(tractate, page, side, this.settings);
      if (this._layoutUsed) applyLayoutGemaraSource(model, this._layoutGemaraSrc);
      const mh = hasModel ? modelHash(model) : null;
      const sefariaHashMatch = hasModel ? (!!profilePage.sefariaHash && mh === profilePage.sefariaHash) : null;
      const hasSegs = profilePage.regions.some(x => Array.isArray(x.segs) && x.segs.length);
      // A layout's segs are rebuilt from the Sefaria tokens' own segment indices (builder), so they
      // link without a sefariaHash; local profiles keep the hash rule.
      const trusted = !!sefariaHashMatch || (this._layoutUsed && hasSegs && hasModel);
      const linking = trusted && hasSegs ? 'full' : (hasModel ? 'degraded' : 'none');
      if (token !== this._token) return model; // navigation moved on
      this._current = model;
      const sheetEnv = { pol, opts: this._opts, applySegs: trusted, layoutPage: this._layoutUsed,
        lang: (this.settings && this.settings.textLang) || 'he',
        note: this._layoutUsed && this._layoutSheets ? { used: profilePage.sourcesUsed, model, src: this._layoutApparatusSources } : null };
      const out = this._layoutSheets
        ? await renderStrictSheets(this._container, model, this._layoutSheets, edition, sheetEnv)
        : await renderStrict(this._container, model, profilePage, edition, sheetEnv);
      if (this._layoutUsed) markLayoutSheets(this._container);
      if (token !== this._token) return model;
      this._state = {
        policy: pol.policy, fallback: pol.fallback, reason: pol.reason, profileId,
        profilePage, edition, modelHash: mh, sefariaHashMatch, linking,
        sheets: out.sheets, pxPerPt: out.pxPerPt, adaptive: null, apparatusFit: out.apparatusFit || [],
        apparatusUnplaced: out.apparatusUnplaced,
        apparatusChecks: apparatusChecksOf(out),
        missingStreams: () => {
          const miss = [];
          for (const rg of profilePage.regions) {
            const want = (rg.lines || []).length;
            const got = this._container.querySelectorAll(
              `.vregion[data-vregion="${CSS.escape(String(rg.id))}"][data-part="${rg.part || 0}"] > .vl`).length;
            if (got < want) miss.push(`${rg.id}:${rg.part || 0}`);
          }
          return miss;
        },
      };
      if (this._layoutUsed && !this._layoutSheets) appendLayoutSourcesNote(this._container, profilePage.sourcesUsed, [], model,
        apparatusEntriesFor(this._layoutApparatusSources, renderedFlowBlocks(profilePage, model), 'he'));
      else if (!this._layoutSheets) appendSourcesNote(this._container, model);   // layer/2: one note per sheet (renderStrictSheets)
      this._finish(out.sheets, model, model);
      if (this.reflowOnResize) this._watchResize();
      if (this._onLoad) this._onLoad(model);
      return model;
    }

    async _loadAnchored(token, modelP, pol, profileId, profilePage, edition) {
      const { tractate, page, side } = this._loc;
      const r = await modelP;
      let model = r.m || null;
      if (pol.plan.needsFlow && !model) throw Object.assign(new Error('model unavailable'), { code: 'no-model' });
      const hasModel = !!(model && modelHasContent(model));
      if (!model) model = await stubModel(tractate, page, side, this.settings);
      if (this._layoutUsed) applyLayoutGemaraSource(model, this._layoutGemaraSrc);
      const baseModel = model._base || model;
      // Final flow set (design §3.5), decided once the model is known.
      const plan = pol.plan;
      const s = canonicalSettings(this.settings);
      const norm = normalizeModel(model, this.settings);
      const hasRegion = id => (profilePage.regions || []).some(x => String(x.id) === id);
      const flows = { gemara: false, inner: false, outer: false };
      if (plan.flow.gemara) {
        if (!hasRegion('gemara') || !segsHaveText(norm.gemara)) throw Object.assign(new Error('no core text'), { code: 'no-core' });
        flows.gemara = true;
      }
      for (const [side2, key] of [['inner', 'rashi'], ['outer', 'tosafot']]) {
        if (!plan.flow[side2]) continue;
        if (segsHaveText(norm[key])) flows[side2] = true;
        // Keep the printed commentary only when the whole selection is the default: under another
        // language (e.g. lang 'en') the print is Hebrew and must not stand in for a missing English text.
        else if (s[side2] === DEFAULT_SETTINGS[side2] && s.lang === DEFAULT_SETTINGS.lang) flows[side2] = false; // keep the print
        else flows[side2] = true; // flow with an empty-note
      }
      const mh = hasModel ? modelHash(baseModel) : null;
      const sefariaHashMatch = hasModel ? (!!profilePage.sefariaHash && mh === profilePage.sefariaHash) : null;
      const hasSegs = profilePage.regions.some(x => Array.isArray(x.segs) && x.segs.length);
      // A layout's segs are rebuilt from the Sefaria tokens' own segment indices (builder), so they
      // link without a sefariaHash; local profiles keep the hash rule.
      const trusted = !!sefariaHashMatch || (this._layoutUsed && hasSegs && hasModel);
      const linking = trusted && hasSegs ? 'full' : (hasModel ? 'degraded' : 'none');
      if (token !== this._token) return model; // navigation moved on
      this._current = model;
      const out = await renderAnchored(this._container, model, profilePage, edition,
        { pol: Object.assign({}, pol, { plan: Object.assign({}, plan, { flow: flows }) }), opts: this._opts,
          applySegs: trusted, norm, flows, settings: s, layoutPage: this._layoutUsed });
      if (this._layoutUsed) markLayoutSheets(this._container);
      if (token !== this._token) return model;
      this._state = {
        policy: pol.policy, fallback: pol.fallback, reason: pol.reason, profileId,
        profilePage: out.pp2, edition: out.edition2, modelHash: mh, sefariaHashMatch, linking,
        sheets: out.sheets, pxPerPt: out.pxPerPt, adaptive: null, anchored: out.anchored, apparatusFit: out.apparatusFit || [],
        apparatusUnplaced: out.apparatusUnplaced,
        apparatusChecks: apparatusChecksOf(out),
        missingStreams: () => {
          const miss = [];
          for (const rg of out.pp2.regions) {
            const want = (rg.lines || []).length;
            const got = this._container.querySelectorAll(
              `.vregion[data-vregion="${CSS.escape(String(rg.id))}"][data-part="${rg.part || 0}"] > .vl`).length;
            if (got < want) miss.push(`${rg.id}:${rg.part || 0}`);
          }
          // A flow (slot or continuation) must show text: its expected text is never empty.
          for (const f of out.anchored.flows) {
            const txt = [...this._container.querySelectorAll(
              `.aflow[data-vregion="${f.id}"], .acont-block[data-vregion="${f.id}"]`)]
              .map(n => n.textContent.trim()).join('');
            if (!txt) miss.push(`${f.id}:flow`);
          }
          return miss;
        },
      };
      if (this._layoutUsed) {
        const flowBlocks = [['gemara', 'gemara'], ['inner', 'rashi'], ['outer', 'tosafot']]
          .filter(([k]) => flows[k]).map(([, b]) => b);
        appendLayoutSourcesNote(this._container, profilePage.sourcesUsed, flowBlocks, model,
          apparatusEntriesFor(this._layoutApparatusSources, renderedFlowBlocks(profilePage, model), 'he'));
      } else appendSourcesNote(this._container, model);
      this._finish(out.sheets, model, model);
      if (this.reflowOnResize) this._watchResize();
      if (this._onLoad) this._onLoad(model);
      return model;
    }

    async _loadAdaptive(token, modelP, pol, profileId, edition) {
      const { tractate, page, side } = this._loc;
      const r = await modelP;
      if (r.e) throw r.e;
      let model = r.m;
      // Overflow amud (e.g. Nazir 33b) — no text of its own; it is the
      // continuation of the previous amud's long commentary. Show that
      // commentary, without a Gemara column.
      if (!modelHasContent(model)) {
        const prev = side === 'a' ? { page: page - 1, side: 'b' } : { page, side: 'a' };
        if (prev.page >= 2) {
          const pm = await loadModel(tractate, prev.page, prev.side, this.settings);
          if (modelHasContent(pm)) {
            model = Object.assign({}, pm, {
              gemara: [], page, side,
              continuationOf: `${heb(prev.page)} ${prev.side === 'a' ? 'ע״א' : 'ע״ב'}`,
            });
          }
        }
      }
      if (token !== this._token) return model;
      this._current = model;
      const catchwordP = fetchCatchword(tractate, page, side, this.settings);
      const out = await renderAdaptive(this._container, model, this.settings,
        { pol, edition, opts: this._opts, catchwordP });
      if (token !== this._token) return model;
      const container = this._container;
      this._state = {
        policy: pol.policy, fallback: pol.fallback, reason: pol.reason, profileId,
        profilePage: null, edition, modelHash: null, sefariaHashMatch: null,
        linking: modelHasContent(model) ? 'full' : 'none',
        sheets: out.sheets, pxPerPt: null, adaptive: out.result,
        missingStreams: () => {
          const nm = out.model;
          const want = {
            gemara: nm.gemara.some(x => x && x.trim()),
            inner: nm.rashi.some(c => c.length),
            outer: nm.tosafot.some(c => c.length),
          };
          const miss = [];
          for (const [id, w] of Object.entries(want)) {
            if (!w) continue;
            const txt = [...container.querySelectorAll(`.core > .stream[data-vregion="${id}"]`)]
              .map(e => e.textContent).join('').trim();
            if (!txt) miss.push(id);
          }
          return miss;
        },
      };
      out.model.apparatusNoteEntries = adaptiveApparatusEntries(out.model);
      appendSourcesNote(this._container, out.model);
      this._finish(out.sheets, model, out.model);
      if (this.reflowOnResize) this._watchResize();
      if (this._onLoad) this._onLoad(model);
      return model;
    }

    /** Integrations, then ready flag; from here on nothing mutates the page. */
    _finish(sheets, rawModel, model) {
      attachIntegrations(this._container, sheets, rawModel, model, this._opts.interactive);
      sheets[0].dataset.vilnaReady = '1';
      const st = this._state;
      st.lateMutations = 0;
      if (typeof MutationObserver !== 'undefined') {
        this._mo = new MutationObserver(recs => {
          for (const rec of recs) {
            // hover/flash/zoom are user-driven class/transform changes
            if (rec.type === 'attributes' && rec.attributeName === 'class') continue;
            st.lateMutations++;
          }
        });
        this._mo.observe(this._container, {
          subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['dir', 'id'],
        });
      }
    }

    _teardown() {
      if (this._mo) { this._mo.disconnect(); this._mo = null; }
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
    }

    /** Opt-in reflow: re-render when the container width changes (not on mobile). */
    _watchResize() {
      const mobile = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
      if (mobile || this._opts.sheetWidth || typeof ResizeObserver === 'undefined') return;
      let lastW = Math.round(this._container.clientWidth);
      let pending = null;
      this._ro = new ResizeObserver(() => {
        const w = Math.round(this._container.clientWidth);
        if (!w || Math.abs(w - lastW) < 2) return;
        clearTimeout(pending);
        pending = setTimeout(() => {
          lastW = Math.round(this._container.clientWidth);
          const st = this._state;
          if (st && st.policy === 'strict-vilna') {
            // Strict geometry is all in pt: rescale = new width + --pt only
            // (no re-measurement, no reflow, identical relative layout).
            const sh = st.sheets[0];
            const pw = +st.profilePage.page.w;
            sh.style.width = ''; sh.style.maxWidth = '';
            const W = parseFloat(getComputedStyle(sh).width) || sh.offsetWidth; // ignores zoom transform
            sh.style.width = `${W}px`; sh.style.maxWidth = 'none';
            sh.style.setProperty('--pt', `${W / pw}px`);
            st.pxPerPt = W / pw;
            reregisterBaselines(sh, W / pw);
          } else if (this._loc) {
            this.load(this._loc.tractate, this._loc.page, this._loc.side).catch(() => {});
          }
        }, 150);
      });
      this._ro.observe(this._container);
    }

    /**
     * Merge a settings patch and reconstruct the current page around it.
     * `extras` replaces the whole array; everything else merges per key.
     * Back at the defaults the strict layout is rebuilt from profile data
     * only (stateless), so the geometry is identical.
     */
    async updateSettings(patch) {
      this.settings = canonicalSettings(Object.assign({}, this.settings, patch));
      if (this._loc) {
        return this.load(this._loc.tractate, this._loc.page, this._loc.side);
      }
    }

    /**
     * What the page really shows (design §2.2). Read-only; computed from the
     * current render state and the loaded per-amud profile.
     */
    getPageSelection() {
      const s = canonicalSettings(this.settings);
      const st = this._state;
      // Source of every block that renders (model.sources) and every store block that does not
      // (model.hiddenBlocks). `tag` is the short line shown in the panel, e.g. "ספריא · Vilna Edition · PD".
      const model = this._current;
      const LICENSE_SHORT = { 'Public Domain': 'PD', CC0: 'PD' };
      const texts = {};
      for (const [block, src] of Object.entries((model && model.sources) || {})) {
        const lic = src.license ? (LICENSE_SHORT[src.license] || src.license) : null;
        texts[block] = {
          lang: src.lang, title: src.title, license: src.license, special: !!src.special, mt: !!src.mt,
          fallbackFrom: src.fallbackFrom || null,
          tag: ['ספריא', src.title, lic].filter(Boolean).join(' · ') + (src.fallbackFrom ? ' (מקור עברי)' : ''),
        };
      }
      const sourceInfo = { texts, hiddenBlocks: ((model && model.hiddenBlocks) || []).map(h => ({ ...h })) };
      const policy = st ? st.policy : 'adaptive';
      const printedSrc = st && (st.policy === 'strict-vilna' || st.policy === 'anchored') ? 'print' : 'sefaria';
      const pp = this._profilePage;
      const edition = this._edition || (st && st.edition) || null;
      const editionMeta = EDITIONS[s.edition] || { he: s.edition };
      if (!pp) {
        return {
          policy, profiled: false, ...sourceInfo,
          edition: { id: s.edition, he: editionMeta.he, printText: false },
          lang: s.lang,
          wrap: {
            inner: { id: s.inner, he: (WRAP_BY_ID[s.inner] || {}).he || s.inner, source: 'sefaria' },
            outer: { id: s.outer, he: (WRAP_BY_ID[s.outer] || {}).he || s.outer, source: 'sefaria' },
          },
          fonts: {
            gemara: { setting: s.gemaraFont, family: null, printFitted: false, sizePt: null },
            comm: { setting: s.commFont, family: null, printFitted: false, sizePt: null },
          },
          fontScale: s.fontScale,
          printed: [],
          extras: s.extras,
        };
      }
      const blocks = printedBlocks(pp);
      const printed = blocks.map(b => ({ ...b, shown: !s.hidden.includes(b.id) }));
      const printedIds = new Set(blocks.map(b => b.id));
      const regionOf = pred => (pp.regions || []).find(pred);
      const gemReg = regionOf(r => r.id === 'gemara');
      const innerReg = regionOf(r => r.id === 'inner') || null;
      const outerReg = regionOf(r => r.id === 'outer') || null;
      const fontOf = (region, setting, def) => {
        const face = region && pp.faces && pp.faces[region.face];
        if (!face) return { setting, family: null, printFitted: false, sizePt: null };
        const [tid, size] = face;
        const wf = webFontFor(edition, tid);
        return {
          setting,
          family: st && st.policy === 'anchored' && setting !== def ? restyleFamily(setting) : wf.family,
          printFitted: !!wf.fitted && setting === def,
          sizePt: Number(size) || null,
        };
      };
      const commReg = innerReg || outerReg;
      const anchoredStreams = st && st.policy === 'anchored' && st.anchored ? st.anchored.streams : null;
      const wrapOf = (id, reg, side) => {
        let source = reg ? printedSrc : 'sefaria';
        const state = anchoredStreams && side ? anchoredStreams[side] : null;
        if (state === 'flow') source = 'sefaria';
        else if (state === 'empty') source = 'missing';
        else if (state === 'kept') source = 'print';
        return { id, he: (WRAP_BY_ID[id] || {}).he || id, source };
      };
      const d = DEFAULT_SETTINGS;
      const inEdition = s.edition === d.edition;
      return {
        policy,
        profiled: true,
        ...sourceInfo,
        edition: { id: s.edition, he: editionMeta.he, printText: printedSrc === 'print' && inEdition },
        lang: s.lang,
        wrap: { inner: wrapOf(s.inner, innerReg, 'inner'), outer: wrapOf(s.outer, outerReg, 'outer') },
        fonts: {
          gemara: fontOf(gemReg, s.gemaraFont, d.gemaraFont),
          comm: fontOf(commReg, s.commFont, d.commFont),
        },
        fontScale: s.fontScale,
        printed,
        extras: s.extras.filter(id => !printedIds.has(id)),
      };
    }

    async loadFromURL() {
      const p = new URLSearchParams(location.search);
      const tractate = p.get('tractate') || p.get('masechet') || p.get('m') || 'Berachot';
      const page = parseInt(p.get('page') || p.get('daf') || p.get('d') || '2');
      const side = (p.get('side') || p.get('amud') || p.get('s') || 'a').toLowerCase();
      return this.load(tractate, page, side);
    }

    async getTractates() {
      if (!this._tractates) this._tractates = TRACTATES.map(t => Object.assign({}, t));
      return this._tractates;
    }

    /** Policy/profile/layout diagnostics measured from the live DOM (schema vilna-diag/1). */
    getDiagnostics() {
      const st = this._state;
      const sheets = [...this._container.querySelectorAll(':scope > .page-sheet[data-sheet]')];
      if (!st || !sheets.length) {
        return { schema: 'vilna-diag/1', ready: false, policy: null, fallback: null, reason: 'not-loaded' };
      }
      const o = sheets[0].getBoundingClientRect();
      const strict = st.policy === 'strict-vilna' || st.policy === 'anchored';
      const regions = st.policy === 'anchored' ? diagAnchoredRegions(sheets, o)
        : strict ? diagStrictRegions(sheets[0], o) : diagAdaptiveRegions(sheets, o);
      const famUsed = new Set();
      for (const e of this._container.querySelectorAll('.vr, .vl, .stream, .marg-col, .daf-header, .daf-bottom-strip')) {
        for (const f of getComputedStyle(e).fontFamily.split(',')) {
          const fam = f.trim().replace(/^["']|["']$/g, '');
          if (fam && !/^(serif|sans-serif|var\()/.test(fam)) famUsed.add(fam);
        }
      }
      const fonts = [...famUsed].map(family => {
        const faces = [...document.fonts].filter(f => f.family.replace(/["']/g, '') === family);
        return {
          family, loaded: faces.some(f => f.status === 'loaded'),
          faces: faces.map(f => ({ weight: f.weight, unicodeRange: f.unicodeRange, status: f.status })),
        };
      }).filter(f => f.faces.length);
      const a = st.adaptive;
      return {
        schema: 'vilna-diag/1',
        policy: st.policy, fallback: st.fallback, reason: st.reason,
        profileId: st.profileId || null,
        profileTextHash: st.profilePage ? profileTextHash(st.profilePage) : null,
        profileTextHashDeclared: st.profilePage ? st.profilePage.textHash || null : null,
        sefariaHashMatch: st.sefariaHashMatch,
        modelHash: st.modelHash,
        linking: st.linking,
        ready: sheets[0].dataset.vilnaReady === '1',
        pxPerPt: strict ? st.pxPerPt : null,
        anchored: st.anchored || null,
        apparatusFit: st.apparatusFit || [],
        apparatusUnplaced: st.apparatusUnplaced === undefined ? null : st.apparatusUnplaced,
        apparatusChecks: st.apparatusChecks || null,
        sheets: sheets.map((s, i) => ({ index: +(s.dataset.sheet || i), rect: relRect(s.getBoundingClientRect(), o) })),
        regions,
        fonts,
        adaptive: a ? {
          rounds: a.rounds, converged: a.converged, scale: a.scale, sheets: a.sheets,
          fallbackLayout: !!a.fallbackLayout, capped: !!a.capped, longSheet: !!a.longSheet,
          narrow: !!a.narrow, seeded: a.seeded, catchword: a.catchword || null,
        } : null,
        safety: diagSafety(this._container, sheets, regions, o, st),
      };
    }

    get current() { return this._current; }
    onLoad(fn) { this._onLoad = fn; return this; }
  }

  VilnaDaf.heb = heb;
  VilnaDaf.HEBREW_NUMERAL = heb;
  // Catalogs for building a settings UI on top of the library.
  VilnaDaf.EDITIONS = EDITIONS;
  VilnaDaf.WRAP_COMMENTARIES = WRAP_COMMENTARIES;
  VilnaDaf.EXTRA_COMMENTARIES = EXTRA_COMMENTARIES;
  VilnaDaf.anchorPlan = anchorPlan;
  VilnaDaf.printedBlocks = printedBlocks;
  VilnaDaf.APPARATUS_HE = APPARATUS_HE;
  VilnaDaf.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  VilnaDaf.TEXT_LANGS = TEXT_LANGS;
  VilnaDaf.isLtrLang = isLtrLang;
  // Policy + hashing (pure, additive; docs/VILNA_PIXEL_PLAN.md §3.1, §2.3).
  VilnaDaf.resolvePolicy = resolvePolicy;
  VilnaDaf.isDefaultSettings = isDefaultSettings;
  VilnaDaf.fnv1a64 = fnv1a64;
  VilnaDaf.modelHash = modelHash;
  VilnaDaf.profileTextHash = profileTextHash;
  VilnaDaf.tractateKey = tractateKey;
  VilnaDaf.hydrateLayout = hydrateLayout;
  VilnaDaf.layoutTokenStream = layoutTokenStream;
  VilnaDaf.layoutTranslationSheet = layoutTranslationSheet;
  VilnaDaf.tsFontsReady = tsFontsReady;
  VilnaDaf.exportSheetLines = exportSheetLines;
  VilnaDaf._internals = { // for tests
    parseMasoretRefs, parseVerseCitation, heNum, buildPrintedAnchors,
    solve, normalizeModel, stripHtml, sanitizeHtml,
    canonicalSettings, profileLineText, segLookup, adaptiveConstants, LAYOUT, FIT,
    transformProfile, measureRestyleFits, computeSlot, TEXT_LANGS, isLtrLang, effectiveLang,
    resolveBlock, applyTextStore,
  };

  global.VilnaDaf = VilnaDaf;
})(typeof window !== 'undefined' ? window : globalThis);
