# Postman regression collections

Run `pnpm build:prototype` then `pnpm test:postman` with Node 24 and the repository dependencies installed. Newman 6.2.3 executes the committed Postman v2.1 collection against an isolated, loopback-only Worker harness and an in-memory SQLite database. The process destroys that database when it exits. Port 4173 must be free; startup fails if it is occupied.

The collection covers synthetic persona login, CSRF and origin rejection, separate purpose defaults, unavailable real-history capability, consent enforcement, import replay and conflicts, workspace isolation, publishing a reviewed summary, deletion, and stale imports after revocation. These are synthetic prototype results, not evidence of real PayPal history, payments, or production authentication.

`local.postman_environment.json` contains placeholders only. The runner supplies unique owner IDs and an import UUID; cookies and CSRF values live only in memory. It prints aggregate counts and assertion names, without exporting responses, environments, receipts, or tokens. The development-only owner header is recognized solely by the local test harness, never by the deployed application. Do not point this collection at the private Site.

Generate exports with `pnpm postman:generate`. CI checks that generated JSON is current and executes the collection after building the Worker. You can also import the exports into Postman and fill the local placeholder values while the explicitly enabled local harness is running.

Issue #29 remains open for payment retry, amount tampering, webhook verification, cancellation/refund collection coverage and a separate Sandbox environment/runbook. Real Sandbox execution requires configured credentials and buyer approval and has not been performed by this suite.
