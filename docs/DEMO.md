# Two-person judge walkthrough

Use a fresh local database and `DEMO_MODE=true`. The illustrations and names are fictional, not photos of real members. Mock mode performs no PayPal calls and must be introduced as such.

1. Start web/API/Postgres using the README. Open two separate browser profiles/contexts, not two tabs sharing cookies. Sign in as Alex and Jordan through the labeled local demo buttons.
2. In each Discover page, use Pass until you reach the other person, then Like. No chat appears until both like. The mutual match appears once in Chats.
3. Open the shared conversation. Send a message, reload the other context, and confirm persistence. A saved message is not labeled read/delivered.
4. Choose Plan a date from Alex’s conversation. Jordan opens Dates and the same plan. Each independently saves a private budget, compatible activities, and overlapping future times. Exact inputs appear only in their owner's form.
5. Find shared possibilities and propose a catalogue entry. Show total, exact per-ticket price, Seattle time and cancellation policy. Accept on one side. Before checkout, propose another eligible entry and show both acceptances reset. Both accept the same final version.
6. Each opens their own checkout, creates an order, and explicitly captures. In mock mode buttons say Create mock order and Simulate mock capture. Receipts state MOCK. A single paid ticket leaves the plan payment_pending; both paid tickets produce confirmed.
7. Cancel the plan and observe reconciliation_pending, then the completed refund history. Explain that mock provider evidence is a fixture. For actual Sandbox, follow PAYPAL.md and record real references separately.
8. Create/open a matched chat and block. The other browser’s chat access is revoked and REST reads/sends are denied. The buyer can still open their own receipts through Profile → My private receipts.
9. Optionally sign up a new adult, inspect the server's local email capture privately, confirm email, save/leave/resume a draft, and finish required fields. Underage activation is denied by the server. The browser never displays a secret OTP.

The seed script inserts fictional profiles/catalogue idempotently. It does not erase existing decisions, plans or payments. To repeat the browser test, use a fresh disposable database and re-run migrations/seed. Never reset a production database; there is no public reset endpoint.

Unconfigured professional connections are explicitly unavailable. AI suggestions are deterministic, not model-generated. No fake testimonials, user totals, identity badges, live bookings or production-readiness claims are included.
