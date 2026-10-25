# Investigation: Jev waits at ticks 86–87

Offline investigation of the raw Jev 1.13.0 action-criteria run. No paid calls,
prompt changes, safeguard changes or deployments were made. The original run and
all sent prompt hashes at ticks 86–88 were reconstructed exactly.

## Observed decisions

| Tick | Raw | Ready | Cooker | Pending delivery | Queue | Legal actions | Selected / probabilities |
| --- | ---: | ---: | --- | --- | ---: | --- | --- |
| 86 | 10 | 0 | Idle | 20 portions at 88 | 5 | COOK, WAIT | WAIT 52%, COOK 48% |
| 87 | 10 | 0 | Idle | 20 portions at 88 | 6 | COOK, WAIT | WAIT 63%, COOK 37% |
| 88 | 30 | 0 | Idle | None | 7 | COOK, RESTOCK, WAIT | COOK ~40%, RESTOCK 40%, WAIT 20% |

These were successful model responses, not forced waits, lack of budget, busy
cooking, insufficient ingredients or capacity constraints. The provider-selected
COOK at 88 is retained as returned; probabilities near a tie are not re-ranked.
They are provider reports, not reliable evidence of hidden reasoning.

Cooking at 86 would complete at 91; cooking at 87 at 92. Actual cooking at 88
completed at 93. Two customers already present at 86 had deadline 93. Customer
expiry occurs before the action at that tick, so they could not be served by the
actual batch. Three other customers in the tick-86 queue expired too early even
for a batch started at 86. Earlier cooking would not rescue the whole queue.

## Controlled offline branches

All branches replay actual actions through tick 85. They start exactly one batch
at 86, 87 or 88; otherwise SERVE whenever legal, or WAIT, through tick 94. They
then use the same frozen Rules controller from 95 to closing. This is a synthetic
continuation, not a prediction of Jev's choices after changing its state.

| Start cooking | Ready at | Served by end 94 | Abandoned by end 94 | Closing profit | Closing utility |
| --- | ---: | ---: | ---: | ---: | ---: |
| 86 | 91 | 75 | 31 | $231 | 17,450 |
| 87 | 92 | 74 | 31 | $231 | 17,395 |
| 88 | 93 | 71 | 33 | $226 | 16,730 |

The later-cooking branch matches actual results through 94. Starting at 86 serves
four more customers by that point (two rescued, others served sooner), and two
fewer have abandoned. Under the common continuation it improves final profit by
$5 and utility by 720 relative to starting at 88. This does **not** imply the
actual $241 result would become $246: switching to Rules after 94 changes later
production and waste. The observed full run remains $241 / 18,515.

## Likely prompt weakness, not a proven cause

The exact prompt says WAIT can be used when “work progresses”. Its state summary
labels the pipeline NONEMPTY and shows delivery due at 88. It does not explicitly
explain that those incoming ingredients are independent of the ten already
usable portions, or compute COOK-now completion. The detailed public mechanics
are still correct, and COOK was explicitly listed as legal.

The selected WAIT is consistent with overvaluing the approaching delivery or
failing to combine current stock, cooking duration and customer deadlines. It
does not establish either explanation causally: at tick 88 raw stock, queue,
history, time and available actions all change together. No paired prompt test
has isolated the delivery effect.

A narrow next prompt candidate would say:

> A pending delivery does not prevent cooking raw stock already on hand. If COOK
> is legal, compare cooking now with waiting; do not wait solely because a
> delivery is approaching. COOK now at 86 would finish at 91. Waiting until the
> delivery at 88 and then cooking would finish at 93. Customers whose deadline
> equals the ready tick expire before they can be served.

Generate timing from public state and apply equivalent wording across providers.
This is a proposed prompt clarification only, not an implemented safeguard or
validated model improvement. Test at saved 86/87 states with negative controls
(busy cooker, insufficient raw, no queue, near closing) before another full run.

Evidence: [full offline branches and exact instructions](evidence/criteria-comparison/cooking-delay.json).
Reproduce with `node --import tsx scripts/investigate-cooking-delay.ts`; typecheck
passes. Retained budget and healthy standby are unchanged.
