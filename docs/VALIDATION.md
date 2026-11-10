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

### Secure integration hub

The shared server-only hub adds nine contract/transport tests, bringing the local suites to 46 passing tests (9 shared, 20 PostgreSQL API, 17 hosted Worker). Both runtimes test the configured preview/planner connection points with isolated gateway fixtures. Lint, type checks and production builds pass; the existing Newman collection still passes 18 requests / 27 assertions. The new hosted browser check covers the Connected services page at 360px, disabled execution and absence of browser credential fields. CI is the browser execution environment. Real sponsor credentials and native provider executions remain unavailable; gateway fixtures do not establish native interoperability.

### Cancellation replays and capture expiry

Five PostgreSQL regressions reproduced two Node API lifecycle defects before the fix: cancelled/refunded or refund-pending plans regressed to reconciliation-pending on replay, expired plans changed to cancelled, and a second capture completing after consent expiry incorrectly confirmed the plan. Cancellation now performs a conditional database transition; replay leaves financial evidence, job completion and backoff unchanged. Capture reconciliation rechecks expiry under the plan lock and queues refunds for both payers instead of confirming an expired invitation. New authoritative late capture evidence still rearms compensation; duplicated evidence does not duplicate refunds.

Local verification passed 51 tests (25 original API/provider, 17 hosted, 9 integration hub), lint, workspace typechecks and the Node API build. These financial regressions use the mock provider and a dedicated PostgreSQL test database. No real PayPal Sandbox completion, distributed-worker guarantee or hosted runtime change is implied. Issues #42 and #43 cover these defects; broader #7 and #8 remain open.

### Three-agent discovery, response privacy and Postman batch

Three agents worked in isolated Git worktrees. Discovery replay revalidates current eligibility before returning an active match ID; seven PostgreSQL regression scenarios include five observed failures before the fix. The response-contract slice reproduced planning-window bounds leaking into proposal snapshots and now allowlists stored/projection snapshots and owner receipt DTOs; one route regression and three serializer cases cover legacy/unknown JSON and generic failure behavior. Combined suites passed 62 tests (36 API/provider/response/visibility, 17 hosted, 9 shared integration).

Newman 6.2.3 executes both taste and original API core/payment exports. The core runner creates and drops only a random schema inside a dedicated test database and never truncates public tables; per-request cookies isolate actors. It covers ownership/consent, amount tampering, operation retries, independent captures, unsigned webhook denial, cancellation/refund reconciliation and retained owner receipts. Counts can vary with bounded refund polling. A cross-review added sanitized malformed-database errors, independent final-plan polling and nested cleanup. Manual Sandbox exports remain disabled: a guard check made zero requests, which is not real Sandbox evidence. See `postman/README.md` for execution and approval steps. Broad discovery #3, API-contract #16 and actual provider gates remain open.

### Auth, date lifecycle and worker reconciliation batch

Three isolated agent worktrees reproduced and fixed account challenge issuance/completion races (#48), ended/elapsed date-planning mutations and completed-date refund initiation (#49), and stale cancellation-worker bookkeeping after new capture evidence (#50). Focused red tests observed duplicate first codes/reset tokens, resets/confirmation after account ineligibility, revived terminal plans, and overwritten/re-delayed compensation. Combined local validation passed 84 tests (58 API/provider/response/lifecycle, 17 hosted, 9 shared), lint, workspace typechecks, all builds and artifact checks. Both Newman collections still passed: taste18 requests/27 assertions and core38/66 on this run (core polling can vary).

Auth uses consistent user-before-challenge locks. Planning guards preserve closed status and reject elapsed consent before the worker runs. Cancellation generation fencing protects success/failure bookkeeping and re-reads verified full-refund evidence without holding transactions across provider calls. A separate agent cross-review found no concrete lock-order/fencing defects. Migration003 adds outbox.generation; it was applied to the local development/test databases. Other Node API/worker deployments must run `pnpm db:migrate` before starting the updated code, with code and migration coordinated; old-worker rolling compatibility is not claimed. See `AUTH_CHALLENGE_SAFETY.md`, `DATE_LIFECYCLE.md` and `WORKER_RECONCILIATION.md`. These original API fixes do not change the hosted mock adapter or establish real provider evidence. Broader #1/#5/#7/#8 remain open.

### Availability, webhook correlation and refund evidence batch

Three isolated workstreams fixed remaining-window suggestions (#52), early webhook correlation loss (#53), and decimal refund verification (#54). Focused tests observed past/too-short options, an unmatched event incorrectly marked processed, valid fractional USD evidence rejected and malformed values accepted before the fixes. Cross-review also caught a safe-integer formatting edge; USD formatting now uses integer digits throughout.

Combined local checks passed 118 tests (92 original API/provider/lifecycle,17 hosted,9 shared), lint, workspace typechecks, all builds and artifact checks. Newman taste18 requests/27 assertions and core38/66 passed on this run. Webhook tests cover later order persistence, authoritative pending/completed evidence, due-batch fairness, bounded exhaustion/provider failures and safe quarantine of unsupported/malformed/mismatched records. Provider responses and inbox rows are explicitly synthetic; no real Sandbox signature/callback or refund execution is claimed.

Migration004 was applied to local development/test databases. Other original API/worker deployments must run `pnpm db:migrate` before updated code starts; existing processed inbox rows are not replayed. Quarantine retains unresolved evidence and requires operator investigation; distributed claims/review tooling and unsupported event families remain in #7/#8. See `AVAILABILITY_WINDOWS.md`, `WEBHOOK_RETRIES.md` and `REFUND_EVIDENCE.md`. The hosted mock adapter/UI are unchanged.

### Chat history and recovery client

The chat slice standardizes ascending first100-row sequence pages in both APIs, including strict bounded decimal cursor validation and Node bigint comparison for large safe cursors. API regressions cover histories beyond200, appended messages and permission rechecks on later pages. The shared ChatThread pages/merges without advancing its fetch cursor from a send acknowledgement, keeps bounded actor/conversation-scoped in-memory drafts/retry IDs, and guards stale responses after navigation, actor change or revocation. Fresh identity-bound CSRF protects retries after session rotation. No delivered/read claim is added.

Combined local verification passed145 tests (116 Node/API/helper,20 hosted,9 shared), lint, workspace typechecks, all builds, artifact checks and both Newman collections. Seven client-helper tests cover batching, continuation, deduplication, acknowledgement gaps, scoped drafts and stale revocation. A new actual-browser CI flow seeds235 fictional messages in the loopback-only harness and tests complete ordered history,360px layout, offline/reconnect and client-navigation drafts, polling, a server-persisted send with deliberately lost acknowledgement and same-ID retry, then partner blocking/cleared disabled chat. Browser execution is a CI gate; local managed preview tools are unavailable, so no local browser run is claimed. The fixture and source-store seed are not imported into the deployed Worker. Broader durable event-envelope/operational requirements remain in #4. See `CHAT_CLIENT.md`.
