# Feature status and production gaps

BaePal is a Sandbox-only hackathon build. A private persistent prototype is deployed at https://baepal-prototype.ruppakriki.chatgpt.site (see [PROTOTYPE.md](PROTOTYPE.md) for the hosted scope); the full Node/PostgreSQL app deploys to Render via `render.yaml`. The table describes the Node/PostgreSQL implementation, not a claim that every adapter runs in the hosted demo.

| Area                     | Implemented                                                                                                                                                                                                                                  | Outstanding                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Original responsive UI   | Landing, auth, onboarding/edit, discovery (undo last pass), matched chats, plans (decline proposal, calendar file), checkout/receipts, account, safety/drafts, staff password step-up                                                        | Screen-reader/contrast audit; UI for sessions, settings, connections, planning pass and photo removal (API ready) |
| Auth                     | Argon2id, opaque sessions with device/last-seen, list and revoke sessions, CSRF/origin checks, email challenge/reset via outbox (local file or Resend), durable PostgreSQL login/signup/reset throttles, step-up password for suspend/restore | Enterprise SSO, MFA                                                                                             |
| Profiles/media           | Two-approved-photo activation gate, re-encoding/EXIF stripping, upload quota, pending/approved/rejected states with moderator queue (`MEDIA_MODERATION=manual`), labelled auto-approval, photo removal, appeals                              | Private object storage, automated content classifier                                                            |
| Discovery                | Reciprocal gender/age/city filters in SQL with indexes, HMAC-signed expiring keyset cursors (`CURSOR_STALE` on tamper/filter change), undo latest pass within 10 minutes                                                                     | Geographic distance                                                                                             |
| Chat                     | Persisted ordered text, idempotent retry, Socket.IO authorization, durable event replay, opt-in reciprocal read receipts, throttled typing indicators                                                                                        | Multi-instance pub/sub                                                                                          |
| Date planning            | Encrypted budgets, intersection, versioned consent, decline, step-free/neighbourhood/opening-hours filters, Seattle venue time zone with DST ambiguity/nonexistent resolution (`/time/resolve`), ICS export, reminders                       | Post-date state                                                                                                 |
| Payments                 | Mock and Sandbox adapters, no-show deposit, AI agent booking, Log in with PayPal, partial admin refunds with remainder-aware cancellation, leased outbox jobs with backoff and dead letter, admin retry, optional Planning Pass              | Real Sandbox evidence (needs keys), disputes                                                                    |
| Professional connections | GitHub OAuth and LinkedIn OIDC adapters, per-provider state, visibility toggle, disconnect                                                                                                                                                   | Needs OAuth app keys to run against real providers                                                              |
| AI                       | OpenAI-compatible model adapter with deterministic labelled fallback                                                                                                                                                                         | Needs `AI_API_KEY` for model evidence                                                                           |
| Moderation               | Block/report, restricted queue, versioned actions, suspend/restore with step-up, media review, appeals                                                                                                                                       | Staffing, assignment                                                                                            |
| Privacy/account          | Password-checked export (settings, sessions, connections, appeals, entitlements, deposits), deletion, hourly retention purge with audit row, field-key rotation (`pnpm keys:rotate`)                                                         | Encrypted backups                                                                                               |
| Notifications            | Inbox, message/date/payment notifications, hourly generic update email with cancellation when read, dead letter after 6 attempts                                                                                                             | Push notifications                                                                                              |
| Demo                     | 16 fictional profiles, catalogue with venue facts, scenario fixtures (no results, no overlap, pending capture, refunded, declined)                                                                                                           | Observed judge rehearsal                                                                                        |
| Operations               | Migrations, health/readiness, CI with browser/Postman checks, `/admin/ops` counts-only metrics and alerts, OpenAPI generated from every registered route (`/api/v1/openapi.json`)                                                           | Backup/restore rehearsal, measured performance                                                                  |

## Release gates

1. Configure real Sandbox merchant/buyer credentials through secrets settings, perform two approved captures and a cancellation/refund, and verify webhook signatures. Mock tests do not satisfy this gate.
2. Run the browser suite against a fresh database and audit 360px layout, focus, contrast and keyboard access.
3. Validate provider permissions, merchant fit, terms, backup/restore, human moderation and financial incident response before any live deployment.

No live mode, escrow, wallet, stored balance, subscriptions, or real merchant booking is implemented. Working name does not imply PayPal affiliation or trademark clearance.

## Operations hardening (migration 010)

Migration 010 adds durable throttles, an email outbox, session metadata, media states, refund kinds, discovery indexes, venue facts, read watermarks, member settings, entitlements, connections and appeals. It must run before the updated API starts (`pnpm db:migrate`; Render runs it at start). Tests: `apps/api/test/hardening.test.ts` covers throttles surviving restart, session revocation, email dead letter and cancellation, retention, key rotation, DST, opening hours, decline, cursor tamper/staleness, undo, partial refunds, dead-lettered jobs, media moderation, read receipts, ICS, the Planning Pass, OpenAPI coverage and export/delete.

## Purchase-interest addendum

Issues #22–#37 track the new brief. The first hosted slice provides synthetic evidence/consent/review, versioned deterministic purchase-pattern ranking, controlled explanations and immediate synthetic revocation; see [TASTE_MATCHING.md](TASTE_MATCHING.md). This is not proof of Elastic or other sponsor use. [SPONSOR_STATUS.md](SPONSOR_STATUS.md) records the current gaps.

## Payment lifecycle refinements

The Node API preserves completed/pending refund state and expiry across cancellation retries, and rechecks consent expiry when a provider capture completes. A delayed second capture expires the plan and queues both payments for compensation instead of confirming it.

## Discovery, response-contract and Postman refinements

Exact discovery retries respect changed visibility/preferences without returning stale closed match IDs. Proposal and owner financial snapshots project only catalogue/receipt fields. The core/taste Postman collections are exported and executed with isolated fixtures; guarded manual Sandbox artifacts are documented but unexecuted. See `DECISION_REPLAY.md`, `RESPONSE_PRIVACY.md` and `../postman/README.md`.

## Auth, date and worker concurrency refinements

Challenge issuance/completion serializes on stable account rows and rechecks eligibility. Ended/elapsed plans reject preference/proposal/suggestion work; completed paid dates cannot be cancelled into refunds. Outbox generations fence stale cancellation results from overwriting newly queued capture compensation.

## Availability windows and provider-evidence refinements

Date suggestions use only the remaining overlap and exclude experiences whose duration no longer fits. Early capture notifications stay durable with scheduled retries and bounded quarantine. Completed Sandbox refund evidence uses exact canonical USD strings.

## Chat history recovery

Message endpoints return ascending first-100-row pages after a bounded sequence cursor. The client catches up beyond page limits, preserves scoped drafts and uncertain request IDs across navigation, and clears revoked conversations. The Node API stores versioned metadata events atomically with messages and replays them after restart; see [CHAT_EVENTS.md](CHAT_EVENTS.md).
