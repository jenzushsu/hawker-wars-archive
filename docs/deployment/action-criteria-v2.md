# Cooking clarification: action-criteria-prompt-2

Implemented a new prompt-only candidate following the investigation of Jev's
waits at ticks 86–87. Jev remains on 1.13.0. No paid calls, safeguard, ledger
change, deployment or automatic rerun accompanies this change.

The candidate makes three targeted clarifications:

- Background work progresses during every action, not just WAIT. An approaching
  delivery alone is not a reason to leave usable raw stock idle.
- If COOK is legal, calculate completion using existing ingredients now. If a
  delivery is pending, compare with cooking on its scheduled arrival, conditional
  on legality/capacity and no additional delay. Do not invent a COOK-now option
  when it is illegal.
- Count current customers expiring by the earliest ready tick, including equal
  deadlines. Later deadlines do not guarantee service; future demand and spoilage
  still matter. This supplies mechanics rather than forcing an action.

At tick 86 the candidate explicitly states that cooking now finishes at 91,
whereas waiting for delivery at 88 and then cooking finishes at 93. Three of five
queued customers expire by 91; the remaining two may be served before deadline93.
At 87 cooking now finishes at92. These values are computed from public state,
not hardcoded tick-specific instructions or hidden demand.

Implementation: `packages/providers/src/action-criteria-v2-experiment.ts` exports
`buildActionCriteriaV2Request` and version `action-criteria-prompt-2`. All three
provider interfaces receive identical wording and unchanged context, choices,
objective and model IDs. No action is selected or overridden by the builder.
The original candidate and production v4 remain intact so historical request
hashes are reproducible; the completed paid runner is not silently changed.
A future authorized evaluation must explicitly select the v2 builder.

Validation: ten focused tests and typecheck pass. Cases include exact tick86/87
observations, deadline equality, busy cooker, insufficient stock, full capacity,
closing, no queue and a delivery too late to cook. Initial synthetic fixtures
violated observation conservation rules; they were corrected to valid recorded
states or internally consistent synthetic states before validation passed.

Offline corpus: 243 saved states, 30 forced waits, 639 generated request bodies
across Jev/Standard/Pro. Largest body is 6,719 bytes, below the shared 8,192-byte
limit. All contexts/options remain unchanged and candidate wording is identical
across providers. V2 adds detail: maximum instruction length is 1,744 characters,
compared with v4's 1,410 across this corpus. The previous v1 full-run receipt also
replays and verifies every recorded request hash unchanged.

These checks validate construction, size and mechanics, not improved model
choices. No claim is made that the tick86/87 hesitation has been eliminated.

Evidence: [offline report and exact example prompts](evidence/action-criteria-v2/offline.json).
Reproduce: `node --import tsx scripts/validate-action-criteria-v2.ts`.
