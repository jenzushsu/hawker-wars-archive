# Prepared live comparison with retained prompt

User requested rerunning the retained prompt across all models and watching live.
One published seed23 round will run 120 decision ticks plus closing:

- Jev `jev-1.13.0`, Zoom Standard and Zoom Pro receive identical
  `action-criteria-prompt-1` instructions, game rules and observation format.
- Rules remains the frozen baseline. No safeguard, action override or voting.
- Each policy has its own evolving state. Five-second tick interval targets about
  ten minutes of visible simulation, plus provider/store latency.

Planned round ID: `a4366c8c-a68e-4699-adcc-f06e754ef352`.
Planned viewer URL (not created yet):
`https://hawker-wars-staging.vercel.app/live/a4366c8c-a68e-4699-adcc-f06e754ef352`.
The existing `/live` page responds HTTP200. Read-only database inspection confirms
recent four-policy database rounds are completed; the latest is private at tick120.
No public table/schema/RLS changes are needed: use existing published-round RPCs.

## Implementation

The live runtime now supports an explicit retained-prompt selector; its provider
configuration hash includes that selection. Existing default v4 behavior and old
prompt serialization remain unchanged. All three adapters receive the retained
request builder. The worker checks the matching approved publication/prompt/round
record before opening the ledger. An unsupported selector is rejected. Private
recovery metadata, credentials and raw provider diagnostics stay server-side.

`prepare-live-retained.ts` verifies the prior retained ledger and completed DB
round, amends only to the approved identity/cap, and creates a published four-policy
round. It has no inference credentials or provider dispatch. It must not be rerun
blindly after a partial amendment. The prepared worker compose uses the same
runtime/exception files and explicit prompt selector, on the existing retained
volume. Both preparation and worker commits must be pinned to the same revision.

No deployment, database publication, ledger amendment or paid calls have happened
for this plan. Budget extension approved by the user: “extend limit”.

## Exact budget extension

Current Jev exposure: $3.083360 against $3.110890, leaving $0.027530 (ten calls).
Maximum new Jev reservations: 120 × $0.002753 = **$0.330360**.
Requested cumulative cap: **$3.413720**, an increase of **$0.302830**.

Zoom requires at most 240 × $0.001 = **$0.240000** combined allocations, within its
unchanged $0.25/run and $5/campaign limits. Prior Zoom allocation: $1.408000.
Total maximum additional reservations/allocations: **$0.570360**. These are
conservative accounting bounds, not invoice charges.

[Approval record](../providers/fair-campaign-approval-live-retained.json) is
approved. Existing manifests are historical runs; do not reset or replay them.
Expected retained attempts:2,526. Prior ledger identity comes from the completed
v2 experiment, independently of the older DB round used to verify completion.

Validation completed:25 tests passed, including three full120-tick worker replay
checks; typecheck and no-dispatch preflight passed. New tests verify shared retained
builder routing, unchanged selected actions, public-round identity and rejection
of unsupported prompt selection.

## Launch and verification

After cap approval: provision the public round on the bootstrap app without
inference keys, verify its receipt/DB identity, stop bootstrap and remove its
temporary service credential, then share the direct viewer link before starting
the worker. Start only the specified four-policy round, poll its live API/DB
sequence and policy snapshots, and provide progress while the user watches.
Readiness and a published initial snapshot may require the first tick commit.
Do not confuse the homepage's recorded replay with this direct live-round route.

After closing: verify121 unique tick commits including settlement,480 decision
records, exact replayed scores/totals, provider model/configuration identities,
all errors and ledger exposure. Compare with earlier runs descriptively. Stop
inference and restore healthy standby, leaving the completed public round viewable.
This plan authorizes no automatic repeat or persistent campaign loop.
