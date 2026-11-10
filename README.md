# BaePal · PayPal Hackathon

A good connection deserves a good first date. BaePal is a Seattle-focused, mobile-first dating prototype with mutual matches, persisted chat, private budget coordination, versioned date consent, and independent demo ticket purchases.

**Deployed private prototype:** https://baepal-prototype.ruppakriki.chatgpt.site

Open it with your ChatGPT account, choose Alex or Jordan, and use the **Demo persona** selector to test both sides. The core flow persists through reloads. Hosted tickets/refunds are explicitly mock; no real booking, PayPal call, or public member network is implied. [Try it and improve the framework](docs/PROTOTYPE.md).

The original Node/PostgreSQL implementation remains available below. Full P0 requirements are still tracked in GitHub; the owner reprioritized a usable deployed prototype over completing every release gate first. Real Sandbox transactions remain unverified; the original API's production guard remains in place.

## Purchase-interest addendum slice

The [new addendum work map](docs/ADDENDUM_WORK.md) tracks purchase-interest matching. The hosted slice adds granular opt-in, fictional imports, owner-only review/corrections, versioned deterministic ranking and safe mutual explanations. Real history/export ingestion and live payments remain disabled; AI/Elastic/sponsor executions are not simulated as real integrations. [Try the taste workflow and review its evidence limits](docs/TASTE_MATCHING.md).

## Quick start

Requires Node **24**, pnpm **11.25.0**, and Docker Compose. Commands run from this repository root.

```bash
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
docker compose -p baepal -f infra/local/compose.yaml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open **http://localhost:3000**. Web runs on 3000; API/Socket.IO and the in-process durable-job worker run on 4000. Keep both on the same trusted machine during local development. `.env.example` documents all implemented configuration; `setup-local.mjs` creates fresh session and encryption keys without overwriting an existing file.

Local demo sign-in buttons exist only with `DEMO_MODE=true`. Use **Alex** and **Jordan** in separate browser profiles or contexts. All 16 seeded accounts are fictional adults; original synthetic illustrations are labeled. Seed credentials are `<lowercase-name>@demo.baepal.invalid`, password `Demo-Only-2026!`. Never reuse these credentials in a real environment.

Signup confirmation/reset messages go to the private local directory **`.data/mail/`**, not real email. Read the corresponding JSON file locally; the UI never displays OTPs. No production email adapter exists yet. Provider connections are unavailable and never receive fabricated badges.

## What works

- Signup, hashed passwords, confirmation codes with expiry/attempt bounds/resend cooldown, password reset, revocable opaque cookie sessions, origin/CSRF protection.
- Saved onboarding drafts, server-side adult checks, editable profiles, reciprocal age/gender/same-city discovery, like/pass, race-safe mutual matching.
- Authorized REST and Socket.IO chat with persistence, ordered catch-up, deduplicated retries, block/report/unmatch and revocation; REST polling fallback.
- Encrypted owner-scoped budgets, activity/time intersection, fictional catalogue suggestions, versioned proposals and mutual acceptance.
- Independent immutable ticket purchases, retry-safe order/capture operations, receipts, refund jobs, expiry compensation, verified-webhook inbox and reconciliation worker.
- Mock and PayPal Sandbox REST adapters, with separate evidence labels; live mode is unsupported.
- Pause/resume, reauthenticated private export and dating-content deletion, role-restricted report queue and audited report state updates.

See [feature gaps and release gates](docs/STATUS.md) before evaluating completeness. In particular, uploads currently provide technical validation and EXIF removal, **not content moderation**. Do not use real member data.

## GitHub backlog

[Prioritized issues](docs/ISSUES.md) track the remaining specification work. [P0 completion checklist #21](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/21) links the release gates.

## Verification

Create a separate database; the suite refuses database names that do not end in `_test` and truncates only that database.

```bash
docker compose -p baepal -f infra/local/compose.yaml exec postgres \
  psql -U baepal -c 'CREATE DATABASE baepal_test'
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

If the database already exists, skip its creation. `scripts/test.sh` defaults to local `baepal_test`; set `DATABASE_URL` to a dedicated test database when using different credentials. Results and limits: [VALIDATION.md](docs/VALIDATION.md).

Browser tests are authored separately:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Run browser tests against a **freshly seeded, disposable** development database. The two-person test consumes likes and creates purchases. Browser binaries were not installed or run in this managed environment because its browser-control tool was unavailable. CI includes browser installation and the test commands, but no GitHub CI run has been observed.

## Architecture

- `apps/web`: Next.js App Router/React/TypeScript, original responsive ivory/rose/lavender interface, accessible text controls alongside non-gesture discovery.
- `apps/api`: Fastify, PostgreSQL via parameterized `pg`, Argon2id, Zod, AES-256-GCM field encryption, Socket.IO, image re-encoding with Sharp.
- `db/migrations`: additive SQL migrations, explicit constraints and indexes; no automatic production schema push.
- `apps/api/src/contracts.ts`: shared runtime request schemas and generated partial OpenAPI at `/api/v1/openapi.json`.
- `apps/api/src/providers`: PayPal and deterministic planner interfaces/adapters. No AI model is claimed to run.
- `infra/local`: local PostgreSQL; `.github/workflows/ci.yml`: frozen install, checks, DB tests, builds and browser smoke tests.

The web server proxies `/api` and `/socket.io` to `API_ORIGIN`. Private screen data is requested with no-store fetches; the API rechecks session/resource ownership. Build and run the API as a persistent process for sockets and workers. See [architecture and permission map](docs/ARCHITECTURE.md), [API inventory](docs/API.md), and [dependency choices](docs/DEPENDENCIES.md).

## Demo and payments

Follow [the two-person judge script](docs/DEMO.md) and [Sandbox setup](docs/PAYPAL.md). Mock receipts are fixtures, not PayPal evidence. Live mode is rejected by configuration. Sandbox credentials must be configured through local/environment secret settings; never paste or commit them.

To stop local services, stop `pnpm dev` and run `docker compose -p baepal -f infra/local/compose.yaml stop`. This preserves local data. No publicly reachable reset/delete-database endpoint exists.

## Specification and ownership

The uploaded [master prompt](docs/MASTER_BUILD_PROMPT.md) remains the source specification. The requested repository name is `BaePal_PayPal_Hackathon`. Code and illustrations were created for this prototype; third-party implementation/template code and photographs were not copied. [References](docs/REFERENCES.md) records what was actually inspected. Source is licensed under the [MIT License](LICENSE), preserved from the GitHub repository initialization.

GitHub repository: https://github.com/rghosh12/BaePal_PayPal_Hackathon. The original GitHub license commit is preserved alongside the application history.

## Configure external services

Provider endpoints and keys belong in the server-only `BAEPAL_INTEGRATIONS_JSON` secret. Start with [the disabled template](integrations/config.example.json), follow [secure integration setup](docs/INTEGRATIONS.md), and run `pnpm integrations:check`. Account settings → Connected services shows redacted readiness and opt-in previews. Both the Node API and deployed Worker use the same gateway contract; native APIs that use different formats require an adapter. Existing PayPal Sandbox environment keys remain separate; the hosted prototype still uses mock payments.
