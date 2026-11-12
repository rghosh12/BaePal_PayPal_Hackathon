# BaePal — PayPal Developer Hackathon submission

> A good connection deserves a good first date.

**Dating where PayPal is the trust layer: verified people, protected first dates, and an AI agent that plans and pays.**

BaePal is a mobile-first dating web app for adults, and PayPal does something real at every step:

| Step | What happens | PayPal |
| --- | --- | --- |
| Profile | **Verified by PayPal** badge | Log in with PayPal (OAuth + `verified_account`) |
| Plan | The AI agent picks a date within both *private* budgets and proposes it | Orders v2 checkout per person |
| Commit | Each person places a **$10 no-show hold** | Orders v2 `AUTHORIZE` |
| Date night | Both check in, so both holds are voided | Authorization **void** |
| Ghosted | The no-show's hold is captured and paid to the person who came | Authorization **capture** + **Payouts** |
| Cancel | Tickets refunded | Captures **refund** |

Every AI result is a proposal that a person approves; the agent never spends money without each member's own PayPal approval.

## The problem

First dates get awkward around money. Nobody wants to say "that's above my budget," and "who pays?" turns a nice moment into a negotiation. BaePal lets each person enter a **private** budget. The server finds options that fit both people without revealing either number. Each person then pays only for their own ticket through PayPal. Nobody pays for access to another person, and nobody's budget is shown to their match.

## Features (working prototype)

| Area | What works |
| --- | --- |
| Accounts | Email signup with confirmation code, Argon2id passwords, opaque HttpOnly sessions, CSRF and origin checks, server-side 18+ check, resumable onboarding |
| Matching | Reciprocal age/gender/city discovery, like/pass, transactional mutual match (race-safe), ranking by shared declared interests, a "why you might click" explanation built only from interests both people declared publicly, and a **Likes inbox** to like back or quietly dismiss |
| Updates inbox | Deduplicated in-app notifications for matches, messages, date proposals and confirmations, PayPal captures and refunds. Titles are generic (no names, budgets or payer details), only the owner can read them or mark them read, and dating events disappear once a match is closed or blocked. |
| Chat | Persisted chat over REST + Socket.IO with ordered catch-up, idempotent retries, block/report/unmatch with immediate revocation |
| **AI preference interpreter** | A member describes dates they enjoy in their own words. The model proposes tags from a fixed list and quotes the matching phrase. Tags stay drafts until the member confirms them and saves. |
| **AI icebreakers** | Three editable opening lines drafted from the match's **public** prompts only. Picking one fills the composer; nothing is sent automatically. |
| **Verified by PayPal** | Log in with PayPal links one PayPal account per member. The badge appears only when PayPal reports `verified_account`. BaePal keeps only the payer ID, the verified flag and the email, which is encrypted and used solely as the member's own payout destination. |
| **AI date agent** | **Let the AI agent book it** takes the eligible options (already within both private budgets and times). The model ranks them, and the agent proposes the top pick at a valid time and accepts it for the requester. The partner still accepts, and each person approves their own PayPal payment. |
| **AI date planner** | The server first filters the catalogue by **both** private budgets, activities and overlapping time windows. The model only ranks those eligible options and explains its choices. Invented IDs are rejected, and the private budgets never reach the model. |
| Date consent | Versioned proposals. Both members accept the same version; any edit clears earlier acceptances. |
| **PayPal checkout** | Official PayPal JS SDK Smart Buttons, plus a hosted-redirect fallback. The server creates an Orders v2 `CAPTURE` order from the accepted plan snapshot, so the client cannot set the amount, payee or buyer. A separate capture step runs after approval, and the server verifies the amount, currency, payee, `reference_id` and `custom_id` before marking a ticket paid. |
| **No-show protection** | Once both accept, each person authorizes a **$10 PayPal hold** (Orders v2 `intent: AUTHORIZE`), so nothing is charged. If both tap **I'm here**, both authorizations are **voided**. If one person ghosts, the one who showed up claims it: the absent person's hold is **captured** and sent to the other person with **PayPal Payouts**. New proposals and cancellations release stale holds automatically. |
| Two independent tickets | Each person pays their own ticket. One capture makes the plan `partially_paid`; two make it `confirmed`. |
| Refunds & reconciliation | Cancelling refunds each capture through `/v2/payments/captures/{id}/refund` using a stable `PayPal-Request-Id`. A background worker handles expiry compensation and retries. Webhook events are signature-verified and deduplicated through an inbox. |
| Receipts | Private per-buyer receipts with order/capture/refund references. These stay accessible after a block or unmatch. |

## How PayPal is used

- **Orders v2 API** (server-side): create order (`intent: CAPTURE`, payee merchant ID, `reference_id`/`custom_id` = BaePal purchase ID), get order, capture order.
- **PayPal JavaScript SDK Buttons** (browser) for buyer approval. Only the public client ID reaches the browser.
- **Payments v2 refunds** for cancellations and compensation.
- **Authorize → void / capture** (`/v2/checkout/orders/{id}/authorize`, `/v2/payments/authorizations/{id}/void` and `/capture`) for the no-show hold, through a second SDK instance with `intent=authorize`.
- **Payouts** (`/v1/payments/payouts`) to pay the captured hold to the member who showed up. The request uses a stable `sender_batch_id`, so a retried claim can't pay twice. The Sandbox business account behind your REST app needs Payouts enabled; it usually is by default in Sandbox.
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

Every seeded account uses the password `Demo-Only-2026!`, and every name is fictional. The seed data includes:
- `moderator@demo.baepal.invalid`, a staff account with a **Reports** queue holding two open reports. Staff accounts never appear in Discover.
- A blocked pair, Avery and Emerson.
- Incoming likes for Alex and Jordan, so their **Likes** inbox has content.

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
5. **Log in with PayPal**, for the Verified by PayPal badge. In your Sandbox app's **Features**, enable **Log in with PayPal**. Then set the **Return URL** to `<APP_ORIGIN>/api/v1/auth/paypal/callback`, for example `https://baepal-web.onrender.com/api/v1/auth/paypal/callback`. Under the information requested, tick **Email** and **PayPal account verification status**. Use the HTTPS Render URL if PayPal rejects `localhost`.
6. **Payouts** (for the no-show payout) are normally enabled on Sandbox business accounts. If a claim fails with a permission error, enable Payouts for the app in the dashboard.

### Optional keys

- **Real email** (verification codes, password resets, hourly update emails): `EMAIL_MODE=resend`, `EMAIL_API_KEY=<Resend key>` and `EMAIL_FROM=<address on a verified domain>`. Without these, emails are written to `.data/mail/`.
- **GitHub profile connection**: create an OAuth app at <https://github.com/settings/developers> with the callback `<APP_ORIGIN>/api/v1/auth/github/callback`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. LinkedIn works the same way, with the callback `.../auth/linkedin/callback` and the "Sign In with LinkedIn using OpenID Connect" product.
- **Manual photo review**: `MEDIA_MODERATION=manual` holds new photos for a moderator instead of auto-approving them (auto-approval is labelled as such).

### Verify your keys (no money moves)

```bash
pnpm check:keys
```

This command checks three things:
- PayPal accepts the Sandbox client ID and secret.
- The merchant ID matches the payee PayPal returns on a test order. The order is created but never approved, so it simply expires.
- The AI model answers one small request.

It prints no secrets. On startup, the API also logs whether PayPal accepted the credentials.

## Deploy on Render (public judge URL)

1. Render Dashboard → **New → Blueprint** → select this repository. `render.yaml` creates `baepal-db`, `baepal-api` and `baepal-web`.
2. When prompted, fill in these values:
   - `APP_ORIGIN` (on the API): the web URL, for example `https://baepal-web.onrender.com`.
   - `API_ORIGIN` (on the web service): the API URL, for example `https://baepal-api.onrender.com`.
   - `FIELD_ENCRYPTION_KEY`: 64 hex characters.
   - The PayPal Sandbox values and the AI values.
   
   If Render assigns different URLs, update both origins and redeploy the web service.
3. Open the web URL and use the demo sign-in buttons. Free instances sleep when idle, so the first request can take about a minute.

## Two-minute judge walkthrough

The flow: match, the AI agent books the date, one person ghosts, and the other gets paid on screen.

1. **Alex** → Profile → **Log in with PayPal** → the **Verified by PayPal** badge appears on Alex's card. Then Edit → describe ideal dates → **Suggest tags** (AI) → confirm → Save.
2. Discover → like Jordan; **Jordan** likes Alex → match. (Or run `node scripts/demo-pair.mjs`.)
3. Chat → **Draft openers with AI** → pick one, edit, send. Jordan sees it.
4. **Plan a date** → each person saves a *private* budget and time window → **✦ Let the AI agent book it**. The agent shows its steps:
   1. It filters to options within both private budgets and both time windows.
   2. The model ranks them by shared interests.
   3. It proposes the top pick at a valid time and accepts it for Alex.
   
   Jordan accepts. (Or run `node scripts/demo-date.mjs` to jump straight to "both accepted".)
5. Each opens **checkout** → **PayPal** button → approve with the Sandbox buyer → the server captures and verifies. After the first ticket, the plan shows `partially_paid`; after the second, it shows `confirmed`.
6. **No-show protection** (the main demo moment): both people place the $10 PayPal hold. Alex taps **I'm here**; Jordan doesn't. Alex taps **They didn't show** and enters a Sandbox personal email. Jordan's hold is captured and paid out to Alex on screen, and Alex's own hold is released. To show the happy path instead, have both people check in, and both holds are voided. In demo mode the time window is relaxed so this fits in a walkthrough.
7. **Cancel the plan** → refunds go to PayPal; receipts show the refund IDs.
8. Optional: log in as the moderator and go to **Reports**. You can dismiss, warn, suspend, restore or escalate a report; each action needs a reason and is written to the audit log. Suspending logs the member out immediately, and the reporter only ever sees "received" or "closed".

## Honest limits

- Prototype: synthetic adult profiles, fictional demo merchant, no real bookings. Live payments are not supported.
- Sponsor tools beyond Render and Postman (Elastic, Astropods, AG Grid, Bryntum, Channel3, Zapier, KERNEL, APIMatic) have planned roles in `docs/SPONSOR_STATUS.md` and are not claimed as integrated.
- Photo moderation, a real email provider and professional-account connections are not implemented.

License: MIT (see `LICENSE`).
