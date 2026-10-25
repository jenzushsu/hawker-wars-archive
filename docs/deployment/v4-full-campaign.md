# Full v4 comparison, seed 23

Completed one user-authorized private 120-tick round under shared prompt v4,
with Rules, Jev, Zoom Standard and Zoom Pro. Round
`81180c83-7388-4540-a46d-6602049e403c` ran on Coolify revision
`999d2b091b14fe8547d36c7a2aff76d4043982c1`. There were no errors, fallbacks,
request-size failures or retries. No policy waited while SERVE was legal.

| Policy | Profit | Utility | Served | Restocks | Paid calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rules | $311 | 29,165 | 120 | 5 | 0 |
| Jev | $96 | -1,680 | 44 | 1 | 110 |
| Zoom Standard | $236 | 18,585 | 105 | 7 | 91 |
| Zoom Pro | $291 | 25,590 | 103 | 5 | 99 |

Profit excludes API fees. Rules served more customers with fewer purchases than
Standard, which bought 140 portions and wasted 37; Rules bought 100 and wasted
22. Pro bought 100 and wasted 9. Promotion choices alter realized arrivals under
the same seed. These are descriptive outcomes from one run, not a model ranking.

## Jev behavior

Jev restocked at tick 19, last served at tick 62, then selected WAIT on ticks
63–109 (47 decisions) with no raw stock, ready stock, cooking or pending delivery
and RESTOCK legal. Its 110 calls all succeeded. No budget gate or provider
fallback explains these waits. Extending the cap funded the full run but did not
resolve the model's replenishment choice. The final ten forced-WAIT ticks did not
call a provider. Other models placed multiple orders under the same game rules.

## Comparison with the prior v3 seed-23 run

| Policy | v3 profit | v4 profit | Difference |
| --- | ---: | ---: | ---: |
| Rules | $311 | $311 | $0 |
| Jev | $71 | $96 | +$25 |
| Zoom Standard | $216 | $236 | +$20 |
| Zoom Pro | $246 | $291 | +$45 |

The prior v3 round had two Zoom size-limit fallbacks at tick 80. The v4 round
completed without any, validating the request-envelope fix over this full live
trajectory. Prompt formatting changed and model trajectories diverged; one run
per version cannot establish that the format change caused the profit gains.
The deterministic Rules baseline and simulation mechanics remained unchanged.

## Budget and retained ledger

The user requested a Jev threshold extension and one full run. Jev's cap increased
from $1.646294 to $1.896817, sufficient for up to $0.330360 additional reservations
above its existing $1.566457 exposure. Zoom retained $0.25/run and $5/campaign caps.

Actual new exposure was $0.302830 Jev reservations plus $0.190000 Zoom allocations
($0.492830 combined). Final cumulative exposure is $1.869287 Jev and $1.199000 Zoom.
Reservations and operator allocations are not invoices. All 300 calls succeeded,
and retained ledger records increased from 1,576 to 1,876. The final ledger hash is
`861ff22cbe20dbdbce836afa353d304b7bf77e69cac4ab376f35392e13f7570d`.

## Verification and cleanup

Offline reconstruction matches all closing profits, utilities, cash, served and
abandoned totals. All four policies have exactly 120 ordered decisions, with 121
unique events and one closing event. The verifier checks approved identity,
prompt/configuration hash, ledger continuity, per-provider calls and cap usage.
Typecheck passed. No new inference was used for analysis.

Coolify is restored to `running:healthy` standby at the same revision, with
inference credentials removed from configuration. The provisioner is stopped
and its temporary datastore credential removed. No extra run was scheduled.
The round remains private and PR #7 remains unmerged.

Evidence: [comparison.json](evidence/v4-full/comparison.json),
[receipt.json](evidence/v4-full/receipt.json),
[worker-events.json](evidence/v4-full/worker-events.json), and
[final-runtime-status.json](evidence/v4-full/final-runtime-status.json).
Reproduce offline with:

```sh
pnpm exec tsx scripts/analyze-recorded-comparison.ts docs/deployment/evidence/v4-full/decisions.json docs/deployment/evidence/v4-full/analysis.json 23
pnpm exec tsx scripts/verify-v4-full.ts
```
