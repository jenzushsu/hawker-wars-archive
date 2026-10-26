# Shared action-criteria prompt: offline validation and authorized Jev run

Status: completed. See [results and idle analysis](criteria-comparison.md).

User authorized: “avoid safe guard and run a full tick. increase jev threshold.
jev to maintain 1.13.0”. Execute one private seed-23 run of 120 ticks plus closing
on Jev 1.13.0, with no action overrides or Zoom calls.

The experimental builder replaces the v4 instruction prose with concise action
criteria. It retains the exact v4 observation, public mechanics/objective, legal
choices and model identity. A derived pipeline summary reports stock, existing
work and conditional earliest delivery/cooking timing. It never supplies hidden
demand or guarantees profit. It identifies impossible late cooking and illegal
restocks; it does not impose a fixed restock cutoff or select actions in code.

Offline validation covers 123 saved states (120 from the 1.14 run and three prior
diagnostic states), skipping 15 forced waits: 324 request bodies across all three
model interfaces. Context/choices are unchanged, instructions identical across
providers, and all bodies fit the shared 8,192-byte bound. Tests cover supplier
delay, existing orders, closing, no safeguard and exact model matching. Five
focused tests and typecheck pass. This validates construction and mechanics,
not model decision quality. Full details: [offline evidence](evidence/action-criteria/offline.json).

The candidate is `action-criteria-prompt-1`; production v4 remains unchanged.
Runtime uses the separate experimental request builder and records each sent
body hash/size so the exact prompt can be reproduced. The first tick doubles as
an identity smoke; returned version must be `jev-1.13.0`. Stop on errors without
retry, reset or silently executing a fallback. The retained ledger/one-use lock
prevent accidental repeats.

Budget: prior Jev exposure $2.458429; approved new ceiling $2.788789, covering at
most $0.330360 (120 calls) for this run. Increase over the prior $2.499724 cap is
$0.289065. Per-run $0.34 cap remains sufficient. Zoom adds $0 and retains its prior
limits/exposure. Approval: [record](../providers/fair-campaign-approval-criteria.json).
No additional approval is required: the latest user instruction explicitly
requests increasing the Jev threshold for this full run.

After completion, replay observations/actions/scores, reconstruct every candidate
request hash, reconcile ledger exposure, and compare idle patterns and scores
with raw 1.13.0 and 1.14.0. Single-run comparisons remain descriptive. Restore
healthy standby and remove inference credentials; do not publish a live-web round.
