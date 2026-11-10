# Remaining date availability

The Node API samples the clock once when building catalogue options. The effective overlap starts at the latest of that sample and both saved availability starts; its end remains the earlier saved end. An experience is offered only when its whole duration fits the remaining overlap. Exact-duration fits remain eligible. Elapsed or disjoint windows return a neutral empty list without broadening either member's availability.

Future overlap bounds, reciprocal activity filters and private budget constraints are unchanged. Suggestions remain a point-in-time snapshot: a later proposal must still pass the existing future-start, overlap, plan-version and lifecycle checks. This change introduces no extra scheduling buffer or implicit consent renewal.

A configured external planner is not called when no eligible options remain; the existing integration adapter returns an empty result with no execution evidence. Eight PostgreSQL/API regressions cover elapsed/end-at-now windows, partial overlap, exact-duration and too-short remainders, future boundary/privacy behavior, disjoint windows and the no-network planner path. Six cases failed before this fix. Tests pin `Date.now` only; database/timer execution remains real.

This fixes #52 and progresses #5. Timezone/DST input workflows, invitation renewal and hosted adapter changes are outside this slice.
