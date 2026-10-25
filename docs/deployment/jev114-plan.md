# Jev 1.14.0 raw full-run plan

Prepared at the user's request: “proceed with just jev 1.14.0 run”. Execution is
pending the cap extension below. No paid calls, ledger amendments or deployment
have occurred for this plan; Coolify remains in standby.

One private 120-tick seed-23 run plus closing uses `jev-1.14.0`, unchanged prompt
v4, and no safeguard. Zoom activation is disabled and its credential is absent
from the compose. No new Rules or Zoom run is needed; prior same-seed scores are
available for descriptive comparison. This does not publish a live-web round.

TypeSafe's [models documentation](https://docs.typesafe.ai/models), checked on
2026-10-25, lists 1.14.0 at the same $0.042 per million input tokens as 1.13.0,
with free output tokens. The existing conservative 65,536-byte request limit and
$0.002753 per-call reservation remain. The exact version is pinned, not an alias.

Tick zero doubles as the credentialed smoke: it must return the requested model
and a request ID before later live calls are allowed. That original tick-zero
choice is executed once; no extra smoke call is added. Any provider fallback,
model mismatch or accounting failure stops the run without automatic retry.
Original choices are executed unchanged, including WAIT. Every tick checkpoints
input, provider result and executed action to the retained volume.

## Budget required

- Prior retained attempts: 2,194.
- Jev reserved: $2.169364; existing cap: $2.224424.
- Remaining: $0.055060, enough for only 20 calls.
- Maximum new run: 120 calls × $0.002753 = **$0.330360**.
- Requested cumulative cap: **$2.499724**, an increase of **$0.275300**.
- Zoom additional allocation: **$0**; existing limits remain unchanged.

[Approval record](../providers/fair-campaign-approval-jev114.json) remains
`pending-budget-approval`. The runner checks approval before opening or amending
the ledger. An exclusive one-use lock and expected prior ledger identity prevent
accidental replay or resetting retained exposure.

Two focused tests and typecheck pass: all 120 raw actions remain unchanged even
when an empty pipeline could trigger the hybrid guard, and an incorrect returned
model is rejected. No-dispatch preflight passed with a 5,882-byte initial request.
An unapproved invocation exited 2 before ledger access or provider dispatch.

After execution, replay all captured inputs/actions and closing scores, reconcile
Jev-only ledger changes, count empty-pipeline and serve/cook-eligible waits, and
compare descriptively against raw 1.13.0. Report model version separately from
the 1.13.0 hybrid. Remove inference credentials and restore healthy standby.

Files: `scripts/jev-version-comparison.ts`, `scripts/run-jev114-comparison.ts`,
`compose.jev114-comparison.yaml`, and `manifests/provider-runtime-jev114.json`.
