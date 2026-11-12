# Implemented API inventory

Base path `/api/v1`. Responses wrap `data`; failures wrap `error: {code,message,requestId}`. Zod validation errors currently summarize field paths in the message, not a separate fieldErrors object. Unknown fields are stripped by schemas; money/actor/provider order fields are never trusted from the client.

All mutations except verified provider webhooks require the exact `Origin: APP_ORIGIN`. Cookie-authenticated mutations also require `x-csrf-token`, obtained from `/me`. No cross-origin API is enabled. All resource IDs are UUIDs unless catalogue IDs or provider references. Permission checks are on the server, including guessed IDs.

`GET /openapi.json` generates the core mutation request schemas from the validators used in code. It is deliberately labeled partial: complete typed response contracts and all route schemas remain outstanding.

| Method    | Path                                         | Behavior                                                                                                      |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET       | /health, /ready, /config                     | Process/DB readiness and safe provider feature configuration                                                  |
| POST      | /auth/signup                                 | Adult/terms acknowledgement, normalized email, Argon2id password, local email challenge                       |
| POST      | /auth/login, /auth/logout                    | Rotate/revoke opaque cookie session                                                                           |
| POST      | /auth/email/request, /auth/email/confirm     | 60-second resend cooldown, ten-minute expiry, five-attempt keyed-code limit                                   |
| POST      | /auth/password/request, /auth/password/reset | Generic request, single-use hashed high-entropy token, revoke sessions                                        |
| GET       | /me                                          | Own profile/private onboarding state and CSRF value                                                           |
| PATCH     | /me/profile                                  | Versioned draft/complete edit, private DOB/preferences, adult activation gate                                 |
| POST      | /me/photos                                   | Base64 JPEG/PNG/WebP ≤10MB; pixel bounds, re-encode, strip EXIF; development technical validation only        |
| GET       | /media/:id                                   | Owner or eligible/matched viewer; no-store controlled derivative                                              |
| GET       | /discover, /people/:id                       | Reciprocal active adult profiles, same city, age/gender, no block/duplicate match                             |
| POST      | /decisions                                   | like/pass with clientMutationId; canonical pair lock and unique reciprocal match                              |
| GET       | /matches                                     | Current authorized matches plus safe partner public profile                                                   |
| DELETE    | /matches/:id                                 | Close chat and cancel/reconcile open plans                                                                    |
| GET       | /conversations/:id/events?after=N            | Node-only participant-authorized metadata event replay, ascending first100 after sequence; schemaVersion1     |
| GET       | /conversations/:id/messages?after=N          | Participant-only ordered messages, up to 100 per request                                                      |
| POST      | /conversations/:id/messages                  | Persist once per sender/clientMessageId, sequence and broadcast                                               |
| POST      | /blocks, /reports                            | Immediate bilateral access revocation; minimal report acknowledgement                                         |
| POST/GET  | /date-plans                                  | Create from an active match / own accessible plan list                                                        |
| GET       | /date-plans/:id                              | Current version, own preferences only, neutral partner paid flag                                              |
| PUT       | /date-plans/:id/private-preferences          | Caller-owned encrypted budget/activity/UTC availability; invalidates consent if editable                      |
| POST      | /date-plans/:id/suggestions                  | At most six requests per IP/hour; both budgets/activities/time overlap filter; deterministic eligible ranking |
| POST      | /date-plans/:id/proposals                    | optionId, startsAt, expectedVersion; server catalogue snapshot and fresh version                              |
| POST      | /date-plans/:id/accept                       | Current proposalVersion only; both required                                                                   |
| POST      | /date-plans/:id/cancel                       | expectedVersion; separate financial reconciliation                                                            |
| POST      | /purchases                                   | planId/proposalVersion; one independent owner ticket with authoritative immutable amount                      |
| GET       | /purchases/:id                               | Own purchase and payment only                                                                                 |
| POST      | /payments/orders                             | Own paymentId; stable server operation key, server-computed money                                             |
| POST      | /payments/:id/capture                        | Own current accepted purchase; verifies stored provider order, exact amount, merchant                         |
| GET       | /payments, /payments/:id                     | Own receipts/refund history; available after block/unmatch                                                    |
| POST      | /webhooks/paypal                             | Sandbox signature verification, event-ID inbox dedupe, async provider reconciliation                          |
| POST      | /me/pause, /me/resume                        | Active↔paused; hides future discovery                                                                         |
| POST      | /me/export                                   | Password reauthentication; synchronous own-data JSON, no partner messages/private inputs                      |
| DELETE    | /me                                          | Password reauthentication; revoke access, anonymize dating content, queue paid-plan compensation              |
| GET/PATCH | /admin/reports, /admin/reports/:id           | Moderator/admin minimal queue and reason-audited reviewed/dismissed updates                                   |

## Realtime

Cookie authentication and exact origin are mandatory. `conversation.subscribe(matchId, ack)` authorizes before and after an awaited room join. `message.send({conversationId,text,clientMessageId}, ack)` shares REST sender admission and rechecks the authenticated session after lock waits. Server events retain legacy `message.created`, `match.created`, `access.revoked` compatibility; the additive Node-only `chat.event` stream carries durable versioned metadata with `eventId`, `schemaVersion`, `aggregateId`, `timestamp`, type and `{messageId,sequence}` payload. See [CHAT_EVENTS.md](CHAT_EVENTS.md) for the exact contract, authorized replay, migration and runtime differences.

The current client uses legacy `message.created` as a refresh signal and pages complete authorized message history with bounded sequence catch-up. It does not consume the new typed metadata stream. Both streams reauthorize recipients before publication. Live socket publication is best-effort; persisted Node events and messages remain replayable after restart. Read receipts, typing, transport delivery guarantees and cross-instance Socket.IO pub/sub are not implemented by this release.

## Purchase-interest extension

The hosted prototype adds the owner/CSRF-checked taste and safe match-explanation routes documented in [TASTE_MATCHING.md](TASTE_MATCHING.md). The Node/PostgreSQL API does not yet expose those extensions.
