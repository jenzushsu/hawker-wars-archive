# Prompt-v2 comparison — completed

The requested private four-policy comparison completed on Coolify on 2026-10-24.
Round `32b5d1e3-f6a2-4e0b-a5c0-38cec0c3a863` used prompt v2 and clean seed 7;
v1 was round `d7f7da47-8b31-4465-8cf9-77773683da3f`. All 120 decision turns
and the closing settlement committed, producing 121 unique events. The worker
is idle after completion. No automatic repetition is scheduled.

The deployed implementation is `902f451568047ba7b387f44230efd27eacf67329`.
The later evidence commit does not change that running image.

## Results

| Policy | v1 game profit | v2 game profit | Change | v1 utility | v2 utility | Served v1 → v2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules | $311 | $311 | $0 | 29,790 | 29,790 | 116 → 116 |
| Jev | $106 | $106 | $0 | 700 | 870 | 46 → 46 |
| Zoom Standard | $226 | $251 | +$25 | 18,390 | 20,765 | 98 → 109 |
| Zoom Pro | $261 | $281 | +$20 | 22,955 | 25,260 | 101 → 101 |

All 121 rules snapshots exactly match v1. Offline replay of the recorded actions
reproduces every policy's final profit, utility and service count. The simulator,
base demand and objective did not change. Promotions can add demand under the
same mechanics; the policies do not necessarily encounter equal total arrivals.
One seed and one run per prompt cannot isolate prompt effects from model variation.

## Behavioral analysis

**Jev's replenishment failure persisted.** Its sole restock moved from tick 33 to
25 and its final cooking action from tick 52 to 48. It exhausted prepared food
at tick 56 and chose WAIT at ticks 57–109: 53 empty-stock turns with RESTOCK legal,
versus 49 in v1. It had cash and no pending delivery. At ticks 110–119 WAIT was
compulsory because a new delivery could not arrive before closing. Those later
model WAITs were successful responses, not fallbacks or budget failures. Total
voluntary WAITs increased from 74 to 76; customers served stayed 46 and abandoned
stayed 66. Utility improved only because total customer waiting fell by 34 minutes.
Clearer shared descriptions did not resolve the planning behavior in this run.

**Zoom Standard earned more through additional service and retained inventory.**
It used two promotions instead of none, received 123 arrivals instead of 112,
and served 109 instead of 98. It placed seven restocks rather than six and cooked
13 batches rather than 12. Voluntary waits fell from 19 to 6. The extra $55 sales,
minus $40 additional purchases and $10 promotions, increased cash by $5; another
10 raw portions at closing added $20 salvage, giving the $25 profit improvement.
Abandonment stayed 14; total waiting rose from 222 to 257 minutes.

**Zoom Pro reduced waste rather than increasing sales.** It served the same 101
customers, placed four restocks again, but cooked 10 rather than 11 batches.
Waste fell from 21 portions to 11. Ten additional raw portions retained at closing
account for its $20 higher profit; cash was unchanged. Waiting increased from
199 to 238 minutes, while utility still improved by 2,305 points.

## Errors and diagnostic limits

Exactly one provider fallback was recorded: Jev, tick 1,
`wire-contract:invalid-probabilities`, one attempted request. The worker applied
its documented rules fallback (COOK), retained the conservative reservation,
and did not retry. There were no provider timeouts, network/rate-limit failures,
budget/quota blocks, worker retries or halts. v1 also had one Jev invalid-response
fallback (tick 5), but its finer diagnostic was not captured.

The current parser validates optional probability metadata against the complete
legal-choice set, numeric range and sum-to-one tolerance of 0.000001. This error
can therefore reject an otherwise legal selected action. The log identifies the
validation category, but the rejected numeric vector was deliberately not
retained; it does not establish which check failed or the model's reasoning.
[Official Jev Choice documentation](https://docs.typesafe.ai/primitives/choice)
requires a full distribution summing to one. A
[public SDK issue](https://github.com/typesafe-ai/typesafe-sdk-python/issues/15)
reports rounding discrepancies for jev-1.13.0; this is a possible explanation,
not proof about this response. No parser or policy was changed mid-run.

One read-only monitoring call using Coolify `lines=all` returned HTTP 500.
Switching to `lines=1000` retrieved the full log. This did not affect execution.

## Accounting and evidence

The user explicitly approved up to $0.330360 additional Jev reservations. The
operator transition preserved every existing ledger record and prior exposure.
This run made 303 new calls: Jev 110 (109 success, one uncertain/invalid),
Zoom Standard 89 and Zoom Pro 104 (all successful). With 305 prior records, the
ledger has 608 records. Calls reconcile to all non-forced-WAIT model turns;
no duplicate dispatches were detected.

Jev reserved $0.302830 this run, bringing cumulative reservations to $0.594648
against the approved $0.622178 cap. Zoom allocated $0.193 against its $0.25 run
limit and $0.394 cumulatively against $5, including prior smokes. Reported Zoom
input usage implies $0.024692998 for this run at published input rates; allocations
and usage estimates are not verified invoices or maximum charges.

[Evidence bundle](evidence/prompt-v2/comparison.json) includes database results,
per-round accounting, latency, every campaign error and reconciliation checks.
[Worker events](evidence/prompt-v2/worker-events.json) preserve the full run log.
The adjacent v1/v2 decision files and replay analyses support reproduction with
`scripts/analyze-recorded-comparison.ts INPUT_JSON OUTPUT_JSON` (offline, seed 7).
The one-use preparation service is stopped; service credentials were removed
from its production and preview configuration entries. Retain its storage volume.

## Recommended follow-up

1. Add bounded probability diagnostics (missing labels, sum and range checks),
   then assess whether unusable optional probabilities should invalidate a legal
   action. Apply any policy consistently to all models and version the change.
2. Test Jev on the captured RESTOCK-versus-WAIT stockout state with concrete,
   equivalent per-option criteria and a short planning horizon. This would be a
   separate experiment, not a retroactive correction to these results.
3. After any change, evaluate multiple approved seeds. Keep any forced-restock
   safeguard as a separately labelled hybrid policy rather than silently adding
   it to the pure model comparison. No additional paid experiment was started.
