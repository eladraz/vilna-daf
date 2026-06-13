/**
 * test-server.mjs — acceptance tests for the chavruta backend.
 *
 * Runs the real server against mocked provider endpoints (no keys needed):
 *   node server/test-server.mjs
 *
 * Asserts:
 *   1. unauthenticated POST /api/chatkit/session and /api/chat → 401
 *   2. authenticated chatkit request → client_secret (nothing sensitive)
 *   3. spoofed user_id / tenant_id / role in the body are ignored —
 *      identity comes from the session, page_id is validated
 *   4. wrong Origin → 403 (CSRF); rate limit → 429
 *   5. frontend bundle contains no API-key material
 *   6. /api/chat claude → anthropic passthrough with the server-side key
 *   7. /api/chat gemini → request converted, response normalized
 *   8. /api/chat rejects unknown providers
 */
import http from 'http';
import { spawn } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

// ── mock OpenAI: records the body, returns a client_secret ──────
let lastOpenAIBody = null;
const mockOpenAI = http.createServer(async (req, res) => {
  let data = '';
  for await (const c of req) data += c;
  lastOpenAIBody = JSON.parse(data);
  if ((req.headers.authorization || '') !== 'Bearer test-key') {
    res.writeHead(401); res.end('{}'); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'cksess_1', client_secret: 'ek_test_secret_123' }));
});

await new Promise(r => mockOpenAI.listen(0, '127.0.0.1', r));
const mockPort = mockOpenAI.address().port;

// ── mock Anthropic: records body + auth header, streams SSE ─────
let lastAnthropic = null;
const mockAnthropic = http.createServer(async (req, res) => {
  let data = '';
  for await (const c of req) data += c;
  lastAnthropic = { body: JSON.parse(data), key: req.headers['x-api-key'] };
  if (lastAnthropic.body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"שלום מקלוד"}}\n\n');
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'שלום מקלוד' }] }));
  }
});
await new Promise(r => mockAnthropic.listen(0, '127.0.0.1', r));

// ── mock Gemini: records URL + body, returns Gemini shapes ──────
let lastGemini = null;
const mockGemini = http.createServer(async (req, res) => {
  let data = '';
  for await (const c of req) data += c;
  lastGemini = { url: req.url, body: JSON.parse(data) };
  const chunk = { candidates: [{ content: { parts: [{ text: 'שלום מג׳מיני' }] } }] };
  if (req.url.includes('streamGenerateContent')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(chunk)}\n\n`);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chunk));
  }
});
await new Promise(r => mockGemini.listen(0, '127.0.0.1', r));

// ── start the real server ────────────────────────────────────────
const PORT = 18787;
const ORIGIN = 'http://localhost:8000';
const child = spawn(process.execPath, [join(__dirname, 'chavruta-server.mjs')], {
  env: {
    ...process.env,
    OPENAI_API_KEY: 'test-key',
    OPENAI_CHATKIT_WORKFLOW_ID: 'wf_test',
    ANTHROPIC_API_KEY: 'anthropic-test-key',
    GEMINI_API_KEY: 'gemini-test-key',
    SESSION_SECRET: 'test-session-secret',
    USER_HASH_SALT: 'test-salt',
    ALLOWED_ORIGIN: ORIGIN,
    OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockAnthropic.address().port}`,
    GEMINI_BASE_URL: `http://127.0.0.1:${mockGemini.address().port}`,
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });
await new Promise(r => setTimeout(r, 600));

const base = `http://127.0.0.1:${PORT}`;
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body || {}),
  });

try {
  // 1. unauthenticated → 401
  const r1 = await post('/api/chatkit/session', { page_id: 'Berachot.2a' });
  check('unauthenticated → 401', r1.status === 401, `got ${r1.status}`);

  // login (demo) to get a session cookie
  const login = await post('/api/login', { name: 'razi' });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('demo login sets cookie', cookie.startsWith('vd_session='), cookie);

  // 2. authenticated → client_secret only
  const r2 = await post('/api/chatkit/session',
    { page_id: 'Berachot.2a' }, { Cookie: cookie });
  const d2 = await r2.json();
  check('authenticated → 200 + client_secret', r2.status === 200 && d2.client_secret === 'ek_test_secret_123', JSON.stringify(d2));
  check('response has nothing but client_secret', Object.keys(d2).join(',') === 'client_secret', JSON.stringify(d2));

  // 3. spoofing: body identity/tenant/role must be ignored
  await post('/api/chatkit/session', {
    page_id: 'Berachot.2a', user_id: 'admin', tenant_id: 'someone-else',
    role: 'admin', allowed_context_scope: 'account:victim',
  }, { Cookie: cookie });
  const sv = lastOpenAIBody.workflow.state_variables;
  check('spoofed tenant/role ignored',
    sv.account_id === 'public' && sv.role === 'learner' && sv.allowed_context_scope === 'public-daf',
    JSON.stringify(sv));
  check('openai user is hashed (not the raw id)',
    /^[0-9a-f]{64}$/.test(lastOpenAIBody.user) && lastOpenAIBody.user !== 'razi', lastOpenAIBody.user);

  // invalid page_id is sanitized
  await post('/api/chatkit/session', { page_id: '<script>alert(1)</script>' }, { Cookie: cookie });
  check('invalid page_id sanitized to "unknown"',
    lastOpenAIBody.workflow.state_variables.current_page === 'unknown',
    lastOpenAIBody.workflow.state_variables.current_page);

  // 4. CSRF: wrong Origin → 403
  const r4 = await post('/api/chatkit/session', { page_id: 'Berachot.2a' },
    { Cookie: cookie, Origin: 'https://evil.example' });
  check('wrong Origin → 403', r4.status === 403, `got ${r4.status}`);

  // 6. /api/chat — auth + claude passthrough
  const chatBody = { provider: 'claude', system: 'אתה חברותא', messages: [{ role: 'user', content: 'מה המשנה אומרת?' }] };
  const c1 = await post('/api/chat', chatBody);
  check('chat unauthenticated → 401', c1.status === 401, `got ${c1.status}`);

  const c2 = await post('/api/chat', chatBody, { Cookie: cookie });
  const d2c = await c2.json();
  check('chat claude → normalized content', d2c.content && d2c.content[0].text === 'שלום מקלוד', JSON.stringify(d2c));
  check('claude called with server-side key', lastAnthropic.key === 'anthropic-test-key', lastAnthropic.key);
  check('claude got system+messages', lastAnthropic.body.system === 'אתה חברותא' && lastAnthropic.body.messages.length === 1, '');

  const c3 = await post('/api/chat', { ...chatBody, stream: true }, { Cookie: cookie });
  const s3 = await c3.text();
  check('chat claude stream → SSE deltas', s3.includes('content_block_delta') && s3.includes('שלום מקלוד'), s3.slice(0, 80));

  // 7. /api/chat — gemini conversion + normalization
  const g1 = await post('/api/chat', { ...chatBody, provider: 'gemini' }, { Cookie: cookie });
  const d2g = await g1.json();
  check('chat gemini → normalized content', d2g.content && d2g.content[0].text === 'שלום מג׳מיני', JSON.stringify(d2g));
  check('gemini got converted payload',
    lastGemini.body.systemInstruction.parts[0].text === 'אתה חברותא'
      && lastGemini.body.contents[0].role === 'user'
      && lastGemini.url.includes('key=gemini-test-key'), JSON.stringify(lastGemini.body).slice(0, 120));

  const g2 = await post('/api/chat', { ...chatBody, provider: 'gemini', stream: true }, { Cookie: cookie });
  const s4 = await g2.text();
  check('chat gemini stream → normalized SSE', s4.includes('content_block_delta') && s4.includes('שלום מג׳מיני'), s4.slice(0, 80));

  // 8. unknown provider rejected
  const c4 = await post('/api/chat', { ...chatBody, provider: 'skynet' }, { Cookie: cookie });
  check('chat unknown provider → 400', c4.status === 400, `got ${c4.status}`);

  // rate limit: 10/min/IP
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await post('/api/chatkit/session', { page_id: 'Berachot.2a' }, { Cookie: cookie });
    last = r.status;
  }
  check('rate limit → 429', last === 429, `got ${last}`);

  // 5. no OpenAI key material in the frontend bundle
  const frontendFiles = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (!/node_modules|\.git|server/.test(p)) walk(p); }
      else if (/\.(js|html|css)$/.test(f)) frontendFiles.push(p);
    }
  })(join(ROOT, 'js'));
  frontendFiles.push(join(ROOT, 'index.html'), join(ROOT, 'vilna-daf.js'));
  const leaks = frontendFiles.filter(f => /OPENAI_API_KEY|sk-[A-Za-z0-9]{20}/.test(readFileSync(f, 'utf8')));
  check('frontend bundle has no OpenAI key material', leaks.length === 0, leaks.join(','));

  // server log has the event but no secrets
  check('log has session event without secrets',
    serverLog.includes('chatkit_session_created') && !serverLog.includes('ek_test_secret') && !serverLog.includes('test-key'),
    serverLog.slice(0, 200));
} finally {
  child.kill();
  mockOpenAI.close();
  mockAnthropic.close();
  mockGemini.close();
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
