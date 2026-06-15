# AI chavruta providers

The site has **no backend** — everything runs in the browser. The tornado
opens a provider picker with two groups.

## No key

| Provider | Login experience | How it works |
|----------|------------------|--------------|
| **GPT / Claude — Puter** | a free account in a popup, like any app | [Puter.js](https://docs.puter.com) "user pays" platform: the page loads `js.puter.com/v2`, the user signs in with a free Puter account, and `puter.ai.chat()` serves GPT/Claude-class models keylessly. |
| **AI בדפדפן (Gemini Nano)** | none at all | Chrome's built-in on-device model (the Prompt API / `LanguageModel`). Private, free, offline-capable; the daf context is trimmed to fit its small window. Card auto-disables on browsers without it. |

## Bring your own API key

For **Claude**, **ChatGPT**, **Gemini**, and **DeepSeek** the browser calls
the vendor's API *directly* with the user's own key. There is no server in
the middle. On first use (or via ⚙ → "מפתח API") a popup asks for the key,
explaining that the site has no backend, that the key is stored **only in
this browser** (`localStorage`, key `vilnaChavruta.key.<provider>`), is sent
**only** to that vendor, and is **never displayed** (masked input). The
Reset button clears it along with everything else.

| Provider | Endpoint (called from the browser) | Model | Key from |
|----------|-----------------------------------|-------|----------|
| Claude | `api.anthropic.com/v1/messages` (with `anthropic-dangerous-direct-browser-access`) | `claude-sonnet-4-6` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| ChatGPT | `api.openai.com/v1/chat/completions` | `gpt-4o` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Gemini | `generativelanguage.googleapis.com` (`generateContent`) | `gemini-2.0-flash` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| DeepSeek | `api.deepseek.com/chat/completions` | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |

Each provider's response (and SSE stream) is normalized to one shape so the
chat UI has a single parser. A missing key throws `{ needKey: true }` and the
UI opens the key popup.

> **Note:** putting an API key in the browser means anyone with access to
> that browser/profile can read it from `localStorage`; it is the user's own
> key and their own risk. This trades the security of a server-held key for
> the simplicity of a zero-backend static site — the deliberate design here.

## Optional backend (legacy)

`server/chavruta-server.mjs` (a server-held-key proxy + OpenAI ChatKit, see
[CHATKIT.md](CHATKIT.md)) remains in the repo for deployments that prefer to
hold keys server-side, but the shipped `index.html` uses the browser-only
BYO-key model above and does not require it.

The optional `server/chavruta-server.mjs` exposes a unified `/api/chat`
proxy (cookie-authenticated, Origin-checked, rate-limited) plus OpenAI
ChatKit; it holds the keys server-side and returns one neutral wire format.
It is documented in [CHATKIT.md](CHATKIT.md) and not used by the shipped
browser-only build.

## Adding a provider

Add one entry to `PROVIDERS` in `js/chavruta/provider.js` (`group: 'key'`,
`needsKey: true`) and a `KEY_PROVIDERS` entry (endpoint, model, vendor, key
URL). If it speaks the OpenAI chat-completions shape, the existing
`callOpenAILike` + `readOpenAILike` handle it; otherwise add a small caller
and SSE reader. The chat UI, sessions, suggested questions, deep links, and
the key popup all work automatically.
