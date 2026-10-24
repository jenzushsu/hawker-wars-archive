# Jev investigation

## Findings

The dominant failure is sustained failure to replenish and resume service, not
an outage, missing cash, budget exhaustion, or illegal-action filtering. In v2,
Jev successfully chose WAIT on 53 consecutive empty-stock turns (57–109) while
RESTOCK was legal. The separate tick-1 probability error caused one rules COOK
fallback; it did not cause those later responses to fail. Its influence on the
earlier trajectory cannot be isolated without another experiment.

At tick 57 the supplied observation contained $390 cash, 63 minutes remaining,
zero raw or ready food, no cooking or pending order, six queued customers, peak
demand, and exactly RESTOCK/WAIT as legal choices. The action descriptions and
public mechanics explain delivery, cooking and service. Thus there is no missing
inventory field or concealed restock option in the reconstructed request.

Delivery would arrive at 67 and cooking could finish at 72. All six current
customers have deadlines at or before 66: replenishment helps future customers,
not the current queue. This makes failure to reason beyond current customers a
plausible hypothesis, not an observed explanation from the model. The worker
provides a fresh state and the last five actions each turn; there is no persistent
plan or conversational memory. Repeated WAITs can fill that recent history, but
the first stockout request still showed four recent SERVE actions, so a WAIT-only
history cannot explain the initial choice by itself.

## Offline counterfactuals

Replay uses the actual v2 Jev prefix, clean seed 7, unchanged mechanics and demand.
No inference requests were made. Baseline scores exactly reproduce the record.

| Continuation from tick 57 | Profit | Utility | Served | Abandoned |
| --- | ---: | ---: | ---: | ---: |
| Recorded Jev actions | $106 | 870 | 46 | 66 |
| RESTOCK once, then recorded WAITs | $106 | 870 | 46 | 66 |
| Frozen rules from tick 57 | $206 | 15,525 | 90 | 22 |
| WAIT at 57, then frozen rules | $221 | 17,325 | 89 | 23 |

A lone restock cannot recover service: cooking and serving must follow. Its cash
cost is offset by the game's full raw-stock salvage at closing. Rules continuations
show substantial recoverable value, but are hybrid counterfactuals, not Jev model
results. Waiting one turn before the rules continuation performs better on this
seed, so neither immediate restocking nor every individual WAIT is proven wrong.
The evidence concerns prolonged inactivity with substantial time remaining.

## Integration issue versus planning hypothesis

The parser checks a legal selected action before optional probability metadata.
A synthetic legal RESTOCK response with a distribution summing to 0.99 produces
`invalid-probabilities`; the same choice without that metadata passes. The real
tick-1 response reached this category, so it had passed the legal-choice check.
Its rejected choice and probability values were not retained. Missing labels,
invalid ranges or a sum discrepancy remain possible; rounding is not confirmed.
The one error does not explain 53 successfully parsed WAIT responses.

Jev's request uses null option descriptions in `criteria`, while detailed action
descriptions appear in the shared instructions and state. This is not evidence
of an invalid request. However, [Jev's Choice documentation](https://docs.typesafe.ai/primitives/choice)
recommends descriptions that distinguish the options. A compact, explicit
RESTOCK → COOK → SERVE planning question and descriptive criteria are reasonable
ablation candidates. They must be compared on identical captured states and
equivalent information for all models before attributing improvement to either.

## Recommended next experiment

First add bounded numeric probability diagnostics (label coverage, range validity,
sum) so the next rejection is explainable without raw responses or credentials.
Consider separating unusable optional metadata from an otherwise valid action;
that is a versioned contract change requiring consistent treatment across models,
not a silent relaxation during a campaign.

Then evaluate captured early and late stockout states with current prompt versus
explicit per-option criteria and a short future-service horizon. Include states
where WAIT is appropriate (pending delivery, near closing). Repeat evaluations
to distinguish prompt effects from variation. Keep any deterministic restock
safeguard labelled as a hybrid policy. No live configuration, budget, policy or
deployment was changed by this investigation.

## Reproduction

Run `pnpm exec tsx scripts/investigate-jev.ts` from the repository root.
[Evidence](evidence/prompt-v2/jev-investigation.json) includes the captured state,
reconstructed prompt-v2 request using the configured Jev model, synthetic parser
reproduction, final metrics and every counterfactual continuation action.
