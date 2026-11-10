# Exact refund amount evidence

The Node API verifies completed Sandbox refund amounts with the same canonical USD string format used by capture verification. `verifiedRefund` requires the exact `money(expectedCents)` string and USD currency; it never coerces provider values to numbers. Expected completed-refund cents must be a positive safe integer. Refund evidence also needs a nonempty string provider reference.

The former `Number(value) * 100` check rejected valid amounts such as `0.29` and `2.51` because floating-point multiplication does not necessarily produce an exact integer. It also accepted malformed wire values that coerced to the right number, such as numeric `30`, exponent `3e1`, padded or signed strings, hexadecimal input and noncanonical precision. Those values now leave the payment captured and the compensation job retryable instead of recording a false refund completion.

Pending provider refunds remain pending, and do not need the amount evidence required for completion. The change neither expands partial-refund support nor changes worker scheduling, capture consent, hosted mock payments or deployment.

The regression suite uses an isolated PostgreSQL fixture and stubbed provider responses while exercising the Sandbox validation branch. Before the fix, nine worker regressions failed: two valid decimal refunds were rejected, and seven malformed values were accepted. Focused worker/provider tests also cover wrong currency, mismatched amounts, invalid expected cents and pending-state preservation. These are synthetic validation tests, not actual PayPal Sandbox transaction evidence. Issue #54 is the bounded defect; broader #7 remains open.
