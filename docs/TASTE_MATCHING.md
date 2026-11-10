# Reviewed synthetic purchase-interest matching

## Scope and mode

This slice runs in the private hosted Worker (`apps/hosted`). It processes **synthetic fictional histories only**. It does not read a PayPal buyer's history, accept export uploads, call an AI model, or query Elastic. Those capabilities are separately tracked and labeled unavailable. Ordinary login and ticket payment do not authorize purchase-history access.

Original dating eligibility remains authoritative: active adults, reciprocal declared gender/age preferences, same-city pilot, account visibility and no block/closed duplicate pair. Discovery falls back to declared profile interests when purchase evidence is missing, insufficient, expired, revoked or unpublished. Paused members do not appear. Existing matches do not disappear merely because an interest changes; blocking still revokes access.

## Member flow

1. Open **Purchase interests → Permissions**. All four purposes start off: purchase matching, selected public explanation tags, hosted-AI processing and optional commercial recommendations. Choose matching and the feature families you permit. Enabling currently unavailable AI/commerce merely records that independent purpose, never invokes a service.
2. Open **Sources** and choose a fictional reader/outdoor/art dataset. Import is synchronous, durable and retry-safe; status shows ready/partial review counts and synthetic provenance.
3. **Private review** shows only the selected persona's records. Exclude individual rows/all from a merchant, correct a safe category, or mark gift/business/shared purchases. Sensitive/non-purchase/reversed events cannot be made eligible by a simple inclusion checkbox.
4. Inspect the private coverage preview, then **Publish reviewed summary**. Changes invalidate the previous version immediately; unpublished/insufficient evidence uses declared fallback. Thresholds are a prototype heuristic, not relationship science.
5. On **Your summary**, explicitly select supported broad tags if you separately consented to public explanation tags. Both parties must share the same approved category before it appears in Discover or **Why this match?**. No raw peer receipts, merchants, amounts or timestamps are returned.
6. **Stop & delete** immediately removes this persona's synthetic imports, evidence, corrections, published feature and shared tags. It disables all purchase-data purposes. Social matches and independent payment receipts remain.

Use the existing explicit Demo persona selector to test both sides. Save before switching; it reloads the document and discards unsaved drafts. A personal prototype profile is separate from fictional fixture personas. Workspaces remain isolated by platform identity.

## Data processing

Fixtures use stable dataset/transaction/event keys. Exact sale-event duplicates are removed; refunds have distinct event keys and invalidate the referenced sale. Included records must be completed USD personal purchases, non-sensitive, unambiguous or explicitly corrected, within the recent synthetic window and not owner-excluded. Transfers, fees, sensitive categories, gifts, business/shared events, unknown categories, non-USD events, refunds and reversed sales do not affect matching. Amounts are retained only in private synthetic review/export and never used in features or ranking.

Unknown item details stay absent. Unknown/invalid timezone or non-purchase-time precision contributes no daypart. Coarse weekday/weekend and morning/afternoon/evening histograms describe purchase events only, never availability, home/work routines, salary timing or location.

Counts are capped at two per merchant/day, then receive a 90-day half-life. Categories/brands/rhythms normalize within one member. `TASTE_POLICY` centralizes the prototype thresholds and requires a policy/version review when changed: at least 20 usable purchases over 30 days; 180-day synthetic input window; 30-day published feature expiry. These synthetic windows never authorize retaining real PayPal data. Timed cross-provider purge/backups remain in #35; explicit synthetic revocation is synchronous.

## Ranking and explanations

`ALGORITHM_VERSION=reviewed-counts-v1`. Supported pair families use category 0.40, approved brand 0.15 and coarse rhythm 0.15, omitting unsupported/disabled families and renormalizing the remaining weights. Numeric category/brand distributions use bounded cosine; normalized rhythm histograms use `1 - JSD/log(2)` with natural logs. Unsupported monetary-relative/semantic-model families are omitted, not simulated.

The reranker is symmetric and deterministic, with stable user-ID ties. Scores stay server-side and are not returned as probabilities or desirability. Evidence support is separate: a single family or a declared fallback is always insufficient; two supported purchased-data families are moderate; three are strong input support only. This is not a scientific compatibility claim.

One member may compare their reviewed synthetic categories against another's public self-declared categories; that pair is explicitly insufficient evidence. A peer's private purchase features are used only while its own matching consent and feature version are active. Public explanations require both parties' separate sharing purpose and intersect only their selected supported category tags (maximum three). Rebuilds, edits, expiry and revocation are checked on every read; there is no stale cached explanation or external index in this slice.

## Atomicity, compatibility and limits

Taste state is an optional addition inside the existing encrypted per-owner D1 workspace. Old workspaces load without a schema rewrite; defaults are all-off. The existing compare-and-swap write loop atomically validates consent/evidence versions, builds features and persists the result. A revocation wins against an old import/rebuild because its consent version changes; the old operation cannot commit on retry. No external calls occur inside this synchronous slice.

The serialized UTF-8 workspace limit is 750 KB before AES-GCM/hex encoding, leaving room below D1 value limits. New taste data cannot bypass that guard. This JSON-per-owner prototype is not the future PostgreSQL/Elastic scale design.

## Implemented API

All require the selected authenticated persona; mutations also require origin/CSRF. Caller IDs are never trusted from bodies.

| Method | Path                               | Contract                                                                                            |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | /taste/capabilities                | Separate source/login/payment capabilities; real history and uploads blocked                        |
| POST   | /taste/consents                    | expectedVersion, four purposes and allowed feature families                                         |
| POST   | /taste/demo-imports                | listed datasetId, UUID idempotencyKey, current consentVersion                                       |
| GET    | /taste/imports/:id                 | Own import status/counts only                                                                       |
| GET    | /taste/evidence                    | Own bounded records, limit 1–100, bounded offset, private preview                                   |
| PATCH  | /taste/evidence/:id                | Own expected row version and consentVersion; exclusion/category/classification/bulk-merchant action |
| POST   | /taste/rebuild                     | current consentVersion and expectedEvidenceVersion; publish reviewed feature                        |
| GET    | /taste/profile                     | Own current summary, permissions, coverage, expiry and honest model/search status                   |
| PATCH  | /taste/profile/sharing             | current consent/feature versions and supported category tags                                        |
| DELETE | /taste/consents/:id                | Immediate synchronous synthetic revocation/purge                                                    |
| GET    | /matches/:id/explanation           | Active participant only; mutually shareable broad tags                                              |
| POST   | /taste/paypal-sync, /taste/exports | Fail closed; no history workaround or fixture substitution                                          |

The original `/me/export` includes only the current persona's taste inputs; `/me` and public cards never include private evidence. Account deletion removes its taste state. Full API response-schema/OpenAPI work remains in #16.

## Evidence and next work

15 hosted SQLite/D1-contract tests cover import/source guards, idempotency, actor isolation, sensitive/refund exclusions, unknown metadata, minimum evidence, amount scaling/outliers, version conflicts, visible ordering changes, safe explanations and revocation races. Existing 19 PostgreSQL/provider/socket tests remain intact. New Chromium CI cases exercise the actual bundled hosted UI/API with a loopback-only SQLite/platform-identity harness, including a 360px private review table. The harness is never imported into the deployed Worker and has no public reset or identity override route.

Real AI (#25), Elastic (#26), original Node/PostgreSQL taste persistence, external jobs/deletion (#35), real Sandbox evidence (#6/#7), actual sponsor tooling and public submission evidence remain separate work. No sponsor completion is implied by the functional native review table or deterministic explanations.
