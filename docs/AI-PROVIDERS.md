# AI chavruta providers

The tornado opens a provider picker. One rule everywhere: **users never
need an API key, and no provider password ever touches our pages.**

## Why "log in with your ChatGPT/Claude/Gemini subscription" isn't a thing

Consumer AI subscriptions are not accessible to third-party websites via
plain web login: OpenAI/Anthropic/Google do not let an arbitrary site bill
a user's subscription (the OAuth programs that will allow it — e.g.
OpenAI's "Sign in with ChatGPT" — require developer registration and are
not generally available). Anything that *asks users for their ChatGPT
password* is a phishing pattern and is deliberately not implemented here.

So the picker is organized around what a simple user can actually do:

## Tier 1 — no server, no keys (works on the static site)

| Provider | Login experience | How it works |
|----------|------------------|--------------|
| **GPT / Claude — Puter** | a free account in a popup, like any app | [Puter.js](https://docs.puter.com) "user pays" platform: the page loads `js.puter.com/v2`, the user signs in with a free Puter account, and `puter.ai.chat()` serves GPT/Claude-class models keylessly. Usage rides on the user's free Puter allowance — the site holds nothing. |
| **AI בדפדפן (Gemini Nano)** | none at all | Chrome's built-in on-device model (the Prompt API / `LanguageModel`). Private, free, offline-capable; the daf context is trimmed to fit its small window, so it's labeled experimental. Card auto-disables on browsers without it. |
| **Claude** | the user's regular claude.ai login | open the app inside Claude (artifact environment) — the keyless `api.anthropic.com` endpoint then bills the viewer's own Claude account. On a plain website, Claude instead uses the site server below (and the card says so). |

## Tier 2 — via the site's backend (keys are the site owner's)

`server/chavruta-server.mjs` (Node ≥ 18, no deps);
tests: `node server/test-server.mjs` (providers mocked, no keys needed).
Users authenticate to **the site** (demo email login → replace with real
auth); they still never see any key.

| Provider | How it connects | Mode |
|----------|-----------------|------|
| Claude | `POST /api/chat` proxy (server-side `ANTHROPIC_API_KEY`) | our chat UI |
| ChatGPT | OpenAI ChatKit — backend mints a short-lived `client_secret` (see [CHATKIT.md](CHATKIT.md)) | ChatKit widget |
| Gemini | same `/api/chat` proxy (server-side `GEMINI_API_KEY`) | our chat UI |
| Grok | placeholder ("בקרוב") | — |

When OpenAI's "Sign in with ChatGPT" opens to general registration, it
slots in as another Tier-1 provider: OAuth popup, user's own plan,
no keys — the registry in `js/chavruta/provider.js` is built for that.

## The unified /api/chat proxy

Request (cookie-authenticated, Origin-checked, rate-limited, size-capped):

```json
{ "provider": "claude" | "gemini",
  "system": "<the daf context payload>",
  "messages": [{ "role": "user"|"assistant", "content": "..." }],
  "max_tokens": 1500, "stream": true }
```

The server holds the keys, forwards to Anthropic or Google, and returns one
**neutral wire format** regardless of provider: non-streaming responses are
`{content:[{type:"text",text}]}`; streaming responses are SSE frames of
`{"type":"content_block_delta","delta":{"text":...}}`. The frontend has a
single parser; adding a provider touches only the server.

## Login flow ("why didn't ChatGPT ask for my email?")

By design, none of the providers log you into *their* account — that would
mean typing a ChatGPT/Google password into our pages (phishing-shaped, and
blocked by the providers anyway). Instead you log into **this site**: when
the backend answers 401, the chat shows an inline login form (email). The
reference server's `POST /api/login` is a DEMO that accepts any email and
sets a signed httpOnly session cookie — replace `requireAuthenticatedUser()`
(and the login endpoint) with your real auth; nothing else changes.

`GET /api/me` lets the frontend check the session. The OpenAI/Anthropic
`user`/identity fields only ever see `sha256(USER_HASH_SALT:userId)`.

## Adding a provider

1. Server: add a `proxy<Name>()` that converts the neutral request to the
   provider's API and its response/SSE back to the neutral dialect; wire it
   into `/api/chat`'s provider switch; add the key env var.
2. Frontend: add one entry to `PROVIDERS` in `js/chavruta/provider.js`
   (label, `mode: 'messages'`, hint). Done — chat UI, sessions, suggested
   questions, and deep links all work through the neutral format.
