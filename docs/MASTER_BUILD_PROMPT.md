# BaePal — Founder and Full-Stack Engineering Master Build Prompt

Version 1.0 · 9 November 2026 · Target repository: baepal_paypalhackathon

## 0. Your role and required outcome

Act as the founding full-stack engineer, product lead, and pragmatic technical cofounder of BaePal. Apply the product judgment expected from engineers familiar with swipe-based dating, prompt-led profiles, mutual matching, realtime chat, trust and safety, and payment checkout. Use Tinder and Hinge as familiar interaction references; do not claim employment at either company, access to their proprietary systems, or knowledge of their private algorithms. Create an original product and original implementation.

Build a mobile-first responsive web application for adults seeking intentional relationships, with optional professional account connections and a considerate path from matching to planning a real date. The differentiator is private budget coordination and explicit, voluntary payment for a date experience. It must feel like a dating product, not a recruiting dashboard, payment terminal, or static collection of screens.

Implement working vertical slices. Do not stop after a plan, wireframe, static frontend, generated component inventory, or simulated checkout success. Persist state, enforce permissions on the server, and test the failure paths described below. If execution time runs short, finish the P0 flow and document unimplemented P1/P2 items honestly. Never describe a mock provider as a live integration.

The current repository package contains specifications, not an implemented application. Your task is to create the application from these specifications.

## 1. Product thesis and assumptions

BaePal helps people meet with more context and less awkwardness: discover someone, respond to something meaningful, match, talk, agree on a date both can afford, and voluntarily purchase a date experience through PayPal Sandbox.

Adopt these explicit defaults unless the owner changes them:

- Audience: adults 18+, initially a Seattle pilot; all genders and orientations supported through reciprocal preferences.
- Relationship intentions: long-term relationship, marriage-minded, or exploring intentionally. Intentions are self-described, not guarantees.
- Professional details are optional context. Students, freelancers, unemployed people, and people without LinkedIn/GitHub must have a complete usable experience.
- Everyone is a member. Remove the ambiguous seeker/partner role split in the uploaded source. Administrative roles are member, moderator, and admin; a romantic partner is not an elevated system role.
- Launch format: mobile-first web/PWA-ready shell, not simultaneous native iOS/Android apps.
- Initial payment currency: USD; store and calculate integer cents. No wallet, stored balance, loans, escrow, cash-out, partner-to-partner transfers, or financial account access.
- Payment assumption: a deliberately labeled demo merchant sells fictional date-experience tickets in Sandbox. BaePal is not claiming to book real restaurants or represent third-party merchants.
- AI proposes choices and drafts text. It never impersonates members, sends messages, accepts invitations, or initiates payment without the relevant person's explicit action.
- Start with one coherent architecture. Do not implement both MERN and PostgreSQL, both Redux and Jotai, or Bitbucket/Harness alongside GitHub Actions.

Success is a reliable journey from signup to an accepted date and confirmed Sandbox ticket purchase, including a demonstrated cancellation/refund path.

## 2. Reference use and source boundaries

Use the following sources as context, with the limitations recorded in docs/REFERENCES.md:

1. Uploaded `Pasted markdown.md`: primary brief for professional context, profiles, verification center, discovery, matching, chat, privacy, moderation, Next.js/TypeScript, Jotai/SASS, Node.js/Postgres and workspace organization. Resolve its conflicting examples in favor of this master prompt.
2. https://groundui.dev/mobile-app-categories/dating : requested visual inspiration. The exact page could not be fetched during preparation. Do not invent observations about its screenshots or copy paid templates. Inspect it when accessible, record which examples were actually viewed, and use original assets unless reuse rights are verified.
3. https://github.com/emmanyouwell/dating-app-frontend : inspected package manifest, README and recursive tree on master, tree commit b50b1b0ec3c3cc83cb657592e94b498f83bd35a4. Observed Next.js/React/TypeScript, Radix components, forms, Socket.IO client, and route/component organization for auth, match, profile and chat. The observed manifest uses Redux; that is a reference choice, not a requirement. This review did not establish backend correctness, full functionality, a reuse license, or production readiness. Use it as structural inspiration, not a dependency to clone blindly.
4. https://dev.to/collins87mbathi/building-a-dating-app-with-mern-478h : a beginner tutorial for React cards and Express/MongoDB connectivity. It includes nonfunctional swipe-button examples and outdated scaffolding. Learn the simple frontend/API separation; do not reproduce its code, stack mistakes, permissive CORS, outdated setup, or unauthenticated database access.
5. https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 : current source for LinkedIn OIDC. Account connection is not identity verification. Do not assume employment, headline, positions, or company APIs are accessible through basic sign-in scopes.
6. https://developer.paypal.com/api/make-api-requests : source for Sandbox/live separation, server authentication and PayPal-Request-Id. Recheck current Orders, refunds and webhook documentation before implementation.

At implementation start, check official framework/provider documentation, select compatible maintained releases, pin them in manifests and commit a lockfile. Do not interpret reference versions as mandated or automatically safe. Keep a dependency decision note. Verify source licenses before copying code, screenshots, icons, photos or paid UI assets. No source implementation is bundled in this package.

## 3. Scope and release gates

### P0 — hackathon-complete vertical slice

- Accessible app shell, landing page, terms/privacy placeholders clearly marked as drafts, and demo banner.
- Email signup/login, email confirmation, secure session, resumable adult onboarding and profile editing.
- Profile photos, prompts, preferences, discovery, like/pass, reciprocal match and working matched chat.
- Account connection center with real provider adapters where credentials exist; labeled development adapters otherwise.
- Block/report and moderator review, plus pause, logout, account export and delete workflows.
- Date planning from a match, independently entered private budgets, deterministic venue/experience suggestions, invitation revisions and mutual acceptance.
- PayPal Sandbox create/approve/capture, durable receipts, independent ticket purchases, cancellation/refund handling and webhook reconciliation.
- AI date planner behind a provider interface with deterministic fallback; no automatic execution.
- Seeded adult demo users and a scripted two-person demonstration.
- Automated checks for access control, matching races, budget privacy, payment retries, blocking and core browser flows.

### P1 — complete after P0 works

- Likes-you inbox, attaching a comment to a particular prompt/photo, undo last pass, advanced optional filters.
- Delivery/read preferences, typing indicators, notification preferences, email reminders and calendar download.
- Full photo moderation provider, moderator appeals, step-up login for sensitive actions, configurable session management.
- Paid one-time premium pass via a separate PayPal product if useful; never mix premium fees with date-ticket money.
- Contact-hiding through consensual methods only; do not upload an address book by default.

### P2 — explicitly deferred

Native apps, video/audio calling, subscriptions, cross-currency purchases, live merchant inventory, multiparty merchant onboarding, end-to-end encrypted messaging, licensed identity verification, advanced ML ranking, fraud scoring and family-managed profiles. Do not include dormant buttons suggesting these features work. Do not market TLS messaging as E2EE.

## 4. Brand, layout and interaction system

Name: BaePal. Treat the name as a working hackathon name; do not imply PayPal affiliation or trademark clearance. Voice: warm, direct, adult, respectful. Suggested line: “A good connection deserves a good first date.” Avoid “AI-powered love,” compatibility guarantees, fake testimonials and fabricated member counts.

Design an original calm interface: warm ivory #FBF8F5, ink #242021, muted rose #B44D64, soft lavender #E9E2F2, and a separately tested accessible success/error palette. Verify actual contrast rather than assuming these tokens pass everywhere. Use readable sans-serif body text and an optional restrained serif for short headings. Use a consistent 4/8px spacing scale, 16–24px card radii, subtle borders, and clear hierarchy. Photographs are prominent; career metadata is secondary. No salary, employer prestige, attractiveness scores, or public trust scores.

Mobile navigation: Discover, Likes, Chats, Dates, Profile. Desktop: a compact side rail and centered content; messaging/date coordination may use two panes. Support 360px to wide desktop without horizontal overflow. Keep checkout totals and primary action visible without covering content or the keyboard. Touch targets at least 44px; forms use labels, visible focus, clear instructions and appropriate input modes.

Shared primitives: Button, IconButton with accessible name, Input, TextArea, Select, Dialog, Drawer, Tabs, Badge, Skeleton, EmptyState, ErrorState, Toast, Avatar, PhotoCarousel, Money, DateTime, ConfirmDialog and OfflineBanner. Use semantic HTML. Provide non-swipe like/pass controls; all functionality works by keyboard. Respect reduced motion and screen readers. Swipe gestures must not hijack page scrolling. Never communicate state only by color.

For EVERY screen specify and implement loading, empty, success, validation failure, network failure, unauthorized, expired session, narrow viewport and keyboard states where relevant. Every visible action has a real handler, disabled explanation, or explicit unavailable label. Use inline form errors; toasts supplement rather than replace them. Persist important server state; never pretend an optimistic mutation succeeded when it failed.

## 5. Route and screen contract

| Route | Content and actions | Important states |
| --- | --- | --- |
| `/` | Brand, product explanation, How it works, safety link, Sign up, Log in, Try demo | Session-aware CTA; no public member directory |
| `/auth/signup` | Email, password, confirmation, adult/terms acknowledgment, submit | Duplicate email uses neutral response; password rules; pending send |
| `/auth/login` | Email/password, show password, forgot password, optional provider sign-in | Rate limited, invalid credentials, suspended account |
| `/auth/verify` | Code input/paste, resend countdown, change email | Expired, used, incorrect, attempts exhausted |
| `/auth/reset` | Request reset and token redemption steps | Generic request result, expired token, password updated |
| `/onboarding/[step]` | Progress, next/back, save/exit, optional-step skip | Draft restored, validation, underage rejection |
| `/discover` | Candidate cards/list toggle, filter drawer, like/pass, open profile | No candidates, location denied, request rollback |
| `/people/[id]` | Eligible member detail, photo carousel, prompts, badge meanings, like/report/block | Unavailable without leaking why; blocked/private member |
| `/likes` | P1 incoming likes/comments, accept or dismiss | Empty, already matched, deleted profile |
| `/matches` | New matches and conversation entry | No matches, unavailable match |
| `/chats` | Conversation list, unread count, search within own list | Offline, loading, empty |
| `/chats/[id]` | History, composer, send/retry, date CTA, mute, unmatch, report/block | Reconnecting, failed send, closed match |
| `/dates` | Upcoming, pending invitations, past plans, cancelled plans | No plans, contribution payment pending |
| `/dates/new?matchId=...` | Private constraints, public venue suggestions, time and invitation builder | No overlap, unavailable experience, stale quote |
| `/dates/[id]` | Current plan version, accept/decline/propose change, budget edit, checkout links, cancel | Awaiting other member, revision invalidation, financial reconciliation |
| `/checkout/[purchaseId]` | Your ticket, merchant demo label, price/fees, cancellation terms, PayPal button | Approval cancelled, processing, pending, failure, completed |
| `/payments/[id]` | Own receipt, order/capture reference, refund history, support | Pending, partial refund, refunded, disputed |
| `/profile` | Own profile preview, completion status, edit, verification link | Paused, incomplete profile |
| `/profile/edit` | Fields, photos/reorder/delete, prompts, save/cancel | Unsaved changes, upload failure, moderation pending |
| `/settings/verification` | LinkedIn/GitHub connect/disconnect, work email challenge, badge privacy | Provider not configured, denied consent, duplicate link |
| `/settings/preferences` | Reciprocal discovery settings, optional values, distance and age | Invalid ranges, denied geolocation |
| `/settings/privacy` | Visibility, employer/repository sharing, read/activity preferences, pause | Confirm public-field changes |
| `/settings/account` | Password, sessions, export, delete, logout | Reauth, pending financial obligations, export expiry |
| `/settings/notifications` | In-app/email categories; browser permission only on request | Permission denied, saved changes |
| `/safety` | Safety guidance, reporting explanation, payment scam warning, support | Always accessible |
| `/admin/reports` | Assigned report queue with filters and status | Role denied, empty queue |
| `/admin/reports/[id]` | Minimal necessary evidence, notes, dismiss/warn/suspend/restore/escalate | Step-up auth and audit; concurrent edit |
| `/admin/payments` | Restricted operational reconciliation and refund requests | Admin only; no member dating details by default |

Deep links after login return only to allowlisted internal routes. Never put session tokens, private budgets or provider secrets in a URL.

## 6. Account lifecycle and onboarding

Account status: pending_email → onboarding → active; active ↔ paused; active/paused → suspended or deletion_pending → deleted. Enforce allowed transitions in one server service. Verification is a separate state and must not silently reactivate a suspended account.

1. Sign up with normalized email and securely hashed password using a maintained password-hashing library. Do not trim or transform password content. Enforce a reasonable minimum length and allow password managers/paste.
2. Generate a cryptographically random email challenge; store a keyed hash of a six-digit code, ten-minute expiry, five-attempt limit and 60-second resend cooldown. Invalidate older challenges when resending. Rate-limit by account and IP; do not log codes.
3. Verify contact email before activating discovery. Do not claim this verifies legal identity or age.
4. Collect date of birth privately; calculate age server-side using a documented calendar rule. Reject under-18 users and clear their onboarding data according to retention policy. Do not publish birth date. Age gate is self-declaration, not verified proof of age.
5. Collect display name, pronouns optional, gender self-description and discoverable gender preferences, intention, city/manual location, bio, interests, at least two approved photos, and two answered prompts.
6. Work/education, faith, family plans and lifestyle fields are optional with visibility controls and “prefer not to say.” Never infer these fields.
7. Offer provider account connection as a skippable step. Explain exactly what each connection proves.
8. Collect age range with minimum 18, distance and dealbreakers; distinguish hard filters from preferences.
9. Preview the exact public profile. Activation checks required fields, email confirmation and photo status; saves atomically.
10. Resume at the first incomplete required step on next login. Back preserves drafts. Save/exit never publishes an incomplete profile.

Sessions use opaque random IDs backed by hashed server-side session records and HttpOnly/Secure cookies. Use SameSite=Lax for OAuth redirect compatibility, strict allowed redirect URIs, CSRF protection for mutations and exact CORS origin allowlists. Rotate on login and privilege change, expire sessions, support revocation, and never store authentication bearer tokens in localStorage. Protected routes check session and account status on the server, even if the client has a route guard.

Reset password uses single-use hashed high-entropy tokens and generic request responses; invalidate existing sessions after reset. Logout revokes the current session and disconnects sockets. Sensitive settings require recent authentication. Notification emails reveal no dating content in their subject by default.

## 7. Profile and media details

Display name 2–50 characters; bio up to 500; prompt answer up to 250; up to six photos and ten interests. Validate Unicode text and length consistently; render as text, not raw HTML. Store birth date, email, exact location and professional provider IDs outside public profile DTOs.

Photo flow: choose → local preview → upload authorization → quarantined storage → file signature/size/dimension validation → re-encode and strip EXIF → moderation → approved derivative. Allow JPEG/PNG/WebP; maximum 10MB input and bounded dimensions/decompression. Do not allow arbitrary SVG/HTML uploads. Originals remain private and expire; expose only approved derivatives through authorized short-lived URLs or a controlled media service. Crop/reorder are accessible actions. Failures support retry/remove and never publish a broken image. Removing the primary photo selects the next approved photo. A rejected upload has an explanation/appeal path; never fabricate a moderation-provider result.

Public professional context is member-selected: role, industry, company and a maximum of three selected public repository links. Hide work email, provider IDs, exact working location and internal provider metadata. Do not import private repositories or publish connections automatically. Changing/removing a prompt targeted by a like preserves a safe snapshot or marks it unavailable.

## 8. Connection center and honest badge semantics

Provider state: disconnected → pending → connected; pending → failed/expired; connected → disconnected/revoked. Show last checked time and scope of evidence. Separate “email confirmed,” “LinkedIn connected,” “GitHub connected,” and “work email confirmed.” No universal “safe” or “identity verified” badge.

LinkedIn: use provisioned OIDC scopes openid/profile/email; validate state, nonce, issuer, audience, expiry and signature with current provider discovery/JWKS. Request only approved scopes. Basic sign-in is not employment validation. No positions scraping; professional details remain self-reported unless a separately authorized verification product is implemented.

GitHub: use server-side OAuth and minimum scopes; bind callback state to the current session and operation. Store provider user ID with a uniqueness constraint. Do not merge accounts solely because email text matches. Require reauthentication to link to an existing account. Public repository selection requires user confirmation. GitHub control does not prove professional skill or legal identity.

Work email: send a distinct keyed-hash OTP challenge with the same TTL/attempt/cooldown controls. A business-domain policy can reject known personal/disposable domains but cannot prove employment. Offer a fallback for small organizations and freelancers. Reconfirm after 180 days as a configurable product policy; expire badge without deleting the account. Keep full address private. Changing address removes old evidence until reconfirmed.

Disconnect requires confirmation and recent authentication. Do not remove the last usable login method. Clear tokens and badges, stop future provider fetching, and preserve only permitted audit metadata. Encrypt retained provider tokens and prefer discarding them when ongoing access is unnecessary. Production must never silently substitute demo verification.

## 9. Discovery, likes and matching

Eligibility is a server-side predicate: both adults with active visible complete profiles, reciprocal gender/orientation and hard age preferences, permitted geographic range, neither blocked either direction, no closed/active duplicate pair, and not self. Pause removes future discovery; existing matches remain usable unless blocked/suspended. Exact coordinates are never returned. Support manual city if geolocation is denied; do not silently broaden a hard filter.

Use cursor pagination with opaque signed cursors and stable tie-breakers. Recheck eligibility on every action, not just fetch. Changing filters invalidates the query cache; empty results offer explicit edit-filter actions. Do not expose private contact data to enable employer or email enumeration.

Baseline ranking is deterministic and explainable: eligible candidates get a bounded score from shared declared interests, aligned intentions, optional shared values and broad activity recency. Example weights: interests 40%, intentions 35%, declared lifestyle overlap 25%; normalize available categories and document ties. No score from salary, employer prestige, spending, GitHub activity or purchase history. Professional connections may be a user-selected filter, not an implicit worth score. Do not label a heuristic as scientific compatibility.

Like/pass mutations accept a clientMutationId and create one directed decision per pair. A like optionally targets a photo/prompt with an optional short comment. UI removes the card optimistically, disables repeat submission and restores the card on confirmed failure. Retry after uncertainty uses the same mutation ID. Distinguish persisted response from a local animation.

When two likes exist, transactionally create exactly one match using canonical lowUserId/highUserId and a unique pair constraint. Create one conversation and an outbox event in the same transaction. Concurrent reciprocal likes must not create duplicate matches or notifications. Match screen offers Send a message or Continue browsing.

Pass hides the candidate. P1 undo can reverse only the most recent eligible pass within a documented time window; never undo blocks, another person's decision or a closed match. Unmatch requires confirmation, immediately closes messaging and cancels unfunded plans; financial records remain accessible privately. Reporting remains possible after unmatch.

## 10. Messaging and notifications

Only participants in an active match can retrieve/send chat. Socket connection and each room subscription require server authorization; never trust a room ID supplied by a client. Use cookie-authenticated Socket.IO with origin checks and account-status validation. Redis adapter is optional until multiple API instances are deployed.

Each send carries clientMessageId, conversationId and text. Validate participant, block status, match status, length 1–2000, rate limits and content policy; persist before acknowledging and broadcasting. Unique (senderId, clientMessageId) provides retry safety. Messages have monotonically increasing conversation sequence for cursor catch-up. UI states are queued/sending/sent/delivered/failed; delivered means an authorized recipient client acknowledged receipt, not merely that the server persisted it. Read receipts are opt-in and use a monotonic read watermark. Never retroactively expose reads when disabled.

Reconnect retrieves history after last confirmed sequence, deduplicates by server message ID and orders by sequence. REST fallback polling uses the same authorization/cursor semantics. Preserve composer text during network loss but do not durably store sensitive chat in shared browser storage. Do not auto-send an offline draft after session expiry. Typing is ephemeral, throttled and expires after five seconds; presence obeys privacy settings.

P0 chat is text plus structured date invitation/status cards. No arbitrary attachments or money requests between members. Warn about suspicious payment links with transparent wording; a warning is not a fraud verdict. Opening external links uses safe link handling. AI icebreakers are editable drafts requiring Send. Blocking evicts socket rooms and invalidates caches immediately.

Notification events: match.created, message.created, date.invited, date.revised, date.accepted, payment.completed, refund.updated and moderation.updated. In-app records are durable and deduplicated by event/recipient. Use an outbox worker for email; retries use capped exponential backoff and dead-letter review. Never include another member's budget, email or private professional data in notifications.

## 11. Private budget and date-planning workflow

This is a product-level privacy promise enforced by DTOs, authorization and tests, not by pretending normal encryption hides data from the server. The application server can access budgets. Do not claim FHE or server-blind processing. Only the budget owner and the suggestion service can access the exact input; the other member, moderators, analytics, logs and AI provider cannot. Admin access requires a separately audited exceptional support process, not default UI visibility.

1. A member in an active match chooses Plan a date. Select activities, accessible public venues, preferred neighborhoods, time windows and a private maximum total spend for their own ticket. The other member receives a neutral invitation to add preferences, never a guessed income bracket.
2. Store each person's budget separately. Show only “Your budget is saved” and whether both have supplied preferences. Do not show the other number or identify who constrained a recommendation.
3. Limit attempts and recommendation refreshes to reduce probing of someone's budget. Explain that recommendations can still allow indirect inference; do not promise perfect secrecy.
4. Use an explicitly fictional seeded catalogue: demo merchant, activity, public venue, accessible features, opening times, duration, ticket price including configured tax/fees, availability and cancellation policy. No fake live booking claims.
5. Default equal split means each buys one ticket at the same all-in price; a two-ticket experience at $60 total means a $30 order for each person. Eligible suggestion requires each ticket price to fit that person's budget. Optional “I treat” requires the payer's explicit agreement and budget check for both tickets; never pressure the recipient or expose the payer's budget.
6. Deterministic filtering checks both budgets, selected hard activity/accessibility constraints, opening hours, availability and shared time windows. If no option fits, offer free public-date ideas or explicit preference edits without naming the limiting person.
7. AI may rank/summarize only already eligible catalogue results using sanitized interests and a server-computed allowed price ceiling/category; do not send raw budgets or private chats. Final validator rejects invented IDs, prices, times, accessibility claims and links.
8. Proposal shows venue, public address, local date/time and timezone, duration, total all-in price, each person's exact charge, payer mode and cancellation terms. Each person can accept, decline or propose a change. Acceptance is consent to the plan, not permission to charge.
9. Store versioned proposals. Any material edit to time, venue, price or payer shares invalidates both acceptances and all not-yet-approved checkout attempts. Use optimistic concurrency via expectedVersion. Notify the other participant once per revision.
10. Only after both accept the same current version may each member initiate their own PayPal checkout. Before create and capture revalidate the plan, actor, amount, currency and quote expiry.
11. Confirmation requires both independent tickets paid, or a completed explicitly agreed two-ticket purchase. One successful charge never means both are paid. Do not share payer names/emails from PayPal with the romantic partner.
12. Save UTC timestamps plus the IANA plan timezone, show both viewers the same instant and zone, and explicitly handle DST ambiguous/nonexistent times. Generate ICS only on request; member alone decides whether to share it.
13. Before any payment, either member can cancel. After a payment, cancellation begins financial reconciliation/refunds according to the displayed terms. If the second payer abandons checkout, expire the plan at a configured deadline and request refund for the first successful payment. This is a compensating workflow, not atomic split settlement.
14. Allow check-in and post-date private feedback without location tracking or forced sharing. No public rating of people, penalties for declining, no-show fines, or payment for access to another person.

Date states: draft → collecting_preferences → proposed → accepted → payment_pending → confirmed → completed. Proposed may become declined/expired/cancelled. A material revision creates a new version and returns to proposed. Any post-payment cancellation marks cancelled plus a separate financialState of reconciliation_pending/refund_pending/refunded/refund_failed. Date state and payment state are separate; never compress them into a misleading “cancelled, money returned” label.

## 12. PayPal integration and financial invariants

Keep three provider modes: mock (development only), sandbox (real PayPal test environment) and live (disabled by default). Display the mode prominently on checkout and receipts. Production refuses to boot with mock adapters or placeholder secrets. Sandbox never takes real money. Live launch is a separate operational decision with merchant, policies and provider approval verified.

Implement a server PaymentProvider interface: createOrder, getOrder, captureOrder, refundCapture, getRefund and verifyWebhook. Store credentials only on API server; only the public SDK client ID may reach the browser. Use current official Orders v2 guidance. Never collect raw card numbers, CVV or PayPal credentials.

Checkout flow:

1. Server computes current ticket price, fees, currency, seller and purchase ownership from an immutable accepted plan snapshot. Client sends purchaseId and idempotency key, never a trusted amount or seller.
2. Create a local payment attempt before calling provider; use a stable PayPal-Request-Id for that exact create operation. Capture and refund each have their own stable operation key. Same local key with a different payload returns conflict.
3. Create provider CAPTURE order in Sandbox. Bind returned order ID to the local payment/purchase and expected payee. A user cannot submit another person's order ID.
4. Client uses the official checkout approval UI. Cancel returns to checkout with no success or charge claim.
5. On approval, client asks server to capture. Server checks current session, ownership, current plan acceptance/version and order status. It captures with idempotency, verifies completed capture amount/currency/payee against expected values, and persists capture reference once.
6. Mark paid only from verified provider evidence. Client redirect query parameters or onApprove invocation alone are not payment evidence. If provider says pending, display pending; don't issue fulfilled tickets.
7. Timeout after a potentially successful call becomes unknown/reconciling. Retry safely with original operation ID or query provider status. Do not create a fresh charge to recover a timeout.
8. Verify webhook signatures through the provider-supported method and configured webhook ID; do not accept arbitrary certificate URLs or unsigned JSON. Deduplicate unique provider event IDs and check the event belongs to this merchant/environment/order. Persist inbox record before durable processing, acknowledge promptly, and use retries/dead-letter states.
9. Handle out-of-order events with explicit transition guards and provider reconciliation. A late approval cannot overwrite a refunded capture. A capture that completes during cancellation must be recorded and routed to refund, not discarded.
10. Refund against the capture, not the order. Check refundable balance under a lock; support full/partial amounts, provider pending states and duplicate callbacks. Only successful provider evidence marks a refund completed. Refund total must never exceed captured total.
11. Receipt shows member's own purchase amount, currency, merchant demo label, date/experience, status, fees and refund timeline. Show only a neutral paid/not-yet-paid flag for the partner. Support tickets receive redacted identifiers.
12. Reconciliation worker revisits unknown/pending operations and webhook failures. Alert on amount mismatch, unexpected seller, duplicate capture IDs and repeated refund failure. Maintain an append-only financial event record and audit access.

Do not label authorizations, delayed capture or independent purchases as escrow. Do not implement Payouts, multiparty splits or subscription products without checking separate eligibility and consent. The P0 two-order design can succeed partially; make compensation visible and test it.

Payment state: created → approval_pending → approved → capture_pending → completed; approval_pending → cancelled/expired; capture_pending → pending/failed/unknown; unknown/pending → reconciled result. Refund state is a separate entity: requested → pending → completed/failed, permitting multiple partial refunds. Disputes remain separately tracked and never silently overwrite history.

## 13. AI behavior, boundaries and fallback

Implement AIProvider.suggestDates(input) and draftIcebreaker(input). Make deterministic adapters the default without credentials, explicitly labeled “Suggested using your preferences.” A configured real AI provider must be disclosed; never fabricate model outputs or claim a model ran when it did not.

Allowed date-planner input: selected public interests, desired activities, broad neighborhoods, permitted time slots and eligible catalogue options. Excluded: work/contact email, OAuth tokens, exact coordinates, private budgets, private chat, gender/faith/health inference, payment records and moderation evidence. Treat bios and catalogue text as untrusted input, not instructions. System instructions require JSON constrained to allowed IDs; parse with Zod, validate against server eligibility and use deterministic fallback on timeout, malformed response or invented option.

Return up to three suggestions with brief factual reasons tied to declared preferences, all-in ticket cost and accessible feature provenance. Do not expose chain-of-thought, infer attraction or give a probability of relationship success. Icebreakers use public prompts only, remain editable and require manual send. Never auto-contact anyone. Rate-limit cost and token budgets; use bounded timeouts, redacted structured logs and a provider circuit breaker. No AI decision can ban a member, approve a refund or charge a card.

## 14. Architecture and repository layout

Use pnpm workspaces and TypeScript throughout. Suggested stack: Next.js App Router + React; Jotai for small local cross-component UI state; TanStack Query for server state; React Hook Form + Zod for validation; Radix accessibility primitives; SASS modules and CSS variables for design tokens; Node.js with Fastify API; PostgreSQL + Prisma; Socket.IO for realtime; optional Redis for rate limits/jobs/pubsub; S3-compatible object storage for private media; transactional email adapter; PayPal provider; AI provider.

Use a same-origin reverse proxy `/api` and `/socket.io` to the Node service for cookie simplicity. Next server rendering must forward only appropriate user cookies to the trusted API origin. Do not run permanent sockets inside ephemeral serverless route handlers. Keep public landing server-rendered and private member screens uncached across users. No search engine indexing of profiles. Build a service layer shared by REST and socket authorization.

Target structure:

```text
apps/web/src/app/          routes, layouts, loading/error boundaries
apps/web/src/features/     auth, onboarding, profile, discover, chat, dates, payments, safety
apps/web/src/components/   original reusable primitives and layout
apps/web/src/atoms/        filters drawer, onboarding UI, composer UI; no auth secrets
apps/web/src/styles/       tokens.scss, globals.scss, component modules
apps/api/src/modules/     auth, accounts, profiles, connections, discovery, matches,
                          conversations, dates, purchases, payments, reports, notifications
apps/api/src/providers/   email, media, moderation, linkedin, github, paypal, ai
apps/api/src/workers/     outbox, inbox, reconciliation, retention, exports
apps/api/src/lib/         db, session, crypto, config, authorization, observability
packages/contracts/       shared Zod schemas, DTOs, errors and event payloads
packages/ui/              shared accessible presentation components if reused
prisma/                   schema, migrations, synthetic seed fixtures
infra/local/              docker compose for postgres, redis, private object storage
scripts/                  seed, reset-demo, verify-docs, deployment helpers
.github/workflows/        lint, typecheck, tests, build and secret checks
```

This package is documentation-first; create executable manifests, migrations, adapters, tests and deploy files while implementing. Do not add empty Terraform/Harness/Bitbucket frameworks to appear enterprise-ready. Start with one web service, one API/worker service and a managed database/object store. Record later scaling decisions when measurements justify them.

## 15. Database schema requirements

Use UUID IDs; timestamps UTC; explicit foreign keys; bounded text; DB constraints plus service validation; soft deletion only where retention requires it. Private data and public views are intentionally separate.

| Entity | Required fields and constraints |
| --- | --- |
| User | id, normalizedEmail unique, passwordHash nullable, status, role, emailConfirmedAt, createdAt, deletionRequestedAt |
| Session | hashedToken unique, userId, expiresAt, revokedAt, lastAuthenticatedAt |
| EmailChallenge | userId, purpose, addressDigest, codeHash, expiresAt, attempts, consumedAt; no raw code |
| ProfilePrivate | userId unique, birthDate, precise/coarse location inputs, professional visibility choices |
| Profile | userId unique, displayName, bio, intention, city, optional declared values, publishedAt, version |
| Photo | ownerId, privateStorageKey, derivativeKey, orderIndex, moderationStatus, dimensions, createdAt |
| PromptAnswer | id, userId, promptKey, answer, version |
| Preferences | userId unique, ageMin>=18, ageMax>=ageMin, genders, distanceKm, hardFilters, softPreferences |
| ProviderConnection | userId, provider, providerSubject, scope, state, checkedAt, expiry; unique(provider, providerSubject) |
| WorkEmailEvidence | userId, encryptedEmail, domain, confirmedAt, expiresAt, status |
| Decision | actorId, targetId, action, prompt/photo reference optional, comment optional, mutationId; unique actor/target |
| Match | lowUserId, highUserId, status, matchedAt, closedAt; unique canonical pair; low<high |
| Conversation | id, matchId unique, lastSequence |
| Message | id, conversationId, sequence, senderId, clientMessageId, text, createdAt; unique sender/clientId and conversation/sequence |
| ReadWatermark | conversationId, userId, lastReadSequence, lastDeliveredSequence |
| Block | actorId, targetId, createdAt; unique directed pair; deny either direction |
| Report | reporterId, subjectId, category, optional restricted evidence snapshot, state, assignedModeratorId |
| DatePlan | matchId, creatorId, status, financialState, currentVersion, expiresAt |
| PrivateDatePreference | planId, userId, encryptedBudgetCents, currency, timeWindows, activities; unique plan/user |
| DateProposal | planId, version, catalogueId, startsAtUTC, timezone, snapshot price/policy, payerMode; unique plan/version |
| DateAcceptance | planId, version, userId, acceptedAt; unique plan/version/user |
| CatalogueExperience | id, demoMerchantId, public venue data, perTicketPriceCents, fee/tax cents, policyVersion, availability |
| Purchase | planId, proposalVersion, buyerId, quantity, amountCents, currency, immutableSnapshot, status |
| Payment | purchaseId, attempt, providerMode, orderId unique nullable, captureId unique nullable, expectedAmount, state |
| PaymentOperation | paymentId, operationType, idempotencyKey, requestHash, providerRequestId, result, status; unique operation key |
| Refund | paymentId, amountCents, providerRefundId unique nullable, state, reason, operationKey unique |
| FinancialEvent | paymentId, type, sourceEventId, redactedPayload, occurredAt; append only |
| WebhookInbox | provider, environment, eventId, verificationStatus, processingStatus; unique provider/env/eventId |
| OutboxEvent | aggregateType, aggregateId, eventType, payload, attempts, availableAt, processedAt |
| Notification | userId, eventId, category, readAt; unique user/event |
| PrivacySettings | userId unique, activity/read switches, company/repo visibility, discoverable |
| AuditLog | actorId, action, resourceType/id, reason, redacted change, timestamp; restricted append-only |
| ExportJob | userId, state, storageKey, expiresAt; downloadable only by requester after reauth |

Indexes: active discovery filters and stable cursor, decisions actor/target, messages conversation/sequence, match participants/status, dates match/status, payments state/updatedAt, outbox availableAt/status, report state/createdAt. Use transaction locking for match creation, proposal revision/acceptance, purchase eligibility and refund totals. Network calls occur outside long database locks with operation records to coordinate retries. Use transactional outbox to bridge DB writes and external effects.

## 16. API and event contracts

Prefix REST with `/api/v1`; JSON requests and DTOs; ISO timestamps; integer cents plus ISO currency. Response shape `{data, meta?}`; error `{error:{code,message,fieldErrors?,requestId}}`. Never return stacks, secrets or raw provider responses. Use 400 validation, 401 unauthenticated, 403 role/consent denial, 404 unavailable resource, 409 version/idempotency conflict, 422 business constraint, 429 throttled and 503 provider unavailability. Unknown payments may return 202 with polling status.

All authenticated mutations need session and CSRF validation unless they are verified provider callbacks. Path IDs never substitute for authorization. Paginated routes accept a bounded limit and opaque cursor. Publish actual OpenAPI from schemas and validate response redaction.

| Method/path suffix | Input / response | Rules |
| --- | --- | --- |
| POST /auth/signup | email, password, adult/terms acknowledgment → generic continuation | Throttle; no account enumeration |
| POST /auth/login | email, password → safe session user | Rotate session; set cookie |
| POST /auth/logout | empty → success | Revoke current session/socket |
| POST /auth/email/request, /confirm | purpose + email or challengeId/code | Cooldown, expiry, attempt counter |
| POST /auth/password/request, /reset | email or token/newPassword | Single use; revoke sessions |
| GET /me | safe current account, onboarding and privacy state | Never provider tokens |
| PATCH /me/profile | expectedVersion + edited fields | Owner; no role/status mass assignment |
| PATCH /me/preferences | typed reciprocal settings | Owner; age floor |
| POST /me/photos/upload, /complete | validated metadata / authorized key | Owner and quarantine pipeline |
| DELETE /me/photos/:id | empty | Owner; completion check |
| POST /connections/:provider/start | operation login/link + allowed returnTo | State/session bound |
| GET /connections/:provider/callback | provider code/state | Server exchange; safe redirect |
| DELETE /connections/:provider | recent-auth proof | Retain usable login method |
| POST /connections/work-email/request, /confirm | address or challenge/code | Separate evidence from identity |
| GET /discover | cursor, allowlisted filters | Server eligibility and redacted cards |
| GET /people/:id | empty | Same visibility predicate |
| POST /decisions | targetId, action, comment/target optional, clientMutationId | Recheck eligibility; dedupe |
| GET /matches | cursor → safe match list | Participants only |
| DELETE /matches/:id | reason optional | Participant; financial compensation rules |
| GET /conversations/:id/messages | after/before sequence | Match membership; blocked denied |
| POST /conversations/:id/messages | text, clientMessageId | Persist/ack once; same as socket |
| POST /conversations/:id/read | sequence | Read setting and monotonic update |
| POST /date-plans | matchId → draft | Active match only |
| PUT /date-plans/:id/private-preferences | own budget/time/activity | Owner-scoped; no partner input |
| POST /date-plans/:id/suggestions | expectedVersion → eligible options | Redaction; probe rate limit |
| POST /date-plans/:id/proposals | optionId, startsAt, payerMode, expectedVersion | Server price; reset consent |
| POST /date-plans/:id/accept, /decline | proposalVersion | Participant; current version |
| POST /date-plans/:id/cancel | expectedVersion, reason optional | Coordinate financial compensation |
| POST /purchases | planId, proposalVersion, selected permitted quantity | Server derives buyer/share |
| POST /payments/orders | purchaseId, idempotencyKey | Server computes money and merchant |
| POST /payments/:id/capture | idempotencyKey | Owner, matching bound provider order |
| GET /payments/:id | own status/receipt | Owner or scoped payment admin |
| POST /payments/:id/refund-requests | reason, permitted amount | No arbitrary peer refund execution |
| POST /webhooks/paypal | provider event and signature headers | Verify, inbox dedupe, async processing |
| POST /blocks, DELETE /blocks/:targetId | targetId or path | Owner; close access immediately |
| POST /reports | subjectId, category, message IDs, notes | Reporter access; evidence minimized |
| GET /notifications, POST /notifications/:id/read | cursor or empty | Owner only |
| PATCH /me/privacy, /me/notifications | allowlisted booleans | Owner; durable |
| POST /me/pause, /me/resume | empty | Completion/status checks |
| POST /me/export | recent authentication | Private expiring job |
| DELETE /me | recent authentication + confirmation | Hide immediately; financial retention isolated |
| GET /admin/reports, PATCH /admin/reports/:id | queue or expectedVersion/action/reason | Moderator/admin; audited scope |
| GET /admin/payments, POST /admin/payments/:id/refunds | filters or amount/reason/key | Payment admin; step-up; audit |

Socket client events: conversation.subscribe, conversation.unsubscribe, message.send, message.delivered, conversation.read, typing.start/stop. Server events: message.created, message.receipt, match.created, match.closed, date.updated, notification.created, access.revoked, error. Envelopes include eventId, schemaVersion, aggregateId, timestamp and typed payload. Use ack timeouts and server replay for durable messages; ephemeral typing is not replayed.

## 17. Safety, privacy and moderation

Block is immediate: server denies discovery, profiles, chat REST/socket and future invitations in either direction; revoke subscriptions and cached data. Existing financial receipts remain privately reachable through purchase ownership only. Block never automatically forfeits a payment or creates a fine. Unblock does not recreate a closed match or resend messages.

Reporting supports impersonation, harassment, spam/scam, inappropriate content, underage concern and other. Preserve only needed evidence with restricted access; reporter can report a former match without needing current message access. Never notify the subject of reporter identity. Moderator actions require reasons, role checks, minimal evidence and audit trail. Acknowledge receipt and expose neutral progress; do not promise 24/7 human review in a hackathon demo.

Account deletion immediately disables discovery and sessions; schedule deletion/anonymization of dating data according to documented policy. Keep only required financial/audit records with restricted access for an explicitly configured retention period. Do not invent a universal legally required duration. Export excludes other users' private inputs, raw tokens, hidden moderation notes and internal secrets. Signed download links expire; export jobs and object-store cleanup are retryable.

Encrypt data in transit and managed storage, encrypt particularly sensitive fields with versioned application keys and separate key access, and redact logs/analytics. Do not put OAuth codes, OTPs, chat text, private preferences or payment payloads in error logs. Use least privilege for DB/object storage and backend operators. Protect media endpoints against SSRF, oversized files and unsafe URLs. Use CSP, safe rendering, dependency scanning and exact-origin CORS. Build server schemas against mass assignment and SQL injection using parameterized ORM access.

Optional identity/selfie verification is P2 and needs a real provider, explicit consent and retention design. Do not implement facial recognition or claim photo moderation verifies someone's age or identity. Professional connections and payment completion never confer safety guarantees.

## 18. Deployment, configuration and operations

Provide `.env.example` with placeholders only: DATABASE_URL, REDIS_URL optional, APP_ORIGIN, API_ORIGIN, SESSION_SECRET, FIELD_ENCRYPTION_KEY, EMAIL_PROVIDER/MODE, EMAIL_API_KEY, EMAIL_FROM, object-storage endpoint/bucket/keys, LINKEDIN_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET, PAYPAL_MODE, PAYPAL_CLIENT_ID/SECRET, PAYPAL_WEBHOOK_ID, AI_MODE/KEY/MODEL, DEMO_MODE and retention/expiry settings. Validate config at startup and fail clearly on missing required live-mode values. Do not prefix server secrets with NEXT_PUBLIC_.

Implement localhost setup with documented ports, health/readiness endpoints, migrations, seed/reset and web/API workers. Use local email capture in development and clearly labeled synthetic OTP paths. Never commit secrets, provider credentials, real member profiles or payment data. `.gitignore` includes env files except examples, node_modules, build output, uploads, logs and exports.

CI must install from the frozen lockfile, lint, typecheck, run unit/integration tests against isolated DB, build web/API and run meaningful browser smoke tests. Verify artifacts contain no demo secrets or debug logs. Deploy migrations as a separate step with rollback/forward-repair guidance; no destructive automatic schema push in production. Run the API on a persistent process capable of sockets and jobs. Use TLS and a trusted reverse proxy. Readiness checks DB/provider config without triggering chargeable operations.

Log requestId, route, outcome and timing, without private payloads. Track request latency, error rate, outbox lag, socket reconnects, pending payment age, webhook verification failures and refunds requiring review. Set initial measurement goals rather than claiming achieved performance: ordinary API p95 <500ms excluding providers, message persisted ack p95 <1s on a healthy regional network, mobile discovery usable in <3s on a representative test device. Measure and report actual results.

Before live release: verify provider permissions and merchant fit, test backups/restore, real moderation staffing, cancellation/support policies and privacy/security review. The build agent can finish Sandbox without inventing those operational approvals.

## 19. Acceptance tests and adversarial scenarios

Write tests against observable behavior and financial invariants, not snapshots that merely mirror implementation. P0 is not complete until these pass or are explicitly reported blocked.

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| AUTH-01 | Fresh adult signs up, confirms email, leaves onboarding and resumes | Draft restored; no discovery before completion |
| AUTH-02 | Under-18 DOB, invalid range, reused or expired OTP | Rejected server-side; bounded attempt counter |
| AUTH-03 | Logged-out request, missing CSRF, reset reuse, revoked session socket | Denied; no unauthorized mutation |
| CONN-01 | Wrong OAuth state/nonce, duplicate provider identity, denied consent | No account merge; clear recoverable state |
| CONN-02 | LinkedIn connection succeeds with no employment data | Only accurate connection badge; optional work fields remain editable |
| MEDIA-01 | Disguised HTML/SVG, huge dimensions, EXIF coordinates | Rejected/re-encoded; metadata never public |
| MATCH-01 | Simultaneous reciprocal likes and repeat retries | Exactly one match, conversation and notification per user |
| MATCH-02 | Gender/age/distance hard preferences and paused member | All reciprocal constraints enforced on read and write |
| CHAT-01 | Nonparticipant guesses conversation/room/message ID | No data, subscription or send access |
| CHAT-02 | Disconnect after persistence before ack; retry same client ID | One message; reconnect catch-up correct |
| SAFE-01 | Block while another tab has chat open | REST and socket denied immediately; caches refreshed |
| SAFE-02 | Unmatch/report after payment | Chat closed; report possible; own receipt available |
| DATE-01 | Each participant saves private budget | Partner DTO, logs, analytics and AI request contain no raw other budget |
| DATE-02 | No shared budget/time overlap | Neutral explanation, free alternatives, no limiting-person label |
| DATE-03 | Edit proposal after one/both accept | Old consent and checkout invalidated; expectedVersion conflict works |
| PAY-01 | Each member buys own $30 Sandbox ticket for $60 plan | Two independent verified captures; confirmation only when both paid |
| PAY-02 | Client tampers with amount/currency/orderId/buyer/payee | Server rejects or ignores; authoritative totals preserved |
| PAY-03 | Double click create/capture and network timeout after success | No duplicate charge; same operation replays/reconciles |
| PAY-04 | onApprove without capture, pending capture, cancelled approval | No false completed receipt or ticket fulfillment |
| PAY-05 | Invalid signature, duplicate/out-of-order webhook | Rejected/deduped; no invalid regression |
| PAY-06 | First pays, second abandons; plan expires | Compensation requests refund; refund status remains pending until evidence |
| PAY-07 | Concurrent partial refunds and replayed callbacks | Sum <= captured; provider operations deduped |
| PAY-08 | Cancellation races with completed capture | Capture retained and compensation scheduled, no orphaned charge |
| AI-01 | Timeout, injected bio instruction, malformed JSON, invented venue | Safe deterministic eligible suggestions; no autonomous action |
| PRIV-01 | Export/delete with other-member private input and outstanding refund | Correct ownership/redaction; visibility revoked; financial handling retained |
| ADMIN-01 | Member opens moderator/payment route; moderator accesses raw budgets | Role denied; payment role scoped; exceptional access audited |
| UX-01 | 360px, keyboard, reduced motion, screen-reader labels, network failure | Core journey accessible; no dead controls or false optimistic success |

Use Vitest for domain logic, API integration tests against real isolated PostgreSQL, and Playwright with two browser contexts for signup/match/chat/date flows. Mock provider responses for deterministic negative tests. Separately run real Sandbox create/approve/capture and webhook verification when credentials and callback reachability are configured. Report mock tests and actual Sandbox evidence separately; one does not prove the other.

## 20. Seed data and judge demonstration

Create at least 16 fictional adult profiles with varied genders, intentions, career circumstances, industries, interests and preferences. Use synthetic names and licensed/synthetic clearly labeled photos. No scraped profiles or real social identities. Include reciprocal candidate pairs, no-results case, pending report, blocked pair, failed message, no-budget-overlap plan, pending payment, cancelled/refunded plan and an unavailable connection provider.

Demo reset is local/staging only, never publicly exposed or destructive to production. Demo auth/session switching is restricted and visibly labeled. Do not display secret OTPs in production UI.

Judge walkthrough:

1. Sign in as two fictional members in separate contexts and show public profile/accurate connection badge meaning.
2. Like a prompt, reciprocate and observe one shared match.
3. Exchange a persisted realtime message and reconnect to show continuity.
4. Each enters a private budget; show member-specific views and eligible date suggestions.
5. Propose and accept the same version; demonstrate an edit invalidates acceptance.
6. Each initiates and approves their own Sandbox purchase; show both paid before confirmation.
7. Demonstrate cancelled checkout, idempotent capture replay or pending status, and refund reconciliation using clearly labeled fixtures where provider events cannot be triggered live.
8. Block a member and demonstrate revoked chat while own receipt remains available.

Track privacy-safe metrics: onboarding completion, mutual matches, first messages, accepted plans, verified Sandbox payment completion and refund completion. Do not optimize for compulsive swiping, spending to gain visibility or willingness to pay as desirability.

## 21. Implementation order and required handoff

Work in dependency order and keep the app runnable:

- Milestone A: architecture notes, pinned dependency matrix, workspace, configuration validation, DB migrations, original app shell and seed.
- Milestone B: secure email auth, adult onboarding, media, safe public DTOs and profile settings.
- Milestone C: discovery, transactional match creation, authorized realtime chat, block/report and moderator queue.
- Milestone D: private preferences, deterministic catalogue suggestions, versioned date consent and proposal state machine.
- Milestone E: PayPal provider, purchase/order binding, capture/refund/webhook inbox, outbox and compensation worker.
- Milestone F: configured professional connection adapters, optional AI suggestions, notification and export/deletion jobs.
- Milestone G: full cross-user browser tests, payment failure tests, accessibility review, deployment setup and honest demo documentation.

After each milestone run relevant checks and summarize working behavior, evidence and blockers. Do not repeatedly ask the owner about routine reversible choices. Ask only when a missing product decision materially changes consent, costs, irreversible publication or paid/live behavior. Never ask the owner to paste secrets into chat; use provider/environment secret settings.

Deliver:

1. Runnable source with exact setup/run commands, lockfile, env examples, migrations and synthetic seed.
2. README with product concept, architecture, feature status and quick start verified from a clean environment.
3. API schemas/OpenAPI, state machines, permission map and financial invariants documented alongside implementation.
4. Test commands and actual results; screenshots of implemented screens without private data if useful.
5. PayPal Sandbox setup, webhook setup, test accounts and real-vs-mock evidence clearly distinguished.
6. Demo script, known limitations, operational dependencies and an explicit production-readiness gap list.
7. Commit meaningful increments in baepal_paypalhackathon. Do not overwrite unrelated code or publish live/payment changes without authorization.

Start by inspecting the repository, explaining the first vertical slice briefly, then implement. Finish the P0 journey before expanding P1. The standard is working and reviewable behavior, not a long feature list.