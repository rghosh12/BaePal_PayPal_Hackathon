# Dependency and architecture decisions

Registry metadata was checked at implementation time for maintained Next.js, React, Fastify, Vitest, ESLint, typescript-eslint, Playwright and Prettier releases. All manifest dependency versions are exact; pnpm-lock.yaml records resolved transitive dependencies. Compatible versions were validated by TypeScript checks and both builds, not assumed from the reference application. A full vulnerability audit remains a release requirement.

| Component                  | Version                 | Decision                                                                                                                    |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node                       | 24.x (verified 24.22.1) | Maintained runtime; modern timeout/fetch primitives                                                                         |
| pnpm                       | 11.25.0                 | Workspace and frozen dependency lock                                                                                        |
| Next.js / React            | 16.4.6 / 19.3.1         | App Router shell with same-origin API rewrites                                                                              |
| Fastify                    | 5.12.8                  | Persistent API, auth hooks, bounded request bodies                                                                          |
| PostgreSQL                 | 17.6-alpine local image | Real transactions, locks, unique constraints and FK checks                                                                  |
| pg                         | 8.16.3                  | Parameterized SQL and explicit migrations/locking; selected over Prisma to keep financial transaction boundaries reviewable |
| Zod                        | 4.1.12                  | Runtime request validation and generated core OpenAPI input schemas                                                         |
| Argon2                     | 0.44.0                  | Maintained Argon2id password hashing; no hand-rolled password hashes                                                        |
| Socket.IO                  | 4.8.1                   | Persistent cookie-authorized messaging; polling transport used through Next proxy                                           |
| Sharp                      | 0.34.5                  | Bounded decode, rotation/re-encode and metadata stripping                                                                   |
| Vitest                     | 5.1.0                   | API/domain tests against isolated real PostgreSQL                                                                           |
| Playwright                 | 1.65.0                  | Authored two-context journey and narrow-screen smoke tests; not run here                                                    |
| TypeScript                 | 5.9.3                   | Strict application code                                                                                                     |
| ESLint / typescript-eslint | 10.14.0 / 8.72.2        | Maintained compatible lint stack                                                                                            |

Minimal local React state and same-origin fetch are used instead of adding Jotai, TanStack Query, React Hook Form or Redux before the core flow is verified. Plain CSS tokens are used instead of a SASS pipeline. The master prompt describes these libraries as a suggested stack; these choices preserve one coherent architecture. No simultaneous MongoDB/MERN stack, alternative CI platform, empty cloud infrastructure framework, or copied template is included.

Dependency installation permits native scripts only for Argon2, esbuild and Sharp. pnpm v11's automatic dependency install before scripts is disabled; installs remain explicit and reproducible. CI uses `pnpm install --frozen-lockfile`.
