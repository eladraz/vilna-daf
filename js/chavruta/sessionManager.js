/**
 * sessionManager.js — chavruta sessions: one per daf by default, persisted
 * in window.storage (artifact persistent storage) when available, else
 * localStorage. Holds messages, suggested questions, and the
 * history-summarization guard (§5, §8).
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const KEY = 'vilnaChavruta.v1';
  let state = null; // { sessions: { id: {...} } }

  // Artifact persistent storage if present, else localStorage.
  const store = {
    get() {
      try {
        if (global.storage && typeof global.storage.getItem === 'function') return global.storage.getItem(KEY);
        return localStorage.getItem(KEY);
      } catch (e) { return null; }
    },
    set(v) {
      try {
        if (global.storage && typeof global.storage.setItem === 'function') return global.storage.setItem(KEY, v);
        localStorage.setItem(KEY, v);
      } catch (e) { /* storage full / unavailable — keep in memory */ }
    },
  };

  function load() {
    if (state) return state;
    try { state = JSON.parse(store.get()) || null; } catch (e) { state = null; }
    if (!state || typeof state !== 'object' || !state.sessions) state = { sessions: {} };
    return state;
  }
  function save() { store.set(JSON.stringify(load())); }

  function dafLabel(daf) {
    const m = /^(.*)\.(\d+)([ab])$/.exec(daf);
    if (!m) return daf;
    const heb = NS._heb ? NS._heb(+m[2]) : m[2];
    return `${m[1]} ${heb} ${m[3] === 'a' ? 'ע״א' : 'ע״ב'}`;
  }

  function create(daf) {
    const s = load();
    const id = `${daf.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    s.sessions[id] = {
      daf,
      created: new Date().toISOString(),
      messages: [],
      suggestedQuestions: null,
      usedQuestions: [],
      suggestionsSeen: false,
    };
    save();
    return id;
  }

  /** Latest session for a daf, or a fresh one. */
  function forDaf(daf) {
    const s = load();
    const matching = Object.entries(s.sessions)
      .filter(([, v]) => v.daf === daf)
      .sort((a, b) => (a[1].created < b[1].created ? 1 : -1));
    return matching.length ? matching[0][0] : create(daf);
  }

  function get(id) { return load().sessions[id] || null; }

  function list() {
    return Object.entries(load().sessions)
      .sort((a, b) => (a[1].created < b[1].created ? 1 : -1))
      .map(([id, v]) => ({
        id, daf: v.daf,
        label: `${dafLabel(v.daf)} — ${new Date(v.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        messages: v.messages.length,
      }));
  }

  function remove(id) { delete load().sessions[id]; save(); }

  function addMessage(id, role, content) {
    const sess = get(id);
    if (!sess) return;
    sess.messages.push({ role, content });
    save();
  }

  function update(id, patch) {
    const sess = get(id);
    if (!sess) return;
    Object.assign(sess, patch);
    save();
  }

  /**
   * §5/§8: if system + history would exceed ~80% of the context window,
   * summarize the older messages into a single assistant message and keep
   * the recent tail verbatim.
   */
  async function summarizeIfNeeded(id, systemPrompt) {
    const sess = get(id);
    if (!sess || sess.messages.length < 8) return;
    const { estimateTokens, CONTEXT_LIMIT_TOKENS, send } = NS.provider;
    const histChars = sess.messages.reduce((n, m) => n + m.content.length, 0);
    const total = estimateTokens(systemPrompt) + estimateTokens(String(histChars ? 'x'.repeat(histChars) : ''));
    if (total < 0.8 * CONTEXT_LIMIT_TOKENS) return;

    const keepTail = sess.messages.slice(-4);
    const toSummarize = sess.messages.slice(0, -4);
    const transcript = toSummarize.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const { text } = await send({
      system: 'Summarize this chavruta (Talmud study) conversation faithfully in under 400 words. Keep segment references like [segment N] and all conclusions reached.',
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 800,
    });
    sess.messages = [
      { role: 'assistant', content: `[סיכום השיחה עד כה]\n${text}` },
      ...keepTail,
    ];
    save();
  }

  /** Export a session as markdown (for the clipboard). */
  function exportMarkdown(id) {
    const sess = get(id);
    if (!sess) return '';
    const head = `# חברותא — ${dafLabel(sess.daf)}\n_${sess.created}_\n\n`;
    return head + sess.messages
      .map(m => `**${m.role === 'user' ? 'אני' : 'חברותא'}:**\n\n${m.content}`)
      .join('\n\n---\n\n');
  }

  NS.sessions = {
    create, forDaf, get, list, remove, addMessage, update,
    summarizeIfNeeded, exportMarkdown, dafLabel,
    _save: save,
  };
})(typeof window !== 'undefined' ? window : globalThis);
