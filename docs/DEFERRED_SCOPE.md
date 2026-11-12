# Deferred scope and promotion policy

Issue #20 records a completed scope decision, not delivery of the features below. It is not a P0 release blocker. Implementation belongs in a new, specifically approved milestone after the working prototype's outstanding P0 gates.

Deferred: native iOS/Android apps; audio/video calling; subscriptions; cross-currency purchases; live merchant inventory and multiparty onboarding; end-to-end encrypted chat; licensed identity verification; advanced ML ranking/fraud scoring; family-managed profiles. No dormant control should imply that any of these capabilities works.

The current app offers web chat, fictional catalogue tickets and independent mock/Sandbox purchases. TLS is transport protection, not E2EE. Optional professional connections do not verify identity or employment. Two ticket purchases do not constitute escrow or a transfer between members. Catalogue suggestions do not book a restaurant. The verification screen and integration previews explicitly distinguish unavailable/configured functionality from verified execution.

Before promoting an item, its implementation issue must record the product benefit and member action, provider/account and licensing rights, required consent/data handling, and an operational plan with acceptance tests. Pricing, claims and visible controls must reflect implemented behavior. A connection key or a sponsor logo does not satisfy these requirements.

This scope record does not authorize live payments, biometric processing or publishing private deployments/recordings. The original API's production/live-mode guards remain in `apps/api/src/config.ts`; the hosted demo remains mock. A future scope change must explicitly update the applicable constraints and issue rather than silently turning on a placeholder.

Audit references: master prompt §3 P2; `docs/STATUS.md`; `apps/web/src/components/BaePal.tsx` landing, receipts and verification views; `IntegrationWorkspace.tsx` readiness/preview labels; original API configuration guards. The audit found no implemented claim of E2EE, escrow, live booking, licensed identity verification or native apps. This is a code/content scope audit, not a comprehensive visual or accessibility certification.
