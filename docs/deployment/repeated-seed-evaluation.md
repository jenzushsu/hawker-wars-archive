# Held-out repeated-seed evaluation

Six completed, unpublished clean-scenario rounds tested whether the retained
`action-criteria-prompt-1` behavior survived beyond seed 23. Seeds 31, 47 and 59
were selected before dispatch and run twice each. Each round had 120 decision
ticks plus closing. Jev used pinned `jev-1.13.0`; Zoom Decisions and Zoom Decisions
Pro used configured API model IDs `zoom-decisions-standard` and
`zoom-decisions-pro`. The same prompt builder, public rules, legal-action schema
and utility objective applied to every model. Each controlled its own evolving
stall; promotions can change realized arrivals. No safeguard, vote, or prompt
revision was introduced between repetitions. Rules ran as a frozen reference.

| Seed / repeat | Jev profit / served / waste | Zoom Decisions profit / served / waste | Zoom Decisions Pro profit / served / waste |
| --- | ---: | ---: | ---: |
| 31 / 1 | $231 / 83 / 9 | $296 / 114 / 18 | $331 / 112 / 0 |
| 31 / 2 | $241 / 85 / 7 | $296 / 114 / 18 | $311 / 107 / 5 |
| 47 / 1 | $276 / 92 / 0 | $286 / 115 / 27 | $331 / 111 / 1 |
| 47 / 2 | $276 / 92 / 0 | $306 / 115 / 17 | $311 / 111 / 11 |
| 59 / 1 | $256 / 88 / 4 | $286 / 111 / 21 | $296 / 104 / 8 |
| 59 / 2 | $226 / 78 / 4 | $266 / 111 / 31 | $296 / 104 / 8 |

All money is simulated game profit, excluding API charges. Across these six
rounds, Zoom Decisions Pro led the three models in game profit each time
(mean $312.67; range $296–$331). Zoom Decisions served the most customers each
time (mean 113.3; range 111–115). Jev averaged $251 profit and 86.3 served;
its mean waste was 4 portions, compared with 5.5 for Zoom Decisions Pro and
22 for Zoom Decisions. Jev had the least waste in four of six rounds, while
Zoom Decisions Pro did in the other two. Rules earned $331–$356 and served
124–129 across these schedules; it is a simulator reference, not an optimal
per-tick label set for grading model choices.

The original clean seed-23 all-model round remains separate: Jev $241 / 85
served / 7 wasted; Zoom Decisions $221 / 102 / 40; Zoom Decisions Pro $246 /
98 / 24. That round's profit order differed from these six repetitions. The
new results show sensitivity to demand schedule and repeat variation rather
than proving a population ranking. Only three distinct seeds were tested, and
identical seeds reuse the same potential demand schedule. The models still
create different trajectories through their actions. Provider backend weight
revisions for the Zoom model IDs were not independently pinned.

## Per-tick behavior and fallbacks

Every one of the 2,880 recorded decisions (four policies × 120 ticks × six
rounds) replayed legally against the simulation engine. The replay reproduced
closing profit, utility, service, abandonment, waste and restocks for every
model and matched the frozen Rules action at every tick. No model made a WAIT
with an empty food pipeline while RESTOCK was legal in these six rounds. That
specific historical Jev failure did not recur under the retained prompt, even
though Jev still served fewer customers than the other models.

Seven provider fallbacks occurred: six invalid Jev responses and one Zoom
Decisions Pro timeout. Jev fell back at seed 31/repeat 1 ticks 1 and 100;
seed 31/repeat 2 tick 82; and seed 47/repeat 1 ticks 25, 35 and 83. Zoom
Decisions Pro fell back at seed 31/repeat 1 tick 21. The worker used the frozen
Rules choice for those seven decisions. Seed 47/repeat 2 and both seed-59
rounds were fallback-free. Scores for rounds with fallbacks describe mixed
model/fallback trajectories; they are not pure model-only outcomes. Differences
also occurred in fallback-free repeats, so fallbacks alone do not explain all
variation.

The [full per-tick action strings](evidence/repeated-seeds/timelines.json) encode
actions, model versus forced WAIT versus Rules source, and fallback reason. The
[expanded decisions and independent replay results](evidence/repeated-seeds/runs)
make the timelines and closing scores auditable. Reproduce one replay with:

```sh
node --import tsx scripts/analyze-recorded-comparison.ts \
  docs/deployment/evidence/repeated-seeds/runs/b653ebdb-8164-4293-afa5-1339eba43bb8.json \
  /tmp/seed31-replay.json 31
```

## Bounded dispatch and cleanup

The approved Jev cumulative reservation ceiling rose from $3.413720 to
$5.349079. Six rounds made 612 Jev attempts, adding at most $1.684836 of
conservative reservations to the retained $3.366919, for $5.051755 cumulative
and $0.297324 headroom. The two Zoom models made 1,158 attempts combined,
adding $1.158000 to the prior $1.596000 allocation, for $2.754000 cumulative
against the unchanged $5 campaign cap. Per-round combined Zoom allocation
was $0.188–$0.197, below the unchanged $0.25/run cap. These are budget
reservations/allocations, not invoice charges or simulation profit.

All six database rounds are completed at tick 120 with sequence 121 and remain
unpublished. The Coolify repeat worker exited after the batch. The four
temporary production/preview inference environment entries were deleted, and
the application was deployed back to `/compose.multi-worker-standby.yaml` at
`8e16d68`; deployment `gkwxywjnum53pvtdykf765um` finished and standby health
was `running:healthy` with no inference credentials attached.

Sources: [fixed run plan](../providers/repeated-seed-plan.json),
[model metrics](evidence/repeated-seeds/results.json),
[recorded action strings](evidence/repeated-seeds/timelines.json), and
[retained prompt implementation](../../packages/providers/src/action-criteria-experiment.ts).
