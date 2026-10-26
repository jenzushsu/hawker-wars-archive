# Repeated Jev cooking-clarification test

Tested the two captured tick-86/87 observations from the completed seed-23
Jev 1.13.0 run. Each state received three baseline (`action-criteria-prompt-1`)
and three treatment (`action-criteria-prompt-2`) calls: 12 calls total, all on
`jev-1.13.0`. No safeguard or full-round simulation was executed.

| State | Baseline choices | Revised choices | Baseline P(COOK) | Revised P(COOK) |
| --- | --- | --- | --- | --- |
| 86 | WAIT, COOK, WAIT | COOK, COOK, COOK | 37%, 51%, 43% | 95%, 95%, 96% |
| 87 | WAIT, WAIT, WAIT | COOK, COOK, COOK | 32%, 34%, 41% | 96%, 95%, 95% |

The revised wording consistently selected cooking in these six calls, versus
one of six baseline calls. It clarifies that delivery progresses during other
actions, existing ingredients can be cooked independently, and cooking now
finishes before waiting for delivery. The observations, public rules, objective,
legal choices and model version were identical within each state. Requests had
unique ledger run IDs; those identifiers are not included in model context.

This is promising local evidence, not proof of general reliability, a causal
explanation of model internals, or higher full-round profit. Ordering alternated
according to a predetermined schedule, not randomized. Three samples per
condition are small. Several wording/timing additions changed together, so this
does not isolate which sentence caused the action shift. Reported probabilities
are provider output, not calibrated success forecasts. Behavioral negative
controls and a full v2 round remain untested; offline legality/closing controls
previously passed.

## Verification and spending

Preflight/typecheck passed before deployment. All 12 responses succeeded with
one attempt each, no retries or fallbacks, and exact returned `jev-1.13.0`.
Every request body/context hash and scheduled state/variant/repetition matches.
All requests were below 8,192 bytes (maximum 6,421). Unique approved run IDs,
a one-use lock and retained ledger identity protected against accidental reruns.

Ledger attempts reconciled 2,404→2,416. New Jev reservations: **$0.033036**;
cumulative **$2.780530** against unchanged **$2.788789** cap. Remaining **$0.008259**
covers three conservative calls. Zoom had no calls or allocation changes and
remains $1.408000. These are reservations, not invoice charges.

Coolify deployment: `e5a86be6eab84fd6eea6ecb2602bbb842ff7d758`. Inference credentials
were removed after completion. Initial standby restoration failed on the recurring
missing external Docker network; a standby-only retry was requested without
repeating paid calls. Final standby status is recorded in the
[deployment receipt](evidence/cooking-test/deployment.json). No further paid test
or simulation is scheduled. Production v4 and completed experiment builders
remain unchanged.

Evidence: [receipt](evidence/cooking-test/result.json),
[analysis](evidence/cooking-test/analysis.json),
[events](evidence/cooking-test/events.json),
[approved schedule](../../manifests/cooking-test-approval.json).
Reproduce without paid calls: `node --import tsx scripts/verify-cooking-test.ts`.
