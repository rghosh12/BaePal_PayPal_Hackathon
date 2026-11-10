# BaePal — Spending-Based Matching, PayPal and Sponsor Build Addendum

Prepared 9 November 2026. Append this document AFTER the existing BaePal Master Build Prompt. This is a proposed implementation brief, not a claim that any integration has been built or approved.

## 1. Founder mandate and precedence

Act as BaePal's founding product engineer, growth-minded technical cofounder and full-stack architect. Build an original dating product whose primary differentiator is matching consenting adults through shared purchase interests, brand affinities and coarse spending rhythms. Keep the original master prompt's working social flows, account security, accessibility, consent, reporting, payment correctness and deployment requirements.

This addendum changes the product center of gravity. BaePal is now a purchase-interest compatibility and date-commerce product. Professional LinkedIn/GitHub context becomes optional secondary information. The default match rank must no longer rely predominantly on manually entered interests. It must demonstrably change when the member reviews, excludes or corrects eligible purchase-derived signals.

This addendum overrides the old default ranking, optional-only AI scope, payment-amount exclusion from all feature engineering, and private-repository submission assumption. Retain the prohibition on ranking people by wealth: monetary data may support within-person, normalized hobby/cadence patterns, never a richer-is-better desirability score. PayPal data access and permitted-use gates below override any instruction to automatically ingest history.

Repository: baepal_paypalhackathon. Inspect what exists before changing it. The earlier deliverable was a specification package, not proof of a working application or remote repository. Do not claim otherwise. Preserve unrelated work, implement vertical slices, and label mock, Sandbox and live evidence separately.

Submission target: runnable working build, public open-source repository with a root license and complete setup instructions, tools disclosure, and a publicly viewable YouTube demonstration under three minutes. Do not expose secrets, personal datasets or proprietary sponsor code when opening the repository.

## 2. Product positioning

Working line: **“Meet someone who spends their weekends like you.”**

BaePal turns voluntarily supplied purchase-interest evidence into a member-controlled lifestyle profile, recommends eligible people who enjoy similar activities, explains the overlap, suggests a first date, and supports explicit PayPal checkout for a permitted date product. Money habits drive discovery; payments complete a shared activity.

Example: two members frequently choose independent bookstores, outdoor recreation and coffee. BaePal can suggest a bookshop-and-coffee date from those confirmed interests. It must not conclude that they have similar salaries, are financially responsible, are free on Saturday mornings, or are romantically compatible with a validated probability.

The behavioral matching hypothesis is commercially testable: purchase interests may help people discover useful common ground and move from a match to an actual plan. It is not established relationship science. Do not imply purchases prove identity, values, financial health or readiness for a relationship.

Avoid public “spending personalities” that shame people. Preferred member-facing descriptions are editable and provisional: “Often chooses outdoor activities” or “Enjoys independent cafés.” Never label someone broke, high value, rich, impulsive, addicted, irresponsible or a good credit risk.

## 3. PayPal access and permitted-use gate

Implement three distinct concepts, each with its own status and consent:

1. **PayPal account connection:** optional identity/login integration using actually provisioned fields. Basic login does not unlock a consumer's full purchase history.
2. **Purchase-interest evidence:** synthetic demo histories first; approved sources only for real users. Provenance and purpose controls are mandatory.
3. **PayPal payments:** actual Sandbox Orders create/approve/capture/refund flows for BaePal's explicitly described demo product. A completed payment does not authorize historical-data access or matching use.

### Source modes

| Mode | What it means | What to implement |
| --- | --- | --- |
| Synthetic demo history | Fictional merchant/category/time/amount rows belonging to fictional adults | Default hackathon flow; visible label; deterministic fixtures and meaningful AI processing |
| Member-declared preferences | A person explicitly chooses brands/interests and coarse spending-style preferences | Working cold-start alternative; distinguish self-report from transaction evidence |
| BaePal-origin Sandbox orders | Events created by this application against its own demo merchant | Actual PayPal API evidence and reconciliation; not proof of all the buyer's spending |
| User-provided PayPal export | Member uploads their own export | Future adapter gated pending confirmation of permitted use; not an assumed workaround for API restrictions |
| PayPal reporting/partner history | Reporting under an account and permissions explicitly available to the app | Restricted integration adapter, disabled by default; verify precise account scope and approved purpose |

The official PayPal Identity integration describes non-financial account information. The official Transaction Search specification requires partner-network participation for third-party use. A merchant's reporting credentials are not a universal consumer-history API. Do not invent a “read_all_purchases” permission or ask users for developer credentials.

The reviewed U.S. Developer Agreement contains transaction-history deletion requirements, restrictions on marketing analysis/disclosure, and a broad definition of PayPal user information. Therefore real-history matching, derived embeddings and commercial recommendations require confirmation of applicable terms and authorized use. User consent, CSV import, anonymization or deriving a vector must not be presented as automatically removing those restrictions. Sandbox access does not establish live business authorization.

Keep real-history ingestion, export upload, derived-history storage and history-based commercial targeting disabled until the specific implementation is cleared through the relevant PayPal relationship and appropriate review. Record permission status, scope, purpose, territory, retention/deletion obligations and supporting approval reference. No need to obtain those permissions to finish the synthetic demonstration.

PayPal's current acceptable-use policy lists online dating among activities requiring pre-approval to accept payments. Keep live payments disabled pending applicable approval. Do not bypass this by disguising a dating payment as an unrelated purchase. Confirm any marketplace/merchant requirements independently.

### UI truthfulness

Show separate status chips: “Demo purchase history,” “Self-declared interests,” “PayPal Sandbox connected,” and “History integration unavailable.” Never show “PayPal history connected” after ordinary login. A disabled real-sync button explains the access dependency and offers Try demo or Enter interests. A real API 403 must remain a real failure; don't silently replace its payload with fixtures while retaining a connected badge.

## 4. Commercial model and product incentives

The commercial wedge is the journey from compatible interests to a mutually accepted, affordable shared activity. Build trust by giving the person control over every signal and never selling raw financial history.

Revenue hypotheses, not guaranteed income:

- Free: control purchase-interest signals, discover people, mutual matches, chat, safety controls and basic date planning.
- Optional BaePal Plus: test a proposed $9.99 monthly price for extra planning utilities, more saved plans and expanded explanations. P1; do not imply actual current pricing or launch subscriptions before the core works. Basic safety, exclusion and deletion remain free.
- Date experiences: test a disclosed convenience fee on a BaePal-operated permitted experience, or a negotiated commission from an onboarded merchant. Sandbox demonstrates the owned demo-merchant case. Third-party platform commissions require an appropriate approved integration; arbitrary platform fees cannot simply be attached to first-party checkout.
- Affiliate product discovery: a separate optional feature with member-declared commercial preferences and explicit disclosure, only where the data source's terms and a retailer relationship permit it. Do not assume Channel3 buy links pay commission or allow platform checkout.
- Sponsored local experiences: future opt-in catalogue placement clearly marked sponsored. Sponsorship never changes which people match and never consumes restricted PayPal history for targeting.

Illustrative unit economics, explicitly assumptions: 1,000 monthly active members, 8% choosing a $9.99 plan gives $799.20 gross recurring revenue; 100 completed $60 date orders with a negotiated 8% commission gives $480 gross commission. Combined $1,279.20 is gross hypothetical revenue before payment costs, cancellations, AI/search/runtime costs, acquisition, support, taxes and other expenses. Bookings, commission and subscription uptake must be validated, not forecast as fact. An order volume is GMV, not revenue.

Measure opt-in and correction rates, useful matches, mutual conversations, accepted date proposals, payment completion, refund rate, retention after a good interaction, acquisition cost and contribution margin. No spending leaderboard, pay-to-match weighting, encouragement to spend more to improve rank, or high-spender acquisition targeting from restricted history. Validate purchase-based matching against declared-interests baseline through controlled evaluation with willing adults before relationship-success claims.

## 5. Sponsor architecture — meaningful roles for all ten

Use every sponsor only where it has a bounded, demonstrable role. Never mark an integration complete based on importing its SDK, adding a logo, writing an adapter stub or mentioning it in a README. Build the main journey first. Credentials, plan limits and license terms must be verified in the developer's own account; credits/trials do not imply permanent production rights.

| Sponsor | BaePal integration | Proof of meaningful use | Priority |
| --- | --- | --- | --- |
| Elastic | Hybrid retrieval of eligible, opted-in member lifestyle vectors and structured compatibility fields; optional explainable catalogue search | Actual index/query, candidate IDs, retrieval evaluation and privacy deletion test | Core runtime |
| Astropods | Agent runtime for consented taste summarization, structured match explanations and date-planner orchestration with allowlisted tools | Executed agent run with model/provider identified, validated output and redacted trace | Core runtime |
| Render | Host web/API, persistent workers and database; optional workflows for import/feature jobs | Running deployment, health checks, durable job execution and migration instructions | Core deployment |
| APIMatic | Use PayPal Context Plugin in the coding workflow; optionally generate a BaePal client from its actual OpenAPI | Record actual context/tool usage and checked contracts/generated artifact; no fake runtime claim | Core development |
| Postman | Versioned collection for BaePal and PayPal Sandbox happy/negative paths | Exportable collection, environments with placeholders and executed assertions | Core development |
| AG Grid / AG Studio | Private “My purchase interests” workspace with review/exclusion grid, aggregate charts and guarded natural-language dashboard questions | Working owner-only review actions; for Studio award, use Studio custom widgets/agent features rather than claiming basic grid use is equivalent | High-value extension |
| Bryntum | Calendar for voluntarily provided availability and proposed dates, accepted revisions and paid confirmation | Working Calendar/Scheduler interaction with server state, timezone handling and consent invalidation | High-value extension |
| Channel3 | Separate optional shared-interest product/gift discovery using allowed declared preferences; normalized product API lookup | Real API search, source IDs, current-price timestamp, retailer link and user confirmation | Optional commerce extension |
| Zapier | Opt-in notifications/calendar handoffs and support workflow through a narrow server-mediated action | One explicitly confirmed real automation with minimal payload and idempotency | Optional operations extension |
| KERNEL | Browser agent checks permitted public venue details when no API exists; show draft itinerary and provenance | Actual permitted browsing task and extracted result, reviewed by user; no financial-session access | Optional research extension |

### Avoid overlapping orchestration

Astropods coordinates AI reasoning and tool calls. Render hosts application services and durable work scheduling. Zapier handles optional external actions after confirmation. KERNEL supplies a narrow browser tool, not a second general autonomous financial agent. Elastic retrieves; PostgreSQL remains the system of record. APIMatic and Postman are genuine build/test tools, not artificial user-facing screens.

### Sponsor-specific constraints

- Elastic: index only allowlisted derived fields with an active consent version and approved source provenance. Server constructs eligibility filters; user text must never become unrestricted DSL. Post-filter against authoritative DB permissions before returning a candidate. Never index raw transaction descriptions, precise purchase times, emails, balances or private budgets. Remove derived documents on revocation. Shared infrastructure must not expose one member's financial vectors through search endpoints.
- Astropods: specify one Taste Agent, one Explanation Agent and one Date Planner as logical responsibilities; a single deployed agent may implement these tools to reduce complexity. Record real model name/version. Only sanitized, approved inputs may reach a hosted model; synthetic histories are the default. Structured output and server validation are required; an agent cannot authorize a payment.
- Render: deployment must support persistent socket/API workers and reachable verified PayPal callbacks. Verify free/trial service limits; don't promise uninterrupted uptime or a permanent free database. Keep secrets in environment settings.
- APIMatic: use its actual documented context tooling rather than inventing tool IDs or endpoints. Generated SDKs must be reviewed and tested. Tool usage by the coding agent does not alone satisfy BaePal's runtime AI requirement.
- Postman: store request/response examples with synthetic data. Never export bearer tokens, real receipts or customer PII to a public workspace. Include replay, amount-tampering, privacy and webhook tests.
- AG Studio: member sees their own inputs only; support/moderation roles don't get a transaction browser by default. Natural-language questions operate on a fixed owner-scoped aggregate interface, not SQL or global finance access. Check component redistribution/license obligations before adding trial code to an open-source submission.
- Bryntum: calendar reads member-provided availability, never guesses it from spending. Dragging a proposed date changes a draft; it doesn't accept on behalf of the other person or bypass re-consent. Confirm trial and redistribution rights; keep proprietary source out of the repository.
- Channel3: product search isn't a historical transaction-enrichment guarantee, merchant booking API or authority to sell retailer stock. Keep API images/links within permitted terms. Price/availability may change. No surprise gifts to a home address, automatic purchases, or inference of the other member's private brand list. Use explicitly declared shopping preferences, not restricted financial data, unless permitted use is confirmed.
- Zapier: export only member-authorized plan details needed for the chosen destination. Confirmation is destination- and payload-specific. Signed events and dedupe prevent repeated emails/calendar entries. No PayPal credentials, private histories or matching vectors in Zapier. Don't implement core capture/refund through an LLM-controlled generic MCP action.
- KERNEL: never scrape PayPal, banks, logged-in purchase histories, private social accounts or sites that prohibit the task. Use allowed public venue pages or BaePal's own test site; respect access controls. Keep replay logs free of private finance/profile data. Opening hours are a researched suggestion, not a reservation guarantee.

## 6. End-to-end member journey and screens

Retain the original social screens; add the following journey:

1. **Welcome:** explain purchase-interest matching in plain language. “You choose what counts. Other members won't see your transactions.” Also clarify that the server processes authorized inputs; don't claim server-blind encryption.
2. **Source choice `/taste/connect`:** Try synthetic history, Enter interests, or view gated integration details. PayPal login is separate. Show provenance prominently throughout the demo.
3. **Consent `/taste/consent`:** separate matching, publicly shared explanation tags, hosted-AI processing and optional commercial recommendations. All are off until selected. Provide a viable declared-interest alternative. Explain source limits and revocation effects; terms are not a blanket consent switch.
4. **Import status `/taste/imports/:id`:** queued, validating, processing, ready, partial, failed, revoked. Show readable row counts and exclusions without dumping financial data. Retry uses the same job identity.
5. **Private review `/taste/review`:** merchant/category mapping, provenance, confidence, recurring grouping and exclusion toggle. Correct category, mark gift/business/shared purchase or exclude all from a merchant. Owner can preview how exclusions affect the summary before publishing.
6. **Taste profile `/taste/profile`:** editable evidence-backed interest chips, broad brand affinities opted in, coarse rhythm descriptors, data coverage and feature-version timestamp. Public profile gets only approved tags, not a finance dashboard.
7. **Discover:** explain up to three specific, mutually shareable overlaps. Example: “You both enjoy hiking and independent cafés.” Show confidence as insufficient/moderate/strong evidence with scope, not “94% chance of love.”
8. **Why this match `/matches/:id/why`:** explain approved common categories, differences as neutral discussion starters, evidence limits, and controls to change future matching. No exact individual purchases, dates, values or merchant lists from the other person.
9. **AI date planner:** ask for shared activity, explicit availability and each member's private budget. Retrieve eligible options, display reasons, propose, mutually accept, then PayPal checkout.
10. **My insights `/insights`:** owner-only AG Studio workspace with correction controls; natural-language queries restricted to personal non-sensitive aggregates.
11. **Shared calendar `/dates/calendar`:** Bryntum plan view; paid status from verified payment evidence; availability supplied independently.
12. **Optional gifts `/shared-interests/shop`:** clearly distinct from matching and powered by declared commercial preferences. Channel3 results are external retailer discovery unless BaePal truly has sell/checkout authority.
13. **Permissions `/settings/data`:** list source, consent purposes, provider processing, expiry and “Stop using purchase data.” Revocation disables related features immediately and purges raw data, vectors, caches, explanations and pending jobs according to the verified policy. Preserve only separately necessary payment records with scoped access.

Every new screen inherits the master prompt's keyboard, mobile, loading, empty, validation, unauthorized, offline and failed-provider states. A graceful fallback must not masquerade as a functioning sponsor or real history connection.

## 7. Data pipeline and interpretation

Implement typed adapters for SyntheticPurchaseProvider, DeclaredPreferenceProvider and an initially disabled AuthorizedPayPalHistoryProvider. The real provider requires capability checks; no automatic execution just because an environment key exists.

Normalize eligible inputs to a private schema:

`id, ownerId, sourceType, sourceRecordKey, sourceAccountScope, occurredAtUTC?, sourceTimezone?, timePrecision, merchantRaw?, merchantCanonical?, category?, itemDescriptors?, amountMinor?, currency?, direction, status, refundReference?, evidenceConfidence, exclusionReason?, consentVersion, importId`.

Raw fields stay quarantined/owner-only and must obey source-specific retention. Avoid ingesting fields not needed for matching, especially addresses, counterpart email, payment method, balances and financing information. An export's merchant name usually does not establish which product was purchased. Missing item details remain missing. A marketplace or department store is low-specificity evidence.

Processing stages:

- Validate source/provenance and consent before processing and again before publishing derived state.
- Validate file/type/size and schemas for any permitted future import. No arbitrary URL imports, formulas executed from CSV or spreadsheet macros. Sanitize cells in downloadable exports.
- Deduplicate using documented stable record/event keys, not transaction ID alone; account for provider records representing multiple event types. Detect refunds/reversals and link corrections rather than treating both sides as two hobbies.
- Exclude transfers, balances, withdrawals, fees, taxes, loan/debt/credit payments, cash equivalents and unknown ambiguous non-purchase events.
- Exclude purchases that reveal or could strongly imply health, religion, political affiliation, sexual life/orientation, disability or similarly sensitive traits. Never infer romantic preferences from purchases; collect those explicitly. Ambiguous merchants default to excluded or owner review, not model guesswork.
- Exclude gifts, work purchases and shared-account events when identified; allow member correction since a receipt doesn't prove personal interest. A shared PayPal account is not a verified individual.
- Canonicalize merchant aliases using an allowlisted mapping and confidence threshold. LLM category proposals are reviewable, never verified facts. Unknown merchants map to unknown.
- Aggregate within-person category shares, optional brand frequency, purchase-day rhythms, recurrence and category-relative ticket patterns with capped counts and recency decay.
- Publish only the approved feature version and remove obsolete search/vector artifacts. Jobs are idempotent, progress durable and revocation-aware.

Timing: coarse weekday/weekend and broad dayparts are weak purchase rhythms. Settlement or processing time is not an activity timestamp. If timezone is unknown, don't create daypart features. Do not infer salary day, live location, home/work schedule, availability or vulnerability from a large-spend time. Show only owner-approved coarse rhythms.

Amounts: favor shares/counts over absolute spend, cap the influence of outliers, and never compare wealth or infer income/debt/creditworthiness. Start USD-only. Mixed currency records are excluded from monetary aggregation unless a verified rate/date pipeline exists. Normalized category shares can change with income and incomplete coverage; disclose that limitation.

Minimum evidence policy, configurable and stated as a prototype heuristic: at least 20 usable purchases across 30 days to activate evidence-based ranking. Below this, use declared interests and label low evidence. Use at most the recent 180-day fictional window by default; real retention is source/permission specific and may be much shorter. Don't use “180 days” to override provider restrictions. Never auto-retain derived data indefinitely.

## 8. AI and matching algorithm

Runtime AI is central: (1) map ambiguous permitted synthetic merchant descriptors into reviewable categories, (2) embed approved lifestyle descriptors for candidate retrieval, (3) generate evidence-grounded match explanations, and (4) suggest date activities. At least one configured model must actually execute for the submitted AI demonstration; deterministic fallback keeps the app usable but is not evidence of real model use. Identify embedding and generative models separately.

Pipeline:

A. Apply server-side hard dating eligibility first: age/adult status, reciprocal declared preferences, geographic settings, account visibility, block/unmatch/suspension and active matching consent. Money never overrides these rules.
B. Build a fixed-version feature vector from non-sensitive, member-approved inputs. No raw text or transaction table in embeddings. Separate public explanation tags from private ranking features.
C. Query Elastic with structured eligibility constraints plus vector/keyword retrieval over allowed lifestyle descriptors. Fetch only bounded candidates, then revalidate eligibility against PostgreSQL. A missing consent or stale feature version removes the candidate regardless of search rank.
D. Rerank symmetrically with a documented baseline. Example weights for comparable supported pairs: category similarity 0.40; approved brand affinity 0.15; coarse spending rhythm 0.15; relative discretionary category patterns 0.10; semantic lifestyle similarity 0.20. Both members choose which feature families can be used; disabled/unsupported families are omitted and remaining weights renormalize. Common feature support determines a separate evidence grade; one enabled feature must not be called strong evidence.
E. For numeric nonnegative category/brand distributions use bounded cosine or documented Jensen-Shannon similarity. For normalized finite daypart histograms use `1 - JSD/log(2)` with consistent log base and missing-data handling. Categorical recurrence can use bounded overlap. Add deterministic tie breakers and a small controlled exploration fraction among eligible comparable candidates.
F. The overall 0–1 heuristic is a ranking score, not a probability, quality score, financial-suitability score or relationship outcome. Keep raw scoring internal. User-facing percentage labels, if ever used, must say profile-pattern overlap and disclose their heuristic nature; prefer plain-language common ground.
G. Explanation service receives only mutually permitted overlap tags and an evidence summary. Validate every sentence against those tags. It may mention shared book/coffee interests; it may not invent exact purchases or disclose an unshared brand. Neutral differences are optional discussion prompts, not warnings about character.
H. Member corrections trigger a versioned rebuild/reindex and update subsequent ranking. Existing friendships/matches need not disappear simply because a hobby signal changed; blocks and consent revocation are handled separately.

Future purchase likelihood is a bounded, experimental category-interest forecast. Optional output is “You might enjoy more outdoor experiences,” with confidence and evidence; not a claim to know the next item, transaction time or spending amount. Avoid it for real restricted data without permission. No target advertising from this output. Consent, eligibility and financial authorization remain deterministic server rules outside the model.

Evaluate against a declared-interest baseline using synthetic known-interest fixtures plus voluntary human judgments. Report retrieval relevance and explanation faithfulness, not invented romantic-success rates. Test that multiplying all of one member's amounts by ten does not improve desirability, and that deleting a single outlier doesn't reverse a stable profile. Brand affinity can proxy socioeconomic status; audit that effect and allow category-only ranking.

## 9. PayPal's central business role

Build two real flows in Sandbox:

**Flow A: date experience purchase.** Approved shared interests produce a date proposal; both accept the same version and individually choose to approve their own ticket purchase with PayPal. Use the master prompt's server-calculated amounts, bound order ownership, independent operations, verified capture evidence, webhook inbox, idempotency, compensation and refund rules. The demo merchant supplies fictional tickets; no false live venue booking claims.

**Flow B: optional one-time BaePal planning pass.** If time permits, sell a clearly specified digital planning benefit through separate PayPal Checkout, e.g. a fictional $4.99 Sandbox pass. Benefits, price and refund policy are explicit. Server grants the entitlement only after verified completed capture; repeat webhooks cannot grant multiple passes. This is a one-time purchase, not an undisclosed subscription. Safety and privacy controls stay free.

PayPal is central because it executes the demonstrated purchase-to-shared-activity loop and maintains the authoritative provider evidence for charges/refunds. Future approved history access can strengthen the input side. The hackathon submission must honestly say synthetic purchase evidence is used for matching if that is what exists; it must not claim real consumer PayPal-history ingestion.

Keep a future reporting adapter for the exact account scope available. Do not reuse BaePal merchant sales data as though it represents each buyer's external purchases. Historic reporting can lag and must not determine realtime fulfillment where capture evidence is available. Verify current endpoint scope, pagination/window limits and event semantics during implementation.

## 10. Schema, API and event additions

Extend rather than duplicate the original data model. Required entities:

- DataSourceConnection: ownerId, type, capabilityStatus, accountScope, provenance, approvalReference nullable, disabledReason.
- DataConsent: ownerId, purpose, sourceId, version, activeFrom, revokedAt, processingPolicyVersion.
- PurchaseImport: ownerId, sourceId, state, idempotencyKey, record counts, encrypted object reference, expiresAt.
- PurchaseEvidence: private normalized record, exclusion state, confidence, consentVersion and allowedRetentionUntil.
- MerchantAlias and CategoryTaxonomy: versioned mappings, sensitivity classification, confidence and reviewer attribution.
- PurchaseCorrection: ownerId, evidenceId, action, old/new safe values, timestamp.
- LifestyleFeatureVersion: ownerId, version, safe category/brand/rhythm feature families, evidence counts, approved tags, consent/policy version, expiresAt.
- MatchEvidence: canonical pair, featureVersions, algorithmVersion, score components, allowed explanation inputs and expiry; no raw receipts.
- SponsorExecution: provider, capability, mode, requestId, redacted result pointer, duration, error and evidence status; no private payload dumping.
- CommercialConsent: separate member-declared recommendation purpose and selected preference tags, with revocation.
- Optional Entitlement: ownerId, productId, verified paymentId unique, status and expiry.

REST additions (all owner-checked, typed and CSRF protected for mutations):

| Route | Action |
| --- | --- |
| GET /api/v1/taste/capabilities | Report available/disabled source modes accurately |
| POST /api/v1/taste/demo-imports | Start selected synthetic dataset import; idempotent |
| POST /api/v1/taste/consents | Save granular purposes/version; no implicit public sharing |
| GET /api/v1/taste/imports/:id | Owner's progress and safe counts |
| GET /api/v1/taste/evidence | Owner-only bounded private review records |
| PATCH /api/v1/taste/evidence/:id | Correct/exclude with expectedVersion |
| POST /api/v1/taste/rebuild | Enqueue current consent-version rebuild |
| GET /api/v1/taste/profile | Owner's approved summary and evidence grade |
| PATCH /api/v1/taste/profile/sharing | Select allowed public explanation tags |
| DELETE /api/v1/taste/consents/:id | Revoke use immediately and enqueue complete deletion |
| GET /api/v1/matches/:id/explanation | Participant-scoped mutually shareable overlap only |
| POST /api/v1/ai/date-suggestions | Retrieve eligible catalogue options and grounded reasons |
| POST /api/v1/insights/query | Owner-scoped aggregate questions; allowlisted operations |
| POST /api/v1/commerce/product-suggestions | Declared commercial preferences + opt-in only |
| POST /api/v1/automations/preview | Exact proposed destination and payload |
| POST /api/v1/automations/confirm | Single-use confirmation ID + idempotency key |

Events: consent.changed/revoked, purchase.imported, evidence.corrected, lifestyle.rebuilt, search.reindexed, explanation.invalidated, date.confirmed, payment.completed and refund.completed. Workers must check current consent before each external call and before persistence; stale jobs cannot resurrect deleted data. Delete covers database, object storage, embeddings, Elastic, caches and externally retained artifacts under verified provider controls. Do not promise instant erasure from immutable backups; document backup expiry and access restrictions.

## 11. Delivery order and feature flags

Phase 1: preserve original social app; synthetic import + review + consent + real AI extraction/embedding + Elastic retrieval + safe explanation; real PayPal Sandbox create/approve/capture/refund; Render run path; Postman and APIMatic development evidence. Astropods is the preferred hosted runtime if configured. If blocked, use a documented actual model adapter temporarily and state Astropods not yet integrated.

Phase 2: owner-only AG Studio insights and Bryntum date calendar. They are strong visible sponsor additions once the matching-to-payment journey works.

Phase 3: Channel3 declared-interest product discovery, Zapier explicit plan handoff and KERNEL public venue research. They are separate optional features with verifiable API executions. Do not allow their failures to block a match, chat, payment receipt or refund.

Flags: TASTE_SOURCE_MODE, REAL_HISTORY_ENABLED=false, REAL_HISTORY_PURPOSE_APPROVED=false, AI_PROVIDER, ASTROPODS_ENABLED, ELASTIC_ENABLED, AG_STUDIO_ENABLED, BRYNTUM_ENABLED, CHANNEL3_ENABLED, ZAPIER_ENABLED, KERNEL_ENABLED, PAYPAL_MODE=sandbox, LIVE_DATING_PAYMENTS_APPROVED=false. Production fails closed if real data/live actions are enabled without verified permission/config. A flag alone is not evidence of actual approval.

For every sponsor provide setup steps, validated current docs, exact capability, actual package/API version used, credential names without values, license/trial dependency, fallback behavior and an execution-status entry. Statuses are planned, implemented/mock-tested, implemented/provider-tested and blocked. No sponsor-complete checkbox without reproducible evidence.

## 12. Acceptance tests

Retain all original payment, social and security tests and add:

1. PayPal login success does not set history capability to connected.
2. Gated history provider cannot run without approved purpose/account scope; no user-token/credential workarounds.
3. Synthetic data is labeled in UI, exported examples and demo description; no fallback hides a failed real fetch.
4. Sensitive/ambiguous categories, gifts, business expenses, transfers and reversals don't affect matching.
5. Missing product details and timezone do not produce invented goods or timing features.
6. Different records with the same transaction ID/event variants are handled without double-counting purchases.
7. Review corrections rebuild feature versions and visibly alter future match order in a seeded case.
8. Amount scale invariance, bounded outlier influence, mixed-currency handling and minimum-evidence rules hold.
9. Blocked/ineligible/paused/revoked members cannot leak through Elastic retrieval, stale caches or explanation endpoints.
10. Public profile, explanation, logs and sponsor requests contain no unapproved private purchase details.
11. Consent revocation wins races against a running import/rebuild/AI/index job and clears derived artifacts.
12. Prompt injection in merchant strings/CSV/bios cannot change tool permissions, expose data or call payment functions.
13. Actual configured AI runs and provider/model identity are recorded; deterministic fallback does not count as AI evidence.
14. Channel3 retail links are never represented as completed PayPal orders; buyer consent and seller authority checks hold.
15. AG Studio questions cannot access another member or raw DB; calendar changes invalidate date acceptances.
16. Zapier requires a confirmed payload and cannot double-send; KERNEL cannot access financial sessions.
17. All original PayPal amount/ownership/replay/webhook/refund race invariants pass after these changes.
18. Public repository includes a root open-source license, synthetic fixtures, complete run instructions, provider disclosures and no secrets/proprietary assets.

## 13. Judge demo under three minutes

- 0:00–0:20: Problem and differentiation. “Profiles describe who we hope to be. BaePal explores common ground in the activities we choose to buy.” Show synthetic evidence label immediately.
- 0:20–0:45: Import a fictional profile's purchases, approve interest chips, exclude a gift and show the summary change.
- 0:45–1:15: AI + Elastic recommend an eligible adult with explainable coffee/books/outdoors overlap. Contrast a matched pair with a deliberately different seeded profile; don't claim scientific validation.
- 1:15–1:45: Match, open chat, ask the AI planner for a date, choose actual availability and private budgets, mutually accept.
- 1:45–2:20: Create and approve PayPal Sandbox checkout, show server-verified capture/receipt; make clear whether each ticket has paid. Display a refund or pending case if ready.
- 2:20–2:40: Show one useful visible sponsor feature: private AG Studio insights or Bryntum calendar. Mention development tools accurately in the tools disclosure, not a ten-logo tour.
- 2:40–2:55: Commercial thesis and limits: optional planning utilities + permitted experience revenue; real automatic history access is a future authorized integration.

Deliver a hosted demo or clean runnable setup, source, assets with rights, an honest implemented-feature matrix, secret-free Postman collection, sponsor execution evidence, model disclosure, sample dataset documentation and a public YouTube URL. A prompt, mocked login, static frontend or fake success receipt alone is not the required working prototype.

## 14. Source register and fact boundaries

Reviewed official hackathon sponsor resource pages for all ten sponsors and these PayPal primary sources on 9 November 2026. Integration assignments, ranking weights, revenue scenarios and UX are proposed BaePal design decisions, not sponsor endorsements or verified commercial outcomes.

PayPal:
- https://developer.paypal.com/log-in/how-it-works/
- https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/reporting_transactions_v1.json
- https://developer.paypal.com/api/transaction-search/v1/search-get
- https://developer.paypal.com/api/make-api-requests/
- https://developer.paypal.com/platforms/overview/
- https://www.paypal.com/us/legalhub/paypal/xdeveloper-full
- https://www.paypal.com/us/legalhub/paypal/acceptableuse-full

Sponsor resource pages:
- https://paypalaihackathon.devpost.com/details/elastic
- https://paypalaihackathon.devpost.com/details/astropods
- https://paypalaihackathon.devpost.com/details/render
- https://paypalaihackathon.devpost.com/details/apimatic
- https://paypalaihackathon.devpost.com/details/postman
- https://paypalaihackathon.devpost.com/details/aggrid
- https://paypalaihackathon.devpost.com/details/bryntum
- https://paypalaihackathon.devpost.com/details/channel3
- https://paypalaihackathon.devpost.com/details/zapier
- https://paypalaihackathon.devpost.com/details/kernel

Start implementation by reading the original master prompt and this addendum, inspecting the actual code, identifying an executable Phase 1 slice and then building it. Do not let optional sponsor breadth displace a reliable AI-matching-to-PayPal-payment demonstration.
