/**
 * chavruta-server.mjs — reference backend for the AI chavruta providers.
 *
 * Vilna Daf itself is a static site with NO backend and NO user accounts.
 * This server is the production-shaped reference you run alongside it (or
 * behind the same reverse proxy) to enable the AI providers:
 *
 *   node server/chavruta-server.mjs
 *
 * Endpoints:
 *   POST /api/login            — DEMO auth: issues a signed session cookie.
 *                                Replace with your real auth system; the
 *                                other endpoints only consume the session.
 *   GET  /api/me               — session check for the frontend login flow.
 *   POST /api/chatkit/session  — authenticated; creates an OpenAI ChatKit
 *                                session and returns ONLY the client_secret.
 *   POST /api/chat             — authenticated; unified messages proxy for
 *                                Claude (Anthropic) and Gemini (Google).
 *                                The browser never sees a provider key;
 *                                streamed responses come back as normalized
 *                                anthropic-style content_block_delta SSE.
 *
 * Security properties (see docs/CHATKIT.md and docs/AI-PROVIDERS.md):
 *   - All provider API keys live only in this process's environment.
 *   - Identity is derived from the verified session cookie, never from the
 *     request body. user_id/tenant/role in the body are ignored.
 *   - The OpenAI `user` value is a salted SHA-256 of the internal user id.
 *   - The only client hint accepted is page_id, validated against the daf
 *     ref format; the server decides what context workflows see.
 *   - Origin allow-list (CORS + CSRF for cookie auth), per-IP rate limit,
 *     body-size caps, and event logging without secrets.
 *
 * Environment:
 *   OPENAI_API_KEY              ChatGPT/ChatKit (server-side only)
 *   OPENAI_CHATKIT_WORKFLOW_ID  the ChatKit workflow to run
 *   ANTHROPIC_API_KEY           Claude proxy (server-side only)
 *   GEMINI_API_KEY              Gemini proxy (server-side only)
 *   GEMINI_MODEL                default gemini-2.0-flash
 *   SESSION_SECRET              HMAC key for the demo session cookie
 *   USER_HASH_SALT              salt for pseudonymizing user ids
 *   ALLOWED_ORIGIN              e.g. https://eladraz.github.io
 *   OPENAI_BASE_URL / ANTHROPIC_BASE_URL / GEMINI_BASE_URL  test overrides
 *   PORT                        default 8787
 */
import http from 'http';
import crypto from 'crypto';

const {
  OPENAI_API_KEY,
  OPENAI_CHATKIT_WORKFLOW_ID,
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.0-flash',
  SESSION_SECRET = '',
  USER_HASH_SALT = '',
  ALLOWED_ORIGIN = 'http://localhost:8000',
  OPENAI_BASE_URL = 'https://api.openai.com',
  ANTHROPIC_BASE_URL = 'https://api.anthropic.com',
  GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com',
  PORT = 8787,
} = process.env;

if (!SESSION_SECRET) {
  console.error('SESSION_SECRET is required (any long random string).');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────

const hmac = data => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
const hashUserId = id => crypto.createHash('sha256').update(`${USER_HASH_SALT}:${id}`).digest('hex');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 512 * 1024) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

function json(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, extraHeaders));
  res.end(JSON.stringify(obj));
}

// ── demo auth (REPLACE with your real auth/session layer) ────────
// Issues `vd_session=<payload>.<hmac>` httpOnly cookie. The ChatKit
// endpoint only calls requireAuthenticatedUser(); swapping in real auth
// means reimplementing just that function (JWT/OIDC/whatever you use).

function makeSession(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function requireAuthenticatedUser(req) {
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('vd_session='));
  if (!cookie) return null;
  const [payload, sig] = cookie.slice('vd_session='.length).split('.');
  if (!payload || !sig) return null;
  if (!crypto.timingSafeEqual(Buffer.from(hmac(payload)), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.uid ? { id: String(data.uid) } : null;
  } catch (e) { return null; }
}

// In this public-Torah app every authenticated user has the same scope;
// a multi-tenant app would resolve account/role from its database HERE,
// never from the request body.
function getScopeForUser(user) {
  return { accountId: 'public', role: 'learner', scope: 'public-daf' };
}

// ── rate limiting (per IP, fixed window) ─────────────────────────

const rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, n: 0 };
  if (now - bucket.start > 60000) { bucket.start = now; bucket.n = 0; }
  bucket.n++;
  rateBuckets.set(ip, bucket);
  return bucket.n > 10; // 10 sessions/minute/IP
}

// ── origin checks: CORS + CSRF (cookie auth ⇒ verify Origin) ─────

function originOk(req) {
  const origin = req.headers.origin || '';
  // Same-origin requests may omit Origin; cross-origin must match.
  return !origin || origin === ALLOWED_ORIGIN;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// ── page_id validation: only a daf ref is an acceptable hint ─────

const PAGE_ID_RE = /^[A-Za-z' ]{2,30}\.\d{1,3}[ab]$/; // e.g. "Berachot.2a"
function validatedPageId(raw) {
  const v = String(raw || '').trim();
  return PAGE_ID_RE.test(v) ? v : 'unknown';
}

// ── ChatKit session creation ─────────────────────────────────────

async function createChatKitSession(user, pageId) {
  const scope = getScopeForUser(user);
  const resp = await fetch(`${OPENAI_BASE_URL}/v1/chatkit/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'chatkit_beta=v1',
    },
    body: JSON.stringify({
      user: hashUserId(user.id),
      workflow: {
        id: OPENAI_CHATKIT_WORKFLOW_ID,
        state_variables: {
          account_id: scope.accountId,
          role: scope.role,
          allowed_context_scope: scope.scope,
          current_page: pageId,
        },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`openai ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ── unified messages proxy: Claude / Gemini ──────────────────────
// Request:  { provider: 'claude'|'gemini', system, messages, max_tokens,
//             stream }
// Response: non-stream → { content: [{type:'text', text}] }
//           stream     → SSE of anthropic-style content_block_delta frames
// (one neutral wire format, whatever the upstream provider speaks).

const MAX_BODY_CHARS = 400000; // system prompt + history cap
const MAX_TOKENS_CAP = 4096;

function validateChatBody(body) {
  if (!body || (body.provider !== 'claude' && body.provider !== 'gemini')) return 'bad provider';
  if (typeof body.system !== 'string' || !Array.isArray(body.messages) || !body.messages.length) return 'bad shape';
  let chars = body.system.length;
  for (const m of body.messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return 'bad message';
    chars += m.content.length;
  }
  if (chars > MAX_BODY_CHARS) return 'too large';
  return null;
}

const sseFrame = text =>
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;

async function proxyClaude(body, res, cors) {
  const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(body.max_tokens || 1500, MAX_TOKENS_CAP),
      system: body.system,
      messages: body.messages,
      stream: !!body.stream,
    }),
  });
  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return json(res, status, { error: `upstream ${upstream.status}` }, cors);
  }
  if (!body.stream) {
    return json(res, 200, await upstream.json(), cors); // already neutral shape
  }
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream' }, cors));
  for await (const chunk of upstream.body) res.write(chunk); // already our SSE dialect
  res.end();
}

function toGeminiPayload(body) {
  return {
    systemInstruction: { parts: [{ text: body.system }] },
    contents: body.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: Math.min(body.max_tokens || 1500, MAX_TOKENS_CAP) },
  };
}

const geminiText = data =>
  (((data.candidates || [])[0] || {}).content || { parts: [] }).parts
    .map(p => p.text || '').join('');

async function proxyGemini(body, res, cors) {
  const verb = body.stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
  const upstream = await fetch(
    `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:${verb}key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toGeminiPayload(body)) });
  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return json(res, status, { error: `upstream ${upstream.status}` }, cors);
  }
  if (!body.stream) {
    const data = await upstream.json();
    return json(res, 200, { content: [{ type: 'text', text: geminiText(data) }] }, cors);
  }
  // Translate Gemini SSE chunks into the neutral dialect.
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream' }, cors));
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of upstream.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const text = geminiText(JSON.parse(line.slice(5).trim()));
        if (text) res.write(sseFrame(text));
      } catch (e) { /* keep-alive / partial frame */ }
    }
  }
  res.end();
}

// ── server ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || '?';

  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireAuthenticatedUser(req);
    return user
      ? json(res, 200, { ok: true, name: user.id }, corsHeaders())
      : json(res, 401, { error: 'unauthenticated' }, corsHeaders());
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const cors = corsHeaders();
    if (!originOk(req)) return json(res, 403, { error: 'bad origin' }, cors);
    if (rateLimited(ip)) return json(res, 429, { error: 'rate limited' }, cors);
    const user = requireAuthenticatedUser(req);
    if (!user) return json(res, 401, { error: 'unauthenticated' }, cors);
    const body = await readBody(req);
    const bad = validateChatBody(body);
    if (bad) return json(res, 400, { error: bad }, cors);
    const keyed = body.provider === 'claude' ? ANTHROPIC_API_KEY : GEMINI_API_KEY;
    if (!keyed) return json(res, 503, { error: `${body.provider} not configured` }, cors);
    console.log(JSON.stringify({
      evt: 'chat_proxied', provider: body.provider,
      user: hashUserId(user.id).slice(0, 12), at: new Date().toISOString(),
    }));
    try {
      if (body.provider === 'claude') return await proxyClaude(body, res, cors);
      return await proxyGemini(body, res, cors);
    } catch (e) {
      console.error('chat proxy failed:', e.message);
      if (!res.headersSent) return json(res, 502, { error: 'proxy failed' }, cors);
      res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    // DEMO ONLY: real deployments replace this whole endpoint.
    if (!originOk(req)) return json(res, 403, { error: 'bad origin' }, corsHeaders());
    const body = await readBody(req);
    const name = String(body.name || '').slice(0, 40) || 'demo-user';
    res.writeHead(200, Object.assign({
      'Content-Type': 'application/json',
      'Set-Cookie': `vd_session=${makeSession(name)}; HttpOnly; SameSite=Lax; Path=/`,
    }, corsHeaders()));
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chatkit/session') {
    const cors = corsHeaders();
    if (!originOk(req)) return json(res, 403, { error: 'bad origin' }, cors);          // CSRF/CORS
    if (rateLimited(ip)) return json(res, 429, { error: 'rate limited' }, cors);       // rate limit
    const user = requireAuthenticatedUser(req);                                        // real identity
    if (!user) return json(res, 401, { error: 'unauthenticated' }, cors);
    if (!OPENAI_API_KEY || !OPENAI_CHATKIT_WORKFLOW_ID) {
      return json(res, 503, { error: 'chatkit not configured' }, cors);
    }
    const body = await readBody(req);
    // Body-provided identity/tenant/role is ignored BY CONSTRUCTION: only
    // page_id is read, and only after validation.
    const pageId = validatedPageId(body.page_id);
    try {
      const session = await createChatKitSession(user, pageId);
      console.log(JSON.stringify({                            // log event, no secrets
        evt: 'chatkit_session_created', user: hashUserId(user.id).slice(0, 12),
        page: pageId, at: new Date().toISOString(),
      }));
      return json(res, 200, { client_secret: session.client_secret }, cors);
    } catch (e) {
      console.error('chatkit session failed:', e.message);
      return json(res, 502, { error: 'session creation failed' }, cors);
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`chatkit server on :${PORT} (origin ${ALLOWED_ORIGIN})`));
