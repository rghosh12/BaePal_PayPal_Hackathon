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

Cookie authentication and exact origin are mandatory. `conversation.subscribe(matchId, ack)` authorizes every subscription. `message.send({conversationId,text,clientMessageId}, ack)` uses the same send service as REST. Server events are `message.created`, `match.created`, `access.revoked`. On reconnect, REST `after=sequence` provides catch-up; the current UI reloads the first 100 records, so long-history pagination remains a known limitation. Read receipts, typing, delivery acknowledgements and schema-versioned event envelopes are not implemented.
