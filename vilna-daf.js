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
  ];
  const LICENSE_MODES = ['all', 'pd'];

  /** True when the language id is a known left-to-right text language (unknown ids are not). */
  function isLtrLang(code) {
    const t = TEXT_LANGS.find(l => l.id === code);
    return !!t && t.dir === 'ltr';
  }

  /**
   * Text language of the streams: textLang when it is not 'he' (en/ru replace the
   * whole page text), otherwise the commentary language setting `lang` ('he' | 'en').
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

  // Tractate catalogue (built in; the library needs no data files to run).
  const TRACTATES = [{"name_en":"Berachot","name_he":"ברכות","sefaria_name":"Berakhot","last_page":64,"ends_on_b":false,"first_page":2},{"name_en":"Shabbat","name_he":"שבת","sefaria_name":"Shabbat","last_page":157,"ends_on_b":true,"first_page":2},{"name_en":"Eiruvin","name_he":"עירובין","sefaria_name":"Eiruvin","last_page":105,"ends_on_b":false,"first_page":2},{"name_en":"Pesachim","name_he":"פסחים","sefaria_name":"Pesachim","last_page":121,"ends_on_b":true,"first_page":2},{"name_en":"Shekalim","name_he":"שקלים","sefaria_name":"Shekalim","last_page":22,"ends_on_b":true,"first_page":2},{"name_en":"Yoma","name_he":"יומא","sefaria_name":"Yoma","last_page":88,"ends_on_b":false,"first_page":2},{"name_en":"Sukkah","name_he":"סוכה","sefaria_name":"Sukkah","last_page":56,"ends_on_b":true,"first_page":2},{"name_en":"Beitzah","name_he":"ביצה","sefaria_name":"Beitzah","last_page":40,"ends_on_b":true,"first_page":2},{"name_en":"Rosh Hashanah","name_he":"ראש השנה","sefaria_name":"Rosh Hashanah","last_page":35,"ends_on_b":false,"first_page":2},{"name_en":"Taanit","name_he":"תענית","sefaria_name":"Taanit","last_page":31,"ends_on_b":false,"first_page":2},{"name_en":"Megillah","name_he":"מגילה","sefaria_name":"Megillah","last_page":32,"ends_on_b":false,"first_page":2},{"name_en":"Moed Katan","name_he":"מועד קטן","sefaria_name":"Moed Katan","last_page":29,"ends_on_b":false,"first_page":2},{"name_en":"Chagigah","name_he":"חגיגה","sefaria_name":"Chagigah","last_page":27,"ends_on_b":false,"first_page":2},{"name_en":"Yevamot","name_he":"יבמות","sefaria_name":"Yevamot","last_page":122,"ends_on_b":true,"first_page":2},{"name_en":"Ketubot","name_he":"כתובות","sefaria_name":"Ketubot","last_page":112,"ends_on_b":true,"first_page":2},{"name_en":"Nedarim","name_he":"נדרים","sefaria_name":"Nedarim","last_page":91,"ends_on_b":true,"first_page":2},{"name_en":"Nazir","name_he":"נזיר","sefaria_name":"Nazir","last_page":66,"ends_on_b":true,"first_page":2},{"name_en":"Sotah","name_he":"סוטה","sefaria_name":"Sotah","last_page":49,"ends_on_b":true,"first_page":2},{"name_en":"Gittin","name_he":"גיטין","sefaria_name":"Gittin","last_page":90,"ends_on_b":true,"first_page":2},{"name_en":"Kiddushin","name_he":"קידושין","sefaria_name":"Kiddushin","last_page":82,"ends_on_b":true,"first_page":2},{"name_en":"Bava Kamma","name_he":"בבא קמא","sefaria_name":"Bava Kamma","last_page":119,"ends_on_b":true,"first_page":2},{"name_en":"Bava Metzia","name_he":"בבא מציעא","sefaria_name":"Bava Metzia","last_page":119,"ends_on_b":false,"first_page":2},{"name_en":"Bava Batra","name_he":"בבא בתרא","sefaria_name":"Bava Batra","last_page":176,"ends_on_b":true,"first_page":2},{"name_en":"Sanhedrin","name_he":"סנהדרין","sefaria_name":"Sanhedrin","last_page":113,"ends_on_b":true,"first_page":2},{"name_en":"Makkot","name_he":"מכות","sefaria_name":"Makkot","last_page":24,"ends_on_b":true,"first_page":2},{"name_en":"Shevuot","name_he":"שבועות","sefaria_name":"Shevuot","last_page":49,"ends_on_b":true,"first_page":2},{"name_en":"Avodah Zarah","name_he":"עבודה זרה","sefaria_name":"Avodah Zarah","last_page":76,"ends_on_b":true,"first_page":2},{"name_en":"Horayot","name_he":"הוריות","sefaria_name":"Horayot","last_page":14,"ends_on_b":false,"first_page":2},{"name_en":"Zevachim","name_he":"זבחים","sefaria_name":"Zevachim","last_page":120,"ends_on_b":true,"first_page":2},{"name_en":"Menachot","name_he":"מנחות","sefaria_name":"Menachot","last_page":110,"ends_on_b":false,"first_page":2},{"name_en":"Chullin","name_he":"חולין","sefaria_name":"Chullin","last_page":142,"ends_on_b":false,"first_page":2},{"name_en":"Bechorot","name_he":"בכורות","sefaria_name":"Bechorot","last_page":61,"ends_on_b":false,"first_page":2},{"name_en":"Arachin","name_he":"ערכין","sefaria_name":"Arachin","last_page":34,"ends_on_b":false,"first_page":2},{"name_en":"Temurah","name_he":"תמורה","sefaria_name":"Temurah","last_page":34,"ends_on_b":false,"first_page":2},{"name_en":"Keritot","name_he":"כריתות","sefaria_name":"Keritot","last_page":28,"ends_on_b":true,"first_page":2},{"name_en":"Meilah","name_he":"מעילה","sefaria_name":"Meilah","last_page":22,"ends_on_b":false,"first_page":2},{"name_en":"Niddah","name_he":"נידה","sefaria_name":"Niddah","last_page":73,"ends_on_b":false,"first_page":2}];

  // Optional offline data pack: data/offline/<Tractate>/<daf><side>.json (schema vilna-offline/1)
  // holds every text in every language plus the page metadata (chapter, links). When the pack is
  // absent (404, network error, foreign schema) the loader resolves to null and the page is fetched
  // live from Sefaria. Base path is set with `new VilnaDaf({offlineBase})`; offlineBase:false disables it.
  let OFFLINE_BASE = 'data/offline';
  const OFFLINE_SCHEMAS = ['vilna-offline/1', 'vilna-text/1'];
  const _textStoreMemo = new Map();
  const TEXT_STORE_MEMO_MAX = 2;
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
    // Hebrew strip rules never run on Cyrillic/Latin text (textLang en/ru keeps punctuation).
    const cleanG = ed.strip && !isLtrLang(s.textLang) ? cleanGemara : softClean;
    const cleanC = isLtrLang(effectiveLang(s)) ? softClean : cleanComment;
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
          mt: r.lang === 'ru',
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

  function buildKeyIndex(model) {
    const links = model.links || {};
    const defs = [
      { key: 'einMishpat', cls: 'key-em', title: 'עין משפט נר מצוה' },
      { key: 'mesoretHaShas', cls: 'key-ms', title: 'מסורת הש״ס' },
      { key: 'torahOr', cls: 'key-to', title: 'תורה אור' },
    ];
    const idx = {};
    // Translation pages cite the source in Latin (sourceRef); Hebrew pages keep sourceHeRef.
    const latinRefs = !!(model.settings && model.settings.textLang && model.settings.textLang !== 'he');
    for (const d of defs) {
      idx[d.key] = { cls: d.cls, title: d.title, entries: [] };
      (links[d.key] || []).forEach((lk, i) => {
        const m = (lk.anchorRef || '').match(/:(\d+)/);
        // Margin shows only the ONE quoted pasuk (first verse if the ref is a
        // range); the full chapter context lives in the hover popup.
        const heArr = Array.isArray(lk.he) ? lk.he.flat(3).filter(Boolean) : (lk.he ? [lk.he] : []);
        const oneVerse = heArr.length ? String(heArr[0]) : '';
        idx[d.key].entries.push({
          id: `note-${d.key}-${i}`,
          segNum: m ? parseInt(m[1]) : 0,
          letter: hebLetter(i),
          ref: stripText(latinRefs ? (lk.sourceRef || lk.sourceHeRef || '') : (lk.sourceHeRef || lk.sourceRef || '')),
          verse: oneVerse ? cleanGemara(oneVerse) : '',
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
    return entries.map(e =>
      `<span class="marg-note" id="${e.id}" data-seg="${e.segNum}"><span class="key">${e.letter}</span> ` +
      (showVerse && e.verse ? `<span class="verse-text">${e.verse}</span> ` : '') +
      `<span class="note-ref">${e.ref}</span></span>`
    ).join('');
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
        mt.textContent = ltr ? `Machine translation (Claude Haiku), based on ${from}` : `תרגום מכונה (Claude Haiku) — מבוסס על ${from}`;
        note.appendChild(mt);
      }
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
    // textLang en/ru: every stream (Gemara included) carries that language, LTR.
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
        if (e.classList.contains('comment') || e.classList.contains('gseg')) {
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
      const se = e.target.closest && e.target.closest('.gseg[data-seg], .comment[data-seg], .ref-key[data-seg]');
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
  function fitStrictLines(sheet, pxPerPt, advanceK, anchoredLen) {
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
    for (const u of units) if (u.mode === 'ws' || u.mode === 'ls') u.n1 = u.measure();
    for (const u of units) {
      if (u.mode === 'ws') {
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
      if (u.shrinkOnly ? r < 0 : (u.mode !== 'none' && Math.abs(r) > FIT.sxTolPx)) {
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

  async function renderStrict(container, rawModel, pp, edition, env) {
    container.innerHTML = '';
    container.dir = 'rtl';
    const pw = +pp.page.w, ph = +pp.page.h;
    const side = pp.side || rawModel.side || 'a';
    const sheet = el('div', `page-sheet policy-strict side-${side}`);
    sheet.dataset.policy = 'strict-vilna';
    sheet.dataset.fallback = env.pol.fallback;
    sheet.dataset.sheet = '0';
    sheet.setAttribute('lang', 'he');
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
      const wf = webFontFor(edition, tid);
      const by = wf.fitted && edition && edition.webFonts && edition.webFonts[tid] && edition.webFonts[tid].baselineShiftBySize;
      const ex = by ? Number(by[(+size).toFixed(2)]) : NaN;
      return { tid, size: +size, wf: Number.isFinite(ex) && ex ? Object.assign({}, wf, { shiftEm: wf.shiftEm + ex }) : wf };
    });
    const css = faces.map((f, i) =>
      `.page-sheet.policy-strict .f${i}{font-family:${f.wf.css};font-weight:${f.wf.wght};` +
      `font-size:calc(var(--pt) * ${(f.size * f.wf.sizeScale).toFixed(4)});}` +
      `.page-sheet.policy-strict .vr.f${i}{--vsh:${(-f.wf.shiftEm).toFixed(4)}em;--hsh:${f.wf.shiftXEm.toFixed(4)}em;}`).join('\n');
    const style = el('style');
    style.textContent = css;
    sheet.appendChild(style);

    const core = el('div', 'core vcore');
    core.id = 'daf-core';
    sheet.appendChild(core);

    const usedIds = new Set();
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
      sheet.appendChild(reg);
    }
    for (const o of pp.ornaments || []) sheet.appendChild(buildOrnament(o));

    await Promise.all(faces.map(f => ensureWebFont(f.wf)));
    await document.fonts.ready;
    const anchored = anchorWords(sheet, faces, edition, pxPerPt);
    // Lines made of anchored words are fitted by word gap alone (fitStrictLines);
    // the advance model (k) only serves lines that could not be anchored.
    const fitCounts = fitStrictLines(sheet, pxPerPt, makeAdvanceModel(faces, edition, pxPerPt), anchored);
    fitCounts.anchoredWords = anchored;
    fitCounts.snapCompensated = compensateBaselineSnap(sheet);

    const H = sheet.getBoundingClientRect().height;
    core._vilnaPlan = null;
    core._vilnaCtx = null;
    core._vilnaResult = {
      policy: 'strict-vilna', rounds: 0, converged: true, scale: 1,
      maxEnd: H, targetCoreH: H, pxPerPt, fit: fitCounts,
    };
    console.log(`[vilna-daf] strict-vilna ${env.pol.fallback} lines=${sheet.querySelectorAll('.vl').length} ` +
      `fit=${JSON.stringify(fitCounts)}`);
    return { sheets: [sheet], pxPerPt, fitCounts };
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
      sheets: cont ? [sheet, cont] : [sheet],
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
    // Russian streams also need the Cyrillic face of each family loaded (unicode-range subsets).
    const probe = sheet.querySelector('.stream[lang="ru"]') ? 'אבגדה abc Жж' : 'אבגדה abc';
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
    // Latin/Cyrillic text has ascenders and descenders the Hebrew print leading (~0.87 of the size)
    // does not allow for: translated streams get a readable minimum leading.
    if (isLtrLang(effectiveLang(s))) {
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
      this._container.innerHTML =
        `<div class="page-sheet"><div class="loading"><span class="spinner"></span>טוען ${tractate} ${heb(page)}${side}...</div></div>`;
      this._container.dir = 'rtl';
      this._container.style.overflowX = '';
      const o = this._opts;
      const settings = this.settings;
      try {
        this._textStoreP = loadTextStore(tractate, page, side);
        const modelP = loadModel(tractate, page, side, settings, this._textStoreP).then(m => ({ m }), e => ({ e }));
        let profileId = null, profilePage = null, edition = null;
        if (o.layoutPolicy !== 'adaptive') {
          profileId = await resolveProfileId(o.profileBase, o.profileId);
          if (profileId) {
            [profilePage, edition] = await Promise.all([
              loadProfilePage(o.profileBase, profileId, tractate, page, side),
              editionProfile(o.profileBase, profileId),
            ]);
            this._profilePage = profilePage;
            this._edition = edition;
          }
        }
        const pol = resolvePolicy(settings, o, profilePage);
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
      const mh = hasModel ? modelHash(model) : null;
      const sefariaHashMatch = hasModel ? (!!profilePage.sefariaHash && mh === profilePage.sefariaHash) : null;
      const hasSegs = profilePage.regions.some(x => Array.isArray(x.segs) && x.segs.length);
      const linking = sefariaHashMatch && hasSegs ? 'full' : (hasModel ? 'degraded' : 'none');
      if (token !== this._token) return model; // navigation moved on
      this._current = model;
      const out = await renderStrict(this._container, model, profilePage, edition,
        { pol, opts: this._opts, applySegs: !!sefariaHashMatch });
      if (token !== this._token) return model;
      this._state = {
        policy: pol.policy, fallback: pol.fallback, reason: pol.reason, profileId,
        profilePage, edition, modelHash: mh, sefariaHashMatch, linking,
        sheets: out.sheets, pxPerPt: out.pxPerPt, adaptive: null,
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
      appendSourcesNote(this._container, model);
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
      const linking = sefariaHashMatch && hasSegs ? 'full' : (hasModel ? 'degraded' : 'none');
      if (token !== this._token) return model; // navigation moved on
      this._current = model;
      const out = await renderAnchored(this._container, model, profilePage, edition,
        { pol: Object.assign({}, pol, { plan: Object.assign({}, plan, { flow: flows }) }), opts: this._opts,
          applySegs: !!sefariaHashMatch, norm, flows, settings: s });
      if (token !== this._token) return model;
      this._state = {
        policy: pol.policy, fallback: pol.fallback, reason: pol.reason, profileId,
        profilePage: out.pp2, edition: out.edition2, modelHash: mh, sefariaHashMatch, linking,
        sheets: out.sheets, pxPerPt: out.pxPerPt, adaptive: null, anchored: out.anchored,
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
      appendSourcesNote(this._container, model);
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
  VilnaDaf._internals = { // for tests
    parseMasoretRefs, parseVerseCitation, heNum, buildPrintedAnchors,
    solve, normalizeModel, stripHtml, sanitizeHtml,
    canonicalSettings, profileLineText, segLookup, adaptiveConstants, LAYOUT, FIT,
    transformProfile, measureRestyleFits, computeSlot, TEXT_LANGS, isLtrLang, effectiveLang,
    resolveBlock, applyTextStore,
  };

  global.VilnaDaf = VilnaDaf;
})(typeof window !== 'undefined' ? window : globalThis);
