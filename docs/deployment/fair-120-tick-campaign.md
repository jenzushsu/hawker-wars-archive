# Shared planning over complete 120-tick rounds

Completed clean demand seeds 7, 11 and 23, with Rules, Jev, Zoom Standard and
Zoom Pro in each private 120-tick round. All runs used deployed commit
`bc5b4e8eb604d002f46ee1019c6e21eff2ae4033` and prompt v3. Seeds 7 and 11 had no
fallbacks. Seed 23 had two zero-dispatch Zoom request-size fallbacks and must not
be presented as a pure model comparison.

## Results

Game profit excludes API fees. These are three selected seeds with one run each,
not a general model ranking or statistical estimate.

| Demand seed | Rules | Jev | Zoom Standard | Zoom Pro |
| --- | ---: | ---: | ---: | ---: |
| 7 | $311 | $106 | $251 | $286 |
| 11 | $336 | $136 | $241 | $281 |
| 23 (two fallbacks) | $311 | $71 | $216 | $246 |
| All-three mean (includes fallbacks) | $319.33 | $104.33 | $236.00 | $271.00 |
| Fallback-free seeds 7 and 11 mean | $323.50 | $121.00 | $246.00 | $283.50 |

Rules achieved the highest profit and utility in each seed. It served an average
120.33 customers, compared with Jev 45.67, Standard 107 and Pro 99. Standard
restocked 6, 6 and 7 times and wasted an average 38.33 portions; Rules restocked
five times in each seed and wasted 18.33. Pro used 4, 5 and 5 restocks and wasted
13 portions on average. Rules combined high service throughput with fewer
purchases than Standard. Promotion choices alter realized arrivals, so the same
seed does not imply identical realized customer counts under different policies.

The shared planning guidance did **not** resolve Jev's replenishment failure:

| Seed | Jev's sole restock tick | Last serve tick | Empty-pipeline WAIT ticks with RESTOCK legal |
| --- | ---: | ---: | --- |
| 7 | 17 | 58 | 59–109 (51) |
| 11 | 7 | 56 | 57–109 (53) |
| 23 | 8 | 56 | 57–109 (53) |

Jev made 110 successful calls in each seed, without a provider fallback or budget
block. These waits were model choices, not an enforced one-order rule. None of
the four policies waited with SERVE legal in any seed. WAIT with COOK legal or
ready stock is recorded separately and is not automatically classified as an
error: cooking delay, customer arrivals, expiry and closing can justify waiting.

## Errors and recovery

At seed 23 tick 80, Standard's request was 8,216 bytes and Pro's was 8,207 bytes,
exceeding their 8,192-byte operator-approved envelope. Both had 12 queued
customers and legal actions SERVE, COOK, WAIT. The adapter blocked dispatch and
used the deterministic fallback SERVE. Neither incurred a call reservation.

The controller stopped for inspection. Offline reconstruction reproduced the
byte counts. The same round resumed with the same commit, prompt, ledger and
bounds; committed decisions were retained. No further fallbacks occurred.
The initial build-time seed-selector failure is also retained in the error log.

Mock full-round tests covered all three seeds but did not exercise the larger
queues reached by the live policies. Before another paid comparison, the shared
request representation needs worst-case legal-state size coverage and a compact
representation within the approved envelope, or an explicitly approved envelope
change. A new configuration needs fresh runs for all policies; changing this
completed run would invalidate its provenance. No additional paid run was made.

## Accounting and verification

There were 899 new provider calls: 330 Jev and 569 combined Zoom. Jev reserved
$0.908490 additional, below the approved $0.991080, bringing retained cumulative
reservations to $1.563704 of $1.646294. Zoom allocated $0.569000 additional,
bringing its campaign allocation to $1.007000 of $5. Each round remained below
the $0.25 shared Zoom limit. Reservations and allocations are not invoices.

The retained ledger grew from 674 to 1,573 records. All 1,440 decisions and 363
unique events reconcile with the ledger and deterministic offline replay; each
round has exactly 120 decisions per policy and one closing event. The two
zero-dispatch fallbacks are matched to their decision records and excluded from
paid-call counts. Rules' seed-7 snapshots also match the earlier v2 run at all
121 boundaries. Typecheck and the targeted worker, wire, planning, budget,
supervisor and ledger tests passed; real model trajectories exposed the size
coverage gap described above.

The worker and provisioner are stopped. The worker's inference credentials and
the provisioner's temporary service credential were removed from Coolify
configuration. The worker retains its existing datastore service credential.
The rounds remain private. PR #7 contains the implementation and evidence;
these results have not been merged or posted to LinkedIn.

Machine-readable results: [comparison.json](evidence/fair-120-tick/comparison.json).
Each seed's database summary, decisions, replay analysis, accounting receipt and
worker events are retained in the same directory. The request-size incident is
recorded in [seed-23-request-size-incident.json](evidence/fair-120-tick/seed-23-request-size-incident.json).

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
