# Auth challenge concurrency and account eligibility

The original Node API serializes challenge issuance and completion using the stable user row, then locks challenge rows. Locking only the latest challenge was insufficient when two first-time requests both saw no previous row. Both could issue a valid reset token or confirmation code and bypass the intended per-account cooldown.

Reset request responses remain generic for unknown, unavailable and cooldown-limited accounts. Issuance rechecks account eligibility while the user is locked. Password reset completion identifies the challenge owner, locks and rechecks that account, then locks and validates the same owner's challenge. Outstanding reset links cannot change a suspended/deleted account's password. Successful reset still consumes the token and revokes existing sessions; expired or reused tokens remain invalid.

Email confirmation uses the same account-before-challenge lock order so it cannot deadlock against a concurrent issuance operation holding the user lock. It also verifies that the account is still awaiting email confirmation before consuming a code; an eligibility change while the request is in flight no longer produces a false success.

`apps/api/test/auth.test.ts` uses a dedicated PostgreSQL test database and test-only advisory gates to reproduce concurrent first reset/email issuance without relying on race timing. Regression tests observed duplicate issuance and unavailable-account reset success before the fix. A controlled in-flight suspension likewise reproduced false email confirmation. The suite also verifies valid reset/session revocation, expired/reused link rejection and generic request responses.

This is the bounded defect in issue #48 under #1. It does not configure real email delivery, distributed abuse controls, or every account lifecycle policy. Local capture files contain only fictional test codes and are removed by test cleanup. Hosted authentication and deployed Worker code are separate and unchanged.
