# ChatGPT provider — OpenAI ChatKit integration

The chavruta's ChatGPT option is implemented with **OpenAI ChatKit**, not with
chatgpt.com. There is **no iframe to chatgpt.com**, the site **never asks for
ChatGPT credentials**, **never reads ChatGPT cookies**, and the **OpenAI API
key never reaches the browser**.

## Architecture

```
Browser (static site)                       Your backend                 OpenAI
─────────────────────                       ────────────                 ──────
tornado → provider modal → ChatGPT
  js/chavruta/chatkit.js
    POST /api/chatkit/session  ──────────▶  verify OUR session cookie
    { page_id: "Berachot.2a" }             validate page_id
                                            derive identity/role/scope
                                            POST /v1/chatkit/sessions ─▶ create session
                                            (Authorization: server key)
    ◀── { client_secret } ────────────────  return ONLY client_secret
mount <openai-chatkit> with client_secret
(widget talks to OpenAI with the short-lived secret)
```

- Users authenticate only with **this site's** auth (the reference server
  ships a demo cookie login at `POST /api/login`; replace
  `requireAuthenticatedUser()` in `server/chavruta-server.mjs` with your real
  session/JWT layer — nothing else needs to change).
- The browser receives **only** a short-lived ChatKit `client_secret`.
- The widget refreshes its secret through the same endpoint
  (`getClientSecret` hook in `js/chavruta/chatkit.js`).

## Environment variables (server-side only)

Copy `server/.env.example`; never commit real values.

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | server-side OpenAI key; never sent to clients |
| `OPENAI_CHATKIT_WORKFLOW_ID` | the ChatKit workflow to run |
| `SESSION_SECRET` | HMAC key for the session cookie |
| `USER_HASH_SALT` | salt for pseudonymizing user ids sent to OpenAI |
| `ALLOWED_ORIGIN` | the site origin (CORS + CSRF Origin check) |

Run: `node server/chavruta-server.mjs` (Node ≥ 18, no dependencies).
Tests: `node server/test-server.mjs` (mocks OpenAI; needs no key).

## Why not ChatGPT web login / iframe?

- chatgpt.com forbids framing (`X-Frame-Options`/CSP) and its cookies are
  third-party — an embedded login would be both broken and a phishing-shaped
  anti-pattern. Users must never type ChatGPT credentials into our pages.
- ChatKit is OpenAI's supported embedding path: our backend mints a scoped,
  short-lived session; the browser holds no durable credential.

## What context is passed to ChatKit

`workflow.state_variables` carries **only**:

| Variable | Source | Value |
|----------|--------|-------|
| `account_id` | server | `public` (this site has no tenants) |
| `role` | server | `learner` |
| `allowed_context_scope` | server | `public-daf` |
| `current_page` | client hint, **validated** | a daf ref like `Berachot.2a`, else `unknown` |

The browser cannot inject identity, role, tenant, or scope: those fields are
derived server-side and any same-named values in the request body are ignored
(covered by tests). `page_id` is the only client hint, validated against the
daf-ref grammar. The OpenAI `user` field is `sha256(USER_HASH_SALT:userId)`.

## Adding backend tools safely later

When the workflow needs private data, do NOT widen `state_variables`.
Instead expose narrow server-side tools (ChatKit server tools / function
endpoints) that:

1. receive the tool call on **your** backend,
2. re-verify the session and re-check permissions for the specific object id,
3. return the minimal data needed.

Treat every tool argument as untrusted, exactly like `page_id` here.

## Operational notes

- Session creation is rate-limited (10/min/IP) and logged as
  `chatkit_session_created` with the hashed user — no secrets in logs.
- A wrong `Origin` is rejected (CSRF defense for cookie auth); CORS is
  restricted to `ALLOWED_ORIGIN`.
- The static frontend contains no key material — enforced by a test that
  greps the bundle.
