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
    extras: ['hagahotHaBach', 'gilyonHaShas', 'rabbeinuChananel', 'ravNissimGaon'],
    // Typography. Fonts take 'rashi' | 'frank' | any CSS font-family string.
    commFont: 'rashi',    // commentary columns, margins, bottom strip
    gemaraFont: 'frank',  // the center text
    fontScale: 1,         // user multiplier on all font sizes (0.7–1.5)
  };

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
    const cleanG = ed.strip ? cleanGemara : softClean;
    const cleanC = s.lang === 'he' ? cleanComment : softClean;
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

    const mesoret = [], einMishpat = [], torahOr = [];
    for (const lk of (Array.isArray(linksData) ? linksData : [])) {
      const cat = (lk.category || '').toLowerCase();
      const typ = (lk.type || '').toLowerCase();
      if (cat === 'talmud' || typ.includes('mesoret') || typ.includes('masoret')) mesoret.push(lk);
      else if (cat === 'halakhah' || typ.includes('mishpat') || typ.includes('ner')) einMishpat.push(lk);
      else if (cat === 'tanakh' || typ.includes('torah or')) torahOr.push(lk);
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

  async function loadModel(tractate, page, side, settings) {
    let base = null;
    try {
      const r = await fetch(`data/${tractate}/${page}${side}.json`);
      if (r.ok) base = await r.json();
    } catch (e) { /* fall through to live */ }
    if (!base) {
      base = await fetchDafLive(tractate, page, side);
      if (!base.tractateHe) {
        // Header is Hebrew-only — never fall back to the English name.
        try {
          const ts = await (await fetch('data/tractates.json')).json();
          const ti = ts.find(x => x.name_en === tractate);
          if (ti) base.tractateHe = ti.name_he;
        } catch (e) { /* leave blank */ }
      }
    }
    return applySettings(base, settings || DEFAULT_SETTINGS);
  }

  /**
   * Reconstruct the model around the user's source selection. The cached
   * model covers the defaults; anything else is fetched live, in parallel.
   * A selected text that does not exist for this daf yields an empty stream
   * (probe-and-render: omit, never fabricate).
   */
  async function applySettings(base, s) {
    const model = Object.assign({}, base);
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
    const cw = Math.round(LAYOUT.C0 * W);
    const g = ctx.gutter;
    const slack = {
      rashi: 0.9 * ctx.lhComm, tosafot: 0.9 * ctx.lhComm, gemara: 0.9 * ctx.lhGem,
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
          if (ctx.mirror) gb -= ctx.box.w + ctx.boxGutter;
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
    for (const d of defs) {
      idx[d.key] = { cls: d.cls, title: d.title, entries: [] };
      (links[d.key] || []).forEach((lk, i) => {
        const m = (lk.anchorRef || '').match(/:(\d+)/);
        // Torah Or links carry the full verse text — render it whole.
        const heRaw = Array.isArray(lk.he) ? lk.he.join(' ') : (lk.he || '');
        idx[d.key].entries.push({
          id: `note-${d.key}-${i}`,
          segNum: m ? parseInt(m[1]) : 0,
          letter: hebLetter(i),
          ref: stripText((lk.sourceHeRef || lk.sourceRef || '')),
          verse: heRaw ? cleanGemara(heRaw) : '',
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

  function marginNotesHTML(entries) {
    return entries.map(e =>
      `<span class="marg-note" id="${e.id}" data-seg="${e.segNum}"><span class="key">${e.letter}</span> ` +
      (e.verse ? `<span class="verse-text">${e.verse}</span> ` : '') +
      `<span class="note-ref">${e.ref}</span></span>`
    ).join('');
  }

  function marginBlock(title, inner) {
    return inner ? `<div class="marg-block"><span class="marg-title">${title}</span>${inner}</div>` : '';
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
    inner.innerHTML = '<div class="marg-clip">' +
      marginBlock('מסורת הש״ס', marginNotesHTML(keyIdx.mesoretHaShas.entries)) +
      (model.extras.hagahotHaBach
        ? marginBlock(model.extras.hagahotHaBach.title, `<span class="marg-note">${model.extras.hagahotHaBach.html}</span>`) : '') +
      (model.extras.gilyonHaShas
        ? marginBlock(model.extras.gilyonHaShas.title, `<span class="marg-note">${model.extras.gilyonHaShas.html}</span>`) : '') +
      '</div>';
    const outer = el('div', 'daf-margin margin-outer');
    outer.innerHTML = '<div class="marg-clip">' +
      marginBlock('עין משפט נר מצוה', marginNotesHTML(keyIdx.einMishpat.entries)) +
      marginBlock('תורה אור', marginNotesHTML(keyIdx.torahOr.entries)) +
      '</div>';
    return { inner, outer };
  }

  function buildBottomStrip(model) {
    const parts = [];
    // Catalog order; margin-slot extras render in the margins, not here.
    for (const def of EXTRA_COMMENTARIES) {
      if (def.slot === 'margin') continue;
      const ex = model.extras[def.id];
      if (ex) parts.push(`<div class="strip-block"><span class="strip-title">${ex.title}</span> ${ex.html}</div>`);
    }
    if (!parts.length) return null;
    const strip = el('div', 'daf-bottom-strip');
    strip.innerHTML = parts.join('');
    return strip;
  }

  // ═════════════════════ Relaxation + fill (§2.3, §2.4) ═════════════════════

  function makeCtx(core, model, scale) {
    const W = core.clientWidth;
    const us = (model.settings && model.settings.fontScale) || 1;
    const fsGem = LAYOUT.fsGem * scale * us;
    const fsComm = fsGem * LAYOUT.ratioComm;
    const lhGem = fsGem * LAYOUT.lhGem;
    const lhComm = fsComm * LAYOUT.lhComm;
    return {
      W,
      fsGem, fsComm, lhGem, lhComm,
      gutter: gutterPx(fsGem, fsComm),
      boxGutter: Math.round(0.4 * fsGem),
      yTop: Math.round(LAYOUT.yTopLines * lhComm),
      mirror: model.side === 'b',
      has: {
        gemara: (model.gemara || []).some(s => s),
        rashi: (model.rashi || []).some(c => c.length),
        tosafot: (model.tosafot || []).some(c => c.length),
      },
      box: null, // measured after first paint when a chapter-start box exists
    };
  }

  function estimateEnds(model, ctx) {
    const count = arr => arr.flat(2).join(' ').replace(/<[^>]*>/g, '').length;
    const lines = (chars, width, fs) => Math.ceil(chars / Math.max(8, width / (0.46 * fs)));
    const cw = LAYOUT.C0 * ctx.W;
    const gw = ctx.W - 2 * cw - 2 * ctx.gutter;
    return {
      gemara: ctx.yTop + lines(count(model.gemara || []), gw, ctx.fsGem) * ctx.lhGem,
      rashi: lines(count(model.rashi || []), cw, ctx.fsComm) * ctx.lhComm,
      tosafot: lines(count(model.tosafot || []), cw, ctx.fsComm) * ctx.lhComm,
    };
  }

  function relax(core, containers, model, ctx, seedEnds) {
    let ends = Object.assign({}, seedEnds);
    let rounds = 0, converged = false;
    const boxEl = core.querySelector('.first-word');
    for (let r = 0; r < LAYOUT.relaxRounds; r++) {
      rounds++;
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
        boxEl.style.right = `${Math.max(0, Math.round((gb ? gb.a : 0) - intr))}px`;
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
      if (done) { converged = true; break; }
    }
    return { ends, rounds, converged };
  }

  async function layoutPage(sheet, core, containers, model) {
    const targetSheetH = Math.round(sheet.getBoundingClientRect().width / SHEET_ASPECT);

    let scale = 1, result = null, maxEnd = 0, targetCoreH = 0;
    let seed = null;
    for (let probe = 0; probe < LAYOUT.fillProbes; probe++) {
      sheet.style.setProperty('--s', scale);
      // Header / bottom strip / paddings scale with --s too — measure them
      // live against a fixed probe core height.
      core.style.height = '100px';
      const chromeH = sheet.getBoundingClientRect().height - 100;
      // With many extra commentaries the bottom strip can exceed the sheet
      // budget; keep a sane core and let the page run long (logged below).
      targetCoreH = Math.max(0.45 * targetSheetH, targetSheetH - chromeH);

      const ctx = makeCtx(core, model, scale);
      result = relax(core, containers, model, ctx, seed || estimateEnds(model, ctx));
      seed = result.ends;
      maxEnd = Math.max(result.ends.gemara, result.ends.rashi, result.ends.tosafot);
      if (Math.abs(maxEnd - targetCoreH) <= ctx.lhGem) break;
      const next = Math.min(LAYOUT.scaleMax,
        Math.max(LAYOUT.scaleMin, scale * Math.sqrt(targetCoreH / Math.max(1, maxEnd))));
      if (Math.abs(next - scale) < 0.004) { scale = next; break; }
      scale = next;
    }
    core.style.height = `${Math.round(Math.max(targetCoreH, maxEnd + 4))}px`;
    core._vilnaResult = {
      rounds: result.rounds, converged: result.converged,
      scale, maxEnd, targetCoreH, ends: result.ends,
    };
    console.log(`[vilna-daf] relax rounds=${result.rounds} converged=${result.converged} ` +
      `scale=${scale.toFixed(3)} maxEnd=${Math.round(maxEnd)} targetCoreH=${Math.round(targetCoreH)}`);
    return result;
  }

  // ═════════════════════════ Interactivity ═════════════════════════

  const _hlEls = new Set();
  let _activeSeg = null;
  function initHover(sheet) {
    function clr() {
      for (const e of _hlEls) e.classList.remove('hl-seg');
      _hlEls.clear(); _activeSeg = null;
    }
    function hl(seg) {
      if (seg === _activeSeg) return;
      clr(); _activeSeg = seg;
      for (const e of sheet.querySelectorAll(`[data-seg="${seg}"]`)) {
        if (e.classList.contains('comment') || e.classList.contains('gseg')) {
          e.classList.add('hl-seg'); _hlEls.add(e);
        }
      }
    }
    sheet.addEventListener('pointerover', e => {
      const se = e.target.closest('[data-seg]');
      if (se) hl(se.dataset.seg);
    });
    sheet.addEventListener('pointerout', e => {
      if (!(e.relatedTarget && e.relatedTarget.closest('[data-seg]'))) clr();
    });
    sheet.addEventListener('click', e => {
      const rk = e.target.closest('.ref-key');
      if (rk) {
        const note = sheet.querySelector('#' + CSS.escape(rk.dataset.target || ''));
        if (note) {
          note.scrollIntoView({ behavior: 'smooth', block: 'center' });
          note.classList.add('hl-flash');
          setTimeout(() => note.classList.remove('hl-flash'), 1500);
        }
        return;
      }
      const se = e.target.closest('.gseg[data-seg]');
      if (!se) return;
      const c = sheet.querySelector(`.comment[data-seg="${se.dataset.seg}"]`);
      if (c) {
        c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        c.classList.add('hl-flash');
        setTimeout(() => c.classList.remove('hl-flash'), 1500);
      }
    });
  }

  function initZoomPan(sheet) {
    let s = 1, tx = 0, ty = 0, drag = false, sx = 0, sy = 0;
    const MIN = 0.4, MAX = 6;
    function ap() {
      sheet.style.transform = `scale(${s}) translate(${tx}px,${ty}px)`;
      sheet.style.transformOrigin = 'top center';
      sheet.style.cursor = s > 1.02 ? (drag ? 'grabbing' : 'grab') : '';
    }
    sheet.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ns = Math.max(MIN, Math.min(MAX, s * (e.deltaY > 0 ? 0.9 : 1.1)));
      const r = sheet.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      tx += cx * (1 / ns - 1 / s); ty += cy * (1 / ns - 1 / s);
      s = ns; ap();
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
  }

  // ═════════════════════════ render one daf ═════════════════════════

  async function renderDaf(container, rawModel, settings) {
    const s = settings || rawModel.settings || DEFAULT_SETTINGS;
    const model = normalizeModel(rawModel, s);
    if (!model.gemara.some(x => x && x.trim())) {
      // Render nothing rather than a blank sheet (e.g. Bavli-printed Shekalim
      // is the Yerushalmi and is not addressable as a Bavli daf on Sefaria).
      throw new Error('אין טקסט גמרא זמין לדף זה');
    }
    container.innerHTML = '';
    container.dir = 'rtl';

    const sheet = el('div', `page-sheet side-${model.side}`);
    // Typography settings ride on CSS custom properties; the fill loop's
    // global scale --s multiplies on top of the user scale --us.
    if (s.fontScale && s.fontScale !== 1) sheet.style.setProperty('--us', String(s.fontScale));
    const commFam = fontFamilyCSS(s.commFont, 'rashi');
    const gemFam = fontFamilyCSS(s.gemaraFont, 'frank');
    if (commFam) sheet.style.setProperty('--font-comm', commFam);
    if (gemFam) sheet.style.setProperty('--font-main', gemFam);
    sheet.appendChild(buildHeader(model));

    const body = el('div', 'sheet-body');
    const keyIdx = buildKeyIndex(model);
    const { inner, outer } = buildMargins(model, keyIdx);
    const coreWrap = el('div', 'core-wrap');
    const core = el('div', 'core');
    core.id = 'daf-core';
    coreWrap.appendChild(core);

    // amud a: inner margin on the physical right; amud b mirrored.
    if (model.side === 'a') { body.append(inner, coreWrap, outer); }
    else { body.append(outer, coreWrap, inner); }
    sheet.appendChild(body);

    const strip = buildBottomStrip(model);
    if (strip) {
      if (s.lang === 'en') strip.classList.add('stream-ltr');
      sheet.appendChild(strip);
    }
    container.appendChild(sheet);

    // Stream containers: absolute, full core, two carve floats + flowing text.
    const containers = {};
    const gem = buildGemaraHTML(model, keyIdx);
    const defs = [
      ['gemara', 'stream-gemara', gem.html],
      ['rashi', 'stream-rashi', buildCommHTML('rashi', model)],
      ['tosafot', 'stream-tosafot', buildCommHTML('tosafot', model)],
    ];
    const ed = EDITIONS[s.edition] || EDITIONS.aramaic;
    for (const [name, cls, html] of defs) {
      const c = el('div', `stream ${cls}`);
      c.id = `${name}-block`;
      c.innerHTML = `<div class="carve carve-r"></div><div class="carve carve-l"></div>${html}`;
      // Direction follows the selected source, not the page chrome.
      if (name === 'gemara' ? ed.dir === 'ltr' : s.lang === 'en') c.classList.add('stream-ltr');
      core.appendChild(c);
      containers[name] = c;
    }
    if (gem.boxWord) {
      const box = el('span', 'first-word');
      box.textContent = gem.boxWord;
      box.dataset.seg = '1';
      containers.gemara.appendChild(box);
    }
    // Legacy alias kept for tooling that queries #gemara-block
    containers.gemara.classList.add('gemara');

    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await layoutPage(sheet, core, containers, model);

    initHover(sheet);
    initZoomPan(sheet);

    // Optional Context Sidebar (js/context-sidebar.js). Renders entirely
    // outside the sheet; layout/measurement are unaffected if it's absent.
    if (global.VilnaDafContextSidebar) {
      try {
        global.VilnaDafContextSidebar.attach({
          sheet,
          anchors: buildContextAnchors(model),
          fetchSnippet: fetchContextSnippet,
          appRouteFor,
        });
      } catch (e) { console.error('[vilna-daf] context sidebar:', e); }
    }
  }

  // ── Context Sidebar integration (Masoret HaShas only for now) ──

  function buildContextAnchors(model) {
    const sideHe = model.side === 'a' ? 'ע״א' : 'ע״ב';
    const cur = `${model.tractate} ${model.page}${model.side}`;
    const curHe = `${model.tractateHe || model.tractate} ${heb(model.page)} ${sideHe}`;
    return ((model.links || {}).mesoretHaShas || [])
      .map((lk, i) => ({
        id: `ctx-ms-${i}`,
        kind: 'mesoret-hashas',
        sourceRef: cur,
        sourceDisplay: curHe,
        targetRef: lk.sourceRef || '',
        label: 'מסורת הש״ס',
        displayText: stripText(lk.sourceHeRef || lk.sourceRef || ''),
        source: 'mesoret-hashas',
        confidence: 1,
        raw: lk,
        domId: `note-mesoretHaShas-${i}`,
      }))
      .filter(a => a.targetRef);
  }

  /** Fetch a plain-text snippet of a referenced source (Hebrew, stripped). */
  async function fetchContextSnippet(targetRef) {
    const segs = heSegments(await getText(targetRef));
    const flat = (Array.isArray(segs) ? segs : [segs]).flat(3).filter(Boolean);
    const text = flat.map(s => stripText(String(s).replace(/<[^>]+>/g, ' ')))
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
    constructor(opts = {}) {
      this._container = typeof opts.container === 'string'
        ? document.querySelector(opts.container)
        : opts.container;
      if (!this._container) throw new Error('VilnaDaf: container not found');
      this._tractates = null;
      this._current = null;
      this._loc = null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, opts.settings);
    }

    async load(tractate, page, side) {
      this._loc = { tractate, page, side };
      this._container.innerHTML =
        `<div class="page-sheet"><div class="loading"><span class="spinner"></span>טוען ${tractate} ${heb(page)}${side}...</div></div>`;
      this._container.dir = 'rtl';
      try {
        const model = await loadModel(tractate, page, side, this.settings);
        this._current = model;
        await renderDaf(this._container, model, this.settings);
        if (this._onLoad) this._onLoad(model);
        return model;
      } catch (err) {
        this._container.innerHTML =
          `<div class="page-sheet"><div class="error-state"><p>❌ ${err.message}</p></div></div>`;
        throw err;
      }
    }

    /**
     * Merge a settings patch and reconstruct the current page around it.
     * `extras` replaces the whole array; everything else merges per key.
     */
    async updateSettings(patch) {
      this.settings = Object.assign({}, this.settings, patch);
      if (this._loc) {
        return this.load(this._loc.tractate, this._loc.page, this._loc.side);
      }
    }

    async loadFromURL() {
      const p = new URLSearchParams(location.search);
      const tractate = p.get('tractate') || p.get('masechet') || p.get('m') || 'Berachot';
      const page = parseInt(p.get('page') || p.get('daf') || p.get('d') || '2');
      const side = (p.get('side') || p.get('amud') || p.get('s') || 'a').toLowerCase();
      return this.load(tractate, page, side);
    }

    async getTractates() {
      if (!this._tractates) this._tractates = await (await fetch('data/tractates.json')).json();
      return this._tractates;
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
  VilnaDaf.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  VilnaDaf._internals = { solve, normalizeModel, stripHtml, sanitizeHtml }; // for tests

  global.VilnaDaf = VilnaDaf;
})(typeof window !== 'undefined' ? window : globalThis);
