# Sender-wide message admission

The original Node API's REST and Socket.IO sends share `sendMessage`. Its rolling limit is **30 newly persisted messages per sender in one minute, across all conversations**. A namespaced PostgreSQL transaction advisory lock (`message-sender:<user UUID>`) serializes that sender before acquiring any match lock. Different senders remain independent except for their existing per-match ordering.

After admission waits, the existing match/member/block authorization runs again. Authorized exact retries return the original row without consuming quota or advancing the sequence, even when the sender is already at the limit. Reusing a sender/client message ID with different text or conversation returns `409 IDEMPOTENCY_CONFLICT`; a new message beyond quota returns `429 MESSAGE_RATE_LIMIT`. A blocked or unavailable match cannot recover an old message through the retry path.

The count's statement-time cutoff and explicit insertion-time timestamp avoid transaction-start timestamps that predate an admission/match wait. The statement-time cutoff remains compatible with the existing `(sender_id,created_at)` index. No schema migration is required.

Deterministic PostgreSQL tests use a test-only insertion barrier to reproduce cross-conversation count and retry-key races: previously two sends could both pass a count of 29, or one could fail with raw database code `23505`. A separate match-lock barrier reproduced a message timestamp predating its wait. Additional cases retain quota-free exact replay and reject replay after block/deletion/suspension committed while admission waited.

This change adds no user/peer row locks and no external calls under locks. It does not introduce a distributed delivery queue, exactly-once transport, session-reset serialization or persistent browser drafts. Hosted mock message admission remains governed by its existing owner-workspace compare-and-swap mutation path; this fix changes only the original Node API service.
