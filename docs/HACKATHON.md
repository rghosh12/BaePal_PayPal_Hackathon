# BaePal — PayPal Developer Hackathon submission

> A good connection deserves a good first date.

BaePal is a mobile-first dating web app for adults. Two people match, chat, privately agree on a date they can both afford, and each pays for their own ticket for a fictional date experience through **PayPal Checkout (Sandbox)**. AI helps along the way, and every AI result is a suggestion that a person has to act on.

## The problem

First dates get awkward around money. Nobody wants to say "that's above my budget," and "who pays?" turns a nice moment into a negotiation. BaePal lets each person enter a **private** budget. The server finds options that fit both people without revealing either number. Each person then pays only for their own ticket through PayPal. Nobody pays for access to another person, and nobody's budget is shown to their match.

## Features (working prototype)

| Area | What works |
| --- | --- |
| Accounts | Email signup with confirmation code, Argon2id passwords, opaque HttpOnly sessions, CSRF and origin checks, server-side 18+ check, resumable onboarding |
| Matching | Reciprocal age/gender/city discovery, like/pass, transactional mutual match (race-safe), ranking by shared declared interests |
| Chat | Persisted chat over REST + Socket.IO with ordered catch-up, idempotent retries, block/report/unmatch with immediate revocation |
| **AI preference interpreter** | A member describes dates they enjoy in their own words. The model proposes tags from a fixed list and quotes the matching phrase. Tags stay drafts until the member confirms them and saves. |
| **AI icebreakers** | Three editable opening lines drafted from the match's **public** prompts only. Picking one fills the composer; nothing is sent automatically. |
| **AI date planner** | The server first filters the catalogue by **both** private budgets, activities and overlapping time windows. The model only ranks those eligible options and explains its choices. Invented IDs are rejected, and the private budgets never reach the model. |
| Date consent | Versioned proposals. Both members accept the same version; any edit clears earlier acceptances. |
| **PayPal checkout** | Official PayPal JS SDK Smart Buttons, plus a hosted-redirect fallback. The server creates an Orders v2 `CAPTURE` order from the accepted plan snapshot, so the client cannot set the amount, payee or buyer. A separate capture step runs after approval, and the server verifies the amount, currency, payee, `reference_id` and `custom_id` before marking a ticket paid. |
| Two independent tickets | Each person pays their own ticket. One capture makes the plan `partially_paid`; two make it `confirmed`. |
| Refunds & reconciliation | Cancelling refunds each capture through `/v2/payments/captures/{id}/refund` using a stable `PayPal-Request-Id`. A background worker handles expiry compensation and retries. Webhook events are signature-verified and deduplicated through an inbox. |
| Receipts | Private per-buyer receipts with order/capture/refund references. These stay accessible after a block or unmatch. |

## How PayPal is used

- **Orders v2 API** (server-side): create order (`intent: CAPTURE`, payee merchant ID, `reference_id`/`custom_id` = BaePal purchase ID), get order, capture order.
- **PayPal JavaScript SDK Buttons** (browser) for buyer approval. Only the public client ID reaches the browser.
- **Payments v2 refunds** for cancellations and compensation.
- **Webhooks**: `verify-webhook-signature`, inbox deduplication and out-of-order handling.
- **Idempotency**: each create, capture and refund call has its own stable `PayPal-Request-Id`, so retries never double-charge.
- **Safety invariants**: client redirects and `onApprove` are not treated as proof of payment; only verified capture data from PayPal is. Live mode is not supported, and Sandbox moves only test funds.

## How AI is used (tools disclosure)

| Tool | Where | How |
| --- | --- | --- |
| Hosted LLM via any OpenAI-compatible Chat Completions API (configured with `AI_BASE_URL` / `AI_MODEL`; tested providers: OpenAI `gpt-4o-mini`, Google Gemini `gemini-2.5-flash`, Groq Llama 3.3) | `apps/api/src/providers/llm.ts` | JSON-mode completions for the three features above. Every response is validated against a Zod schema and a server allowlist. Any failure uses a fallback that the UI labels **"no AI model ran"**. Includes a circuit breaker and request timeout. |
| Redacted AI execution log | `GET /api/v1/ai/evidence` | Records the capability, provider, model, duration and outcome of each call, with no prompts or outputs, so judges can confirm a real model ran. |
| Cursor (AI coding agent) | Development | Pair-programming the implementation, tests and docs. |
| Render (sponsor) | `render.yaml` | One-click Blueprint: Postgres, API and web services. |
| Postman (sponsor) | `postman/` | Exported API collections executed with Newman (`pnpm test:postman:core`). |

**Privacy boundary:** the model receives only public declared interests, public prompts, a member's own description text, and catalogue entries that already fit both budgets. It never receives budgets, chat messages, emails, payment data or user IDs. Member text is passed as untrusted data, never as instructions; `apps/api/test/llm.test.ts` covers prompt injection, invented IDs and malformed output.

## Run it locally (about 5 minutes)

Requirements: Node 24, Docker Desktop, pnpm 11 (`npm i -g pnpm@11.25.0`).

```bash
git clone https://github.com/rghosh12/BaePal_PayPal_Hackathon
cd BaePal_PayPal_Hackathon
pnpm install --frozen-lockfile
node scripts/setup-local.mjs           # creates .env with fresh random keys
docker compose -p baepal -f infra/local/compose.yaml up -d --wait
pnpm db:migrate && pnpm db:seed        # 16 fictional adults + demo catalogue
node scripts/demo-pair.mjs             # optional: match Alex & Jordan instantly (needs the API running)
pnpm dev                               # web http://localhost:3000 · API :4000
```

Use **Continue as Alex** in one browser window and **Continue as Jordan** in a private/incognito window.

### Turn on real AI

In `.env`:

```env
AI_MODE=openai
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai   # or https://api.openai.com/v1
AI_MODEL=gemini-2.5-flash                                             # or gpt-4o-mini
AI_API_KEY=<your key>
```

### Turn on PayPal Sandbox

1. Sign in at <https://developer.paypal.com> → **Apps & Credentials** → **Sandbox** → **Create App** (Merchant). Copy the **Client ID** and **Secret**.
2. **Testing Tools → Sandbox Accounts**: open the default *Business* account → **View/Edit account** and copy its **Account ID** (the merchant ID). Note a *Personal* account email/password; it is the test buyer.
3. In `.env`: `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID=…`, `PAYPAL_CLIENT_SECRET=…`, `PAYPAL_MERCHANT_ID=…`. Restart `pnpm dev`.
4. Optional webhooks need a public HTTPS URL (Render): add `https://<api-host>/api/v1/webhooks/paypal` in the app's webhook settings and set `PAYPAL_WEBHOOK_ID`.

## Deploy on Render (public judge URL)

1. Render Dashboard → **New → Blueprint** → select this repository. `render.yaml` creates `baepal-db`, `baepal-api` and `baepal-web`.
2. When prompted, set `APP_ORIGIN` to the web URL (for example `https://baepal-web.onrender.com`). Also set `FIELD_ENCRYPTION_KEY` (64 hex characters), the PayPal Sandbox values and the AI values.
3. Open the web URL and use the demo sign-in buttons. Free instances sleep when idle, so the first request can take about a minute.

## Two-minute judge walkthrough

1. **Alex** → Profile → Edit → describe ideal dates → **Suggest tags** (AI) → confirm → Save.
2. Discover → like Jordan; **Jordan** likes Alex → match. (Or run `node scripts/demo-pair.mjs`.)
3. Chat → **Draft openers with AI** → pick one, edit, send. Jordan sees it.
4. **Plan a date** → each person saves a *private* budget and time window → **Find shared possibilities**: AI-ranked options that fit both budgets, each with a reason.
5. Propose → both accept the same version.
6. Each opens **checkout** → **PayPal** button → approve with the Sandbox buyer → the server captures and verifies. After the first ticket, the plan shows `partially_paid`; after the second, it shows `confirmed`.
7. **Cancel the plan** → refunds go to PayPal; receipts show the refund IDs.

## Honest limits

- Prototype: synthetic adult profiles, fictional demo merchant, no real bookings. Live payments are not supported.
- Sponsor tools beyond Render and Postman (Elastic, Astropods, AG Grid, Bryntum, Channel3, Zapier, KERNEL, APIMatic) have planned roles in `docs/SPONSOR_STATUS.md` and are not claimed as integrated.
- Photo moderation, a real email provider and professional-account connections are not implemented.

License: MIT (see `LICENSE`).
