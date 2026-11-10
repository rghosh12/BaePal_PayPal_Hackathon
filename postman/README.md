# Postman regression collections

Run `pnpm build:prototype` then `pnpm test:postman` with Node 24 and the repository dependencies installed. Newman 6.2.3 executes the committed Postman v2.1 collection against an isolated, loopback-only Worker harness and an in-memory SQLite database. The process destroys that database when it exits. Port 4173 must be free; startup fails if it is occupied.

The collection covers synthetic persona login, CSRF and origin rejection, separate purpose defaults, unavailable real-history capability, consent enforcement, import replay and conflicts, workspace isolation, publishing a reviewed summary, deletion, and stale imports after revocation. These are synthetic prototype results, not evidence of real PayPal history, payments, or production authentication.

`local.postman_environment.json` contains placeholders only. The runner supplies unique owner IDs and an import UUID; cookies and CSRF values live only in memory. It prints aggregate counts and assertion names, without exporting responses, environments, receipts, or tokens. The development-only owner header is recognized solely by the local test harness, never by the deployed application. Do not point this collection at the private Site.

Generate exports with `pnpm postman:generate`. CI checks that generated JSON is current and executes the collection after building the Worker. You can also import the exports into Postman and fill the local placeholder values while the explicitly enabled local harness is running.

The additional core/payment collection and separate manual Sandbox artifacts are described below. Real Sandbox execution requires configured credentials and buyer approval and has not been performed by either local suite.

## Original API core/payment collection

Run `pnpm test:postman:core` with Node 24, installed workspace dependencies and a PostgreSQL database whose name ends in `_test`. `DATABASE_URL` defaults to the documented local `baepal_test` database; CI supplies its dedicated test database. `PAYPAL_MODE` must be unset or `mock`. The runner refuses an explicit Sandbox mode and does not contact PayPal.

The runner creates a random `newman_<UUID>` schema, sets the API connection's search path to **that schema only**, applies migrations and prepares fictional users/an accepted art plan through the actual API. It listens on an ephemeral loopback port and runs the exported `core.postman_collection.json` against real Fastify routes and PostgreSQL. It never truncates public tables. Cleanup stops the reconciliation timer/server/pool and drops only the generated schema, including after assertion/setup failures.

The collection covers anonymous/foreign-resource denial, CSRF/origin checks, private partner-budget redaction, actor identity binding, immutable $30 USD catalogue amounts despite client tampering, purchase/order/capture replay, independent payment confirmation, unsigned webhook denial, cancellation/refund reconciliation, cancellation replay, blocking and retained owner receipts. Both payer receipts and the terminal plan state are checked independently. Refund polling is bounded; request/assertion counts may increase if reconciliation needs another polling iteration. Webhook rejection in mock mode is a negative endpoint assertion, not proof of real PayPal signature verification.

`core-local.postman_environment.json` has empty placeholders only. Login credentials, actor cookies, CSRF values, ephemeral addresses and random fixture IDs are populated in memory and never exported. Per-request cookie automation is disabled to prevent actor switching from inheriting the wrong cookie jar state. `scripts/generate-postman-core.mjs --check` checks all core/Sandbox exports for drift; CI runs the actual core collection in addition to the existing taste suite.

## Manual Sandbox workflow — not executed

`sandbox.postman_environment.json` and `sandbox-manual.postman_collection.json` are exportable **disabled manual artifacts**. No real Sandbox transaction, webhook, capture or refund has been observed by this work. The automated runner never executes them. A guard-only local Newman check confirmed the disabled collection makes zero requests; that is safety behavior, not Sandbox execution evidence.

Use an original BaePal Node API configured with `PAYPAL_MODE=sandbox`, the required merchant/client/webhook secrets in its secure runtime, an HTTPS application origin, a publicly reachable verified webhook callback and a running reconciliation worker. The hosted Site remains mock and is not a Sandbox target. Prepare your own adult test accounts and mutually accepted unexpired plan; no real customer receipts or personal datasets belong in this workflow.

1. Import the manual collection and placeholder environment privately. Fill `base_url`, `app_origin`, your app `email`/`password`, `plan_id`, numeric `proposal_version` and the accepted `expected_amount_cents` through your secure local environment. Keep credentials and current environment values out of public exports.
2. Set `sandbox_execution_enabled=true` only when you are intentionally testing that Sandbox application. The guard skips all requests for disabled environments, non-HTTPS targets and example placeholders. The first request verifies the application's reported mode; subsequent requests stay skipped unless that check succeeds.
3. Run requests individually in order. Sign in, create the purchase and create its order. Read the response's `approvalUrl` and complete approval using the proper PayPal Sandbox buyer account. Creating an order resets `buyer_approval_confirmed=false` so a collection run cannot automatically capture it.
4. After actual buyer approval, explicitly set `buyer_approval_confirmed=true` and run the capture request. The flag resets afterwards. A pending or uncertain response is not a completed payment. Read the owner receipt and separately record its real provider outcome. Repeat with the other buyer's private environment if testing both independent tickets.
5. The unsigned webhook request must be rejected. Separately trigger a real provider webhook, inspect signature verification/inbox reconciliation and record redacted native request/event IDs; the unsigned check alone does not prove the positive callback path.
6. To test cancellation deliberately, set `cancel_approved=true` and run that request. Its flag resets afterwards. Re-read the receipt after the worker reconciles. The final refund assertion passes only for an observed `refunded` receipt with a completed refund; pending/failed/unknown evidence must not be labeled completed.
7. Record actual application/API/PayPal versions, operation IDs, durations, observed states and redacted results separately from local mock runs. Never commit bearer tokens, session cookies, passwords, private environment exports or raw financial data. Clear runtime credentials/cookies before sharing any collection/environment.

Issue #29's local core/taste export, assertion and execution coverage is implemented. Real Sandbox assertions remain explicitly unexecuted until credentials, buyer approval and callback configuration are available. Broader payment races/partial refunds and distributed-worker completion stay in #7/#8.
