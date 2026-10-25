# Captured-state planning comparison

The bounded experiment completed on Coolify using `a870e574ccc2c9f12f8cdb464e93cfe8da3e7312`.
It made exactly 24 successful requests: four captured v2 Jev states × baseline
and planning prompts × Jev, Zoom Standard and Zoom Pro. No simulation campaign
was started and no score improvement is inferred from these isolated choices.

## Results

Each cell shows baseline → planning. Both variants used identical captured state
and legal actions across providers. Planning instructions were identical across
providers; Jev additionally received the same descriptions in its native criteria
fields. This is a combined intervention, not an isolated test of criteria placement.

| Captured state | Jev | Zoom Standard | Zoom Pro |
| --- | --- | --- | --- |
| Tick 26: delivery pending; PROMOTE/WAIT legal | WAIT → WAIT | PROMOTE → WAIT | WAIT → WAIT |
| Tick 57: empty stock, 63 minutes remaining | WAIT → WAIT | RESTOCK → RESTOCK | RESTOCK → RESTOCK |
| Tick 95: empty stock, 25 minutes remaining | WAIT → WAIT | RESTOCK → RESTOCK | RESTOCK → RESTOCK |
| Tick 109: empty stock, 11 minutes remaining | WAIT → WAIT | RESTOCK → RESTOCK | WAIT → WAIT |

Jev's selected actions did not change. Its provider-reported RESTOCK probabilities
at ticks 57, 95 and 109 were respectively 0.39 → 0.40, 0.29 → 0.24, and 0.24 → 0.22.
These are within-provider observations, not calibrated success probabilities.
The current parser accepted all distributions, so metadata rejection did not
produce these WAITs. No fallback, timeout, quota or budget rejection occurred.

The late control matters: restocking at tick 109 delivers at 119 and cannot
support a new five-minute cook before closing. Raw stock's salvage offsets its
purchase cost, but RESTOCK does not improve future service there. WAIT is therefore
reasonable; a blanket instruction to restock whenever empty would not measure
planning competence. At tick 57 there is substantial future service opportunity,
as the separate offline continuation analysis demonstrates.

## Interpretation

Explicit future-demand reasoning, a 20-minute horizon, RESTOCK → COOK → SERVE
sequences and descriptive criteria did not resolve Jev's early stockout choice
in this sample. A missing action description alone is now a weaker explanation.
The underlying reasoning remains unobserved. This cannot establish a general
model limitation: there was one response per state/variant, no randomization or
repetition, and several prompt features changed together.

A useful next experiment would compare choosing complete short plans or
evaluating supplied projected outcomes against choosing a single action from
the full state. The projection must use public demand assumptions, never the
hidden realized schedule, and give equivalent information to all models. Repeat
the decisive cases before any broader campaign. An operational rules safeguard
would be a separately labelled hybrid policy.

## Diagnostics and accounting

The deployed experiment includes bounded probability diagnostics: shape validity,
missing legal labels, unexpected/duplicate label counts, invalid value count and
numeric sum. Raw provider labels, messages and payloads are not copied into error
diagnostics. Strict response rejection remains unchanged; malformed optional
metadata still causes fallback. All three model paths use the same checks.

Ledger records increased from 608 to 632, with one record per variant/state/model.
Jev reservations increased by $0.022024 to $0.616672 against the unchanged $0.622178
cap. Zoom allocations increased by $0.016 to $0.410 against the $5 campaign cap;
each experimental run allocated $0.008 against the $0.25 run cap. These allocations
are not verified invoices. Only $0.005506 of Jev reservation capacity remains.

The old completed simulation worker was stopped before the ledger transition.
A stop was requested for the completed experiment service and its configured inference
credentials were removed from production and preview. Coolify still reports
`running:unknown:excluded`, so container shutdown is not confirmed. The completed
process is idle with no dispatch loop; removing configured keys does not erase
the running process environment. Its storage remains authoritative.
Do not restart an old worker with the previous ledger configuration or rerun the
single-use experiment script. The final ledger identity and run ID are recorded
in the transition events. Historical simulation data remains intact.

## Evidence and validation

- [Complete outcomes and accounting](evidence/prompt-v2/planning-experiment.json)
- [Transition and response events](evidence/prompt-v2/planning-experiment-events.json)
- [Captured inputs and offline continuation analysis](jev-investigation.md)

Typecheck and 62 targeted tests passed. Request-body bounds were checked for all
captured states; maximum planning request size was 7,685 bytes. The frozen rules
reference's source provenance was refreshed with behavioral metrics unchanged.
An initial provenance check correctly detected the changed source identity; the
subsequent check passed. No live provider errors occurred during the experiment.
