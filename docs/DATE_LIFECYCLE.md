# Date planning lifecycle guards

Node API preference edits, proposal revisions and suggestions now share a planning guard. Cancelled, expired, confirmed and completed plans return `409 PLAN_CLOSED`. A consent deadline that has passed is rejected immediately, even before the background expiry worker changes the stored status.

This prevents a preference update from reopening a completed invitation, a proposal revision from reopening a confirmed free date, or suggestions from reaching a configured external planner when the invitation is already closed or elapsed at the planning check. Rejected edits preserve preferences, acceptances, proposals and version. The guard does not silently renew consent or rewrite terminal state; a new plan requires its normal agreement flow.

Active collecting-preferences, proposed and accepted flows remain available. Checkout restrictions still prevent changing a plan with existing payment operations. Proposal version conflicts retain the existing `VERSION_CONFLICT` response before the planning guard.

Twelve dedicated PostgreSQL regressions cover terminal preference edits, an API-confirmed free-date fixture, wall-clock expiry and configured planner calls; eight cases were observed failing before their fixes. Completed paid dates also reject cancellation without queuing refunds, and the domain cancellation transition excludes completed state for every caller. Cancelled/expired retries retain their no-op behavior.

This addresses #49 and progresses #5. It does not complete timezone/DST availability handling, invitation renewal, cancellation policy or distributed expiry processing. The hosted mock adapter is unchanged.
