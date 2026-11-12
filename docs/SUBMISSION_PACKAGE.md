# Submission package and recording storyboard

This package completes the preparation scope of issue #37. It does not certify sponsor integrations or hackathon readiness. The runnable private prototype, source, disclosure, timed script and storyboard are available; no video has been recorded or published by this change. Public video URL: **not published**. The private Site's audience is unchanged.

## Reproducible build and evidence

- Repository: https://github.com/rghosh12/BaePal_PayPal_Hackathon (root MIT license).
- Private prototype: https://baepal-prototype.ruppakriki.chatgpt.site. An authorized owner can use this; the source's local setup works without Site access.
- Original API/web setup, configuration and separate test database: [README](../README.md#quick-start), [.env.example](../.env.example). Use Node 24 and pnpm 11.25.0 with the frozen lockfile.
- Hosted runtime setup and differences: [PROTOTYPE.md](PROTOTYPE.md). Local core payments and hosted payments are synthetic mock demonstrations. Actual Sandbox captures/refunds remain unverified.
- Synthetic dataset, consent and ranking policy: [TASTE_MATCHING.md](TASTE_MATCHING.md), `apps/hosted/src/taste.ts`, `apps/api/src/seed.ts`, and `apps/web/public/portraits/`. All names, histories and illustrations are fictional; no member history or real consumer PayPal feed is included.
- Observed baseline [CI 43127372886](https://github.com/rghosh12/BaePal_PayPal_Hackathon/actions/runs/43127372886), PR #61 head `656a6b3`: 162 automated tests, six browser cases, taste Newman 18 requests/27 assertions and core Newman 38 requests/66 assertions. This historical reference remains specific to that revision; the PR adding this document supplies its own current CI result.
- Repeat checks: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:postman`, `pnpm test:postman:core`. Browser commands and disposable seeded-database requirements are in the README; authored test code is not substituted for an observed run.

For a clean repeat, create a **new disposable** local database, set `DATABASE_URL` to it, then run `pnpm db:migrate` and `pnpm db:seed`. Seed is idempotent and does not erase past likes/payments. The test runner uses a separate database ending `_test`. Do not delete a live database or expose a reset route to prepare a recording.

## Ten-sponsor execution and configuration matrix

Status vocabulary: **planned**, **implemented/mock-tested**, **implemented/provider-tested**, **blocked**. No sponsor currently has implemented/provider-tested evidence. Our gateway fixture coverage is identified separately and does not upgrade a native provider claim. Provider versions marked absent are intentionally not guessed.

| Sponsor | Native/tool status; actual version | Configuration and setup reference | License/account dependency and evidence |
| --- | --- | --- | --- |
| Elastic | blocked; native API/package absent | `BAEPAL_INTEGRATIONS_JSON.providers.elastic`, `search`; [setup](INTEGRATIONS.md) | Native index/account/retention rights unverified. Shared gateway contract `baepal-gateway-v1` is mock-tested; no index/query/model executed. #26 |
| Astropods | blocked; native agent/model version absent | `providers.astropods`, `plan`/`explain`/`embed` in the same secret | Account, model and usage rights unverified. Gateway requests/validation mock-tested; no model execution. #25 |
| Render | planned; no deployed service version | Original API environment from `.env.example`; separate account/service deployment | Service/database plan terms not verified or purchased. Sites/Cloudflare deployment is not Render evidence. #27 |
| APIMatic | blocked; no tool/package version executed | Development tool setup, not a fabricated runtime endpoint | Tool availability and generated-client license need verification. Partial native BaePal OpenAPI is not APIMatic usage. #28 |
| Postman | implemented/mock-tested; Newman **6.2.3**, collection schema **v2.1** | [Postman runbook](../postman/README.md), two commands above; generated fixtures supply local values | Installed `newman/package.json` declares **Apache-2.0**. CI evidence above; manual Sandbox is guarded and unexecuted. No paid workspace entitlement claimed. |
| AG Grid / AG Studio | planned; no AG package installed | UI implementation/licensed dependency setup, not key-only activation | No Studio/Enterprise redistribution right verified. Native HTML review table is not AG usage. #30 |
| Bryntum | planned; no package installed | Calendar component implementation and timezone/consent tests | Trial/redistribution rights not verified; no proprietary bundle copied. #31 |
| Channel3 | planned; native API version absent | `providers.channel3`, `products` in the hub secret | Product/retailer/image/affiliate rights unverified. Opt-in gateway preview mock-tested; no real catalogue search or checkout. #32 |
| Zapier | planned; native API version absent | `providers.zapier`, `handoffPreview` in the hub secret | Account and automation rights unverified. Side-effect-free preview mock-tested; no dispatch executed. #33 |
| KERNEL | planned; native API version absent | `providers.kernel`, `venues` in the hub secret | Account/site permissions unverified. Gateway venue preview mock-tested; no native browser task/replay recorded. #34 |

`providers.*` refers to keys inside **BAEPAL_INTEGRATIONS_JSON**, not new environment variables. The complete disabled template is [config.example.json](../integrations/config.example.json). Secrets stay in the runtime secret manager. PayPal separately uses `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID`; the hosted runtime remains mock. Do not enter raw native endpoints into the gateway template unless they implement its contract.

Official sponsor resource URLs and the original review date are in [addendum §14](SPENDING_MATCH_SPONSOR_ADDENDUM.md#14-source-register-and-fact-boundaries). That historical source register is not a fresh license/terms verification. Check the current official account/API/license documentation when activating each blocked integration. The actionable native implementation issues remain open.

## Recording storyboard: 2 minutes 50 seconds

Use a 1920×1080 canvas with readable zoom, captions and two clearly named fictional member contexts. Prepare a fresh fictional mutual match and compatible future date windows. Use the hosted prototype for the visible flow; do not mix original/hosted screens without naming the runtime. Keep the mock banner visible. Never record environment settings, session cookies, OTP files, real inboxes or private workspace identities.

| Time | Shot and explicit action | Narration / on-screen wording |
| --- | --- | --- |
| 0:00–0:15 | Title and mock banner; show Alex/Jordan contexts | “BaePal is a prototype for meeting someone, discussing shared interests and agreeing on a date. These adults, purchases and payments are fictional.” |
| 0:15–0:40 | Purchase interests: consent, choose fictional dataset, private review; exclude a row and publish | “Purchase matching is optional. You review synthetic evidence and choose what to share. Real PayPal history is not connected.” |
| 0:40–1:00 | Discover and Why this match; open the reciprocal match/chat | “This explanation uses mutually approved broad interests. Current ranking is deterministic; it is not an AI compatibility prediction.” |
| 1:00–1:25 | Send a chat message; show independent private-budget forms and one eligible proposal | “Messages persist. Each person controls their own budget. The other person sees a suitable option, not the private budget.” |
| 1:25–1:55 | Each member explicitly accepts and purchases one fictional ticket; show MOCK receipts | “Acceptance and payment are separate actions. Each person purchases their own ticket. These mock receipts demonstrate the flow, not real charges or venue bookings.” |
| 1:55–2:15 | Cancel; show completed mock refund evidence. Briefly show Stop & delete purchase interests | “Cancellation keeps a receipt trail. The demo also lets a member revoke synthetic purchase matching. Real Sandbox evidence is still required.” |
| 2:15–2:35 | Show the sponsor matrix and successful Newman CI rows | “Postman/Newman collections execute against synthetic fixtures. Other sponsor integrations are planned or blocked; configured gateways are not provider verification.” |
| 2:35–2:50 | Closing card: repo, model disclosure, hypothetical business concept | “A future optional planning utility could fund the product. There is no observed revenue, live booking or automatic history access. Source and setup are available; provider and production work remains.” |

This table is the prepared storyboard artifact accepted by #37, not evidence of a recorded video. If a live interaction takes longer, record separate shots with a clear cut and preserve truthful state labels; never edit an unsuccessful charge into a successful receipt. The longer interactive demonstration and retained-receipt/block flow are in [DEMO.md](DEMO.md).

## Model, tool and commercial disclosure

ChatGPT/Codex assisted implementation, debugging, tests and documentation, including parallel coding/review agents. GitHub Actions ran the repository checks. No precise development model build ID was recorded; none is invented here. The application currently executes **no generative or embedding model**. `reviewed-counts-v1` and `DeterministicPlanner` are application algorithms. A configured model/provider claim requires its actual version and redacted execution evidence.

Hypothetical arithmetic only: 100 fictional tickets × $30 = $3,000 ticket GMV, **not BaePal revenue**. A future, separately specified $4.99 planning utility sold 20 times would generate $99.80 gross utility sales before fees, refunds and costs. That product, demand, pricing and proceeds have not been validated or implemented as a live commercial offer. No marketplace take rate, merchant authority or affiliate earnings are assumed. Basic safety, exclusion, revocation, export and deletion remain free.

## Public source and asset boundaries

The root MIT license covers the original project code and committed original illustrations; dependencies retain their own licenses. Postman/Newman licensing is above. No paid GroundUI template, proprietary sponsor trial source, AG/Bryntum bundle, real financial dataset or recorded member material is intentionally redistributed.

`node scripts/check-source-secrets.mjs --self-test` tests source-scanner signatures; `node scripts/check-source-secrets.mjs` scans tracked source for private-key/token signatures and prohibited local/private paths without printing credential contents. CI runs both. `scripts/check-artifacts.mjs` additionally checks tracked configuration and configured secret values in compiled browser/Worker artifacts. These bounded checks do not prove that every possible secret format or untracked recording is safe.

`.gitignore` excludes local secrets, runtime mail/data, proprietary sponsor files under `vendor/proprietary/`, and private captures under `recordings/private/` or `submission/private/`. Ignoring does not grant a license. Inspect exported archives and every frame before any separately authorized publication. No public YouTube URL, public Site audience or sponsor award claim is created by completing this preparation issue.
