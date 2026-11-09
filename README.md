# BaePal — PayPal Hackathon

A mobile-first dating application concept for intentional relationships, private date-budget coordination, and voluntary date-experience purchases through PayPal Sandbox.

## Project status

Specification repository. Application implementation has not started; no live payment integration or working product is included yet.

## Product specification

The original uploaded [master build prompt](docs/MASTER_BUILD_PROMPT.md) defines the product, architecture, P0/P1/P2 scope, security requirements, and release gates. The repository name follows the owner’s request: `BaePal_PayPal_Hackathon`.

## Initial implementation priorities

1. Establish the application architecture, pinned dependencies, database, and CI.
2. Implement adult onboarding, profiles, reciprocal matching, and matched chat.
3. Add private budgets, date proposals, and mutual acceptance.
4. Integrate PayPal Sandbox orders, capture, receipts, refunds, and webhook reconciliation.
5. Verify permissions, budget privacy, payment retries, blocking, and the two-person demo.

Use the full specification for acceptance criteria. Demo experiences must be labeled fictional, and development adapters must never be presented as live integrations.

## Secrets

Keep credentials out of version control. Configure provider credentials locally or through deployment secrets when implementation begins.
