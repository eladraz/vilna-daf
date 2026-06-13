/**
 * provider.js — AI provider abstraction for the chavruta.
 *
 * Providers (see docs/AI-PROVIDERS.md):
 * - "claude" (messages): goes through OUR backend proxy (/api/chat) on a
 *   regular website; if the proxy is absent it falls back to the keyless
 *   api.anthropic.com endpoint, which works only inside a Claude artifact.
 * - "chatgpt-chatkit" (widget): OpenAI ChatKit. The browser never sees an
 *   OpenAI key — it asks OUR backend (/api/chatkit/session) for a
 *   short-lived client_secret and mounts the ChatKit widget with it.
 * - "gemini" (messages): the same /api/chat proxy, provider=gemini. The
 *   server normalizes every provider to one wire format, so the chat UI
 *   has a single parser.
 *
 * send() implements the messages-mode transport:
 * - streaming parses the normalized SSE and calls onDelta(fullText)
 * - 429/5xx retried with exponential backoff (max 3)
 * - 401 propagates so the UI can show the site-login form
 * - signal aborts the in-flight request
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const ENABLE_MULTI_PROVIDER = true;
  const PROVIDER_KEY = 'vilnaChavruta.provider';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-4-6';
  const CONTEXT_LIMIT_TOKENS = 200000;

  /**
   * The selectable providers (connection modal cards).
   * group 'free'   — works on the static site, NO API key and NO backend:
   *                  a simple web login (or none at all).
   * group 'server' — needs the site's backend (server/chavruta-server.mjs);
   *                  keys are the site owner's, users still never see them.
   */
  const PROVIDERS = {
    puter: { label: 'GPT / Claude — חשבון Puter', mode: 'messages', enabled: true, group: 'free',
      hint: 'הרשמה חינמית בחלון קופץ — ללא מפתחות וללא התקנה' },
    browser: { label: 'AI בדפדפן (Gemini Nano)', mode: 'messages', enabled: true, group: 'free',
      hint: 'ללא חשבון כלל — מקומי ופרטי, דורש Chrome עדכני' },
    claude: { label: 'Claude', mode: 'messages', enabled: true, group: 'free',
      hint: 'בתוך claude.ai (חשבון Claude רגיל) — או דרך שרת האתר' },
    'chatgpt-chatkit': { label: 'ChatGPT (ChatKit)', mode: 'widget', enabled: true, group: 'server',
      hint: 'דרך שרת האתר — ללא סיסמת ChatGPT וללא מפתח למשתמש' },
    gemini: { label: 'Gemini', mode: 'messages', enabled: true, group: 'server',
      hint: 'דרך שרת האתר (Google Gemini)' },
    grok: { label: 'Grok', mode: 'messages', enabled: false, group: 'server', hint: 'בקרוב' },
  };

  function current() {
    let id = null;
    try { id = localStorage.getItem(PROVIDER_KEY); } catch (e) { /* no storage */ }
    if (id === 'claude-artifact') id = 'claude'; // legacy stored value
    return PROVIDERS[id] ? id : null;
  }
  function setCurrent(id) {
    if (!PROVIDERS[id] || !PROVIDERS[id].enabled) return false;
    try { localStorage.setItem(PROVIDER_KEY, id); } catch (e) { /* in-memory only */ }
    return true;
  }
  function mode() {
    const id = current();
    return id ? PROVIDERS[id].mode : null;
  }

  function sleep(ms, signal) {
    return new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  /** Rough token estimate — Hebrew is dense, ~3.2 chars/token is safe. */
  function estimateTokens(text) {
    return Math.ceil((text || '').length / 3.2);
  }

  /** Read a response (JSON or normalized SSE) into the full text. */
  async function readResponse(resp, { stream, onDelta }) {
    if (!resp.ok) {
      const err = new Error(`API ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    if (!stream) {
      const data = await resp.json();
      return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    }
    // SSE: accumulate content_block_delta text deltas (the proxy normalizes
    // every provider to this dialect).
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) {
            text += ev.delta.text;
            if (onDelta) onDelta(text);
          }
        } catch (e) { /* keep-alive or partial frame — skip */ }
      }
    }
    return text;
  }

  /** Direct Anthropic call — keyless, works only inside a Claude artifact. */
  function callDirect(body, stream, signal) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ model: MODEL }, body, stream ? { stream: true } : null)),
      signal,
    });
  }

  /** Our backend proxy (server/chavruta-server.mjs) — regular websites. */
  function callProxy(providerName, body, stream, signal) {
    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(Object.assign({ provider: providerName }, body, { stream: !!stream })),
      signal,
    });
  }

  // ── Puter: free user account ("user pays"), keyless, static-site ──

  let puterScript = null;
  function loadPuter() {
    if (global.puter) return Promise.resolve();
    if (!puterScript) {
      puterScript = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.puter.com/v2/';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { puterScript = null; reject(new Error('puter script failed')); };
        document.head.appendChild(s);
      });
    }
    return puterScript;
  }

  function puterBlockText(r) {
    // Puter returns OpenAI-ish or Anthropic-ish shapes depending on model.
    if (r == null) return '';
    if (typeof r === 'string') return r;
    const c = (r.message && r.message.content) != null ? r.message.content : (r.text != null ? r.text : r);
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : b.text || '')).join('');
    return String(c);
  }

  async function puterLoginNeeded() {
    try { await loadPuter(); return !global.puter.auth.isSignedIn(); }
    catch (e) { return true; }
  }
  async function puterLogin() {
    await loadPuter();
    if (!global.puter.auth.isSignedIn()) await global.puter.auth.signIn();
  }

  async function callPuter(body, { stream, onDelta, signal }) {
    await loadPuter();
    // puter.ai.chat pops its own login window if needed (user gesture path).
    const msgs = [{ role: 'system', content: body.system }, ...body.messages];
    if (!stream) return puterBlockText(await global.puter.ai.chat(msgs));
    const resp = await global.puter.ai.chat(msgs, { stream: true });
    let text = '';
    for await (const part of resp) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = part && (part.text != null ? part.text : puterBlockText(part));
      if (t) { text += t; if (onDelta) onDelta(text); }
    }
    return text;
  }

  // ── Browser built-in AI (Chrome Gemini Nano): no account at all ──

  function browserLM() {
    return global.LanguageModel || (global.ai && global.ai.languageModel) || null;
  }

  /** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'none' */
  async function browserAvailability() {
    const LM = browserLM();
    if (!LM) return 'none';
    try {
      if (LM.availability) return await LM.availability();
      if (LM.capabilities) {
        const c = await LM.capabilities();
        return c.available === 'no' ? 'unavailable'
          : (c.available === 'after-download' ? 'downloadable' : 'available');
      }
    } catch (e) { /* treat as unavailable */ }
    return 'unavailable';
  }
  async function browserAvailable() {
    const s = await browserAvailability();
    return s !== 'none' && s !== 'unavailable';
  }

  // Nano's context window is tiny (~6k tokens) — trim the daf payload and
  // history rather than failing. It's labeled experimental in the UI.
  const BROWSER_SYSTEM_CHARS = 9000;

  async function callBrowser(body, { stream, onDelta, signal }) {
    const LM = browserLM();
    if (!LM || !LM.create) {
      throw Object.assign(new Error('browser AI unavailable'), { unavailable: true });
    }
    const system = body.system.length > BROWSER_SYSTEM_CHARS
      ? body.system.slice(0, BROWSER_SYSTEM_CHARS) + '\n…[context trimmed for on-device model]'
      : body.system;
    const history = body.messages.slice(0, -1).slice(-6);
    const last = body.messages[body.messages.length - 1].content;
    const session = await LM.create({
      initialPrompts: [{ role: 'system', content: system },
        ...history.map(m => ({ role: m.role, content: m.content }))],
    });
    try {
      if (stream && session.promptStreaming) {
        let text = '';
        for await (const chunk of session.promptStreaming(last)) {
          if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
          // Older Chrome yields cumulative text, newer yields deltas.
          text = (typeof chunk === 'string' && chunk.startsWith(text) && chunk.length >= text.length)
            ? chunk : text + chunk;
          if (onDelta) onDelta(text);
        }
        return text;
      }
      return await session.prompt(last);
    } finally {
      if (session.destroy) session.destroy();
    }
  }

  // ── Claude transport resolution: the proxy serves regular websites; ──
  // the direct endpoint serves the Claude artifact environment. Probe the
  // proxy first and remember what worked.
  let claudeTransport = null; // 'proxy' | 'direct'

  async function callOnce(body, { stream, onDelta, signal }) {
    const prov = current() || 'claude';
    if (prov === 'puter') return callPuter(body, { stream, onDelta, signal });
    if (prov === 'browser') return callBrowser(body, { stream, onDelta, signal });
    if (prov === 'gemini') {
      return readResponse(await callProxy('gemini', body, stream, signal), { stream, onDelta });
    }
    // Claude
    if (claudeTransport !== 'direct') {
      try {
        const resp = await callProxy('claude', body, stream, signal);
        if (resp.status === 404 || resp.status === 503) throw Object.assign(new Error('no proxy'), { noProxy: true });
        const text = await readResponse(resp, { stream, onDelta });
        claudeTransport = 'proxy';
        return text;
      } catch (e) {
        if (e.name === 'AbortError' || e.status === 401 || e.status === 429 || claudeTransport === 'proxy') throw e;
        // Proxy absent (no backend / static hosting) → try direct artifact.
        claudeTransport = 'direct';
      }
    }
    return readResponse(await callDirect(body, stream, signal), { stream, onDelta });
  }

  async function send({ system, messages, maxTokens = 1000, stream = false, onDelta, signal }) {
    const body = { max_tokens: maxTokens, system, messages };
    let lastErr = null;
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt) await sleep(1000 * Math.pow(2, attempt - 1), signal);
      try {
        const text = await callOnce(body, { stream, onDelta, signal });
        return { text };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        // Retry only rate limits and server hiccups.
        if (!(e.status === 429 || e.status === 529 || (e.status >= 500 && e.status < 600))) break;
      }
    }
    throw lastErr;
  }

  // ── site auth helpers (the demo cookie login on our backend) ───

  const auth = {
    async me() {
      try {
        const r = await fetch('/api/me', { credentials: 'include' });
        return r.ok ? await r.json() : null;
      } catch (e) { return null; }
    },
    async login(name) {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(`login ${r.status}`);
      return r.json();
    },
  };

  NS.provider = {
    ENABLE_MULTI_PROVIDER,
    MODEL,
    CONTEXT_LIMIT_TOKENS,
    PROVIDERS,
    send,
    estimateTokens,
    current,
    setCurrent,
    mode,
    auth,
    browserAvailable,
    browserAvailability,
    /** Interactive (popup) login the provider needs before first use. */
    interactiveLogin: {
      async needed() { return current() === 'puter' ? puterLoginNeeded() : false; },
      async login() { if (current() === 'puter') await puterLogin(); },
      label: 'התחבר עם חשבון Puter (חינם)',
    },
    /** Whether the connection modal must be shown before chatting. */
    needsConnection() { return ENABLE_MULTI_PROVIDER && !current(); },
    _resetTransport() { claudeTransport = null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
