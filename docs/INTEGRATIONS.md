# Secure integration setup

BaePal now has a shared server-only integration hub used by the Node API and the hosted Worker. Configure **`BAEPAL_INTEGRATIONS_JSON`** in the environment secret manager for the runtime you deploy. No credentials belong in the browser, GitHub issues, source control, screenshots, or this document.

## Where to add endpoints and keys

1. Start with [`integrations/config.example.json`](../integrations/config.example.json). All services are disabled and tokens blank.
2. In your secure environment, replace a service's `baseUrl` and `token`, select the operations its adapter supports, then set `enabled` to `true`.
3. Save that complete JSON object as the server secret **`BAEPAL_INTEGRATIONS_JSON`**. For local development only, the ignored root `.env` may contain `BAEPAL_INTEGRATIONS_JSON='{"version":1,"providers":{...}}'`. Use valid JSON from the template rather than the abbreviated example. The Node API loads `.env`; hosted Workers use runtime bindings instead.
4. Restart the Node API or publish the Worker with its updated environment. Development environment secrets are not automatically copied into Sites hosting. Set the same named secret in the Site's runtime environment settings for the deployed prototype. Do not put values in `.openai/hosting.json` or use `NEXT_PUBLIC_` names.
5. Run `pnpm integrations:check` in the server environment, or open **Account settings → Connected services**. The checker prints only provider names, states and enabled operations. It exits unsuccessfully for malformed configuration.
6. Run an explicitly approved preview. “Configured · awaiting verification” means configuration passed validation, not that an account, native API, license, model, or live transaction has been verified. Previews make real outgoing requests once enabled; outputs are not persisted as verification claims.

The configured base URL must be an HTTPS gateway accepting the contract below. The hub appends `/<operation>` to the base path. Credentials use `Authorization: Bearer <token>` or `X-API-Key: <token>` according to `auth`. URLs with userinfo, query strings, fragments, nonstandard ports, literal IPs or local/internal suffixes are rejected. Destinations come exclusively from trusted server settings. Apply deployment egress controls if private-network destinations must also be blocked after DNS resolution; hostname validation alone is not a DNS firewall. Redirects are rejected, requests are bounded to 0.1–15 seconds, response bodies to 64 KiB, and failed requests are not automatically retried.

## Provider coverage and activation limits

| Software            | Prepared connection                           | What configuration enables                                                                                                                              | Remaining native setup                                                                                                                         |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Astropods           | `plan`, `explain`, `embed` gateway operations | Explicit planner ranking and explanation previews; validated embedding client for future jobs                                                           | Gateway mapping to actual agent/model API and model/account evidence; no purchase data sent automatically                                      |
| Elastic             | `search` gateway operation                    | Internal validated vector/candidate search client                                                                                                       | Native index schema, gateway mapping, consent/version/deletion lifecycle before discovery uses it                                              |
| Channel3            | `products` gateway operation                  | Opt-in broad-interest product preview                                                                                                                   | Native API mapping, retailer rights; no purchases or automatic targeting                                                                       |
| KERNEL              | `venues` gateway operation                    | Opt-in public venue research preview                                                                                                                    | Native browser-task mapping and permitted sources; responses remain unverified suggestions                                                     |
| Zapier              | `handoffPreview` gateway operation            | Preview summary/destination only                                                                                                                        | A separate confirmed dispatch implementation; the gateway must not execute a handoff during preview                                            |
| PayPal              | Existing original API native Sandbox adapter  | Existing `PAYPAL_MODE=sandbox` and `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID` in the same secure environment | Buyer approval, public verified webhook callback, actual Sandbox tests. Hosted Site remains mock; real history and live payments stay disabled |
| Render              | Deployment environment                        | The same hub secret works when running the original API there                                                                                           | Actual service/database deployment and callbacks; not an application request endpoint                                                          |
| APIMatic            | Development tooling                           | No runtime API fabricated                                                                                                                               | Actual tool/client-generation setup and evidence                                                                                               |
| Postman / Newman    | Existing committed regression collection      | `pnpm test:postman`                                                                                                                                     | Remaining payment and real Sandbox collection work in #29                                                                                      |
| AG Grid / AG Studio | UI integration boundary                       | No key-only activation                                                                                                                                  | Licensed packages, appropriate redistribution rights and component implementation                                                              |
| Bryntum             | Calendar UI integration boundary              | No key-only activation                                                                                                                                  | Licensed package and timezone/consent-aware calendar implementation                                                                            |

**Endpoints alone cannot guarantee native interoperability.** This implementation provides a stable `baepal-gateway-v1` seam because the provider endpoint/authentication/response formats have not yet been supplied. If a service already implements this contract, configuration is enough. Otherwise connect a thin provider-specific gateway or implement a native adapter against the supplied official API specification. A raw Elastic cluster URL, ordinary Zapier Catch Hook, model completion endpoint, or browser task endpoint generally does not speak this contract directly. Do not mark it verified until its actual native call has been tested.

## Gateway wire contract

All operations use `POST <baseUrl>/<operation>`. The request contains no BaePal cookie, user identity, private budget, chat text or raw transaction history:

```json
{
  "version": 1,
  "operation": "explain",
  "requestId": "generated-uuid",
  "input": { "interests": ["arts"], "sharedInterests": ["arts"] }
}
```

Return `Content-Type: application/json` with exactly:

```json
{ "version": 1, "data": { "summary": "Art is a shared interest." } }
```

Supported input/output shapes are authoritative in [`packages/integrations/index.mjs`](../packages/integrations/index.mjs). Unknown fields are rejected. Broad interests are limited to `books`, `coffee`, `outdoors`, `arts`, `music`, `games`.

| Operation        | Input                                                    | `data` response                                                                  |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `plan`           | `interests`, `options: [{id,title,activity,priceCents}]` | `suggestions: [{id,reason}]`, 1–3 unique IDs from the provided catalogue         |
| `explain`        | `interests`, `sharedInterests`                           | `summary` (1–600 characters); the preview is a sample, not a compatibility score |
| `embed`          | `features: {arts: 0.5, ...}` normalized broad values     | `vector` (1–3072 finite numbers), `model`                                        |
| `search`         | `vector`, `candidateIds` (pre-authorized UUIDs)          | `candidates: [{id,score}]`; IDs must be from that authorized set                 |
| `products`       | `interests`                                              | `items: [{id,title,url}]`, maximum 10 HTTPS product links                        |
| `venues`         | `interests`, `city: "Seattle"`                           | `venues: [{name,description,url}]`, maximum 10 HTTPS source links                |
| `handoffPreview` | `activity` from documented enum, `city: "Seattle"`       | `summary`, `destination`; **must be side-effect free**                           |

The application exposes authenticated `GET /api/v1/integrations/status` and CSRF/origin-protected, rate-limited `POST /api/v1/integrations/preview`. The latter accepts `{operation, input, allowExternalProcessing:true}` for `plan`, `explain`, `products`, `venues`, `handoffPreview`. Client requests cannot select an endpoint, credential, arbitrary provider, raw purchase payload, or an internal embedding/search operation. One preview approval is for one request and is never persisted as general purpose consent.

The existing `POST /api/v1/date-plans/:id/suggestions` accepts an optional `{useExternalProvider:true,allowExternalProcessing:true}` body. Both runtimes first authorize the plan and filter eligible catalogue entries, then call `astropods/plan` outside retryable database mutations. Only public catalogue fields are sent. Exact private budgets are excluded, although the eligible price range can imply preferences; the UI asks for confirmation and explains this. Responses cannot invent options or override stored prices, and normal proposal/acceptance/checkout checks still apply. Default suggestions remain deterministic; no configuration silently transfers data.

No generic outbound proxy, arbitrary webhook action, remote booking, checkout, calendar dispatch, real-history ingestion, automatic embedding export or Elastic indexing job is enabled by this configuration.

## Verification

`pnpm --filter @baepal/integrations test` verifies configuration, secret redaction, permission validation, destination restrictions, bounded transport, malformed/oversized output, timeouts, immutable catalogue membership/prices and search candidate restrictions. Hosted tests verify authentication/CSRF/approval and real route-to-adapter behavior using isolated fixture responses. CI builds both runtimes and runs the existing regression/browser suites. `pnpm test:postman` remains synthetic prototype evidence.

Gateway fixture tests prove our code and contract, not a native sponsor API. Add actual provider API/model versions and redacted request IDs to the execution register after credentials and compatible endpoints are configured. Never commit real tokens or raw financial records as test fixtures.
