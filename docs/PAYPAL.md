# PayPal modes, setup, and evidence

## Current evidence

The test suite uses deterministic mock provider responses and selected mocked failure responses, with real PostgreSQL persistence. No Sandbox credentials were configured and no real Sandbox order, approval, capture, refund, or webhook verification was executed. Do not present mock references as PayPal transaction evidence.

`PAYPAL_MODE=mock` is a local fixture adapter. `sandbox` calls only `https://api-m.sandbox.paypal.com`. `live` is rejected by config. The application also refuses `NODE_ENV=production` until release gaps are resolved.

## Sandbox setup

1. Create a PayPal Developer Sandbox business account and REST app; use two separate Sandbox personal buyer accounts for the two-person walkthrough. Do not use real money/accounts.
2. Set `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, and `PAYPAL_WEBHOOK_ID` in local/environment secret settings. Never paste secrets in chat or commit `.env`.
3. Configure a trusted HTTPS `APP_ORIGIN` and an externally reachable HTTPS callback for `/api/v1/webhooks/paypal`. Keep the web/API proxy same-origin. The callback must point to this API, not a static host.
4. Subscribe to capture completion/pending/denied/refund events in the Sandbox app. Restart the API after changing config. Readiness checks validate required config and DB without making financial operations.
5. Each user accepts the same plan version, chooses their own ticket, and clicks Continue to PayPal Sandbox. Approval happens on the provider-hosted Sandbox page. Current UI uses this redirect flow, not the JS SDK embedded button. On return the buyer explicitly asks the API to verify & capture the bound order.
6. Approval cancellation leaves the ticket unpaid. Inspect the receipt and plan: only a provider-verified COMPLETED capture is paid, and the plan requires two tickets. One completed order does not imply both people paid.
7. Cancel a paid plan, wait for worker reconciliation, and confirm successful provider refund evidence in the own receipt. Pending/failed states remain visible; they do not mean funds returned.

## Provider and reconciliation behavior

The provider interface implements createOrder/getOrder/captureOrder/refundCapture/getRefund/verifyWebhook. OAuth server credentials never reach browser responses. Capture checks exact amount, USD, expected merchant, purchase binding and a single capture. Stable request IDs are persisted before external calls. Retrying the same purchase reuses these operation IDs. Timeout recovery queries the bound order or retries the same provider operation; it does not create a new purchase to hide uncertainty.

Signature verification uses PayPal's verification endpoint with the configured webhook ID. Unsigned events are rejected, event IDs deduplicated in a durable inbox, and processing queries the associated order before altering capture state. The server never fetches the webhook's arbitrary certificate URL itself. Raw event payloads are held only in the restricted inbox, excluded from logs and member DTOs; production retention/redaction cleanup is outstanding.

Full cancellation refunds are implemented; partial refunds/disputes and an operational payment-admin UI are unavailable. A single full refund record per payment prevents over-refunding. The in-process worker runs every five seconds; provider failures leave durable retry state. It currently has no maximum-attempt dead-letter escalation or external alert channel. Use one API instance for this prototype.

## Required manual evidence record

Record mode, local purchase/payment references, provider order/capture/refund references, completion/pending results, amount/currency/merchant checks, webhook verification and duplicate processing evidence. Do not include buyer name/email, credentials, private budgets or provider access tokens. Publish no private member screenshots.
