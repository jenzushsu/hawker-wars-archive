# Jev 1.14.0 raw full-run comparison

The approved Jev-only seed-23 run completed all 120 ticks plus closing on Coolify
revision `b54dd654ff76e4f679a4c284a24ebc523bc583b1`. The API returned exactly
`jev-1.14.0`; tick zero verified identity and was executed once as part of the run.
The prompt remained v4. No safeguard, Zoom dispatch, or live-web publication was
used. Run ID: `b09d4e88-6c4b-499b-9b63-75ef24964743`.

| Metric | Prior raw Jev 1.13.0 | Raw Jev 1.14.0 |
| --- | ---: | ---: |
| Profit (simulation currency) | $96 | $71 |
| Utility | -1,680 | -5,025 |
| Customers served | 44 | 39 |
| Customers abandoned | 75 | 80 |
| Restock orders | 1 | 1 |
| Empty-pipeline WAITs with RESTOCK legal | 47 | 51 |
| Last SERVE tick | 62 | 58 |

The upgrade did **not** resolve the stockout-idling behavior in this run. This is
one historical run per version, not repeated matched-state testing or evidence
of a general model regression. The 1.13.0 hybrid's $191 profit belongs to a
separate policy with a safeguard and must not be labeled raw model performance.

## Decision analysis

Jev 1.14.0 cooked at ticks 0, 5, 30, 41 and 50. It placed its only restock at 31,
with reported RESTOCK probability 51% versus WAIT 49%. Its last serving action
was at 58.

At 59 it had zero raw/ready stock, no cooking or pending order, three queued
customers, $355 cash, and legal choices RESTOCK/WAIT. It selected WAIT (66% versus
34%). It continued selecting WAIT at every tick through 109: **51 discretionary
empty-pipeline waits**. At 63 the queue had six customers and WAIT probability
was 75%. These are reported probabilities, not calibrated outcome forecasts.
Ticks 110–119 were forced waits after restocking ceased to be legal.

Early stockout waits left time to replenish and serve future arrivals; late
restocking being legal alone does not establish that it would improve the score.
No guard was applied, so no recovery profit counterfactual is claimed here.

There were no waits with SERVE legal. Seven waits had COOK legal (20, 21, 22, 24,
26, 27, 29); those need queue/pipeline context and are not automatically errors.
The central observed failure remains choosing not to restart an empty pipeline.

## Verification and accounting

All 120 captured observations, action histories, unmodified model choices,
closing totals, cash, raw stock and score replayed exactly. All discretionary
responses matched `jev-1.14.0`. Typecheck and the two focused runner tests passed.
The full run made **105 successful calls**, with 15 forced waits, no retries,
fallbacks, request-size errors or budget failures.

The retained ledger reconciled **2,194→2,299** attempts. Jev added **$0.289065**
reservations, bringing cumulative reservations to **$2.458429** against the
approved **$2.499724** cap. Remaining headroom is **$0.041295** (15 conservative
call reservations). Zoom remained unchanged at **$1.408000**, with zero new calls.
Reservations are conservative exposure accounting, not invoice cost.

The worker's restored standby status and removal of inference credentials are
recorded in the [deployment receipt](evidence/jev114-comparison/deployment.json).
No further paid run is scheduled. The persistent ledger was retained.

Evidence: [full result](evidence/jev114-comparison/result.json),
[events](evidence/jev114-comparison/events.json),
[verified analysis](evidence/jev114-comparison/analysis.json),
[approved plan](jev114-plan.md).
Reproduce offline: `node --import tsx scripts/verify-jev114-comparison.ts`.
