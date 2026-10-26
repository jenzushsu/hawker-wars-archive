# Matched-state tick-63 comparison

One paid request per model was made after the user approved the exact-state
diagnostic. All three received Jev's reconstructed tick-63 observation from the
v4 seed-23 run, including the original recent-action history, unchanged prompt
v4, and the same ordered choices: RESTOCK, WAIT. Only the accounting run UUID
changed; it is excluded from the wire context. The runner verifies identical
canonical context before dispatch.

The state has $380 cash, four waiting customers, 57 ticks remaining, no raw or
ready stock, and no pending delivery or cooking. A restock costs $40, takes ten
ticks to arrive, then requires five ticks to cook before serving.

| Model | Selected action | Reported RESTOCK probability | Reported WAIT probability | Latency |
| --- | --- | ---: | ---: | ---: |
| Jev 1.13.0 | WAIT | 16% | 84% | 307 ms |
| Zoom Decisions Standard | RESTOCK | 98.1263% | 1.8737% | 501 ms |
| Zoom Decisions Pro | RESTOCK | 99.9718% | 0.0282% | 476 ms |

These are provider-reported choice probabilities, not calibrated confidence
estimates or comparable measures of correctness across providers. All three
responses passed validation; there were no fallbacks or retries.

## Interpretation

Jev reproduced its recorded WAIT choice. Standard and Pro chose RESTOCK on that
same empty-pipeline state. Thus the original difference cannot be explained only
by the models having reached different inventory states: it persists in this
matched-state check under identical shared guidance and legal choices.

This supports a replenishment-choice failure in this state. It does not reveal
Jev's internal reasoning, prove why it prefers WAIT, or establish behavior across
other states. One call per model is a spot check, not a repeatability study.
No alternative prompts, choice-order permutations or hidden executor rules were
introduced. The choices were not executed into a new simulation continuation.

The earlier offline Rules continuation demonstrated that recovery remained
possible from this state. Taken together, the evidence favors investigating
multi-step action valuation or an explicitly shared execution safeguard, rather
than increasing API budget again. Any safeguard should apply equally to all
models and be reported as a hybrid policy; none was added by this diagnostic.

## Provenance and accounting

- Source round: `81180c83-7388-4540-a46d-6602049e403c`, policy Jev, tick 63.
- Diagnostic run: `c7ff5c31-65ed-4e78-bb20-8fb77e859ce3`.
- Shared context SHA-256: `f7372f8ec74e99137f324a06176ca11d4cddc9cb3d30d949caaf2a149a0efb7a`.
- Request bytes: Jev 6,028; Standard 6,057; Pro 6,052, all below 8,192.
- Deployed revision: `bfd065287922830bc1d94aa1a58c24156e013e76`.
- Retained ledger records: 1,876 → 1,879, exactly three successful new calls.
- Additional reservations/allocations: Jev $0.002753; Zoom $0.002000.
- Cumulative exposure: Jev $1.872040 of $1.896817; Zoom $1.201000 of $5.
- Final ledger hash: `564a80dc533cd550ed979e52f0dee6e7aa0e943568ebf906446059d75b83cfbc`.

No spending caps were increased. Reservations and operator allocations are not
invoices. Typecheck and zero-dispatch preflight passed; all three outcomes
reconcile with ledger increments. The one-use runner fails closed if invoked
again against the amended ledger. Inference credentials were removed after the
test, and standby restoration is recorded in the deployment receipt.

Evidence: [result.json](evidence/tick63/result.json),
[events.json](evidence/tick63/events.json),
[input](../../manifests/tick63-input.json), and
[approval](../../manifests/tick63-approval.json).

Coolify's post-stop aggregate status remained `degraded:excluded`; the operator
then restored the explicit standby compose. Final status is `running:healthy`,
with `standby-ready` and no inference credentials in configuration. See
[deployment.json](evidence/tick63/deployment.json). No additional calls or runs
were launched during cleanup.
