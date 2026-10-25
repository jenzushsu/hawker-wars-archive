# Short-plan diagnostic — completed

Six requests completed successfully on Coolify: two captured states × Jev, Zoom
Standard and Zoom Pro. No plan was executed in the simulation. This was a change
from choosing an immediate action to choosing between two fixed conditional plans:
order now, then cook/serve when feasible; or wait ten turns, then follow the same
plan if ordering remains legal. Both plans place only one order and never promote.
All models received identical state and plan instructions, with the same text
also supplied in Jev's native criteria fields.

| State | Jev | Zoom Standard | Zoom Pro |
| --- | --- | --- | --- |
| Tick 57, 63 minutes remaining | Replenish now (0.97) | Replenish now | Replenish now |
| Tick 109, 11 minutes remaining | Replenish now (0.93) | Replenish now | Wait ten turns |

Parenthesized numbers are Jev's provider-reported choice probabilities, not
calibrated probabilities of success. Previously Jev chose WAIT at both states
under the original and expanded single-action prompts. Its change at tick 57
supports sensitivity to the decision framing; it does not isolate the effect
of plan descriptions from the changed alternative or instructions.

The late control limits the conclusion. At tick 109 an immediate order arrives
at 119, too late for a five-minute cook. Its raw salvage exactly offsets its
purchase price. The delayed plan cannot order before closing. Thus both plans
leave service and final wealth unchanged at this state. Jev's strong preference
does not establish an ability to recognize this tie or reason about timing.
One response per state/model and no executed plans cannot demonstrate improved
profit or a general model ranking. Production single-action policy is unchanged.

## Errors and recovery

Startup uncovered an integration bug from the preceding experiment: its JSON
report was written inside the ledger directory, which rejects unexpected files.
A read-only inspection verified 632 records and unchanged reservations; no
inference had been dispatched. A subsequent report relocation encountered EACCES
because the unprivileged process could not create a sibling reports directory.

The fix provisions only `/var/lib/hawker/reports` for UID 1000, validates the
historical report and relocates it intact. Both experiment runners now save
reports outside the strict ledger directory. The ledger was not reset, deleted,
or given weaker validation. The failed starts made no calls. Stage diagnostics
remain readable after startup failure. The successful deployment was
`vm1vxj8xzswvfamb1k9v1zve`, commit `288e74e86afa9cf10993722910f50f8daeaa264d`.

## Accounting and operational state

All six inference requests succeeded without retries, fallbacks or probability
validation errors. The ledger increased from 632 to 638 records. Jev reserved
another $0.005506, reaching the existing $0.622178 cumulative cap exactly. There
is no remaining Jev reservation capacity; further paid Jev experiments require
a separately approved cap increase. Zoom allocated $0.004, bringing cumulative
allocations to $0.414 against $5, with its $0.25 run cap unchanged. These accounting
figures are not verified invoices.

The completed process is idle, a stop was requested, and configured inference
credentials were removed from production and preview. Shutdown confirmation is
tracked in the evidence receipt. Retain the volume and the relocated historical
report. Do not restart an older worker against the new ledger identity.

## Validation and evidence

Typecheck and 67 targeted tests passed. Both plans preserve equal provider context
and fit the request-size bound. Recovery tests verify byte-for-byte report
preservation, unchanged ledger data and rejection of unrecognized reports.
Compose configuration validates, and frozen rules behavior remains unchanged.

- [Outcomes and accounting](evidence/prompt-v2/short-plan-experiment.json)
- [Complete runtime events](evidence/prompt-v2/short-plan-experiment-events.json)
- [Startup failures and recovery](evidence/prompt-v2/short-plan-startup-diagnosis.json)

Before adopting plan selection, repeat decisive cases with counterbalanced plan
labels and an explicit tie option, then test execution across seeds. This would
be a new experiment with a new budget approval, not an automatic continuation.
