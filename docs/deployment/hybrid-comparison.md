# Shared restock hybrid comparison

Completed one private seed-23 comparison with 120 ticks plus closing on Coolify
revision `b7a5172485ae840b069cdf03a0c76403b45add68`. Round
`2a818689-d18d-4810-9d18-aeca4607cf42` used unchanged v4 requests and identical
shared recovery for Jev, Zoom Standard and Zoom Pro. Rules remained frozen.
This experiment did not publish a live-web round or change the production worker.

| Policy | Profit | Prior v4 profit | Utility | Served | Restocks | Guard interventions | Calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules | $311 | $311 | 29,165 | 120 | 5 | 0 | 0 |
| Jev + recovery | $191 | $96 | 11,390 | 75 | 3 | 1 | 100 |
| Zoom Standard + recovery | $236 | $236 | 18,585 | 105 | 6 | 0 | 91 |
| Zoom Pro + recovery | $291 | $291 | 25,590 | 103 | 5 | 0 | 100 |

Profit is simulation currency; provider spending is accounted separately below.
One new run versus one historical run is descriptive, not causal proof of the
$95 Jev improvement: sampled choices differed even before the intervention.
All models had the same guard; only Jev met its trigger in this run.

## Jev recovered, but some idle choices remain

At tick 64 Jev selected WAIT with an empty pipeline, four customers, and RESTOCK
legal. Its reported probabilities were WAIT 78%, RESTOCK 22%. The guard executed
RESTOCK separately, preserving the provider's original WAIT. Delivery was due at
74, cooking could finish at 79, leaving 41 service ticks.

The next observations correctly showed the pending order. Ticks 65–73 were forced
waits, not discretionary idling. Jev selected COOK immediately at 74 and again at
83, then independently selected RESTOCK at 91. It delayed cooking at 101 by one
tick, selected COOK at 102, and served again at 107. Three total orders were at
18, 64 (guard), and 91. Cooking occurred at 0, 12, 36, 46, 55, 74, 83 and 102.

There were **zero executed empty-pipeline WAITs with RESTOCK legal**, versus 47 in
the prior unguarded v4 run. Customers served increased 44→75 and utility
-1,680→11,390. This demonstrates a working recovery path in this run, not a fix to
Jev's raw replenishment preference.

Jev still waited with SERVE legal at ticks **32, 108, 109 and 110**. At 32 it had
three ready portions and one customer; at 108–110 it had seven ready portions
and one customer. These were successful provider WAIT choices, not errors or
budget limits. The empty-pipeline guard intentionally does not cover these cases.
It also waited with COOK legal at 22 ticks, although legality alone does not imply
cooking is optimal (some had ready stock or no queue). Zoom Standard had no waits
with SERVE or COOK legal; Pro had 19 waits with COOK legal and none with SERVE legal.
Neither Zoom model had an empty-pipeline restock-eligible wait or intervention.

The next useful improvement to evaluate offline is a shared serve-first rule
when queued customers and ready food make SERVE legal. It needs separate objective
and timing analysis; no additional guard or paid run is authorized by this report.

## Verification, errors and spending

All 480 decision inputs and canonical context hashes replayed exactly from the
executed histories. The verifier independently recomputed legality, every guard
choice and attribution, frozen Rules actions, closing cash/raw stock, totals and
scores. All original model actions remain distinguishable from executed actions.
Typecheck passed; the prepared implementation's 13 focused tests had passed.

All **291 provider calls succeeded**, with no retries, fallbacks, request-size
failures or budget failures. The retained ledger reconciled **1,903→2,194** calls.
No ledger reset or reservation refund was used.

- Jev added **$0.275300** reservations (100 × $0.002753), cumulative **$2.169364**
  against the approved **$2.224424** cap; $0.055060 remains (20 calls).
- Zoom added **$0.191000** shared allocations (191 × $0.001), under the unchanged
  $0.25/run limit; cumulative **$1.408000** against $5/campaign.
- Combined additional reservations/allocations: **$0.466300**, not invoice cost.

The initial local preflight omitted the hybrid configuration environment and
failed closed with `Unexpected hybrid plan`; rerunning with the same configuration
paths as the deployment passed before any deployment or paid dispatch.

The first standby restoration failed because Coolify referenced a missing external
Docker network after stop/cleanup. A separate standby-only redeployment was
completed with no inference credentials; the paid run was not repeated. The
worker is now `running:healthy` and reports `standby-ready`, with provider dispatch
disabled.

Standby restoration and removed inference credentials are captured in the
[deployment receipt](evidence/hybrid-comparison/deployment.json). The retained
ledger and reports remain on the existing volume. No further paid run is scheduled.

Evidence: [result](evidence/hybrid-comparison/result.json),
[events](evidence/hybrid-comparison/events.json),
[replay analysis](evidence/hybrid-comparison/analysis.json),
[approval](../providers/fair-campaign-approval-hybrid.json).
Reproduce offline with `node --import tsx scripts/verify-hybrid-comparison.ts`.
