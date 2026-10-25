# Current queue versus future demand treatment

The user approved the next diagnostic after timeline guidance left Jev choosing
WAIT. One new call per model used the same captured Jev tick-63 state, history,
option order and base v4 prompt, retained the explicit timeline, and added:

> Distinguish the current queue from future demand: all four customers currently waiting have patience deadlines before tick 78, so a newly ordered and cooked batch cannot save them. This does not mean future customers stop arriving. Stock made ready at tick 78 can serve later arrivals during the remaining peak ticks 78-89 and off-peak ticks 90-119. Evaluate expected final utility using the supplied public arrival rates across those future ticks, not only whether the current queue can be rescued. Future arrivals are uncertain; do not infer the hidden schedule or assume follow-up actions execute automatically.

The current customer deadlines are ticks 64, 67, 70 and 70, all before the earliest
newly replenished food could be ready at tick 78. The future-demand explanation
uses public rates and phases only, not the hidden realized arrival schedule.

| Model | Base v4 | Timeline only | Timeline + future demand |
| --- | --- | --- | --- |
| Jev | WAIT; P(RESTOCK) 16% | WAIT; 41% | **RESTOCK; 62%** |
| Zoom Standard | RESTOCK; 98.1263% | RESTOCK; 98.4575% | RESTOCK; 99.0441% |
| Zoom Pro | RESTOCK; 99.9718% | RESTOCK; 99.9792% | RESTOCK; 99.9578% |

All new calls succeeded without fallback or retry. Latencies were 296 ms for Jev,
520 ms for Standard and 558 ms for Pro.

## Interpretation

This is the first of these three matched-state conditions in which Jev selected
RESTOCK. The result is consistent with explicit separation of the expiring
current queue from future demand helping Jev value replenishment. It supports
further testing of this explanation, not a claim that its internal cause has been
proven or its full-round idle behavior fixed.

There was one call per model per condition; baseline and timeline results were
collected earlier. They were not randomized, contemporaneous repeated controls.
The displayed probabilities are provider-reported, not calibrated across models.
The combined treatment does not isolate a future-demand-only effect independent
of the timeline. No follow-up action was executed into a simulation, so this does
not establish improved profit or repeated restocking.

Before adopting a production prompt, validate across additional captured states,
including in-progress deliveries, no current queue, and near-closing states where
WAIT should remain sensible. The treatment is currently restricted to this
captured state, and its longer wording has not been approved as a global prompt
or tested across a new full live trajectory. It remains diagnostic-only; normal
production v4 behavior is unchanged.

## Verification and accounting

Four timeline/future-demand tests passed, along with typecheck and zero-dispatch
preflight. Tests confirm identical instructions across models, unchanged
observation/options/timeline, bounded size and rejection of an incompatible
queue. Shared context hash remains
`f7372f8ec74e99137f324a06176ca11d4cddc9cb3d30d949caaf2a149a0efb7a`.
Requests were 7,176 / 7,205 / 7,200 bytes, below the 8,192-byte limit.

Diagnostic run: `56b798e3-cd14-4a71-9132-1fcb18058fd5`.
Deployed revision: `fe4b6c642e81df67a09337f728b2b0e43ff66fd7`.
Experiment: `tick63-future-demand-1`.
Ledger records increased from 1,882 to 1,885, exactly three successful new calls.
Jev added $0.002753 reservations and Zoom $0.002000 allocations, with unchanged
caps. Cumulative exposure is $1.877546 of $1.896817 for Jev, and $1.205000 of $5
for Zoom. Reservations and operator allocations are not invoices.
Final ledger hash:
`a7af04832092d4379a311d43306bf54c7ba7c37d9f63980e9c80ffb335d8e3ef`.

Evidence: [result.json](evidence/tick63-future-demand/result.json),
[events.json](evidence/tick63-future-demand/events.json),
[approval](../../manifests/tick63-future-demand-approval.json), and
[diagnostic builder](../../packages/providers/src/future-demand-experiment.ts).

Inference credentials were removed after the test. Coolify returned to
`running:healthy` standby with the unchanged production v4 builder and no paid
dispatch. The intermediate post-stop status was `degraded:excluded`; standby
readiness was verified after redeployment. See
[deployment.json](evidence/tick63-future-demand/deployment.json).
