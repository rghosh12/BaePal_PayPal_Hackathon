# Deployed prototype framework

**Private URL:** https://baepal-prototype.ruppakriki.chatgpt.site

This is the fast iteration prototype requested by the owner. It is deployed, backed by persistent storage, and useful for improving the core product. It is not a complete P0 release or a public dating network.

## Try the journey

1. Open the URL and sign in with the owning ChatGPT account. Choose **Explore the demo → Continue as Alex**. Use the top **Demo persona** selector to explicitly switch between Alex and Jordan.
2. Like the other persona from Discover, switch, and reciprocate. Open Chats, send a message, switch back, and see the saved conversation. Polling refreshes active chats/plans; data survives reloads.
3. Plan a date from the chat. Each persona independently saves a private budget, compatible activities and overlapping future times. Propose an option, and have both accept the same version.
4. Choose the paid art or coffee option to exercise checkout; the free walk is confirmed without payment. Each explicitly opens their own ticket checkout, creates a **mock** order and simulates capture. A first ticket leaves payment pending; both paid tickets confirm the plan.
5. Cancel the plan and inspect simulated refund receipts. Block/unmatch closes chat; your own receipts remain reachable from Profile.

The two personas are controlled by you for testing. Every choice is explicit; the server does not impersonate a real member. All catalogues/illustrations are fictional and all hosted payments/refunds are mock. There is no PayPal call or real booking in the hosted demo. Professional connections and photo uploads are explicitly unavailable. You can also create one personal prototype profile, using fictional information, without entering a separate email/password.

## What is deployed

- `apps/hosted`: React interface reused from the Next.js app, bundled into a self-contained Cloudflare Worker.
- Sites owns ChatGPT authentication and private access. API ownership comes from the platform-injected stable user ID, never a submitted email or ID.
- Each signed-in owner's prototype is a separate D1 workspace. A persona cookie selects a fictional actor only inside that namespace; it does not create a second real authentication system.
- The entire workspace state is encrypted with AES-256-GCM under `FIELD_ENCRYPTION_KEY`, held in Sites secret settings. Exact private budgets are returned only in their selected persona's DTO. The app server can decrypt them.
- D1 compare-and-swap versions serialize concurrent mutations and retry conflicts. Matching, retry-safe messages, proposal consent, independent mock captures and mock refunds are persisted atomically.
- Schema-only Drizzle migrations provision `prototype_workspaces`. Initial fictional data is generated at first authenticated use, not inside the migration.
- Request origins and persona-bound CSRF tokens are checked on mutations; participant and buyer ownership are checked server-side. Chat uses authorized polling instead of a permanent socket server.

## Improve the framework

```bash
pnpm install --frozen-lockfile
pnpm test:prototype
pnpm build:prototype
```

Edit the shared interface in `apps/web/src/components/BaePal.tsx` and styles in `apps/web/src/app/globals.css`. `node scripts/sync-hosted-ui.mjs` copies the shared interface/assets to the hosted app. Its Next.js navigation imports resolve to small browser-history adapters for hosting. Hosted API behavior lives in `apps/hosted/src/api.ts`; persistence/encryption/fictional seed lives in `apps/hosted/src/store.ts`.

For schema changes, edit `apps/hosted/db/schema.ts`, then run `pnpm --filter @baepal/hosted db:generate`. Commit new migrations; never rewrite migrations already applied to the Site. `apps/hosted/.openai/hosting.json` retains the exact Site identity and logical DB binding. Keep runtime secrets in Sites settings, not this file. Do not rotate the field key without a data/key migration: existing workspaces require it for decryption.

`node scripts/export-hosted.mjs` prepares a standalone Sites source checkout at `/workspace/sites/baepal-prototype`, preserving its Git metadata and Site identity. Install its pinned package manifest and lockfile, test/build it, then use the Sites source/version/deployment workflow to republish the same private Site. The artifact must contain `.openai/hosting.json`, `dist/server/index.js`, and the schema migrations. The current deployment's source Git remote is managed by Sites; the complete framework also lives in the user's GitHub repository.

## Limits kept deliberate

This owner-private prototype separates each owner's simulated environment. It is not cross-owner public member discovery. Real email/password auth, Argon2, media processing, realtime Socket.IO and the PayPal Sandbox adapter remain in the original local Node/PostgreSQL app. The hosting adapter offers a smaller self-contained deployment while those full-product requirements remain in the GitHub backlog.

Workspace state is capped at 2 MB and 2,000 messages; this is a prototype data model, not a scale architecture. Mock cancellation/refund is immediate and labeled simulated; it does not demonstrate actual provider reconciliation. Full notification/retention/moderation, advanced filters, public sharing, real payments and real-member data are outside this deployment. No production readiness claim is made.

## Verified evidence

- Native Sites publication succeeded and returned the URL above.
- Hosted D1 overview confirms `DB` and migrated `prototype_workspaces`.
- A private service-access request to `/api/v1/ready` confirmed live DB access; `/api/v1/config` confirmed hosted/mock/platform-auth/polling configuration.
- Hosted API tests run against real SQLite using the D1 statement contract; original integration tests run against real PostgreSQL. Browser evidence comes from GitHub Actions, separately recorded in VALIDATION.md.
