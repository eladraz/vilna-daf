/**
 * deepLink.js — AI ↔ daf interaction (§7).
 *
 * 7.1: "[segment N]" / "[on segment N]" / "[קטע N]" in AI responses become
 *      clickable links that scroll the daf to that segment and pulse the
 *      existing hover-highlight.
 * 7.2: right-click (desktop) or long-press (touch) on a Gemara segment or
 *      a Rashi/Tosafot comment opens a small "ask the chavruta" menu.
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const SEGREF_RE = /\[(?:on\s+)?(?:segment|seg\.?|קטע|סגמנט)\s*(\d+)\]/gi;

  /** Wrap segment refs in already-escaped HTML with clickable anchors. */
  function linkify(html) {
    return html.replace(SEGREF_RE, (m, n) =>
      `<a href="#" class="chv-segref" data-seg="${n}" title="הצג על הדף">${m}</a>`);
  }

  /** Scroll the daf to segment n and pulse the highlight (§7.1). */
  function activate(n) {
    const sheet = document.querySelector('.page-sheet');
    if (!sheet) return;
    const targets = sheet.querySelectorAll(
      `.gseg[data-seg="${n}"], .first-word[data-seg="${n}"], .comment[data-seg="${n}"]`);
    if (!targets.length) return;
    targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    for (const el of targets) {
      el.classList.add('hl-seg', 'hl-flash');
    }
    setTimeout(() => {
      for (const el of targets) el.classList.remove('hl-seg', 'hl-flash');
    }, 2200);
  }

  // ── 7.2 context menu ───────────────────────────────────────────

  let menu = null;
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'chv-ctxmenu';
    menu.hidden = true;
    menu.innerHTML =
      `<button data-act="ask">🌀 שאל את החברותא</button>
       <button data-act="translate">תרגם</button>`;
    document.body.appendChild(menu);
    document.addEventListener('click', () => { menu.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
    return menu;
  }

  function snippetOf(el) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.split(' ').slice(0, 8).join(' ');
  }

  function openMenuAt(x, y, targetEl) {
    const m = ensureMenu();
    m.hidden = false;
    m.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - 90)}px`;
    m.onclick = e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      e.stopPropagation();
      m.hidden = true;
      const snip = snippetOf(targetEl);
      const isComment = targetEl.classList.contains('comment');
      const q = act === 'translate'
        ? `תרגם: ${snip}`
        : (isComment ? `הסבר את הדיבור המתחיל "${snip}"` : `הסבר: "${snip}" [segment ${targetEl.dataset.seg || '?'}]`);
      if (NS.controller) NS.controller.askFromDaf(q);
    };
  }

  function attachDafMenu(sheet) {
    if (!sheet || sheet._chvMenu) return;
    sheet._chvMenu = true;
    sheet.addEventListener('contextmenu', e => {
      const el = e.target.closest('.gseg, .comment');
      if (!el) return;
      e.preventDefault();
      openMenuAt(e.clientX, e.clientY, el);
    });
    // Touch long-press (600ms without movement).
    let lpTimer = null, lpStart = null;
    sheet.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      const el = e.target.closest('.gseg, .comment');
      if (!el) return;
      lpStart = { x: e.clientX, y: e.clientY };
      lpTimer = setTimeout(() => openMenuAt(lpStart.x, lpStart.y, el), 600);
    });
    const cancelLp = e => {
      if (lpTimer && (e.type !== 'pointermove' || !lpStart
          || Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10)) {
        clearTimeout(lpTimer); lpTimer = null;
      }
    };
    sheet.addEventListener('pointermove', cancelLp);
    sheet.addEventListener('pointerup', e => { clearTimeout(lpTimer); lpTimer = null; });
    sheet.addEventListener('pointercancel', e => { clearTimeout(lpTimer); lpTimer = null; });
  }

  NS.deepLink = { linkify, activate, attachDafMenu, SEGREF_RE };
})(typeof window !== 'undefined' ? window : globalThis);
