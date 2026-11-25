/**
 * provider.js — AI provider abstraction for the chavruta.
 *
 * This is a NO-BACKEND, bring-your-own-key design:
 * - "puter" / "browser" (group 'free'): no key — Puter's free account, or
 *   Chrome's on-device Gemini Nano.
 * - "claude" / "chatgpt" / "gemini" / "deepseek" (group 'key'): the browser
 *   calls the provider's API DIRECTLY with the user's own API key. The key
 *   is stored only in this browser (localStorage), never sent anywhere
 *   except straight to that provider, and never displayed. The UI prompts
 *   for it on first use (see chavruta.js key modal).
 *
 * send() implements the messages-mode transport:
 * - streaming parses each provider's SSE and calls onDelta(fullText)
 * - 429/5xx retried with exponential backoff (max 3)
 * - a missing key throws { needKey:true, provider } so the UI can prompt
 * - signal aborts the in-flight request
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const ENABLE_MULTI_PROVIDER = true;
  const PROVIDER_KEY = 'vilnaChavruta.provider';
  const KEY_PREFIX = 'vilnaChavruta.key.';
  const MODEL_PREFIX = 'vilnaChavruta.model.';   // chosen model id, per provider
  const TOOLS_PREFIX = 'vilnaChavruta.tools.';   // enabled tool ids (JSON array), per provider
  const MODEL = 'claude-opus-5-5';
  const CONTEXT_LIMIT_TOKENS = 200000;

  // Tool catalog — capabilities the user can switch on per provider. Each is a
  // single server-side request parameter (no client tool-loop), so the answer
  // still streams as normal text. `id` is stored; `he` labels the checkbox.
  const TOOLS = {
    webSearch: { he: 'חיפוש באינטרנט', hint: 'הספק מחפש ברשת בזמן המענה' },
  };

  // Per-provider endpoint/model/key metadata for the BYO-key cloud providers.
  //   model   — default model id (also the prefilled value in the model field)
  //   models  — suggested model ids (datalist); the field stays editable, so
  //             any model the user's key supports works without a code change.
  //   tools   — tool ids from TOOLS this provider can run server-side.
  const KEY_PROVIDERS = {
    claude:   { api: 'anthropic', model: MODEL, vendor: 'Anthropic',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2',
               'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
      tools: ['webSearch'],
      keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'מפתח Anthropic (מתחיל ב־sk-ant-)' },
    // OpenAI goes through the Responses API: web search there works with the
    // current GPT models (Chat Completions only searches with gpt-5-search-api).
    chatgpt:  { api: 'openai-responses', model: 'gpt-6.2-astra', vendor: 'OpenAI', endpoint: 'https://api.openai.com/v1/responses',
      models: ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol',
               'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
      tools: ['webSearch'],
      keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'מפתח OpenAI (מתחיל ב־sk-)' },
    deepseek: { api: 'openai',    model: 'deepseek-flash', vendor: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      tools: ['webSearch'], toolsNote: 'חיפוש ב־DeepSeek זמין בדגם ‎deepseek-flash בלבד',
      keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'מפתח DeepSeek (מתחיל ב־sk-)' },
    gemini:   { api: 'gemini',    model: 'gemini-4-hydrogen', vendor: 'Google AI Studio',
      models: ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-argon', 'gemini-4-carbon',
               'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
      tools: ['webSearch'],
      keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'מפתח Google AI Studio (מתחיל ב־AIza)' },
  };

  /**
   * Selectable providers (connection modal cards).
   * group 'free' — no key needed.  group 'key' — bring your own API key.
   */
  const PROVIDERS = {
    puter: { label: 'GPT / Claude — חשבון Puter', mode: 'messages', enabled: true, group: 'free',
      hint: 'הרשמה חינמית בחלון קופץ — ללא מפתח וללא התקנה' },
    browser: { label: 'AI בדפדפן (Gemini Nano)', mode: 'messages', enabled: true, group: 'free',
      hint: 'ללא חשבון כלל — מקומי ופרטי, דורש Chrome עדכני' },
    claude: { label: 'Claude (Anthropic)', mode: 'messages', enabled: true, group: 'key', needsKey: true,
      hint: 'מפתח API משלך — נשמר רק בדפדפן' },
    chatgpt: { label: 'ChatGPT (OpenAI)', mode: 'messages', enabled: true, group: 'key', needsKey: true,
      hint: 'מפתח API משלך — נשמר רק בדפדפן' },
    gemini: { label: 'Gemini (Google)', mode: 'messages', enabled: true, group: 'key', needsKey: true,
      hint: 'מפתח API משלך — נשמר רק בדפדפן' },
    deepseek: { label: 'DeepSeek', mode: 'messages', enabled: true, group: 'key', needsKey: true,
      hint: 'מפתח API משלך — נשמר רק בדפדפן' },
  };

  function current() {
    let id = null;
    try { id = localStorage.getItem(PROVIDER_KEY); } catch (e) { /* no storage */ }
    if (id === 'claude-artifact' || id === 'chatgpt-chatkit') id = id.split('-')[0]; // legacy
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

  // ── API keys: stored only in this browser, never displayed ──────
  function needsKey(id) { return !!(PROVIDERS[id] && PROVIDERS[id].needsKey); }
  function keyFor(id) {
    try { return localStorage.getItem(KEY_PREFIX + id) || ''; } catch (e) { return ''; }
  }
  function hasKey(id) { return !!keyFor(id); }
  function setKey(id, val) {
    try { localStorage.setItem(KEY_PREFIX + id, String(val || '').trim()); } catch (e) {}
  }
  function clearKey(id) { try { localStorage.removeItem(KEY_PREFIX + id); } catch (e) {} }
  function keyMeta(id) { return KEY_PROVIDERS[id] || null; }

  // ── Model selection: chosen model id per provider (editable) ────
  function modelDefault(id) { return (KEY_PROVIDERS[id] || {}).model || MODEL; }
  function modelList(id) { return ((KEY_PROVIDERS[id] || {}).models || []).slice(); }
  function modelFor(id) {
    let v = '';
    try { v = localStorage.getItem(MODEL_PREFIX + id) || ''; } catch (e) {}
    return v.trim() || modelDefault(id);
  }
  function setModel(id, val) {
    const v = String(val || '').trim();
    try {
      if (v && v !== modelDefault(id)) localStorage.setItem(MODEL_PREFIX + id, v);
      else localStorage.removeItem(MODEL_PREFIX + id);
    } catch (e) {}
  }

  // ── Tools: which capabilities are enabled per provider ──────────
  function toolsAvailable(id) { return ((KEY_PROVIDERS[id] || {}).tools || []).slice(); }
  function toolsEnabled(id) {
    let raw = '';
    try { raw = localStorage.getItem(TOOLS_PREFIX + id) || ''; } catch (e) {}
    let arr = [];
    try { arr = raw ? JSON.parse(raw) : []; } catch (e) { arr = []; }
    const avail = toolsAvailable(id);
    return Array.isArray(arr) ? arr.filter(t => avail.includes(t)) : [];
  }
  function setTools(id, list) {
    const avail = toolsAvailable(id);
    const clean = (Array.isArray(list) ? list : []).filter(t => avail.includes(t));
    try {
      if (clean.length) localStorage.setItem(TOOLS_PREFIX + id, JSON.stringify(clean));
      else localStorage.removeItem(TOOLS_PREFIX + id);
    } catch (e) {}
  }
  function toolOn(id, tool) { return toolsEnabled(id).includes(tool); }
  function toolMeta(tool) { return TOOLS[tool] || null; }

  /**
   * Whether a tool actually works with a given model. DeepSeek's built-in
   * search (deepseek_web_search) runs only on deepseek-flash. Claude, OpenAI
   * (Responses API) and Gemini search with every model in their lists.
   */
  function toolSupported(id, tool, model) {
    if (!toolsAvailable(id).includes(tool)) return false;
    model = model || modelFor(id);
    if (id === 'deepseek' && tool === 'webSearch') return /^deepseek-flash/.test(model);
    return true;
  }

  /**
   * Claude web search tool version: the dynamic-filtering variant on the models
   * that have it, the basic one on Haiku and older models.
   */
  function claudeSearchTool(model) {
    const basic = /haiku|claude-3|claude-(opus|sonnet)-4-[0-5]\b|claude-(opus|sonnet)-4-\d{8}/.test(model);
    return { type: basic ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 5 };
  }
  /** Tools that are enabled AND usable with the chosen model. */
  function effectiveTools(id, model) {
    return toolsEnabled(id).filter(t => toolSupported(id, t, model));
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

  /**
   * Build an Error from a failed response, pulling the provider's own message
   * out of the body so the UI can show *why* it failed (bad key, unknown
   * model, quota, …) instead of a bare status code.
   */
  async function errorFromResponse(resp) {
    const err = new Error(`API ${resp.status}`);
    err.status = resp.status;
    let detail = '';
    try {
      const text = await resp.text();
      try {
        const j = JSON.parse(text);
        // OpenAI/DeepSeek/Anthropic: {error:{message,type}}; Gemini: {error:{message,status}}.
        detail = (j.error && (j.error.message || j.error.type || j.error.status)) || j.message || '';
      } catch (e) { detail = text; }
    } catch (e) { /* body already consumed or unreadable */ }
    if (detail) err.detail = String(detail).trim().slice(0, 400);
    return err;
  }

  /** Read a response (JSON or normalized SSE) into the full text. */
  async function readResponse(resp, { stream, onDelta }) {
    if (!resp.ok) throw await errorFromResponse(resp);
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

  /** Stream an OpenAI-style SSE (data: {choices:[{delta:{content}}]}). */
  async function readOpenAILike(resp, { stream, onDelta }) {
    if (!resp.ok) throw await errorFromResponse(resp);
    if (!stream) {
      const d = await resp.json();
      return ((d.choices || [])[0] || {}).message?.content || '';
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try {
          const t = (((JSON.parse(p).choices || [])[0] || {}).delta || {}).content;
          if (t) { text += t; if (onDelta) onDelta(text); }
        } catch (e) { /* partial frame */ }
      }
    }
    return text;
  }

  /** Stream a Gemini SSE (data: {candidates:[{content:{parts:[{text}]}}]}). */
  async function readGemini(resp, { stream, onDelta }) {
    if (!resp.ok) throw await errorFromResponse(resp);
    const partsText = d => (((d.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('');
    if (!stream) return partsText(await resp.json());
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p) continue;
        try { const t = partsText(JSON.parse(p)); if (t) { text += t; if (onDelta) onDelta(text); } }
        catch (e) { /* partial frame */ }
      }
    }
    return text;
  }

  // ── Direct, browser-side calls with the user's own key ──────────

  function callAnthropic(key, model, tools, body, stream, signal) {
    const payload = { model, max_tokens: body.max_tokens, system: body.system, messages: body.messages, stream: !!stream };
    // Server-side web search: Claude runs it and folds results into the answer;
    // text still arrives as content_block_delta, so the SSE reader is unchanged.
    if (tools.includes('webSearch')) {
      payload.tools = [claudeSearchTool(model)];
    }
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
      signal,
    });
  }

  function callOpenAILike(endpoint, model, key, tools, body, stream, signal) {
    const payload = {
      model,
      messages: [{ role: 'system', content: body.system }, ...body.messages],
      max_tokens: body.max_tokens,
      stream: !!stream,
    };
    // DeepSeek built-in search: the service runs it, so no client tool loop.
    // Plain search (with citations) needs thinking disabled.
    if (tools.includes('webSearch')) {
      payload.tools = [{ type: 'deepseek_web_search' }];
      payload.thinking = { type: 'disabled' };
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal,
    });
  }

  /** OpenAI Responses API (system prompt as `instructions`, hosted web search). */
  function callOpenAIResponses(endpoint, model, key, tools, body, stream, signal) {
    const payload = {
      model,
      instructions: body.system,
      input: body.messages.map(m => ({ role: m.role, content: m.content })),
      max_output_tokens: body.max_tokens,
      stream: !!stream,
    };
    if (tools.includes('webSearch')) payload.tools = [{ type: 'web_search' }];
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal,
    });
  }

  /** Read a Responses API reply: JSON `output[]` or SSE `response.output_text.delta`. */
  async function readOpenAIResponses(resp, { stream, onDelta }) {
    if (!resp.ok) throw await errorFromResponse(resp);
    const fail = ev => {
      const e = (ev.response && ev.response.error) || ev.error || ev;
      return Object.assign(new Error('API error'), { status: 500, detail: String(e.message || e.code || 'response failed').slice(0, 400) });
    };
    if (!stream) {
      const d = await resp.json();
      if (d.error) throw fail(d);
      return (d.output || []).filter(o => o.type === 'message')
        .flatMap(o => o.content || []).filter(c => c.type === 'output_text')
        .map(c => c.text).join('');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(p); } catch (e) { continue; /* partial frame */ }
        if (ev.type === 'response.output_text.delta' && ev.delta) {
          text += ev.delta; if (onDelta) onDelta(text);
        } else if (ev.type === 'response.failed' || ev.type === 'error') {
          throw fail(ev);
        }
      }
    }
    return text;
  }

  function callGeminiDirect(model, key, tools, body, stream, signal) {
    const verb = stream ? `streamGenerateContent?alt=sse&key=${key}` : `generateContent?key=${key}`;
    const payload = {
      systemInstruction: { parts: [{ text: body.system }] },
      contents: body.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: body.max_tokens },
    };
    if (tools.includes('webSearch')) payload.tools = [{ google_search: {} }];
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${verb}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

  async function callOnce(body, { stream, onDelta, signal }) {
    const prov = current() || 'claude';
    if (prov === 'puter') return callPuter(body, { stream, onDelta, signal });
    if (prov === 'browser') return callBrowser(body, { stream, onDelta, signal });

    // BYO-key cloud providers — call the vendor API directly with the key,
    // using the user's chosen model and enabled tools.
    const meta = keyMeta(prov);
    const key = keyFor(prov);
    if (meta && !key) throw Object.assign(new Error('api key required'), { needKey: true, provider: prov });
    const model = modelFor(prov);
    // Only tools the chosen model can actually run (prevents e.g. OpenAI 400
    // "Unknown parameter: web_search_options" on non-search models).
    const tools = effectiveTools(prov, model);

    if (prov === 'claude') {
      return readResponse(await callAnthropic(key, model, tools, body, stream, signal), { stream, onDelta });
    }
    if (prov === 'gemini') {
      return readGemini(await callGeminiDirect(model, key, tools, body, stream, signal), { stream, onDelta });
    }
    if (meta.api === 'openai-responses') {
      return readOpenAIResponses(await callOpenAIResponses(meta.endpoint, model, key, tools, body, stream, signal), { stream, onDelta });
    }
    // deepseek uses the OpenAI chat-completions shape.
    return readOpenAILike(await callOpenAILike(meta.endpoint, model, key, tools, body, stream, signal), { stream, onDelta });
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
    browserAvailable,
    browserAvailability,
    // BYO API keys (browser-only storage).
    needsKey, keyFor, hasKey, setKey, clearKey, keyMeta,
    // Model selection + tools (browser-only storage).
    TOOLS,
    modelFor, setModel, modelList, modelDefault,
    toolsAvailable, toolsEnabled, setTools, toolOn, toolMeta, toolSupported, effectiveTools,
    /** Interactive (popup) login the provider needs before first use. */
    interactiveLogin: {
      async needed() { return current() === 'puter' ? puterLoginNeeded() : false; },
      async login() { if (current() === 'puter') await puterLogin(); },
      label: 'התחבר עם חשבון Puter (חינם)',
    },
    /** Whether the connection modal must be shown before chatting. */
    needsConnection() { return ENABLE_MULTI_PROVIDER && !current(); },
    _resetTransport() { /* no-op: kept for callers */ },
  };
})(typeof window !== 'undefined' ? window : globalThis);
