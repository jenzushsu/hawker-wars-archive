# Short-plan repeatability and order comparison

The authorized follow-up completed on Coolify with 36 successful requests: two
captured states, two presented option orders, three repetitions per order and
three models. No simulated plan was executed. The preceding failed startup bug
did not recur; no requests failed, retried, fell back or exceeded budget gates.

## Results

Counts are replenish-now selections out of three requests in each cell.

| Model | Early, normal | Early, reversed | Near closing, normal | Near closing, reversed |
| --- | ---: | ---: | ---: | ---: |
| Jev | 3/3 | 3/3 | 3/3 | 3/3 |
| Zoom Standard | 3/3 | 3/3 | 3/3 | 3/3 |
| Zoom Pro | 3/3 | 3/3 | 0/3 | 0/3 |

The early state is tick 57 with 63 minutes remaining. Near closing is tick 109
with 11 minutes remaining. Zoom Pro selected the wait-ten-turns plan in every
near-closing repetition. Both plans can tie on final utility there: an immediate
order arrives too late to cook, and its raw salvage offsets the purchase price.
Neither selecting WAIT nor RESTOCK at that state establishes recognition of the tie.

Jev's switch from its earlier single-action WAIT choice to the replenish-now plan
was reproducible across six early-state calls and survived reversal of the
presented plan order. This is stronger evidence of repeatable framing sensitivity
than the initial single sample. It does not show improved campaign profit or
general planning competence. The fixed plans and prompt differ from the earlier
single-action task; no plans were executed in the simulator.

## Experimental scope and limits

Each provider received identical state bytes and plan instructions. Reversal
changed the order of the descriptions and native choice entries, not their
meaning. The legal-action list inside the shared state retained its original
order. Labels stayed RESTOCK and WAIT: this is an option-presentation-order test,
not a counterbalanced label-meaning test. There was no explicit tie choice.
Three repetitions per condition on two states are too few for a broad claim.
API caching/determinism may also make repeated requests less independent.

Order was alternated across repetition pairs: normal/reversed, reversed/normal,
normal/reversed. Provider request order remained Jev, Standard, Pro. The same
strict validation and at-most-one dispatch per captured input were retained.
Production action selection and simulation rules are unchanged.

## Budget and verification

User authorization to extend the budget was applied as a bounded $0.033036 Jev
extension (12 × $0.002753 maximum reservations), bringing its cumulative cap from
$0.622178 to $0.655214. All 12 reservations were used, exactly reaching the new cap.
Zoom allocated $0.024, bringing its cumulative allocation to $0.438; the $0.25/run
and $5 campaign caps stayed unchanged. These figures are accounting reservations
and allocations, not verified invoices. No additional calls are scheduled.

The retained ledger grew from 638 to 674 records, with 36 unique run/tick/provider
combinations. Six explicit run transitions preserved every previous record and
charge. The deployed commit was `c1f4a217ae51e44d2b4866da7ddc9b9a85e8e33f`, deployment
`bw8wz1qqvcetb314na7pg1gj`. Results were written outside the ledger directory.

TypeScript, 69 targeted tests and Compose validation passed. Shared instructions,
unchanged plan meanings, reversed options and request-size bounds were checked.
The frozen rules reference's source provenance was refreshed without behavioral
changes. Stop and credential-cleanup status is recorded in the evidence receipt.

- [Full results and ledger reconciliation](evidence/prompt-v2/repeatability-experiment.json)
- [Runtime events and transitions](evidence/prompt-v2/repeatability-experiment-events.json)
- [Bounded authorization](../providers/repeatability-approval.json)
- [Refreshed LinkedIn replay and caption notes](../social/linkedin-teaser-v2.md)

The next meaningful performance test would execute an explicitly labelled
plan-selection policy across multiple seeds, after defining its control and
replanning rules. It would require a separate scope and budget; these results
do not justify silently replacing the existing single-action policy.
