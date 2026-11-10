# Verification evidence

## Executed in this environment

- Real PostgreSQL 17.6 container started through Docker Compose.
- SQL migrations applied; 16 fictional adult profiles and original synthetic artwork seeded in the development database.
- An isolated `baepal_test` database used for integration tests; suite explicitly refuses other database names and rebuilds fixtures per test.
- Final suite: **19 tests passed** across two files, including real WebSocket and long-polling delivery/subscription denial, immediate block access revocation, and logout socket disconnection. Final API test run completed in approximately 11 seconds.
- API TypeScript compile and Next.js optimized build passed; ESLint and workspace typechecks passed. The two authored Playwright tests are discoverable and their TypeScript was separately checked, GitHub Actions subsequently executed both scenarios: the 360px smoke check passed, while the full journey exposed a discovery timing race and an overly broad shared-IP request throttle. Those fixes let the browser reach date acceptance. The subsequent failure was a test selecting a free walk and expecting checkout; the payment scenario now explicitly chooses the $30 art experience and awaits persisted acceptance. The subsequent run verifies that correction.

## Clean-source replay

A Git source export without node_modules, generated Next files, or local secrets successfully completed frozen-lockfile installation, fresh local key generation, workspace typechecks and both optimized builds. The source archive excludes `.env`, `.data`, build output, dependencies and Git metadata. No browser was launched during this check.

## Covered behavior

Anonymous/origin/CSRF denial; simultaneous reciprocal likes and idempotent retries; unique match notifications; authorized persisted messages and outsider denial; budget encryption/redaction and guessed-plan denial; stale consent and purchase rejection; neutral no-overlap suggestions; two independent captures; stable create/capture retries; receipt ownership; full refund cancellation; block with retained receipts; unsigned webhook rejection; member/moderator role denial; reciprocal age/pause filtering; OTP exhaustion; onboarding draft/adult activation; pending capture without completion; timeout reconciliation without another capture; pending refund without false success; own-only export/deletion; exact calendar adult threshold; live socket authorization/delivery/revocation; Sandbox order/purchase/merchant/currency/amount binding.

Provider responses in these tests are mock fixtures. Real database execution proves persistence/authorization behavior, not PayPal interoperability.

## Not executed / blocked

- Real PayPal Sandbox approval/capture/refund/webhook: required merchant app/buyer credentials and HTTPS callback are not configured. No transaction evidence is claimed.
- Browser screenshots, two-context Playwright journey, mobile overflow and accessibility/contrast audit: no `cua_repl.js` or other managed browser-control tool was available. The applicable [Sites skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md) states: “If `cua_repl.js` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.” Accordingly no preview or browser binary was started/installed here. Browser test source and CI commands are included, with no passing-browser claim.
- GitHub repository creation was initially unavailable. On the subsequent publishing request the existing repository became accessible; its MIT license initialization was merged without rewriting history. CI results must be checked on the pushed commit; earlier local results do not establish a successful GitHub run.
- Full master acceptance matrix (including partial refund races, real OAuth, media content moderation, complete export/retention, screen-reader and network failure audits) remains open in STATUS.md. All P0 completion claims are withheld.

CI has run on GitHub. See its latest run for the current browser result; earlier failed runs are retained. No achieved p95 latency, conversion, accessibility score, or production reliability metric is claimed.

## Hosted prototype verification

The private Site was successfully published with schema-only D1 migrations. Native database inspection confirmed the `DB` binding and `prototype_workspaces` table. Authenticated service health requests confirmed live database readiness and hosted/mock/platform-auth/polling configuration. Two hosted API tests passed against real SQLite/D1 statement semantics, covering the persisted two-person journey, encrypted state, budget privacy, ownership, CSRF/origin rejection, concurrent matching/message retries, independent mock purchases/refunds, blocking and per-owner namespace isolation. No browser or real PayPal evidence is implied by service health or these tests.

## Observed successful GitHub CI

[Run 42741588672](https://github.com/rghosh12/BaePal_PayPal_Hackathon/actions/runs/42741588672) succeeded on commit `3e0bc26`: frozen installation, lint, workspace typechecks, 19 PostgreSQL/provider/socket tests, 2 hosted SQLite/D1-contract tests, all three builds, generated-interface consistency, artifact checks, and both Chromium browser scenarios. The full two-person journey persisted chat, saved both private budgets, accepted the same paid art proposal, captured two independent $30 mock tickets, and observed a confirmed plan. The 360px landing/login/safety overflow test also passed. This is mock payment/browser evidence, not a real PayPal Sandbox transaction or a full accessibility audit.

The final hosted persona-switching refinement reloads the document after an explicit actor switch and keys content by selected persona. This resets uncontrolled forms/composers and in-flight polling from the previous actor, while ordinary same-persona polling preserves drafts.

### Postman taste regression

The `feature/postman-regression-suite` slice adds a real Newman 6.2.3 execution against the isolated Worker harness: 18 requests, 27 assertions, zero failures locally. CI runs `pnpm test:postman` after building the Worker. Coverage and remaining payment/Sandbox work are documented in `postman/README.md`; issue #29 remains open. This is synthetic local evidence only.
