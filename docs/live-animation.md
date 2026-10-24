# Live stall animation

Live snapshots may include an optional `activity` object on each policy. The rules worker derives it from the committed engine state and changes in served/abandoned totals. It contains only bounded queue poses, counts, inventory and the applied action; customer identities and recovery state remain private.

The live page reuses the demo renderer with only the centre stall active. A selector chooses the policy for multi-policy rounds. Queue sprites are representative (at most three); the displayed queue count is authoritative. Animation pauses on disconnect, operator pause/stop, completion and page hiding, and respects reduced motion. Polling the same tick does not restart movement. Older snapshots remain readable and show an activity-unavailable message.

## Rollout

1. Apply `supabase/migrations/202610240001_live_activity.sql`. This preserves old snapshots and commits, the voting wrapper, permissions, pacing and fencing.
2. Deploy the web/API code that accepts optional activity. Existing viewers using the older strict schema should reload before the updated worker runs.
3. Restart the rules worker with the updated code. Subsequent committed ticks contain activity; previous ticks are not rewritten.
4. Verify a running round in the hosted browser, including walking and operator pause/resume.

## Staging verification

The activity migration is installed on `hawker-wars-staging`. Vercel deployment
`dpl_GhcHZRV8JR9aJR33JtrXfrnSQoLQ` serves commit
`98e7658049fd795287733b872a94a188419238da` at
`https://hawker-wars-staging.vercel.app`.

Hosted Chromium checks on 2026-10-24 UTC passed against round
`e388e9f8-3720-430d-ab4f-14e96ba91392`: the scene loaded, customer walking changed
position, operator pause froze animation, resume continued it, reduced motion
removed positional movement, and disconnection/reconnection froze/resumed the
clock. No browser runtime errors occurred. The test round was stopped afterward.
These checks used the actual hosted API and committed worker activity, not
fixture responses. Local validation also covers PostgreSQL persistence/rejection
and worker/recovery behaviour.

Persistent worker deployment is described in
[the Coolify runbook](deployment/coolify-worker.md). The worker now runs persistently on Coolify. The integrated public exhibition
acceptance record is in [the staging runbook](deployment/staging-runbook.md).
