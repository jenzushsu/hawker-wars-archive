# Explicit timeline treatment on Jev's tick-63 state

The user approved trying explicit recovery timing. One additional request per
model used the same captured observation, recent actions, legal-action ordering
and base v4 prompt as the previous matched-state test. Only the following shared
instruction was appended:

> Explicit timing for this observation: RESTOCK at tick 63 would deliver 20 raw portions at tick 73. If you then choose COOK at tick 73, 10 portions would become ready at tick 78, with 42 decision ticks remaining before closing at tick 120. These later actions are conditional choices, not automatic execution. WAIT at tick 63 starts no delivery or cooking; if you instead RESTOCK at tick 64 and COOK on delivery at tick 74, the first batch would be ready at tick 79. Evaluate the timing when choosing between the two legal actions.

| Model | Original choice | Timeline choice | Original P(RESTOCK) | Timeline P(RESTOCK) |
| --- | --- | --- | ---: | ---: |
| Jev | WAIT | WAIT | 16% | 41% |
| Zoom Standard | RESTOCK | RESTOCK | 98.1263% | 98.4575% |
| Zoom Pro | RESTOCK | RESTOCK | 99.9718% | 99.9792% |

Jev's reported preference moved toward RESTOCK, but WAIT remained its selected
action (reported probability 59%). The timeline treatment therefore did not fix
the decision in this test. Both Zoom models retained RESTOCK. All three calls
succeeded without retries or fallbacks; latencies were 306, 539 and 551 ms.

Probabilities are provider-reported and not calibrated across models. The control
was the earlier unchanged-prompt call, not a simultaneous randomized repeat.
With one call per condition, the probability difference is a diagnostic clue,
not proof that the wording caused it. This test does not establish full-round
performance or isolate the model's internal reason for choosing WAIT.

The timeline addition remains a diagnostic-only request builder. Production v4
instructions were not changed, no actions were forcibly executed, and no full
campaign was started. A next diagnostic could explicitly distinguish the
expiring current queue from future arrivals, using the original and timeline-only
conditions as controls. That separate treatment has not been run.

## Verification and budget

Two tests verify unchanged observation/options, identical treatment instructions
across providers, correct fixed-state timing text, bounded request size and
rejection of a different state. Typecheck and zero-dispatch preflight passed.
The context hash matches the baseline exactly:
`f7372f8ec74e99137f324a06176ca11d4cddc9cb3d30d949caaf2a149a0efb7a`.
Treatment request sizes were 6,560 / 6,589 / 6,584 bytes.

Run `5277c2c3-4f6f-4aec-a910-938a62ef9594` executed at revision
`ba26d660b0893f57884236300f3bbde7e488674a`, experiment `tick63-timeline-1`.
The retained ledger grew from 1,879 to 1,882 records. The three successful calls
reconcile with $0.002753 additional Jev reservations and $0.002000 Zoom
allocations, with all caps unchanged. Final cumulative exposure is $1.874793
Jev of $1.896817, and $1.203000 Zoom of $5. These are not invoices.
Final ledger hash:
`6405fae2770da1640df3b4bb7d2de56bfd064635e5a6b0338eac2fcd1015ddc2`.

Evidence: [result.json](evidence/tick63-timeline/result.json),
[events.json](evidence/tick63-timeline/events.json),
[approval](../../manifests/tick63-timeline-approval.json), and
[diagnostic builder](../../packages/providers/src/timeline-experiment.ts).

After recording the results, inference credentials were removed and Coolify was
restored to `running:healthy` standby with the unchanged production v4 builder.
The post-stop aggregate briefly reported `degraded:excluded`; the subsequent
standby deployment passed its offline readiness check. See
[deployment.json](evidence/tick63-timeline/deployment.json). No additional paid
calls were made during cleanup.
