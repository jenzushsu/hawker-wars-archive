# Jev idle behavior versus Zoom Decisions Standard

This analysis reconstructs the completed v4 seed-23 round offline. No new model
calls were made. Both models used the same prompt, game rules and demand seed,
but their observations diverged as they chose different actions. Comparing the
same tick is not a matched-state model test.

| Measure | Jev | Zoom Standard |
| --- | ---: | ---: |
| Restocks | 1 | 7 |
| Cooking actions | 5 | 13 |
| Total WAITs | 91 | 40 |
| Forced WAITs (only legal action) | 10 | 29 |
| Discretionary WAITs | 81 | 11 |
| WAITs with an empty pipeline and RESTOCK legal | 47 | 0 |
| WAITs with COOK legal | 12 | 0 |
| WAITs with SERVE legal | 0 | 0 |
| Customers served / abandoned | 44 / 75 | 105 / 19 |
| Profit / utility | $96 / -1,680 | $236 / 18,585 |

## Where Jev stalled

Jev ordered once at tick 19. It cooked at ticks 0, 8, 33, 43 and 54. It also
waited despite raw stock, an idle cooker and queued customers on ticks 42
(20 raw, six customers), 52 (10 raw, five customers) and 53 (10 raw, seven customers).
Those are separate cooking delays preceding the prolonged stockout. The other
nine waits with COOK legal had no queued customers and are not automatically
mistakes.

Its final batch became ready at tick 59 and was served over ticks 59–62. At the
start of tick 63 it had $380 cash, four customers, zero raw/ready stock, and no
pending delivery or cooking. The only legal choices were RESTOCK and WAIT.
A restock cost $40, so it had ample in-game cash as well as API budget. It chose
WAIT on every tick 63–109, including while the queue reached 15 at tick 78.
From tick 110 onward, RESTOCK was no longer legal because delivery would reach
closing; its last ten waits were applied locally without calling the model.

This was a replenishment failure, not a refusal to serve cooked food. Jev never
waited with SERVE legal. All 110 API calls succeeded; no quota, request-size,
network or budget fallback occurred. No rule prevented repeat orders.

## What Standard did differently

Standard restocked at ticks 13, 26, 43, 53, 63, 80 and 99. It often ordered while
cooking was already underway, keeping future ingredients available. At tick 63,
its queue also held four customers, but it had 40 raw portions and a ten-portion
batch due at tick 65; it selected another RESTOCK. Jev had no pipeline at that
same tick. This illustrates their different inventory strategies, not proof of
how Standard would answer Jev's exact empty-state observation.

Standard's 40 waits include 29 forced waits. Its 20 waits with ready stock all
occurred with an empty customer queue. It never waited with COOK or SERVE legal,
and never waited with a completely empty pipeline while RESTOCK was legal.
Many of its pauses were simply waiting for delivery/cooking to finish.

Standard was not optimal: it bought 140 portions, wasted 37 cooked portions and
finished with 40 raw portions. Rules served 120 customers with only 100 purchased
portions and earned $311. Raw stock is salvaged at its purchase price at closing,
so retained raw stock is not itself a dollar-for-dollar loss. Unnecessary orders
still consume turns, and cooked waste has no closing salvage value.

## What the evidence supports

Jev's choices are consistent with undervaluing a multi-step investment in future
service: RESTOCK takes ten ticks, then COOK five, before SERVE becomes possible.
An order at tick 63 cannot rescue that tick's current queue, but can serve later
arrivals from tick 78 onward. We cannot establish the model's internal reasoning
from action choices alone. The shared prompt already mentions future arrivals,
repeated restocks and planning; wording alone has not fixed this behavior.

Nor are all 47 restock-legal waits equally bad. From tick 105, a newly ordered
batch cannot be delivered and cooked before closing. Late waiting can therefore
be reasonable even though RESTOCK remains technically legal through tick 109.
The clear missed opportunity is the earlier, extended stockout while substantial
service time remains.

## Offline recovery check

Starting from Jev's exact tick-63 state, switching subsequent decisions to the
unchanged Rules policy produces:

| Outcome | Actual Jev | Rules from tick 63 |
| --- | ---: | ---: |
| Profit | $96 | $196 |
| Utility | -1,680 | 12,455 |
| Served | 44 | 84 |
| Abandoned | 75 | 35 |

The continuation restocks at ticks 63, 74 and 95 (in addition to Jev's earlier
order at tick 19). The underlying demand seed and pre-tick-63 history are held
fixed. This demonstrates recoverable opportunity; it does not predict Jev's
response to one forced restock, and it changes the controller for every remaining
turn. No paid counterfactual run was made.

A future matched-state diagnostic could present Jev's exact tick-63 observation
to all three models and compare RESTOCK versus WAIT choices. That would separate
state differences from model differences. Any execution safeguard (for example,
restock when the entire pipeline is empty and sufficient delivery/cooking/service
time remains) should be applied equally across models and reported as a hybrid
policy, rather than silently attributed to the model.

Evidence: [idle-analysis.json](evidence/v4-full/idle-analysis.json). The script
`scripts/analyze-v4-idle.ts` verifies actual scores/totals against the previously
reconciled run and performs the counterfactual entirely through the engine.
