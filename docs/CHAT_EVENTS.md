# Durable message events and authorized replay

The original Node/PostgreSQL API now writes one metadata-only event in the **same database transaction** as each newly saved message and conversation sequence. Exact `clientMessageId` retries reuse the original message and event identities. Event rows retain only UUID references, sequence, type, schema version and occurrence time; message text remains in `messages` rather than being copied into an event payload or delivery queue.

## Event contract and replay

New Socket.IO clients may listen for the additive `chat.event` channel:

```json
{
  "eventId": "stable-event-uuid",
  "schemaVersion": 1,
  "aggregateId": "conversation-uuid",
  "timestamp": "2026-11-12T00:00:00.000Z",
  "type": "message.created",
  "payload": { "messageId": "saved-message-uuid", "sequence": 1 }
}
```

The actual UUID/timestamp/type validators are exported as `MessageCreatedEvent` in [`chat-events.ts`](../apps/api/src/chat-events.ts). These events contain no text, sender identity, client retry key or session material. Read message content through the existing authorized message endpoint.

`GET /api/v1/conversations/:id/events?after=N` returns `{data:[event,...]}` with the first 100 events strictly after the conversation's saved sequence cursor, in ascending order. Omitted `after` means zero. Cursors are bounded decimal strings representing nonnegative safe integers; malformed/repeated/unsafe values return 400. Each page checks current session, membership, active match and bilateral block status. A stale cursor never restores revoked access. Continue from the last payload sequence until a short/empty page, deduplicating by stable `eventId`.

A process can commit a message and stop before publishing it. The event still exists and is replayable after app restart because persistence is independent of any socket subscription or in-memory queue. Live publication is best-effort; exact send retries may publish the same stable event again. No transport delivery/read receipt or exactly-once push claim is made. Supported live room delivery remains within one Node Socket.IO server; cross-instance pub/sub routing is an operational deployment capability, not supplied by this event log.

## Compatibility and authorization

Legacy `message.created` continues to carry its existing saved-message row. The current ChatThread listens to that legacy signal and refreshes authorized message pages; it does **not** consume `chat.event` metadata. Existing REST message/send responses and Socket.IO acknowledgement shapes are unchanged. The hosted Site has separate persistent authorized HTTP message catch-up, without this Node-only typed log or Socket.IO channel; no hosted storage migration is introduced.

Both REST and Socket.IO sends pass their trusted, server-authenticated session hash into admission. After waiting for the sender and conversation locks, the service rechecks session ownership, expiry with the current database clock and revocation before either new persistence or exact-retry recovery. No token hash is accepted from a client message body. Internal trusted fixture/service calls may omit session context; externally reachable send routes supply it.

A subscription rechecks the current session and conversation again after an awaited room join, removing the room membership if access ended while joining. Each live event recipient is independently reauthenticated and checked for current match/block access before either new metadata or legacy content is emitted. Read/delivery labels remain unsupported: the UI says only saved.

## Migration and verification

Stop old Node message writers, run **`pnpm db:migrate`** against the configured database, then start the updated Node API. Migration `005_durable_chat_events.sql` creates the log and backfills stable metadata for existing messages. `server.ts` does not apply migrations automatically. Mixed old/new writers are not a supported rollout: old code cannot atomically create the new metadata. The normal migration runner wraps this migration transactionally; its backfill is duplicate-safe by message ID.

Focused PostgreSQL/real Socket.IO tests cover stable exact retry, forced metadata-insert failure rolling back message/sequence/event together, replay after app restart without any live publication, actual migration backfill, more than 100 replay records and stale authorization. Expired/revoked sessions are rejected while sends wait on admission and while subscriptions await joining. Expired/revoked recipients receive neither event stream. The queued REST expiry case previously saved the message despite expiration; it now rejects before any message/event commit. These are local application tests, not a distributed-delivery reliability or browser audit claim.
