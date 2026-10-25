# Prepared shared-restock hybrid comparison

Status: approved by the user (“extend”) and completed. See
[results and post-run analysis](hybrid-comparison.md) for the verified comparison.

## Concrete run

One standalone private Coolify experiment runs all 120 decision ticks plus
closing on clean seed 23. Rules remains frozen. Jev, Zoom Standard and Zoom Pro
use unchanged v4 requests and the same shared restock safeguard after successful
model decisions. This is a hybrid-policy comparison, not raw model performance.

A selected WAIT is executed as RESTOCK only when the entire stock pipeline is
empty, RESTOCK is legal, and delivery/cooking leave at least ten service ticks.
Existing work and late waits are left alone. Rules fallbacks and forced waits
retain their own attribution and are not relabeled as model/guard decisions.

Every record contains the captured input, original provider result,
model-selected action, executed action, execution source and intervention reason.
Future model observations and recent-action history reflect the executed action.
The engine advances the resulting state; it never reuses a prerecorded model
choice after an intervention. Rules follows its own unchanged trajectory.

A dedicated experiment runner is used rather than silently writing guard actions
as model decisions into the existing live database schema. It uses the same
simulation engine, demand generation, provider adapters and retained cost ledger.
The report and per-tick checkpoints are stored on the Coolify retained volume;
this does not publish a new web-visible round. Checkpoints are atomically replaced
and flushed. A one-use lock plus ledger identity gate prevents automatic reruns.
Failures require inspection; no ledger reset, refund or automatic retry occurs.

## Approved budget

Current Jev reservations are $1.894064 against a $1.896817 cap: one call remains.
A full run requires at most 120 × $0.002753 = $0.330360 additional reservations.
The approved cumulative cap is therefore **$2.224424**, an increase of $0.327607
from the current cap. The existing $0.34 Jev per-run cap remains sufficient.

Zoom remains at $0.25 shared per run and $5 per campaign. At most 240 calls across
Standard and Pro allocate $0.240000. No other run is authorized by this plan.
These are maximum ledger reservations/operator allocations, not invoice amounts.

- Prepared run ID: `2a818689-d18d-4810-9d18-aeca4607cf42`.
- Expected prior records: 1,903.
- Previous allowed run: `cdeb4749-9f09-4276-b6e5-efff4d99158e`.
- Previous ledger hash: `bf633701e84ab4202d53bde186484eddc674bc4908736c91f2d9efc932cd4f8f`.
- Approval record: [fair-campaign-approval-hybrid.json](../providers/fair-campaign-approval-hybrid.json), now `approved`.

The runner checks approval before opening or amending the ledger. Its `--check`
mode validates configuration without dispatch. Running it without approval was
verified to exit with `hybrid-budget-approval-required` and no provider dispatch.

## Validation and post-run analysis

Thirteen tests and typecheck pass. Tests cover stock/cash/legality and timing
boundaries, supplier delay, non-WAIT decisions, fallback attribution, identical
behavior across model controllers, and all 120 ticks with recovery at tick 63.
The full-round fixture verifies that original WAIT remains in the provider record,
RESTOCK is separately attributed to the guard, and the next observation contains
the new pending order and executed history. The frozen Rules score is unchanged.
Fixture controller results are not predictions of real model behavior.

After an approved run, reconcile provider calls and exposure with the retained
ledger; replay executed actions; report interventions per model, profits,
utilities, customers served, cooking after replenishment, repeat orders and all
errors. Compare descriptively with the previous unguarded v4 seed-23 result,
acknowledging that model sampling may differ. Restore standby and remove inference
credentials after collecting the receipt.

Implementation: [hybrid-comparison.ts](../../scripts/hybrid-comparison.ts),
[run-hybrid-comparison.ts](../../scripts/run-hybrid-comparison.ts), and
[compose.hybrid-comparison.yaml](../../compose.hybrid-comparison.yaml).
