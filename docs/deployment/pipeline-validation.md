# Paired pipeline-guidance validation across three states

The user approved validation beyond tick 63. Three captured Jev observations
from the completed v4 seed-23 round were tested with original v4 and a shared,
state-derived timeline/future-demand addition. Each condition received one call
per model: 18 calls total, all successful, no retries or fallbacks.

The treatment describes existing cooking separately, derives delivery and the
earliest new cooking completion from public mechanics, distinguishes expiring
current customers from later demand, and handles an order arriving too late to
cook before closing. The late case also states the raw-inventory salvage rule.
No hidden realized demand was supplied. Paired baseline/treatment contexts and
legal choices match exactly. Their instructions differ only by the addition.

| State | Jev baseline → treatment | Standard baseline → treatment | Pro baseline → treatment |
| --- | --- | --- | --- |
| Tick 58: raw/ready empty; ten portions cooking, ready at 59 | WAIT → WAIT | RESTOCK → RESTOCK | RESTOCK → RESTOCK |
| Tick 73: completely empty pipeline; 11 queued customers | WAIT → WAIT | RESTOCK → RESTOCK | RESTOCK → RESTOCK |
| Tick 109: new delivery at 119 cannot cook before closing | WAIT → WAIT | RESTOCK → WAIT | WAIT → WAIT |

| State | Jev baseline P(RESTOCK) | Jev treatment P(RESTOCK) |
| --- | ---: | ---: |
| 58 | 18% | 33% |
| 73 | 18% | 32% |
| 109 | 16% | 1% |

Probabilities are provider-reported and not calibrated across providers. Baseline
ran first at ticks 58 and 109; treatment ran first at tick 73. This fixed,
alternating order is not randomized, and there is only one sample per condition.

## Interpretation

The revised guidance did not reproduce the earlier Jev RESTOCK choice beyond
tick 63: Jev still waited both with existing cooking and with a fully empty
pipeline. Its reported restock preference increased at those two states, but
never became its selected action. Standard and Pro retained RESTOCK in both.

All models selected WAIT under the near-closing treatment. Standard changed from
RESTOCK to WAIT, showing that the addition is not simply a blanket restock nudge.
However, this should not be scored as a demonstrated utility gain: in this
particular state RESTOCK and WAIT tie on final utility because unused raw stock
is salvaged at purchase price. An offline engine replay changing only tick 109
to RESTOCK confirms identical profit ($96) and utility (-1,680), with $40 less
cash offset by 20 additional raw portions worth $40 at closing. No additional
customers are served. Evidence: [late-restock-equivalence.json](evidence/pipeline-validation/late-restock-equivalence.json).

The earlier tick-63 success is therefore insufficient grounds to replace the
production prompt or run another full campaign claiming an idle fix. This test
uses a state-derived version of the prior targeted wording; both state and
wording differ from the original tick-63 treatment. It cannot isolate whether
the previous choice was state-specific, wording-sensitive or sampling variation.
Within each new state, however, the comparison is properly matched.

Recommendation: retain production v4 and avoid another full campaign until a
candidate shows reliable behavior across states. Further work should either
control exact wording/repetition more tightly or evaluate a transparently shared
hybrid safeguard. Neither additional paid testing nor a safeguard was executed
as part of this validation.

## Verification and budget

Four focused tests, typecheck and zero-dispatch preflight passed. They check
state-derived timing, existing work, the closing boundary, identical treatment
instructions across providers, unchanged observations/options and request sizes.
All requests were below 8,192 bytes (largest 7,135). The 18 unique successful
provider receipts reconcile with the retained ledger, and each state's six calls
share the same context hash. Prior records were not reset.

Ledger records: 1,885 → 1,903. New exposure: $0.016518 Jev reservations plus
$0.012000 Zoom allocations, $0.028518 combined. Final cumulative exposure:
Jev $1.894064 of $1.896817; Zoom $1.217000 of $5. No caps changed. Jev has
$0.002753 remaining, enough for one further call under the current reservation
bound. Allocations/reservations are not invoices.

Deployed revision: `f389e3023575d2416d515c31ccfb82beac282d79`.
Final allowed run: `cdeb4749-9f09-4276-b6e5-efff4d99158e`.
Final ledger hash:
`bf633701e84ab4202d53bde186484eddc674bc4908736c91f2d9efc932cd4f8f`.

Evidence: [result.json](evidence/pipeline-validation/result.json),
[events.json](evidence/pipeline-validation/events.json),
[approval and predetermined order](../../manifests/pipeline-validation-approval.json),
and [captured inputs](../../manifests/pipeline-validation-inputs.json).

Inference credentials were removed after the 18 calls. Coolify was restored to
`running:healthy` standby, with the unchanged production v4 builder and no paid
dispatch. The intermediate post-stop status was `degraded:excluded`; the final
standby readiness check passed. See
[deployment.json](evidence/pipeline-validation/deployment.json).
