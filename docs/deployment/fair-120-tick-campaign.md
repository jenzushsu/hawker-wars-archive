# Shared planning over complete 120-tick rounds

Prepared for clean seeds 7, 11 and 23, with Rules, Jev, Zoom Standard and Zoom Pro
in each private round. The user approved the additional budget and execution is
in progress. Results and reconciliation will be added after all rounds finish.

## Behavior

Prompt `hawker-decision-prompt-3` gives identical state, recent-action history,
legal choices, objective and planning instructions to all three models. It asks
each to consider the replenishment → cooking → service sequence and future
customers, then choose exactly one next action. The updated observation is
reassessed every decision tick; sole legal WAIT is applied locally. Repeated
restocking remains legal throughout the round subject to normal game rules.

There is no fixed-plan executor or one-order limit in this campaign. The worker
already supported repeated orders and per-tick decisions; the change is shared
planning guidance and an explicit explanation of continuing reassessment.
The diagnostic plan executors remain separate. Historical experiment request
builders are explicitly pinned to prompt v2 so their reproduction does not
silently adopt the new campaign prompt.

Rules remains the frozen deterministic baseline. Starting state, seed, mechanics,
timeouts, parsing, fallback and closing settlement stay shared. Promotion can
alter realized demand under the same rules. No model is forced to restock or cook.

## Prepared run and budget scope

Three rounds × 120 decision ticks permits at most 360 requests per model. Some
turns may require no request because WAIT is the only legal action. No automatic
repetition beyond these three run IDs is authorized by this preparation.

| Item | Maximum additional allocation/reservation |
| --- | ---: |
| Jev, 360 × $0.002753 | $0.991080 |
| Zoom Standard + Pro, 720 × $0.001 | $0.720000 |

Jev's existing $0.655214 cap is fully reserved. The approved cumulative cap is
$1.646294. Its existing $0.34 per-run cap covers all 120 calls ($0.330360). Zoom's
$0.25 per-run shared cap covers 240 calls ($0.24); the $5 campaign cap stays
unchanged. These are ledger reservations/operator allocations, not invoices.

The three approval records are now `approved`, and the model activation flags
are enabled only for the defined run scope. The run IDs and seeds are in
[`fair-campaign-plan.json`](../providers/fair-campaign-plan.json).

## Deployment procedure

1. The approved cap and model flags are recorded in the per-seed manifests.
   Keep the specified run IDs and exact scope.
2. Use the retained Coolify volume and last experiment ledger identity, never a
   newly initialized ledger. First preparation requires exactly 674 prior records.
3. Deploy `compose.prepare-fair-campaign.yaml` with `HAWKER_SEED=7` (build-time and runtime, non-secret), the current
   ledger hash and previous run ID. The operator validates approval, checks the
   preceding completed simulation, amends the existing ledger and creates a
   private seed-7 round. It performs no provider dispatch.
4. Stop the provisioner and remove its temporary service credentials, then run
   `compose.multi-worker-fair.yaml` against that exact round and manifest.
5. After verifying completion and ledger reconciliation, repeat preparation and
   execution for seeds 11 and 23. Each preparation checks the preceding round is
   completed; retain its exact new ledger identity for the next transition.
6. Compare utility, profit, served, abandoned, waste, waits with SERVE/COOK legal,
   and every fallback/error across all seeds. Report each seed as well as aggregates.

The preparation script supports explicit approved seeds and distinguishes the
last ledger experiment from the last completed simulation for the first transition.
Existing datastore methods and schemas are unchanged.

## Verification

Full worker tests cover all 120 decisions plus closing at each proposed seed,
including process replacement/recovery. With identical mock policies, all four
states, observations and scores match; every policy restocks more than once.
All constructed requests in those trajectories have identical context/instructions
across models and fit the current 8,192-byte allocation bound. This does not
prove future model trajectories always fit; oversize requests retain the existing
explicit quota fallback and must be reported if encountered.

Budget tests verify worst-case call coverage, retained campaign exposure and
explicitly approved run identities. A 1,100 ms supervisor polling pause is used
for these private runs; the database still enforces its unchanged five-second
minimum between committed simulation ticks. Provider calls retain the same
timeout and shared rolling-window rate checks. The initial Coolify build failed
before any ledger transition because its seed selector was runtime-only; exposing
only that non-secret selector at build time resolved Compose path interpolation.
Credentials remain runtime-only.
