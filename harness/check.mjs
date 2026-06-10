/**
 * check.mjs — DOM-level acceptance checks for the Vilna Daf renderer (§4).
 *
 * Usage:  node check.mjs                 # full matrix + one random held-out daf
 *         node check.mjs Berachot 5 b    # single page
 *
 * Serves the repo root itself (no external server needed), drives Chromium,
 * asserts checks 1-8 per page, and writes a screenshot per page to out/.
 */

import { chromium } from 'playwright';
import http from 'http';
import { promises as fsp } from 'fs';
import { createReadStream, mkdirSync, readFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = process.env.VILNA_OUT || join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png',
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(ROOT, path === '/' ? 'index.html' : path.slice(1));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fsp.stat(file).then(st => {
        if (!st.isFile()) throw new Error('dir');
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        createReadStream(file).pipe(res);
      }).catch(() => { res.writeHead(404); res.end('not found'); });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const MATRIX = [
  { tractate: 'Berachot', page: 2, side: 'a', cached: true },
  { tractate: 'Berachot', page: 4, side: 'b', cached: true },
  { tractate: 'Berachot', page: 5, side: 'b', cached: true },
  { tractate: 'Berachot', page: 10, side: 'a', cached: true },
  { tractate: 'Yoma', page: 3, side: 'a', cached: true },
];

function randomDaf() {
  const tractates = JSON.parse(readFileSync(join(ROOT, 'data/tractates.json'), 'utf8'))
    // Bavli-printed Shekalim is the Yerushalmi — no Bavli daf text on Sefaria.
    .filter(t => t.name_en !== 'Shekalim');
  const t = tractates[Math.floor(Math.random() * tractates.length)];
  const page = 2 + Math.floor(Math.random() * (t.last_page - 2));
  const side = Math.random() < 0.5 ? 'a' : 'b';
  return { tractate: t.name_en, page, side, cached: false, heldOut: true };
}

// ── In-page measurement: returns everything the assertions need ──
async function measurePage(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.page-sheet');
    const core = document.querySelector('#daf-core');
    if (!sheet || !core) return { fatal: 'no sheet/core' };
    const sheetR = sheet.getBoundingClientRect();
    const coreR = core.getBoundingClientRect();

    // Per-stream text line rects (merged per visual line)
    function lineRects(container) {
      if (!container) return [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      const raw = [];
      let node;
      while ((node = walker.nextNode())) {
        const r = document.createRange();
        r.selectNodeContents(node);
        for (const rect of r.getClientRects()) {
          if (rect.width > 2 && rect.height > 2) {
            raw.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
          }
        }
      }
      // merge fragments on the same line
      raw.sort((a, b) => a.y - b.y || a.x - b.x);
      const lines = [];
      for (const r of raw) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - r.y) < r.h * 0.5) {
          const x0 = Math.min(last.x, r.x), x1 = Math.max(last.x + last.w, r.x + r.w);
          last.x = x0; last.w = x1 - x0; last.h = Math.max(last.h, r.h);
        } else lines.push({ ...r });
      }
      return lines;
    }

    const streams = {};
    for (const name of ['gemara', 'rashi', 'tosafot']) {
      const elc = document.querySelector(`#${name}-block`);
      streams[name] = {
        lines: lineRects(elc),
        text: elc ? elc.textContent : '',
        fontFamily: elc ? getComputedStyle(elc).fontFamily : '',
      };
    }

    const headerText = (document.querySelector('.daf-header') || {}).textContent || '';
    const marginText = [...document.querySelectorAll('.daf-margin')].map(m => m.textContent).join(' ');
    const allText = Object.values(streams).map(s => s.text).join(' ') + headerText + marginText;

    const plan = core._vilnaPlan || null;
    const ctx = core._vilnaCtx || null;
    const planOut = plan && {
      gemara: { start: plan.gemara.start, end: plan.gemara.end, bands: plan.gemara.bands },
      rashi: { start: plan.rashi.start, end: plan.rashi.end, bands: plan.rashi.bands },
      tosafot: { start: plan.tosafot.start, end: plan.tosafot.end, bands: plan.tosafot.bands },
    };

    return {
      sheet: { x: sheetR.x, y: sheetR.y, w: sheetR.width, h: sheetR.height },
      core: { x: coreR.x, y: coreR.y, w: coreR.width, h: coreR.height },
      streams,
      headerText: headerText.trim(),
      allText,
      plan: planOut,
      gutter: ctx ? ctx.gutter : 12,
      result: core._vilnaResult || null,
      rashiFontLoaded: document.fonts.check('16px RashiScript'),
    };
  });
}

function runChecks(name, m, spec, loadMs) {
  const fails = [];
  const warn = [];
  const ok = msg => { /* silent */ };

  if (m.fatal) return [`FATAL: ${m.fatal}`];

  // 1. sheet aspect within 2% of 0.707 (w/h). Exception sanctioned by the
  // spec fill law: if the global font scale is clamped at its lower bound
  // and the text still overruns the core, the page renders long and logs it.
  const aspect = m.sheet.w / m.sheet.h;
  if (Math.abs(aspect - 0.707) / 0.707 > 0.02) {
    const r = m.result;
    const atBound = r && r.scale <= 0.851 && r.maxEnd > r.targetCoreH;
    (atBound ? warn : fails).push(
      `aspect: sheet w/h=${aspect.toFixed(3)} not within 2% of 0.707` +
      (atBound ? ' (scale clamped at 0.85; page renders long per fill law)' : ''));
  }

  // 2. gemara line widths: narrow ≥ 0.40 coreW; widening below a dead commentary
  const gl = m.streams.gemara.lines;
  if (gl.length) {
    const firstWide = Math.max(...gl.slice(0, 4).map(l => l.w));
    if (firstWide < 0.40 * m.core.w) {
      fails.push(`gemara first lines max width ${Math.round(firstWide)} < 0.40*coreW=${Math.round(0.4 * m.core.w)}`);
    }
    const gemEnd = Math.max(...gl.map(l => l.y + l.h));
    for (const cname of ['rashi', 'tosafot']) {
      const cl = m.streams[cname].lines;
      if (!cl.length) continue;
      const cEnd = Math.max(...cl.map(l => l.y + l.h));
      if (cEnd + 40 < gemEnd) {
        const below = gl.filter(l => l.y > cEnd + 10);
        const narrow = Math.min(...gl.slice(0, 6).map(l => l.w));
        if (below.length && Math.max(...below.map(l => l.w)) < narrow + 30) {
          fails.push(`no gemara widening below ${cname} end (${Math.round(cEnd)})`);
        }
      }
    }
  } else if (m.streams.gemara.text.trim()) {
    fails.push('gemara has text but zero rendered lines');
  }

  // 3. no two stream text fragments intersect
  const namesS = ['gemara', 'rashi', 'tosafot'];
  let overlaps = 0; let worst = null;
  for (let i = 0; i < namesS.length; i++) {
    for (let j = i + 1; j < namesS.length; j++) {
      for (const a of m.streams[namesS[i]].lines) {
        for (const b of m.streams[namesS[j]].lines) {
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 2 && oy > 3) {
            overlaps++;
            if (!worst || ox * oy > worst.area) {
              worst = { area: ox * oy, pair: `${namesS[i]}/${namesS[j]}`, ox: Math.round(ox), oy: Math.round(oy), y: Math.round(a.y) };
            }
          }
        }
      }
    }
  }
  if (overlaps) fails.push(`text overlap: ${overlaps} line pairs, worst ${JSON.stringify(worst)}`);

  // 4. no empty quadrant: 3×3 grid; occupied-by-plan cells must contain text
  if (m.plan) {
    const W = m.core.w, H = m.core.h;
    const allLines = namesS.flatMap(n => m.streams[n].lines.map(l => ({
      x: l.x - m.core.x, y: l.y - m.core.y, w: l.w, h: l.h,
    })));
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const cell = { x: gx * W / 3, y: gy * H / 3, w: W / 3, h: H / 3 };
        // does the plan say this cell is (mostly) occupied? x measured from right edge
        let planned = 0;
        for (const n of namesS) {
          for (const b of m.plan[n].bands) {
            const bx = W - b.b, bw = b.b - b.a; // physical left x and width
            const ox = Math.min(bx + bw, cell.x + cell.w) - Math.max(bx, cell.x);
            const oy = Math.min(b.y1, cell.y + cell.h) - Math.max(b.y0, cell.y);
            if (ox > 0 && oy > 0) planned += ox * oy;
          }
        }
        if (planned > 0.5 * cell.w * cell.h) {
          const hasText = allLines.some(l => {
            const ox = Math.min(l.x + l.w, cell.x + cell.w) - Math.max(l.x, cell.x);
            const oy = Math.min(l.y + l.h, cell.y + cell.h) - Math.max(l.y, cell.y);
            return ox > 10 && oy > 5;
          });
          if (!hasText) fails.push(`empty cell (${gx},${gy}) though plan occupies it`);
        }
      }
    }
  } else {
    fails.push('no _vilnaPlan exposed on core');
  }

  // 5. sanitizer/strip health
  if (/[֑-ֽֿ-ׇׅ]/.test(m.allText)) fails.push('diacritics present in rendered text');
  for (const bad of ['<', '&nbsp;', 'class=']) {
    if (m.allText.includes(bad)) fails.push(`literal ${JSON.stringify(bad)} in rendered text`);
  }

  // 6. Rashi font actually loaded and applied
  if (!m.rashiFontLoaded) fails.push("document.fonts.check('16px RashiScript') is false");
  if (!/RashiScript/.test(m.streams.rashi.fontFamily)) fails.push(`rashi font-family = ${m.streams.rashi.fontFamily}`);

  // 7. header: Hebrew only, perek pattern
  if (/[A-Za-z]/.test(m.headerText)) fails.push(`Latin chars in header: ${m.headerText}`);
  if (!/ע״[אב]/.test(m.headerText)) fails.push(`no amud marker in header: ${m.headerText}`);
  if (!/פרק/.test(m.headerText)) warn.push(`no פרק in header: ${m.headerText}`);

  // 8. performance + convergence
  if (spec.cached && loadMs > 2000) fails.push(`cached load took ${loadMs}ms > 2000ms`);
  if (!m.result) fails.push('no _vilnaResult on core');
  else if (m.result.rounds > 8) fails.push(`relaxation took ${m.result.rounds} rounds`);

  return { fails, warn };
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1400 },
    deviceScaleFactor: 2,
  });

  const args = process.argv.slice(2);
  const pages = args.length === 3
    ? [{ tractate: args[0], page: +args[1], side: args[2], cached: true }]
    : [...MATRIX, randomDaf()];

  let anyFail = false;
  for (const spec of pages) {
    const name = `${spec.tractate}-${spec.page}${spec.side}${spec.heldOut ? '-heldout' : ''}`;
    const pg = await context.newPage();
    const logs = [];
    pg.on('console', msg => logs.push(msg.text()));
    const t0 = Date.now();
    try {
      await pg.goto(
        `http://127.0.0.1:${port}/index.html?tractate=${encodeURIComponent(spec.tractate)}&page=${spec.page}&side=${spec.side}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pg.waitForFunction(
        () => { const c = document.querySelector('#daf-core'); return c && c._vilnaResult; },
        null, { timeout: spec.cached ? 20000 : 60000 });
    } catch (e) {
      console.log(`\n=== ${name}: FATAL ${e.message.split('\n')[0]}`);
      console.log('  console:', logs.slice(-5).join(' | '));
      anyFail = true;
      await pg.close();
      continue;
    }
    const loadMs = Date.now() - t0;
    const m = await measurePage(pg);
    const { fails, warn } = runChecks(name, m, spec, loadMs);

    const sheetEl = await pg.$('.page-sheet');
    if (sheetEl) await sheetEl.screenshot({ path: join(OUT, `${name}.png`) });

    const r = m.result || {};
    console.log(`\n=== ${name}  (${loadMs}ms, rounds=${r.rounds}, converged=${r.converged}, scale=${(r.scale || 0).toFixed(3)}, maxEnd=${Math.round(r.maxEnd || 0)}/${Math.round(r.targetCoreH || 0)})`);
    if (fails.length) {
      anyFail = true;
      for (const f of fails) console.log(`  FAIL: ${f}`);
    } else {
      console.log('  PASS (all checks)');
    }
    for (const w of warn) console.log(`  warn: ${w}`);
    await pg.close();
  }

  await browser.close();
  srv.close();
  process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
