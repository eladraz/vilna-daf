/**
 * chavruta.js — main controller (§10 data flow).
 *
 * The renderer calls VilnaChavruta.setDaf({model, sheet}) after each daf
 * render (guarded — the renderer works identically without these scripts).
 * Everything else flows from the tornado FAB: open panel → ensure session
 * → build context once per daf → background suggested questions → chat
 * with full history, streaming, abort, and summarization guard.
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const state = {
    model: null,
    dafKey: null,    // "Berachot.2a"
    sessionId: null,
    abort: null,
    busy: false,
    lastFailed: null, // message text for retry
  };

  function dafKeyOf(model) { return `${model.tractate}.${model.page}${model.side}`; }

  function hebLabel(model) {
    const heb = NS._heb ? NS._heb(model.page) : model.page;
    return `${model.tractateHe || model.tractate} ${heb} ${model.side === 'a' ? 'ע״א' : 'ע״ב'}`;
  }

  // ── session plumbing ───────────────────────────────────────────

  function ensureSession() {
    if (!state.sessionId || (NS.sessions.get(state.sessionId) || {}).daf !== state.dafKey) {
      state.sessionId = NS.sessions.forDaf(state.dafKey);
    }
    return NS.sessions.get(state.sessionId);
  }

  function refreshSessionUI() {
    const sess = ensureSession();
    NS.ui.setSessionList(NS.sessions.list(), state.sessionId);
    NS.ui.renderMessages(sess.messages);
    if (sess.suggestedQuestions) {
      NS.ui.setSuggestions(sess.suggestedQuestions, sess.usedQuestions, true);
    }
  }

  // ── suggested questions (§6) ───────────────────────────────────

  async function generateSuggestions(avoid) {
    const sess = ensureSession();
    NS.ui.setSuggestionsLoading();
    try {
      const system = await NS.context.build(state.model);
      const qs = await NS.suggestions.generate(system, state.dafKey, avoid);
      const merged = avoid && avoid.length ? [...qs] : qs;
      NS.sessions.update(state.sessionId, {
        suggestedQuestions: merged,
        suggestionsSeen: NS.ui.isOpen(),
      });
      NS.ui.setSuggestions(merged, (NS.sessions.get(state.sessionId) || {}).usedQuestions, true);
      if (!NS.ui.isOpen()) NS.ui.setBadge(true); // generated while closed (§0 badge)
    } catch (e) {
      if (e.name !== 'AbortError') NS.ui.setSuggestionsError();
    }
  }

  // ── chat (§5, §8) ──────────────────────────────────────────────

  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || !state.model) return;
    // New message aborts an in-flight response (§8).
    if (state.abort) state.abort.abort();
    state.abort = new AbortController();
    state.busy = true;
    state.lastFailed = null;

    const sess = ensureSession();
    NS.sessions.addMessage(state.sessionId, 'user', text);
    NS.ui.addUserMessage(text);
    NS.ui.clearInput();
    NS.ui.startStreaming();

    try {
      const system = await NS.context.build(state.model);
      await NS.sessions.summarizeIfNeeded(state.sessionId, system);
      const history = (NS.sessions.get(state.sessionId) || sess).messages;
      const { text: answer } = await NS.provider.send({
        system,
        messages: history.map(m => ({ role: m.role, content: m.content })),
        maxTokens: 1500,
        stream: true,
        onDelta: full => NS.ui.updateStreaming(full),
        signal: state.abort.signal,
      });
      NS.ui.updateStreaming(answer);
      NS.ui.endStreaming();
      NS.sessions.addMessage(state.sessionId, 'assistant', answer);
    } catch (e) {
      if (e.name === 'AbortError') { NS.ui.endStreaming(); return; }
      state.lastFailed = text;
      // Roll the failed user message back out of stored history so a retry
      // doesn't double it.
      const s = NS.sessions.get(state.sessionId);
      if (s && s.messages.length && s.messages[s.messages.length - 1].content === text) {
        s.messages.pop(); NS.sessions._save();
      }
      if (e.status === 401) {
        // Site login required (cookie session on our backend).
        NS.ui.showLoginForm(async email => {
          try {
            await NS.provider.auth.login(email);
            sendMessage(text);
          } catch (le) {
            NS.ui.showError('ההתחברות נכשלה.', 'message');
          }
        });
        return;
      }
      let msg = 'השיחה נכשלה.';
      if (e.status === 429) msg = 'יותר מדי בקשות — המתן רגע ונסה שוב.';
      else if (e instanceof TypeError || !e.status) {
        msg = 'אין חיבור לספק — ודא שהשרת פעיל (server/chavruta-server.mjs), או החלף ספק (⚙).';
      }
      NS.ui.showError(msg, 'message');
    } finally {
      state.busy = false;
    }
  }

  // ── handlers ───────────────────────────────────────────────────

  const handlers = {
    onSend: text => sendMessage(text),
    onClose: () => NS.ui.close(),
    onPill: (q, pillEl) => {
      NS.ui.markPillUsed(pillEl);
      const s = NS.sessions.get(state.sessionId);
      if (s) NS.sessions.update(state.sessionId, { usedQuestions: [...(s.usedQuestions || []), q] });
      sendMessage(q);
    },
    onSession: id => {
      const sess = NS.sessions.get(id);
      if (!sess) return;
      state.sessionId = id;
      NS.ui.renderMessages(sess.messages);
      NS.ui.setSuggestions(sess.suggestedQuestions || [], sess.usedQuestions, !!sess.suggestedQuestions);
    },
    onGear: act => {
      if (act === 'export') {
        const md = NS.sessions.exportMarkdown(state.sessionId);
        navigator.clipboard && navigator.clipboard.writeText(md);
      } else if (act === 'clear') {
        if (confirm('למחוק את השיחה הזו?')) {
          NS.sessions.remove(state.sessionId);
          state.sessionId = null;
          refreshSessionUI();
        }
      } else if (act === 'provider' && NS.provider.ENABLE_MULTI_PROVIDER) {
        openProviderModal();
      }
    },
    onRetry: key => {
      if (key === 'suggestions') generateSuggestions();
      else if (key === 'more') {
        const s = NS.sessions.get(state.sessionId);
        generateSuggestions((s && s.suggestedQuestions) || []);
      } else if (key === 'message' && state.lastFailed) {
        sendMessage(state.lastFailed);
      }
    },
    // Debug: show the exact system prompt the AI receives for this daf,
    // so the full context (prev/current/next daf, Rashi, Tosafot,
    // Steinsaltz, Torah Or, …) can be verified.
    onDebug: async () => {
      if (!state.model) { NS.ui.showDebug('(לא נטען דף)'); return; }
      NS.ui.showDebugLoading();
      try {
        const system = await NS.context.build(state.model);
        const tokens = NS.provider.estimateTokens(system);
        const has = label => (system.includes(label) ? '✓' : '✗');
        const meta = `${system.length.toLocaleString()} תווים · ~${tokens.toLocaleString()} טוקנים` +
          ` · גמרא ${has('--- GEMARA ---')} · רש״י ${has('--- RASHI ---')}` +
          ` · תוספות ${has('--- TOSAFOT ---')} · תורה אור ${has('TORAH OR')}` +
          ` · שטיינזלץ ${system.includes('שטיינזלץ') || /steinsaltz/i.test(system) ? '✓' : '✗'}` +
          ` · עמוד קודם ${has('PREVIOUS AMUD')} · עמוד הבא ${has('NEXT AMUD')}`;
        NS.ui.showDebug(system, meta);
      } catch (e) {
        NS.ui.showDebug('שגיאה בבניית ההקשר: ' + e.message);
      }
    },
  };

  // ── provider connection modal (§1b) ────────────────────────────

  let providerModal = null;
  function openProviderModal() {
    if (!providerModal) {
      providerModal = document.createElement('div');
      providerModal.className = 'chv-provider-modal';
      const cardsOf = group => Object.entries(NS.provider.PROVIDERS)
        .filter(([, p]) => p.group === group)
        .map(([id, p]) =>
          `<button class="chv-provider-card" data-provider="${id}" ${p.enabled ? '' : 'disabled'}>
             <b>${p.label}</b><small>${p.hint || ''}</small>
           </button>`).join('');
      providerModal.innerHTML =
        `<div class="chv-provider-box" dir="rtl">
           <h3>חיבור ספק AI</h3>
           <p class="chv-provider-note">ללא מפתחות API וללא סיסמאות של הספקים — לעולם.</p>
           <h4 class="chv-provider-group">ללא שרת — מתאים לכולם</h4>
           <div class="chv-provider-cards">${cardsOf('free')}</div>
           <h4 class="chv-provider-group">דרך שרת האתר (למפעיל האתר)</h4>
           <div class="chv-provider-cards">${cardsOf('server')}</div>
           <button class="chv-provider-close">סגור</button>
         </div>`;
      // The on-device option exists only on supporting browsers; when the
      // model needs a one-time download, say so up front.
      NS.provider.browserAvailability().then(state => {
        if (!providerModal) return;
        const c = providerModal.querySelector('[data-provider="browser"]');
        if (!c) return;
        if (state === 'none' || state === 'unavailable') {
          c.disabled = true;
          c.querySelector('small').textContent = 'אינו זמין בדפדפן זה';
        } else if (state === 'downloadable' || state === 'downloading') {
          c.querySelector('small').textContent = 'ללא חשבון כלל — הורדת מודל חד־פעמית בשימוש הראשון';
        }
      });
      providerModal.addEventListener('click', e => {
        if (e.target.closest('.chv-provider-close') || e.target === providerModal) {
          providerModal.remove(); providerModal = null;
          return;
        }
        const card = e.target.closest('.chv-provider-card');
        if (card && !card.disabled && NS.provider.setCurrent(card.dataset.provider)) {
          NS.provider._resetTransport(); // re-probe proxy vs direct
          providerModal.remove(); providerModal = null;
          openPanel();
        }
      });
    }
    document.body.appendChild(providerModal);
  }

  // ── open / setDaf ──────────────────────────────────────────────

  async function mountChatKit() {
    const host = NS.ui.chatkitHost();
    try {
      await NS.chatkit.mount(host, { pageId: state.dafKey });
    } catch (e) {
      if (e.status === 401) {
        // Site login (our session cookie) — never a ChatGPT password.
        host.innerHTML =
          `<div class="chv-chatkit-error chv-login">
             <div>נדרשת התחברות לאתר כדי להשתמש ב־ChatGPT<br>
               <small>(התחברות לאתר שלנו — לא סיסמת ChatGPT)</small></div>
             <input type="email" class="chv-login-mail" placeholder="כתובת אימייל" dir="ltr">
             <button class="chv-retry chv-login-go">התחבר</button>
           </div>`;
        const input = host.querySelector('.chv-login-mail');
        const go = async () => {
          const v = input.value.trim();
          if (!v) { input.focus(); return; }
          try { await NS.provider.auth.login(v); mountChatKit(); }
          catch (le) { input.value = ''; input.placeholder = 'ההתחברות נכשלה — נסה שוב'; }
        };
        host.querySelector('.chv-login-go').onclick = go;
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
        input.focus();
        return;
      }
      host.innerHTML =
        `<div class="chv-chatkit-error">חיבור ChatGPT אינו זמין (השרת אינו פעיל?).
           <button class="chv-retry" data-chv-ck-retry>נסה שוב</button>
           <button class="chv-retry" data-chv-ck-switch>החלף ספק</button>
         </div>`;
      host.querySelector('[data-chv-ck-retry]').onclick = () => mountChatKit();
      host.querySelector('[data-chv-ck-switch]').onclick = () => openProviderModal();
    }
  }

  async function openPanel() {
    if (!state.model) return;
    if (NS.provider.needsConnection()) { openProviderModal(); return; }
    NS.ui.open();
    NS.ui.setBadge(false);
    NS.ui.setDafLabel(hebLabel(state.model));

    if (NS.provider.mode() === 'widget') {
      NS.ui.setMode('widget');
      mountChatKit();
      return;
    }
    NS.ui.setMode('messages');
    const sess = ensureSession();
    refreshSessionUI();
    // Providers with a popup login (Puter) need a user gesture — offer a
    // connect button instead of firing the popup from this async chain.
    if (await NS.provider.interactiveLogin.needed()) {
      NS.ui.setConnectPrompt(NS.provider.interactiveLogin.label, async () => {
        try {
          await NS.provider.interactiveLogin.login();
          const s2 = NS.sessions.get(state.sessionId);
          if (!s2 || !s2.suggestedQuestions) generateSuggestions();
          else NS.ui.setSuggestions(s2.suggestedQuestions, s2.usedQuestions, true);
        } catch (e) { NS.ui.setSuggestionsError(); }
      });
      return;
    }
    if (!sess.suggestedQuestions) generateSuggestions();
    else NS.sessions.update(state.sessionId, { suggestionsSeen: true });
  }

  function setDaf({ model, sheet }) {
    const newKey = dafKeyOf(model);
    const changed = newKey !== state.dafKey;
    state.model = model;
    state.dafKey = newKey;
    if (NS.deepLink) NS.deepLink.attachDafMenu(sheet);
    if (changed) {
      if (state.abort) state.abort.abort();
      state.sessionId = null; // old session stays saved; new daf → new/latest session
      if (NS.ui.isOpen()) {
        NS.ui.setDafLabel(hebLabel(model));
        if (NS.provider.mode() === 'widget') {
          mountChatKit(); // remount with the new daf as page_id
        } else {
          const sess = ensureSession();
          refreshSessionUI();
          if (!sess.suggestedQuestions) generateSuggestions();
        }
      }
    }
  }

  /** §7.2 — daf context-menu entry point. */
  function askFromDaf(question) {
    if (!NS.ui.isOpen()) openPanel();
    // ChatKit brings its own input — we can only open the panel there.
    if (NS.provider.mode() === 'widget') return;
    // openPanel is async-ish (suggestions fire in background); send directly.
    setTimeout(() => sendMessage(question), 60);
  }

  // ── boot ───────────────────────────────────────────────────────

  function init() {
    NS.ui.buildPanel(handlers);
    NS.ui.buildFab(() => (NS.ui.isOpen() ? NS.ui.close() : openPanel()));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  NS.controller = { setDaf, openPanel, sendMessage, askFromDaf, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
