/**
 * contextBuilder.js — builds the chavruta's system prompt (§2 + §3).
 *
 * Input: the renderer's RAW model (as loaded from cache / Sefaria) for the
 * current daf. Previous/next amud models are fetched from the local data
 * cache when available; missing neighbors are simply omitted (they are
 * continuity aids, not primary content). The current daf is NEVER
 * truncated; prev/next tails are condensed.
 *
 * The payload is cached per daf and built once per navigation (§2.5).
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const cache = new Map(); // dafKey -> Promise<string>

  // ── plain-text helpers ─────────────────────────────────────────

  function plain(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.innerHTML = String(s).replace(/<br\s*\/?>/gi, ' ');
    return d.textContent.replace(/\s+/g, ' ').trim();
  }

  function segText(seg) {
    const arr = Array.isArray(seg) ? seg.flat(3) : [seg];
    return arr.filter(Boolean).map(plain).join(' ').trim();
  }

  /** {dh, body} from a commentary segment's raw HTML. */
  function dhSplit(raw) {
    const html = Array.isArray(raw) ? raw.flat(3).filter(Boolean).join(' ') : String(raw || '');
    const m = /<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/i.exec(html);
    const full = plain(html);
    if (m) {
      const dh = plain(m[1]);
      return { dh, body: full.startsWith(dh) ? full.slice(dh.length).replace(/^[\s—–:-]+/, '') : full };
    }
    const words = full.split(' ');
    return { dh: words.slice(0, 4).join(' '), body: words.slice(4).join(' ') };
  }

  const hebNum = n => (NS._heb ? NS._heb(n) : String(n));

  // ── scholars (Tannaim / Amoraim) heuristic extraction ──────────

  const STANDALONE_SCHOLARS = [
    'אביי', 'רבא', 'רבה', 'שמואל', 'עולא', 'הלל', 'שמאי', 'רבינא', 'מרימר',
    'אמימר', 'ריש לקיש', 'בן עזאי', 'בן זומא', 'אבוה', 'רב', 'אדמון',
  ];

  function extractScholars(gemaraPlain) {
    const found = new Set();
    const re = /(?:רבי|רבן|רב|ר׳)\s[א-ת]{2,}(?:\s(?:בר|בן|איש)\s[א-ת]{2,}){0,2}/g;
    let m;
    while ((m = re.exec(gemaraPlain))) {
      const name = m[0].trim();
      // Skip false positives like "רב לכם".
      if (!/^(?:רב|רבי|רבן|ר׳)\s(?:לכם|אחד|הוא|זה|מאד)/.test(name)) found.add(name);
    }
    for (const n of STANDALONE_SCHOLARS) {
      if (new RegExp(`(?:^|[^\\u05d0-\\u05ea])${n}(?:$|[^\\u05d0-\\u05ea])`).test(gemaraPlain)) found.add(n);
    }
    return [...found].slice(0, 40);
  }

  // ── apparatus sections ─────────────────────────────────────────

  function segNumOf(lk) {
    const m = /:(\d+)/.exec(lk.anchorRef || '');
    return m ? m[1] : '?';
  }

  function linksSection(title, arr, withText) {
    if (!arr || !arr.length) return '';
    const lines = arr.map(lk => {
      const extra = withText && lk.he ? ` — "${plain(Array.isArray(lk.he) ? lk.he.join(' ') : lk.he)}"` : '';
      return `[segment ${segNumOf(lk)}] → ${lk.sourceRef || lk.sourceHeRef || ''}${extra}`;
    });
    return `--- ${title} ---\n${lines.join('\n')}\n\n`;
  }

  function commentarySection(title, segs) {
    if (!segs || !segs.some(s => s && (Array.isArray(s) ? s.length : true))) return '';
    const lines = [];
    segs.forEach((seg, i) => {
      const items = Array.isArray(seg) ? seg : (seg ? [seg] : []);
      for (const it of items) {
        if (!it) continue;
        const { dh, body } = dhSplit(it);
        lines.push(`[on segment ${i + 1}] DH: ${dh} — ${body}`);
      }
    });
    return lines.length ? `--- ${title} ---\n${lines.join('\n')}\n\n` : '';
  }

  function gemaraSection(model) {
    const lines = (model.gemara || []).map((seg, i) => {
      const raw = Array.isArray(seg) ? seg.join(' ') : String(seg || '');
      const mish = /<big/i.test(raw) ? ' [MISHNAH]' : '';
      return `[${i + 1}]${mish} ${segText(seg)}`;
    });
    return `--- GEMARA ---\n${lines.join('\n')}\n\n`;
  }

  /** Condensed neighbor: a fraction of the gemara + brief commentary DHs. */
  function condensed(model, which) {
    if (!model) return '';
    const segs = model.gemara || [];
    const n = Math.max(1, Math.round(segs.length * 0.4));
    const slice = which === 'tail' ? segs.slice(-n) : segs.slice(0, n);
    const base = which === 'tail' ? segs.length - n : 0;
    const label = which === 'tail'
      ? `--- PREVIOUS AMUD (tail) — ${model.tractate} ${model.page}${model.side} — END OF PREVIOUS AMUD (for continuity) ---`
      : `--- NEXT AMUD (head) — ${model.tractate} ${model.page}${model.side} — START OF NEXT AMUD (for continuity) ---`;
    const lines = slice.map((seg, i) => `[${which === 'tail' ? 'prev ' : 'next '}${base + i + 1}] ${segText(seg)}`);
    const briefs = [];
    for (const [name, list] of [['Rashi', model.rashi], ['Tosafot', model.tosafot]]) {
      (list || []).forEach((seg, i) => {
        const inRange = which === 'tail' ? i >= base : i < n;
        if (!seg || !inRange || briefs.length >= 8) return;
        const items = Array.isArray(seg) ? seg : [seg];
        if (items[0]) {
          const { dh, body } = dhSplit(items[0]);
          briefs.push(`${name} [${i + 1}] DH: ${dh} — ${body.split(' ').slice(0, 15).join(' ')}…`);
        }
      });
    }
    return `${label}\n${lines.join('\n')}${briefs.length ? '\nKey commentary:\n' + briefs.join('\n') : ''}\n\n`;
  }

  // ── neighbor + metadata fetches ──
  // Prefer the local data cache; if a neighbor isn't cached, fall back to
  // the renderer's live loader (set as NS._neighborLoader) so the AI still
  // gets the previous/next amud on the deployed site. Failures omit the
  // neighbor — it is a continuity aid, not primary content.

  async function tryCachedModel(tractate, page, side) {
    try {
      const r = await fetch(`data/${tractate}/${page}${side}.json`);
      if (r.ok) return await r.json();
    } catch (e) { /* fall through to live */ }
    if (typeof NS._neighborLoader === 'function') {
      try { return await NS._neighborLoader(tractate, page, side); }
      catch (e) { /* neighbor unavailable — omit */ }
    }
    return null;
  }

  function neighborRefs(model) {
    const { page, side } = model;
    return {
      prev: side === 'a' ? { page: page - 1, side: 'b' } : { page, side: 'a' },
      next: side === 'a' ? { page, side: 'b' } : { page: page + 1, side: 'a' },
    };
  }

  // ── persona (§3) ───────────────────────────────────────────────

  function persona(model) {
    return `You are an AI חברותא (Talmud study partner). The user is studying ${model.tractate} ${model.page}${model.side}.
You have the full text of the current page, its Rashi and Tosafot commentary, cross-references,
and surrounding context.

Your role:
- Answer questions about the sugya (topic), the flow of the argument, the opinions cited.
- Explain Rashi and Tosafot's interpretations and where they disagree.
- Identify the Tannaim and Amoraim by name, generation, and known positions.
- Translate difficult Aramaic phrases.
- Connect the sugya to the relevant Mishnah and to halachic conclusions (Ein Mishpat refs).
- When quoting the text, cite by segment number so the user can find it on the page.

Guidelines:
- Answer in the language the user writes in (Hebrew or English or mixed).
- Be precise — cite the text. Don't generalize when the user asks about a specific line.
- If Rashi and Tosafot disagree on a point, present both views.
- If you're unsure or the question is beyond the provided text, say so.
- Keep answers focused; a chavruta explains clearly, doesn't lecture.
- Use segment references like "[segment 5]" so the user can cross-reference the daf.

`;
  }

  // ── build ──────────────────────────────────────────────────────

  async function buildNow(model) {
    const refs = neighborRefs(model);
    const [prevM, nextM, tractates] = await Promise.all([
      refs.prev.page >= 2 ? tryCachedModel(model.tractate, refs.prev.page, refs.prev.side) : null,
      tryCachedModel(model.tractate, refs.next.page, refs.next.side),
      fetch('data/tractates.json').then(r => r.json()).catch(() => []),
    ]);

    const tInfo = (tractates || []).find(t => t.name_en === model.tractate);
    const ch = model.chapter || {};
    const sideHe = model.side === 'a' ? 'עמוד א׳' : 'עמוד ב׳';
    const gemaraPlain = (model.gemara || []).map(segText).join(' ');

    let out = persona(model);
    out += `== CURRENT DAF: ${model.tractate} ${model.page}${model.side}`
      + ` (${model.tractateHe || ''} דף ${hebNum(model.page)} ${sideHe}) ==\n`;
    if (ch.name) out += `== PEREK: ${ch.name} (${ch.num})${ch.startsHere ? ' — THE PEREK BEGINS ON THIS DAF' : ''} ==\n`;
    if (tInfo) out += `== POSITION: daf ${model.page} of ${tInfo.last_page} in ${model.tractate} ==\n`;
    out += `== DATE: ${new Date().toISOString().slice(0, 10)} ==\n\n`;

    const hasMishnah = (model.gemara || []).some(s => /<big/i.test(Array.isArray(s) ? s.join(' ') : String(s || '')));
    if (hasMishnah) {
      out += `--- MISHNAH ---\nSegments marked [MISHNAH] below contain Mishnah text (rendered large in the Vilna layout).\n\n`;
    }

    out += gemaraSection(model);
    out += commentarySection('RASHI', model.rashi);
    out += commentarySection('TOSAFOT', model.tosafot);

    const links = model.links || {};
    out += linksSection('CROSS REFERENCES (Masoret HaShas)', links.mesoretHaShas);
    out += linksSection('HALACHIC REFERENCES (Ein Mishpat Ner Mitzvah)', links.einMishpat);
    out += linksSection('TORAH OR (Biblical verses)', links.torahOr, true);

    for (const [key, ex] of Object.entries(model.extras || {})) {
      const txt = (ex.segments || []).flat(3).filter(Boolean).map(plain).join(' ');
      if (!txt) continue;
      const capped = txt.length > 2500 ? txt.slice(0, 2500) + ' …[truncated]' : txt;
      out += `--- ${ex.title || key} ---\n${capped}\n\n`;
    }

    out += condensed(prevM, 'tail');
    out += condensed(nextM, 'head');

    const scholars = extractScholars(gemaraPlain);
    if (scholars.length) out += `--- NAMED SCHOLARS ON THIS DAF ---\n${scholars.join(', ')}\n\n`;

    return out.trim();
  }

  NS.context = {
    /** Build (or reuse) the system prompt for this daf. */
    build(model) {
      const key = `${model.tractate}-${model.page}${model.side}`;
      if (!cache.has(key)) cache.set(key, buildNow(model).catch(e => { cache.delete(key); throw e; }));
      return cache.get(key);
    },
    invalidate(key) { if (key) cache.delete(key); else cache.clear(); },
    _internals: { plain, dhSplit, extractScholars, condensed, segText },
  };
})(typeof window !== 'undefined' ? window : globalThis);
