# Full Jev 1.13.0 round: action-criteria v2 regressed

Completed the approved clean seed23 run with Jev1.13.0, action-criteria-prompt-2,
all120 ticks plus closing, and no safeguard. Every model choice was executed
unchanged. No Zoom calls or live-web publication. Run
`371de41b-8241-4514-ba95-52c7ddcdcac2`, revision
`eeed08236cecf1827183b6721ac038bb6073d790`.

| Metric | Previous criteria v1 | Revised criteria v2 |
| --- | ---: | ---: |
| Profit | $241 | $71 |
| Utility | 18,515 | -4,630 |
| Served | 85 | 39 |
| Abandoned | 34 | 80 |
| Wasted portions | 7 | 23 |
| Restock orders | 3 | 1 |
| Empty-pipeline WAITs with RESTOCK legal | 0 | 61 |
| WAITs with COOK legal | 28 | 0 |
| WAITs with SERVE legal | 0 | 0 |

The targeted cooking clarification succeeded on the earlier saved states, but
that did not translate into a better full trajectory. This run is an unsuccessful
full-round candidate; do not promote v2 on the basis of the six targeted COOK
choices. V1 remains the stronger observed full-round candidate, not a proven
optimal policy. Production v4 was never changed by either experimental builder.

## What happened

V2 began with COOK at0 (v1 selected RESTOCK). It cooked at0,5,20,26,36, and placed
its sole order at6. It last served at48. At49 the pipeline was entirely empty,
with two customers, $355 cash and RESTOCK legal; it selected WAIT with reported
probability71% versus RESTOCK29%. It continued WAIT through109. Ticks110–119
were forced waits. Early stockouts left ample replenishment time; legality alone
near closing does not establish a beneficial restock.

The actual tick86/87 states were now empty pipelines with legal RESTOCK/WAIT,
not the saved states with usable raw stock and pending delivery tested earlier.
Those local tests remain valid evidence for those inputs only. No raw-stock
cooking hesitation occurred in this trajectory, but the larger replenishment
failure returned. V2 also wasted23 portions versus7 under v1, consistent with
its different cooking schedule; this is not a causal attribution to one sentence.

A plausible concern is that the cooking-focused detail changes action emphasis
across unrelated states. The evidence does not establish model internals or
separate prompt effects from sampling and downstream state differences. There
is one full run per condition. Next evaluation should include stockout recovery
and production/waste controls alongside the targeted cooking states before any
further full-run claim. No additional calls or prompt changes are scheduled.

## Verification and accounting

All120 captured observations, executed actions, histories and closing totals
replayed exactly. All110 sent request hashes/sizes matched the v2 builder; max
body6,529 bytes. Every discretionary response returned Jev1.13.0. Typecheck and
approved preflight passed; existing v2 tests and saved-state validation remain
unchanged.

All110 calls succeeded, with no retries, fallbacks, size errors or budget failures.
Ledger continuity: 2,416→2,526. Added Jev reservations **$0.302830**; cumulative
**$3.083360** against the approved **$3.110890** cap. Remaining **$0.027530** covers
10 conservative call reservations. Zoom remains **$1.408000** with zero new calls.
These are conservative reservations, not invoice costs.

Inference credentials were removed and standby restoration is documented in
[deployment receipt](evidence/criteria-v2-comparison/deployment.json). No further
paid run is scheduled. The original ledger and all earlier evidence are retained.

Evidence: [result](evidence/criteria-v2-comparison/result.json),
[verified analysis](evidence/criteria-v2-comparison/analysis.json),
[events](evidence/criteria-v2-comparison/events.json),
[approved plan](criteria-v2-full-plan.md).
Reproduce: `node --import tsx scripts/verify-criteria-v2-comparison.ts`.
