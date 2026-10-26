# Jev 1.13.0 with concise action criteria

**Selection: retained by user instruction.** Jev 1.13.0, action-criteria-prompt-1, no safeguard. See [selection record](prompt-selection.md).

Completed all 120 ticks plus closing on clean seed 23 using **Jev 1.13.0**, the
experimental `action-criteria-prompt-1` instructions and **no safeguard**. Every
model choice was executed unchanged. No Zoom calls or live-web publication were
made. Round: `3136cde0-c6ae-4f6a-af4d-29621f1a9370`; deployed revision:
`5d00ee022b9739383c3d1be9bbe7a3a4ce0ffe7c`.

| Metric | Prior raw 1.13 / v4 | Raw 1.13 / action criteria |
| --- | ---: | ---: |
| Profit | $96 | $241 |
| Utility | -1,680 | 18,515 |
| Customers served | 44 | 85 |
| Abandoned | 75 | 34 |
| Wasted portions | 18 | 7 |
| Restock orders | 1 | 3 |
| Empty-pipeline WAITs with RESTOCK legal | 47 | 0 |
| WAITs with SERVE legal | 0 | 0 |

This run demonstrates recovery without a code-level action override. It is a
promising prompt result, not proof of repeatability or a causal estimate: there
is one full run per condition, and the replacement changes several instructions
and adds a derived summary together. The previous raw 1.14/v4 run earned $71;
the separate 1.13 hybrid with a safeguard earned $191. Neither is an equivalent
control for isolating individual prompt changes.

## What changed in behavior

Jev placed orders at **0, 67 and 78**. At 67 it had an empty pipeline and selected
RESTOCK itself. Delivery arrived at 77 and it immediately selected COOK, then
ordered again at 78 while cooking was already underway. It continued serving
until tick 116 rather than stopping at 62 as in the prior raw 1.13 run.

There were still 28 WAITs with COOK legal. Most had no customers currently queued,
so they should not all be called mistakes. The two with waiting customers were
**86 and 87**: ten raw portions, no ready food/cooking, queues of five and six,
and a pending delivery due at 88. Jev waited until delivery before cooking despite
already having enough ingredients. This suggests a remaining issue distinguishing
usable existing stock from incoming stock; it does not prove internal reasoning.

The first cooking action was delayed until tick 23. Other cooking ticks were
29, 40, 49, 58, 77, 88 and 102. The prompt improved replenishment in this observed
trajectory but did not establish globally optimal production scheduling.

## Offline and post-run verification

Before deployment, 123 saved states yielded 324 generated request bodies across
Jev/Standard/Pro (15 forced-wait states needed no requests). All shared the same
candidate instructions, retained the exact v4 context/legal options and fit
8,192 bytes; maximum was 6,265. Maximum candidate instruction length was 1,317
characters versus baseline 1,410 across that corpus. Five focused tests and
typecheck passed, covering timing, supplier delay, pending orders, closing,
model identity and unmodified action execution. These are mechanical checks,
not predictions of model behavior.

Post-run replay matched all 120 captured observations, actions, histories and
closing totals/scores. All **105 sent request body hashes and byte counts** were
reconstructed exactly with the experimental builder; the largest was 6,228 bytes.
Every discretionary response returned `jev-1.13.0`. No hidden demand, fixed
restock threshold or action override was used. The new builder is isolated from
the production v4 worker.

## Errors, accounting and standby

All **105 calls succeeded**; 15 turns were forced WAIT. There were no retries,
fallbacks, request-size errors or budget failures. Ledger attempts reconciled
**2,299→2,404**, with **$0.289065** new Jev reservations. Cumulative Jev exposure
is **$2.747494** against the user-authorized **$2.788789** cap; **$0.041295** remains
(15 conservative call reservations). Zoom exposure stayed at **$1.408000**, with
no new calls. Reservations are conservative accounting amounts, not invoice cost.

The first standby deployment failed on a missing external Docker network. A
standby-only retry was requested after inspecting the failure; no paid rerun occurred.
The worker was restored to healthy standby with inference credentials removed;
see [deployment receipt](evidence/criteria-comparison/deployment.json). No further
paid run is scheduled and the retained ledger remains intact.

Evidence: [receipt](evidence/criteria-comparison/result.json),
[analysis](evidence/criteria-comparison/analysis.json),
[events](evidence/criteria-comparison/events.json),
[offline validation](evidence/action-criteria/offline.json),
[authorized plan](action-criteria-plan.md).
Reproduce offline: `node --import tsx scripts/verify-criteria-comparison.ts`.
