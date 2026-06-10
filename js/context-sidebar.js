/**
 * context-sidebar.js — Context Sidebar for Masoret HaShas references.
 *
 * A small, isolated module: the renderer hands it the anchor objects it
 * built from the page model (see ANCHOR SHAPE below) plus two optional
 * helpers, and this module does everything else — decorating the existing
 * margin-note elements (no extra wrapping of daf text), hover/focus
 * previews, click-to-pin, Escape to close, lazy snippet fetching with a
 * Map cache, and a bottom-sheet presentation on small screens.
 *
 * The sidebar element lives on document.body, OUTSIDE the page sheet, and
 * is position:fixed — it cannot affect page measurement, column layout, or
 * font sizing, and showing/hiding it causes no layout shift.
 *
 * ANCHOR SHAPE (built by the renderer):
 *   {
 *     id: string,              // unique per anchor, e.g. "ctx-ms-3"
 *     kind: "mesoret-hashas",
 *     sourceRef: string,       // the current daf, e.g. "Berachot 2a"
 *     sourceDisplay: string,   // Hebrew display of the current daf
 *     targetRef: string,       // the referenced location (Sefaria ref)
 *     label: string,           // e.g. "מסורת הש״ס"
 *     displayText: string,     // Hebrew display of the target ref
 *     source: "mesoret-hashas",
 *     confidence: 1,
 *     raw: object,             // the original link object
 *     domId: string,           // id of the existing element to decorate
 *   }
 *
 * attach({ sheet, anchors, fetchSnippet, appRouteFor }):
 *   fetchSnippet(targetRef) -> Promise<string|null>   (optional)
 *   appRouteFor(targetRef)  -> {tractate,page,side}|null (optional)
 *
 * No external dependencies.
 */
(function (global) {
  'use strict';

  const SNIPPET_MAX = 420;

  // targetRef -> { status: 'loading'|'ready'|'empty'|'error', text? }
  const cache = new Map();

  let host = null;
  let opts = { anchors: [], fetchSnippet: null, appRouteFor: null };
  let byId = {};
  let activeId = null;
  let pinned = false;
  let hideTimer = null;
  let escBound = false;

  // ── Host element (outside the page sheet) ──────────────────────

  function ensureHost() {
    if (host) return host;
    host = document.createElement('aside');
    host.id = 'context-sidebar';
    host.setAttribute('role', 'complementary');
    host.setAttribute('aria-label', 'הקשר — מסורת הש״ס');
    host.dir = 'rtl';
    host.hidden = true;
    document.body.appendChild(host);

    // Keep an unpinned preview open while the pointer is inside it.
    host.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    host.addEventListener('pointerleave', scheduleHide);
    host.addEventListener('click', e => {
      if (e.target.closest('.ctx-close')) closeAll();
    });

    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && host && !host.hidden) closeAll();
      });
    }
    return host;
  }

  // ── Show / hide state machine ──────────────────────────────────

  function show(anchor, pin) {
    // A pinned card is replaced only by an explicit click/Enter.
    if (pinned && !pin) return;
    clearTimeout(hideTimer);
    pinned = pinned || !!pin;
    activeId = anchor.id;
    renderCard(anchor);
    ensureHost().hidden = false;
    host.classList.toggle('pinned', pinned);
  }

  function scheduleHide() {
    if (pinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pinned) { host.hidden = true; activeId = null; }
    }, 250);
  }

  function closeAll() {
    pinned = false;
    clearTimeout(hideTimer);
    if (host) { host.hidden = true; host.classList.remove('pinned'); }
    activeId = null;
  }

  // ── Card rendering ─────────────────────────────────────────────

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function sefariaUrl(ref) {
    const m = /^(.+?)\s+(\d+[ab](?::\d+(?:-\d+)?)?)$/.exec(ref);
    if (m) return 'https://www.sefaria.org/' + m[1].replace(/ /g, '_') + '.' + m[2].replace(/:/g, '.');
    return 'https://www.sefaria.org/' + ref.replace(/ /g, '_');
  }

  function renderCard(anchor) {
    const h = ensureHost();
    const route = opts.appRouteFor && opts.appRouteFor(anchor.targetRef);
    const appHref = route
      ? `?tractate=${encodeURIComponent(route.tractate)}&page=${route.page}&side=${route.side}`
      : null;
    h.innerHTML =
      `<div class="ctx-head">
         <span class="ctx-label">${esc(anchor.label)}</span>
         <button class="ctx-close" type="button" aria-label="סגור">✕</button>
       </div>
       <div class="ctx-body">
         <div class="ctx-row"><span class="ctx-k">בדף</span>
           <span class="ctx-v">${esc(anchor.sourceDisplay || anchor.sourceRef)}</span></div>
         <div class="ctx-row"><span class="ctx-k">מפנה אל</span>
           <span class="ctx-v">${esc(anchor.displayText || anchor.targetRef)}
             <span class="ctx-ref-en" dir="ltr">${esc(anchor.targetRef)}</span></span></div>
         <div class="ctx-snippet" aria-live="polite"></div>
         <div class="ctx-minidaf"></div>
         <div class="ctx-actions">
           <a class="ctx-btn" href="${esc(sefariaUrl(anchor.targetRef))}" target="_blank" rel="noopener">פתח בספריא ↗</a>
           ${appHref ? `<a class="ctx-btn" href="${esc(appHref)}">פתח כאן</a>` : ''}
         </div>
       </div>`;
    renderSnippet(anchor, h.querySelector('.ctx-snippet'));
    renderMiniDafPreview(anchor.targetRef, anchor.sourceRef, h.querySelector('.ctx-minidaf'));
  }

  // ── Snippet: model text first, lazy fetch once, Map-cached ─────

  function rawHeText(raw) {
    if (!raw || raw.he == null) return null;
    const t = Array.isArray(raw.he) ? raw.he.flat(3).filter(Boolean).join(' ') : String(raw.he);
    const plain = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return plain || null;
  }

  function renderSnippet(anchor, el) {
    if (!el) return;
    const ref = anchor.targetRef;

    if (!cache.has(ref)) {
      const inline = rawHeText(anchor.raw);
      if (inline) {
        cache.set(ref, { status: 'ready', text: inline });
      } else if (opts.fetchSnippet) {
        cache.set(ref, { status: 'loading' });
        opts.fetchSnippet(ref)
          .then(text => cache.set(ref, text ? { status: 'ready', text } : { status: 'empty' }))
          .catch(() => cache.set(ref, { status: 'error' }))
          .finally(() => {
            // Re-render only if this card is still the one on screen.
            if (activeId === anchor.id && host && !host.hidden) {
              renderSnippet(anchor, host.querySelector('.ctx-snippet'));
            }
          });
      } else {
        cache.set(ref, { status: 'empty' });
      }
    }

    const c = cache.get(ref);
    if (c.status === 'ready') {
      const text = c.text.length > SNIPPET_MAX ? c.text.slice(0, SNIPPET_MAX) + '…' : c.text;
      el.innerHTML = `<span class="ctx-snippet-text">${esc(text)}</span>`;
    } else if (c.status === 'loading') {
      el.innerHTML = '<span class="ctx-muted">טוען את לשון המקור…</span>';
    } else {
      el.innerHTML = '<span class="ctx-muted">לשון המקור אינה טעונה.</span>';
    }
  }

  /**
   * Future: render a miniature daf of targetRef with highlightRef marked,
   * inside `container`. For now a clean placeholder keeps the boundary.
   */
  function renderMiniDafPreview(targetRef, highlightRef, container) {
    if (!container) return;
    container.innerHTML = '<span class="ctx-minidaf-ph">תצוגת דף ממוזערת — בקרוב</span>';
  }

  // ── Anchor decoration + events ─────────────────────────────────

  function attach(options) {
    opts = Object.assign({ anchors: [], fetchSnippet: null, appRouteFor: null }, options);
    closeAll();
    byId = {};
    const root = opts.sheet || document;
    for (const anchor of opts.anchors) {
      const el = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(anchor.domId) : anchor.domId));
      if (!el) continue;
      byId[anchor.id] = anchor;
      el.classList.add('ctx-anchor');
      el.dataset.contextAnchorId = anchor.id;
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${anchor.label}: ${anchor.displayText || anchor.targetRef}`);

      el.addEventListener('pointerenter', () => show(anchor, false));
      el.addEventListener('pointerleave', scheduleHide);
      el.addEventListener('focus', () => show(anchor, false));
      el.addEventListener('blur', scheduleHide);
      el.addEventListener('click', e => {
        e.stopPropagation();
        show(anchor, true); // pin; clicking another anchor replaces the card
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          show(anchor, true);
        }
      });
    }
  }

  global.VilnaDafContextSidebar = {
    attach,
    closeAll,
    renderMiniDafPreview,
    _state: { cache, get pinned() { return pinned; }, get activeId() { return activeId; } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
