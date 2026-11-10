# Verification evidence

## Executed in this environment

- Real PostgreSQL 17.6 container started through Docker Compose.
- SQL migrations applied; 16 fictional adult profiles and original synthetic artwork seeded in the development database.
- An isolated `baepal_test` database used for integration tests; suite explicitly refuses other database names and rebuilds fixtures per test.
- Final suite: **19 tests passed** across two files, including real WebSocket and long-polling delivery/subscription denial, immediate block access revocation, and logout socket disconnection. Final API test run completed in approximately 11 seconds.
- API TypeScript compile and Next.js optimized build passed; ESLint and workspace typechecks passed. The two authored Playwright tests are discoverable and their TypeScript was separately checked, but neither browser scenario was executed.

## Covered behavior

Anonymous/origin/CSRF denial; simultaneous reciprocal likes and idempotent retries; unique match notifications; authorized persisted messages and outsider denial; budget encryption/redaction and guessed-plan denial; stale consent and purchase rejection; neutral no-overlap suggestions; two independent captures; stable create/capture retries; receipt ownership; full refund cancellation; block with retained receipts; unsigned webhook rejection; member/moderator role denial; reciprocal age/pause filtering; OTP exhaustion; onboarding draft/adult activation; pending capture without completion; timeout reconciliation without another capture; pending refund without false success; own-only export/deletion; exact calendar adult threshold; live socket authorization/delivery/revocation; Sandbox order/purchase/merchant/currency/amount binding.

Provider responses in these tests are mock fixtures. Real database execution proves persistence/authorization behavior, not PayPal interoperability.

## Not executed / blocked

- Real PayPal Sandbox approval/capture/refund/webhook: required merchant app/buyer credentials and HTTPS callback are not configured. No transaction evidence is claimed.
- Browser screenshots, two-context Playwright journey, mobile overflow and accessibility/contrast audit: no `cua_repl.js` or other managed browser-control tool was available. The applicable [Sites skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md) states: “If `cua_repl.js` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.” Accordingly no preview or browser binary was started/installed here. Browser test source and CI commands are included, with no passing-browser claim.
- GitHub remote creation/push: earlier attempts returned `Resource not accessible by integration (createRepository)`. Source remains local; no observed CI run.
- Full master acceptance matrix (including partial refund races, real OAuth, media content moderation, complete export/retention, screen-reader and network failure audits) remains open in STATUS.md. All P0 completion claims are withheld.

CI configuration exists but has not run on GitHub. No achieved p95 latency, conversion, accessibility score, or production reliability metric is claimed.
