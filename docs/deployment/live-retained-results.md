# Published four-policy round with retained prompt

Completed the user-approved live comparison: clean seed23,120 decision ticks plus
closing, frozen Rules and Jev1.13.0/Zoom Standard/Zoom Pro using the same retained
`action-criteria-prompt-1`. No safeguard or voting. The user received the direct
viewer link before worker startup; the public API was checked at multiple live
ticks with all four policies and again after closing.

[View the completed live round](https://hawker-wars-staging.vercel.app/live/a4366c8c-a68e-4699-adcc-f06e754ef352).

| Policy | Profit | Utility | Served | Abandoned | Wasted | Restocks | Calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules | $311 | 29,165 | 120 | 2 | 22 | 5 | 0 |
| Jev1.13.0 | $241 | 18,625 | 85 | 34 | 7 | 3 | 103 |
| Zoom Standard | $221 | 16,935 | 102 | 19 | 40 | 6 | 88 |
| Zoom Pro | $246 | 19,475 | 98 | 21 | 24 | 5 | 100 |

These are simulation profits, separate from provider costs. All models had zero
empty-pipeline WAITs with RESTOCK legal and zero WAITs with SERVE legal. Rules
remains ahead overall. Jev served fewer customers than Zoom but wasted fewer
portions; compare utility and customer outcomes as well as profit.

## Jev repeat and fairness

Jev repeated the prior retained-prompt result of $241 and85 served, now with
18,625 utility versus18,515 (22 fewer accumulated customer wait-minutes). Its
orders were at0,67,80, versus0,67,78 previously. It cooked upon delivery at77 and
served until115. There were23 WAITs with COOK legal; legality alone does not make
each wait an error, since some states have ready stock, no queue or little time.
This second full run supports the retained choice but does not establish
reliability across seeds or general model ranking.

All three models received identical request-building rules and instructions, each
with its own evolving observation. Their trajectories, promotions and resulting
arrival totals can differ; fairness does not mean forcing identical actions or
queues. Rules followed the unchanged frozen controller. V2 cooking clarification
was not selected. No hidden realized demand or model-specific action override
was introduced.

## Verification

All480 decisions were independently replayed against the engine. Every action
was legal, Rules matched its frozen decisions, and final scores, cash, served and
abandoned counts matched the database. There were121 unique ticks/sequences,
including exactly one closing event. The published flag, seed and private
provider-configuration hash matched the retained-prompt runtime. Live worker
identity includes the selected prompt, preventing silent recovery under another
prompt. The adapter checks response model identities; the deployment pins Jev1.13.

Twenty-five focused tests, including full worker replays, typecheck and preflight
passed before deployment. Runtime revision:
`e86ca1e` (full SHA in deployment receipt). Public feed validation did not require
frontend or schema changes. Completed results remain published after standby.

## Errors, budget and cleanup

All291 provider calls succeeded, without retries or fallbacks. Ledger continuity:
2,526→2,817 attempts. Original reservations were retained across the transition.

- Jev added **$0.283559** (103 × $0.002753), cumulative **$3.366919** against the
  approved **$3.413720** cap. Remaining **$0.046801** covers17 conservative calls.
- Zoom added **$0.188000** combined allocations, below $0.25/run; cumulative
  **$1.596000** remains below $5/campaign.
- Combined additional reservations/allocations: **$0.471559**, not invoice cost.

A direct REST read from the execution workspace returned403 during inspection;
the connected read-only SQL tool provided the authoritative records instead.
The live site's public API and provider calls were unaffected. Graceful worker
stop exceeded the initial40-second polling window; exited status was verified
before standby deployment. Neither incident triggered additional paid calls.

Inference credentials were removed. Bootstrap is stopped with its temporary
service credential removed. Final standby health is recorded in the
[deployment receipt](evidence/live-retained/deployment.json). No further run is
scheduled; the public completed round remains viewable.

Evidence: [verified comparison](evidence/live-retained/comparison.json),
[decisions](evidence/live-retained/decisions.json),
[database completion](evidence/live-retained/database.json),
[accounting](evidence/live-retained/receipt.json),
[public live start](evidence/live-retained/live-start-view.json),
[public closing view](evidence/live-retained/live-final-view.json).

Reproduce offline:
`node --import tsx scripts/analyze-recorded-comparison.ts docs/deployment/evidence/live-retained/decisions.json docs/deployment/evidence/live-retained/analysis.json 23`
then `node --import tsx scripts/verify-live-retained.ts`.
