# Retained prompt

User decision: “retain the previous prompt”.

Use **`action-criteria-prompt-1` with Jev `jev-1.13.0` and no safeguard** as the
retained candidate for future evaluations. Its implementation is
`buildActionCriteriaRequest` in
`packages/providers/src/action-criteria-experiment.ts`.

The recorded full seed23 round achieved $241 profit, 18,515 utility and 85 served,
with no empty-pipeline WAITs when RESTOCK was legal. This is the stronger observed
candidate, not a claim of general reliability across seeds.

`action-criteria-prompt-2` is rejected for promotion following its full-round
regression ($71 profit, -4,630 utility, 39 served, 61 empty-pipeline waits). Keep
its implementation and receipts only for reproducibility and analysis. Do not
select v2 for a future run without a new explicit instruction.

This selection does not replay a completed run or reset a ledger. Existing run
manifests are historical approvals, not reusable launch configurations. A future
run needs a fresh identity and sufficient authorized budget. The retained ledger
is at 2,817 attempts with $3.366919 Jev reservations against the $3.413720 cap;
Zoom is $1.596000.

Deployment remains healthy standby with inference credentials removed. Production
v4 has not been replaced: the selected action-criteria prompt is still a separate
experimental builder. This decision does not launch calls or deploy new behavior.

Evidence: [retained v1 full round](criteria-comparison.md),
[rejected v2 full round](criteria-v2-full.md).

The user-authorized published all-model repeat is now completed: see
[live retained-prompt results](live-retained-results.md). Jev repeated $241/85 served;
current ledger totals and standby evidence are in that report.
