# Decision replay visibility

Exact retries of a discovery decision recheck the current reciprocal discovery eligibility rules before returning a match ID. Active accounts must still meet the same-city, age and gender preferences, neither direction may be blocked, and a closed pair remains unavailable. A legitimate immediate retry after reciprocal likes is allowed to reference the newly created **active** match without creating another match or notification.

A paused member is unavailable for discovery decisions, including stale retries. Existing conversation access continues to use the separate `activeMatch` policy, which intentionally permits paused members to use an already-active conversation. A pause does not silently become an unmatch.

Changing the key or payload still returns the existing `409 IDEMPOTENCY_CONFLICT` before eligibility is evaluated. A formerly valid exact request that is no longer eligible returns `404 UNAVAILABLE`; the application therefore cannot emit a fresh `match.created` event for an unavailable pair from its cached decision.

Seven PostgreSQL regression scenarios cover these boundaries, including a benign retry and stale requests after closure, blocking, pause, hard-preference changes, suspension and conflicting replay. This fixes issue #45 and progresses #3. It does not complete signed pagination, indexed discovery or unify all detail/media visibility predicates; the broader discovery issue remains open.
