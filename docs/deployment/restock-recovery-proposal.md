# Offline shared restock-recovery proposal

After prompt-only diagnostics failed to produce a consistent Jev action change,
the next step was an offline prototype of an explicit shared safeguard. This is
not wired into any live controller and makes no provider calls.

Propose replacing a selected WAIT with RESTOCK only when all conditions hold:

1. RESTOCK is legal in both the captured legal-action list and engine legality.
2. There is no raw stock, ready stock, cooking, or pending order.
3. Delivery plus cooking would leave at least ten decision ticks for service.

The rule uses public state and mechanics only, with no model identity, demand
seed, realized future arrivals or outcome labels. It is applied identically in
the shadow check to all four policies. In ordinary conditions its last eligible
tick is 95; active supplier delay moves that boundary to 90. It does not force
extra orders during existing work or override non-WAIT model choices. The
ten-tick service margin is a conservative heuristic, not an optimality result.

## Shadow results

All 1,920 recorded decisions across the three v3 campaigns and one full v4
campaign were replayed with the original actions. The proposal was evaluated,
but never applied. Replay scores and totals match the verified original runs.

| Campaign | First flagged Jev tick | Jev flagged WAITs | Standard / Pro / Rules flags |
| --- | ---: | ---: | --- |
| v3 seed 7 | 59 | 37 | 0 / 0 / 0 |
| v3 seed 11 | 57 | 39 | 0 / 0 / 0 |
| v3 seed 23 | 57 | 39 | 0 / 0 / 0 |
| v4 seed 23 | 63 | 33 | 0 / 0 / 0 |

The same safeguard identifies the prolonged early stockout in each Jev campaign
without proposing changes to the other policies' recorded actions. In the latest
run it flags ticks 63–95, while leaving late discretionary waits 96–109 and forced
waits 110–119 alone. Supplier-delay boundaries and stock/cooking/order exclusions
are covered in focused tests.

These 148 flags are opportunities on the **original** trajectories, not 148
predicted interventions. After the first actual restock, stock and future
observations change, so later original WAIT decisions cannot be replayed as if
they were fresh model responses. This analysis makes no guarded profit or
customer-service prediction. The earlier Rules-from-tick-63 counterfactual is a
different controller and does not establish this guard's performance.

## Scope and next decision

This is a candidate hybrid-policy component, not an improvement to the model's
raw decisions. Any live use must be versioned and clearly distinguish the
model-selected action from the executed action and intervention reason. It must
apply equally to every model, with the frozen Rules baseline retained for
comparison. No production prompt, model adapter, worker or spending cap changed.

The next useful validation is a bounded live hybrid comparison with fresh model
observations after interventions, plus a cooking/replenishment follow-through
check. One forced order is not proof the model will continue cooking or place
subsequent orders. Current Jev budget covers only one more provider call, so a
full paid comparison is outside the remaining budget. No extra paid work was
launched or requested by this prototype.

Validation: 11 focused tests cover exact captured stockout, cutoff boundaries,
supplier delay, non-WAIT choices, available raw/ready stock, pending deliveries,
existing cooking, insufficient cash, and captured legal-action restrictions.
Typecheck passed. Imports were inspected: only the offline analysis script and
tests use the proposal; production controllers do not.

Evidence: [shadow.json](evidence/restock-recovery/shadow.json).
Implementation: [restock-recovery-proposal.ts](../../packages/decisions/src/restock-recovery-proposal.ts).
Reproduce with `pnpm exec tsx scripts/analyze-restock-recovery.ts`.
