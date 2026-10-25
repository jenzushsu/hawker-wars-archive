# Execution of the recorded short-plan choices

The selected plans were executed offline through the simulator to closing, using
the exact captured Jev states at ticks 57 and 109 and the original seed-7 future
demand. Every provider's recorded repeatability-test choice was executed (36
sample executions); identical choices on the same state produce identical
continuations. This required zero new provider calls and did not change the live
worker or historical campaign. It is execution of recorded choices, not a new
campaign in which models select fresh plans throughout the round.

## Early stockout: execution from tick 57

All three models chose the immediate-restock plan on this captured state.
Reported totals include the shared, unchanged Jev prefix through tick 56.

| Continuation | Final game profit | Final utility | Served | Abandoned |
| --- | ---: | ---: | ---: | ---: |
| Original recorded Jev actions | $106 | 870 | 46 | 66 |
| Selected immediate-restock plan | $166 | 9,215 | 66 | 46 |
| Alternative wait-ten-turns plan | $166 | 9,330 | 66 | 46 |
| Frozen rules from the same state | $206 | 15,525 | 90 | 22 |

The selected plan orders at tick 57, receives stock and cooks at 67, serves the
first batch at 72–75, cooks again at 76, and serves the second batch at 81–84.
It sells all 20 purchased portions, adding $100 revenue less $40 purchases:
profit increases by $60. It then waits at ticks 85–119.

**The renewed inactivity is specified by the plan, not a fresh Jev WAIT choice.**
The experiment explicitly offered one-order plans with no further restocks.
After that order is consumed, there is no replanning step. Empty-pipeline WAIT
turns fall from 63 to 35, but the plan cannot support the remaining rush. A full
plan-selection policy needs an explicit rule for when to finish a plan and request
another. Repeating RESTOCK automatically would instead be a separately labelled
hybrid rule; this execution did not silently add it.

The delayed alternative also sells 20 portions and earns $166. It produces 23
fewer aggregate customer-wait minutes, yielding 115 higher utility on this realized
seed, despite postponing service. Thus repeatable selection of immediate RESTOCK
did not select the highest realized utility of the two plans here. The models
were asked to maximize expected utility without seeing the future schedule;
this single realized comparison is not proof of an expectation error.

The rules continuation is a control from the same stockout, not the original
rules policy's $311 full-round result. Comparisons against that original full
round would combine differences in both earlier and later decisions.

## Near closing: execution from tick 109

Jev and Standard selected immediate restock; Pro selected delayed restock. The
immediate order arrives at 119 and cannot be cooked before closing. The delayed
plan reaches its order decision at 119, when RESTOCK is illegal, and waits.
Both finish at $106 profit, utility 870 and 46 served: the immediate order's
20 raw portions retain $40 value, offsetting its $40 cash cost exactly. The
previously identified utility tie is now verified by actual simulation.

## Reproduction and verification

Run `pnpm exec tsx scripts/execute-recorded-plans.ts` from the repository root.
[Evidence](evidence/prompt-v2/executed-plans.json) records every executed action,
inventory/pipeline state, closing metric and source model request ID.

The executor enforces consecutive observations, an initially empty pipeline,
one order only, serving before cooking, and simulation legality at every turn.
Tests cover baseline reproduction, delivery/cooking/service execution, the
delayed plan, renewed inactivity, closing salvage equivalence and duplicate
decision rejection. No expected outcomes or future demand are fed into the
executor; the simulator alone provides arrivals as time advances.
