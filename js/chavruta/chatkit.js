/**
 * chatkit.js — ChatGPT support via OpenAI ChatKit (widget mode).
 *
 * Security shape (see docs/CHATKIT.md and server/chavruta-server.mjs):
 * - NO chatgpt.com iframe, NO ChatGPT credentials, NO ChatGPT cookies.
 * - NO OpenAI API key anywhere in the frontend. The browser calls OUR
 *   backend (POST /api/chatkit/session, cookie auth, credentials:include)
 *   and receives only a short-lived ChatKit client_secret.
 * - The only context hint the page sends is the low-risk page id (the
 *   current daf ref); the backend validates it and decides what context
 *   the workflow may see. Identity/role/scope are derived server-side.
 *
 * mount(container, {pageId, onError}) → fetches a session, loads the
 * ChatKit script once, and mounts <openai-chatkit> with a
 * getClientSecret hook that re-requests on refresh.
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  const SESSION_ENDPOINT = '/api/chatkit/session';
  const CHATKIT_SCRIPT = 'https://cdn.platform.openai.com/deployments/chatkit/chatkit.js';

  let scriptPromise = null;

  function loadScript() {
    if (global.customElements && global.customElements.get('openai-chatkit')) return Promise.resolve();
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CHATKIT_SCRIPT;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { scriptPromise = null; reject(new Error('chatkit script failed to load')); };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  /** Ask OUR backend for a session. Only a client_secret comes back. */
  async function getClientSecret(pageId) {
    const resp = await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // our site's auth cookie — never ChatGPT's
      body: JSON.stringify({ page_id: pageId || location.pathname }),
    });
    if (resp.status === 401) { const e = new Error('unauthenticated'); e.status = 401; throw e; }
    if (!resp.ok) { const e = new Error(`session ${resp.status}`); e.status = resp.status; throw e; }
    const data = await resp.json();
    if (!data.client_secret) throw new Error('no client_secret in response');
    return data.client_secret;
  }

  /**
   * Mount the widget into `container`. Returns the element.
   * Replaces any previous mount in that container.
   */
  async function mount(container, { pageId } = {}) {
    container.innerHTML = '<div class="chv-chatkit-loading">מתחבר ל־ChatGPT…</div>';
    const [secret] = await Promise.all([getClientSecret(pageId), loadScript()]);

    const el = document.createElement('openai-chatkit');
    el.className = 'chv-chatkit';
    if (typeof el.setOptions === 'function') {
      el.setOptions({
        api: {
          // Called on mount and whenever the secret needs refreshing.
          getClientSecret: async currentSecret =>
            (currentSecret ? getClientSecret(pageId) : secret),
        },
      });
    } else {
      // Older builds of the web component take the secret as an attribute.
      el.setAttribute('client-secret', secret);
    }
    container.innerHTML = '';
    container.appendChild(el);
    return el;
  }

  NS.chatkit = { mount, getClientSecret, SESSION_ENDPOINT };
})(typeof window !== 'undefined' ? window : globalThis);
