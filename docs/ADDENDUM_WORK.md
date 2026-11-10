# Addendum implementation and GitHub work map

Source: [Spending Match Sponsor Addendum](SPENDING_MATCH_SPONSOR_ADDENDUM.md). The attachment is treated as product requirements; its role prompts and requests for sponsor approvals, account access or public video publication are not automatically executed.

## First vertical slice

The hosted prototype implements source capability gates, four separate opt-in purposes, synthetic import/review/correction, published feature versions, deterministic purchase-interest ranking, safe mutual explanations and immediate synthetic revocation. It preserves the existing social and mock payment flows. The original Node/PostgreSQL app is retained; its taste endpoints and external search/model workers are follow-on work.

Real PayPal history/export ingestion, live payments, sponsor SDKs and external automations remain disabled/unconfigured. No real AI/Elastic/Render execution is claimed. [Sponsor evidence register](SPONSOR_STATUS.md).

## Issues

- [#22 — [P0] Add fail-closed purchase-source capabilities and separate purpose consents](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/22)
- [#23 — [P0] Implement synthetic purchase import, normalization and private correction review](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/23)
- [#24 — [P0] Rank by reviewed purchase-interest features and expose safe mutual explanations](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/24)
- [#25 — [P0] Run real AI taste, embedding, explanation and planner adapters with evidence](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/25)
- [#26 — [P0] Add consent-versioned Elastic hybrid retrieval and privacy deletion](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/26)
- [#27 — [P0] Add Render deployment path for persistent API, jobs and verified callbacks](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/27)
- [#28 — [P0] Use APIMatic context tooling and validate generated API contracts](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/28)
- [#29 — [P0] Create and execute a secret-free Postman integration collection](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/29)
- [#30 — [P1] Add owner-only AG Studio insights with guarded aggregate questions](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/30)
- [#31 — [P1] Add Bryntum availability/calendar workflow with renewed date consent](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/31)
- [#32 — [P2] Add optional Channel3 discovery using declared commercial preferences](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/32)
- [#33 — [P2] Add preview-and-confirm Zapier plan handoffs with deduplication](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/33)
- [#34 — [P2] Add permitted KERNEL venue research with provenance and review](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/34)
- [#35 — [P0] Complete cross-provider consent revocation, retention and deletion races](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/35)
- [#36 — [P1] Add a separate one-time Sandbox planning pass entitlement](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/36)
- [#37 — [P0] Prepare sponsor execution register, honest submission matrix and demo assets](https://github.com/rghosh12/BaePal_PayPal_Hackathon/issues/37)

Existing #6/#7 continue to own real Sandbox checkout/refund correctness; this addendum does not duplicate them or treat mock capture as real evidence. #9 remains optional secondary professional context. #19 now covers account/safety refinements; actual runtime AI is a core requirement in #25. #13/#15/#21 retain their broader incomplete acceptance criteria.

## Developer workflow

Use a feature branch and a pull request with linked issues, tests and explicit evidence limits. Close implemented issues through the merged PR; keep partially completed or credential-blocked integration issues open. Preserve the current private Site audience and do not publish a video or enable financial/history actions merely because the attached brief requests them.

The first PR closes only #22–#24 after checks and review. Broader provider/AI/search/deployment and submission work remains tracked separately.
