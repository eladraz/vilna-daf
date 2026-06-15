/**
 * chatUI.js — the chavruta's DOM: tornado FAB, slide-in panel, suggestion
 * pills, message bubbles (markdown + RTL mixed content), streaming, input,
 * resize handle, mobile full-screen with swipe-right close (§0, §4, §9).
 *
 * Pure view layer: all actions are dispatched to NS.controller callbacks.
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  let fab = null, badge = null, panel = null, els = {};
  let streamingBubble = null;

  // ── tiny safe markdown (escape first, then transform) ──────────

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function markdown(text) {
    let h = escapeHtml(text);
    // fenced code blocks
    h = h.replace(/```([\s\S]*?)```/g, (m, code) => `<pre dir="rtl">${code.trim()}</pre>`);
    // headers (only at line start)
    h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>')
         .replace(/^## (.+)$/gm, '<h4>$1</h4>')
         .replace(/^# (.+)$/gm, '<h4>$1</h4>');
    // bold / italic / inline code
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
         .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
         .replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // unordered lists
    h = h.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `\n<ul>${items}</ul>`;
    });
    // paragraphs / line breaks
    h = h.split(/\n{2,}/).map(p => /^<(h4|ul|pre)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return NS.deepLink ? NS.deepLink.linkify(h) : h;
  }

  // ── FAB (§0) ───────────────────────────────────────────────────

  function buildFab(onClick) {
    if (fab) return fab;
    fab = document.createElement('button');
    fab.id = 'chavruta-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'חברותא — שאל על הדף');
    fab.title = 'חברותא';
    fab.innerHTML = `<img src="assets/tornado.svg" alt=""><span class="chv-badge" hidden></span>`;
    badge = fab.querySelector('.chv-badge');
    fab.addEventListener('click', onClick);
    document.body.appendChild(fab);
    return fab;
  }

  function setBadge(on) { if (badge) badge.hidden = !on; }

  // ── Panel (§4) ─────────────────────────────────────────────────

  function buildPanel(handlers) {
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'chavruta-panel';
    panel.dir = 'rtl';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'חברותא');
    panel.innerHTML = `
      <div class="chv-resize" title="גרור לשינוי רוחב"></div>
      <header class="chv-head">
        <button class="chv-back" aria-label="סגור">→</button>
        <span class="chv-daf-label"></span>
        <select class="chv-sessions" title="שיחות שמורות"></select>
        <button class="chv-debug" aria-label="הצג את ההקשר שה־AI מקבל" title="הצג את ההקשר שה־AI מקבל">?</button>
        <div class="chv-gear-wrap">
          <button class="chv-gear" aria-label="הגדרות">⚙</button>
          <div class="chv-gear-menu" hidden>
            <button data-act="export">העתק שיחה (Markdown)</button>
            <button data-act="clear">מחק שיחה זו</button>
            <button data-act="apikey" hidden>מפתח API</button>
            <button data-act="provider" hidden>החלף ספק AI</button>
          </div>
        </div>
        <button class="chv-close" aria-label="סגור">✕</button>
      </header>
      <div class="chv-suggest" aria-label="שאלות מוצעות"></div>
      <div class="chv-messages" aria-live="polite"></div>
      <div class="chv-chatkit-host" hidden></div>
      <footer class="chv-input-row">
        <textarea class="chv-input" rows="1" placeholder="?שאל את החברותא"></textarea>
        <button class="chv-send" aria-label="שלח">◄</button>
      </footer>
      <div class="chv-debug-panel" hidden>
        <div class="chv-debug-head">
          <span class="chv-debug-title">ההקשר שנשלח ל־AI (system prompt)</span>
          <span class="chv-debug-meta"></span>
          <button class="chv-debug-copy" title="העתק">העתק</button>
          <button class="chv-debug-close" aria-label="סגור">✕</button>
        </div>
        <pre class="chv-debug-body" dir="ltr"></pre>
      </div>`;
    document.body.appendChild(panel);

    els = {
      label: panel.querySelector('.chv-daf-label'),
      sessions: panel.querySelector('.chv-sessions'),
      suggest: panel.querySelector('.chv-suggest'),
      messages: panel.querySelector('.chv-messages'),
      chatkitHost: panel.querySelector('.chv-chatkit-host'),
      inputRow: panel.querySelector('.chv-input-row'),
      input: panel.querySelector('.chv-input'),
      send: panel.querySelector('.chv-send'),
      gearMenu: panel.querySelector('.chv-gear-menu'),
      debugPanel: panel.querySelector('.chv-debug-panel'),
      debugBody: panel.querySelector('.chv-debug-body'),
      debugMeta: panel.querySelector('.chv-debug-meta'),
    };

    // input: Enter sends, Shift+Enter newline
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handlers.onSend(els.input.value);
      }
    });
    els.send.addEventListener('click', () => handlers.onSend(els.input.value));
    panel.querySelector('.chv-close').addEventListener('click', handlers.onClose);
    panel.querySelector('.chv-back').addEventListener('click', handlers.onClose);

    // gear menu
    const gear = panel.querySelector('.chv-gear');
    gear.addEventListener('click', e => {
      e.stopPropagation();
      // "מפתח API" only for BYO-key providers.
      const cur = NS.provider && NS.provider.current && NS.provider.current();
      els.gearMenu.querySelector('[data-act="apikey"]').hidden = !(cur && NS.provider.needsKey(cur));
      els.gearMenu.hidden = !els.gearMenu.hidden;
    });
    document.addEventListener('click', () => { els.gearMenu.hidden = true; });
    els.gearMenu.addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act) { els.gearMenu.hidden = true; handlers.onGear(act); }
    });
    if (NS.provider && NS.provider.ENABLE_MULTI_PROVIDER) {
      els.gearMenu.querySelector('[data-act="provider"]').hidden = false;
    }

    // sessions dropdown
    els.sessions.addEventListener('change', () => handlers.onSession(els.sessions.value));

    // debug: show the exact context payload the AI receives
    panel.querySelector('.chv-debug').addEventListener('click', e => {
      e.stopPropagation();
      handlers.onDebug();
    });
    panel.querySelector('.chv-debug-close').addEventListener('click', () => { els.debugPanel.hidden = true; });
    panel.querySelector('.chv-debug-copy').addEventListener('click', () => {
      if (navigator.clipboard) navigator.clipboard.writeText(els.debugBody.textContent);
    });

    // Escape closes; outside click closes (but not the FAB/menu)
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !panel.hidden) handlers.onClose();
    });
    document.addEventListener('click', e => {
      // A click that re-rendered its own button (e.g. the refresh pill)
      // reaches here with a detached target — that's an inside click.
      if (!e.target.isConnected) return;
      // The nav bar is exempt: the chavruta follows daf navigation (§6.1).
      if (!panel.hidden && !e.target.closest('#chavruta-panel,#chavruta-fab,.chv-ctxmenu,.nav-bar')) handlers.onClose();
    });

    // delegated: segment refs + suggestion dropdown + retry
    panel.addEventListener('click', e => {
      const ref = e.target.closest('.chv-segref');
      if (ref) { e.preventDefault(); NS.deepLink.activate(ref.dataset.seg); return; }
      // retry/refresh buttons take precedence — the "more questions" item
      // is also a .chv-suggest-item but must not be treated as a question.
      const act = e.target.closest('[data-chv-retry]');
      if (act) { closeSuggestMenu(); handlers.onRetry(act.dataset.chvRetry); return; }
      // open/close the suggestions dropdown
      const toggle = e.target.closest('.chv-suggest-toggle');
      if (toggle && !toggle.disabled) {
        const menu = els.suggest.querySelector('.chv-suggest-menu');
        if (menu) {
          menu.hidden = !menu.hidden;
          toggle.setAttribute('aria-expanded', String(!menu.hidden));
        }
        return;
      }
      // pick a suggested question
      const item = e.target.closest('.chv-suggest-item');
      if (item && !item.classList.contains('used')) {
        closeSuggestMenu();
        handlers.onPill(item.dataset.q, item);
        return;
      }
      // click elsewhere in the panel closes an open suggestions menu
      if (!e.target.closest('.chv-suggest')) closeSuggestMenu();
    });

    // resize by dragging the left edge (desktop)
    const grip = panel.querySelector('.chv-resize');
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const onMove = ev => {
        const w = Math.min(window.innerWidth * 0.5, Math.max(300, window.innerWidth - ev.clientX));
        panel.style.width = `${w}px`;
        document.documentElement.style.setProperty('--chv-panel-w', `${Math.round(w)}px`);
      };
      const onUp = () => {
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
      };
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
    });

    // mobile: swipe right to close
    let swipe = null;
    panel.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !e.target.closest('.chv-input,.chv-messages')) {
        swipe = { x: e.clientX, y: e.clientY };
      }
    });
    panel.addEventListener('pointermove', e => {
      if (!swipe || e.pointerType !== 'touch') return;
      const dx = e.clientX - swipe.x, dy = Math.abs(e.clientY - swipe.y);
      if (dx > 90 && dy < 60) { swipe = null; handlers.onClose(); }
    });
    panel.addEventListener('pointerup', () => { swipe = null; });

    return panel;
  }

  // ── view operations ────────────────────────────────────────────

  /**
   * 'messages' shows our own chat (suggestions, bubbles, input);
   * 'widget' hands the panel body to an embedded provider widget
   * (ChatKit) which brings its own conversation UI.
   */
  function setMode(mode) {
    const widget = mode === 'widget';
    els.suggest.hidden = widget;
    els.messages.hidden = widget;
    els.inputRow.hidden = widget;
    els.chatkitHost.hidden = !widget;
    els.sessions.hidden = widget; // ChatKit keeps its own threads
  }
  function chatkitHost() { return els.chatkitHost; }

  // Reserve room for the panel so the daf + context sidebar shrink beside
  // it instead of being covered (CSS uses --chv-panel-w on wide screens).
  function applyPageShrink(on) {
    const root = document.documentElement;
    if (on) {
      root.style.setProperty('--chv-panel-w', `${Math.round(panel.getBoundingClientRect().width)}px`);
      document.body.classList.add('chv-panel-open');
    } else {
      document.body.classList.remove('chv-panel-open');
    }
  }

  function open() {
    panel.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add('open');
      applyPageShrink(true); // measure the panel after its CSS width applies
    });
  }
  function close() {
    panel.classList.remove('open');
    applyPageShrink(false);
    setTimeout(() => { panel.hidden = true; }, 220);
  }
  function isOpen() { return panel && !panel.hidden; }

  function setDafLabel(text) { if (els.label) els.label.textContent = text; }

  function setSessionList(items, currentId) {
    if (!els.sessions) return;
    els.sessions.innerHTML = items
      .map(it => `<option value="${it.id}" ${it.id === currentId ? 'selected' : ''}>${escapeHtml(it.label)}</option>`)
      .join('');
  }

  function bubble(role, html) {
    const b = document.createElement('div');
    b.className = `chv-msg chv-${role}`;
    b.innerHTML = html;
    els.messages.appendChild(b);
    els.messages.scrollTop = els.messages.scrollHeight;
    return b;
  }

  function renderMessages(messages) {
    els.messages.innerHTML = '';
    for (const m of messages) bubble(m.role, markdown(m.content));
  }

  function addUserMessage(text) { bubble('user', markdown(text)); }

  function startStreaming() {
    stopTyping();
    streamingBubble = bubble('assistant', '<span class="chv-typing"><i></i><i></i><i></i></span>');
    return streamingBubble;
  }
  function updateStreaming(fullText) {
    if (!streamingBubble) startStreaming();
    streamingBubble.innerHTML = markdown(fullText);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function endStreaming() { streamingBubble = null; }

  let typingEl = null;
  function startTyping() {
    if (typingEl) return;
    typingEl = bubble('assistant', '<span class="chv-typing"><i></i><i></i><i></i></span>');
  }
  function stopTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function showError(message, retryKey) {
    stopTyping(); endStreaming();
    bubble('error',
      `${escapeHtml(message)} <button class="chv-retry" data-chv-retry="${escapeHtml(retryKey || '')}">נסה שוב</button>`);
  }

  /** Inline site-login form (our session, never a provider's password). */
  function showLoginForm(onSubmit) {
    stopTyping(); endStreaming();
    const b = bubble('error',
      `<div class="chv-login">
         <div>נדרשת התחברות לאתר כדי להמשיך</div>
         <input type="email" class="chv-login-mail" placeholder="כתובת אימייל" dir="ltr">
         <button class="chv-login-go">התחבר</button>
       </div>`);
    const input = b.querySelector('.chv-login-mail');
    const go = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      b.remove();
      onSubmit(v);
    };
    b.querySelector('.chv-login-go').addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    input.focus();
  }

  function clearInput() { els.input.value = ''; els.input.focus(); }
  function setInput(v) { els.input.value = v; els.input.focus(); }

  // suggested questions — a dropdown menu in the panel header area
  function setSuggestionsLoading() {
    els.suggest.innerHTML =
      '<button class="chv-suggest-toggle" disabled>שאלות מוצעות נטענות…</button>';
  }
  function setSuggestions(questions, used, withRefresh) {
    if (!questions || !questions.length) { els.suggest.innerHTML = ''; return; }
    const items = questions.map(q =>
      `<button class="chv-suggest-item ${used && used.includes(q) ? 'used' : ''}" data-q="${escapeHtml(q)}" role="option">${escapeHtml(q)}</button>`
    ).join('') + (withRefresh
      ? '<button class="chv-suggest-item chv-more" data-chv-retry="more">🔄 עוד שאלות</button>' : '');
    els.suggest.innerHTML =
      `<button class="chv-suggest-toggle" aria-haspopup="listbox" aria-expanded="false">
         <span>שאלות מוצעות</span><span class="chv-suggest-caret">▾</span>
       </button>
       <div class="chv-suggest-menu" role="listbox" hidden>${items}</div>`;
  }
  function setSuggestionsError() {
    els.suggest.innerHTML =
      '<button class="chv-suggest-toggle" data-chv-retry="suggestions">שאלות מוצעות — נסה שוב</button>';
  }
  function closeSuggestMenu() {
    const menu = els.suggest.querySelector('.chv-suggest-menu');
    const toggle = els.suggest.querySelector('.chv-suggest-toggle');
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  /** One prominent connect button (popup logins need a user gesture). */
  function setConnectPrompt(label, onClick) {
    els.suggest.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'chv-pill chv-connect';
    btn.textContent = label;
    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    els.suggest.appendChild(btn);
  }
  function markPillUsed(pill) { if (pill) pill.classList.add('used'); }

  /** Debug: show the full context payload the AI receives. */
  function showDebug(text, meta) {
    els.debugBody.textContent = text || '(אין הקשר זמין)';
    els.debugMeta.textContent = meta || '';
    els.debugPanel.hidden = false;
  }
  function showDebugLoading() {
    els.debugBody.textContent = 'בונה את ההקשר…';
    els.debugMeta.textContent = '';
    els.debugPanel.hidden = false;
  }

  NS.ui = {
    buildFab, setBadge, buildPanel, open, close, isOpen, setMode, chatkitHost,
    setDafLabel, setSessionList, renderMessages, addUserMessage,
    startStreaming, updateStreaming, endStreaming, startTyping, stopTyping,
    showError, showLoginForm, clearInput, setInput,
    setSuggestionsLoading, setSuggestions, setSuggestionsError, setConnectPrompt, markPillUsed,
    showDebug, showDebugLoading,
    markdown, _els: () => els,
  };
})(typeof window !== 'undefined' ? window : globalThis);
