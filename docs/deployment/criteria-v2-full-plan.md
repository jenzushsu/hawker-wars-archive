# Prepared full-round action-criteria v2 evaluation

User requested full-round performance after the repeated tick86/87 comparison.
Prepared one private clean seed23 run: 120 decision ticks plus closing, Jev1.13.0,
`action-criteria-prompt-2`, unchanged game mechanics and no safeguard. No Zoom calls
or live-web publication. All model choices are executed unchanged. Tick zero
also verifies the returned model identity; no extra smoke call is needed.

Round ID: `371de41b-8241-4514-ba95-52c7ddcdcac2`.

## Budget extension needed before execution

The previous approval explicitly capped cumulative reservations at $2.788789.
After the 12-call test, Jev reservations total $2.780530, leaving $0.008259 (three
calls). A full round needs at most $0.330360 (120 × $0.002753).

Requested new cumulative cap: **$3.110890**. Increase over current cap:
**$0.322101**. The existing $0.34 per-run cap remains sufficient; Zoom exposure
and limits stay unchanged. No refund/reset of prior reservations is assumed.
[Approval record](../providers/fair-campaign-approval-criteria-v2.json) is pending.
The user authorized the full run, but has not yet explicitly extended this cap.

## Prepared execution and validation

Dedicated compose/runtime/runner select the v2 builder and pinned Jev1.13.0.
Expected retained ledger: 2,416 attempts; previous allowed run
`3c3ed075-d9f9-4970-bf1e-6ef737f2c28f`; config hash
`f47283f4a7a14331faeec245296b9ab005c1b575766e06ecb7be882ef6d3a6b6`.
Approval is checked before ledger access or lock creation. One-use lock, prior
ledger identity, per-call reservations, exact version checks and stop-on-error
behavior prevent unapproved dispatch or automatic reruns.

No-dispatch preflight passed (initial body 6,120 bytes), typecheck passed, and an
unapproved invocation exited2 before ledger access/dispatch. Existing v2 tests
and 243-state offline validation remain applicable; the prompt is unchanged from
the successful repeated state test. No deployment or paid call occurred here.

After approval: execute once, checkpoint inputs/actions/request hashes, reconcile
ledger usage, replay final scores and compare with v1's $241 / 18,515 utility /
85 customers. Inspect both stockout idling and cooking delays without assuming
those same tick numbers recur. Report limitations of a single seed/round. Remove
inference credentials and restore healthy standby. Prior diagnostics do not
establish full-round improvement in advance.
