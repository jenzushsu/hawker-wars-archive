# Live stall animation

Live snapshots may include an optional `activity` object on each policy. The rules worker derives it from the committed engine state and changes in served/abandoned totals. It contains only bounded queue poses, counts, inventory and the applied action; customer identities and recovery state remain private.

The live page reuses the demo renderer with only the centre stall active. A selector chooses the policy for multi-policy rounds. Queue sprites are representative (at most three); the displayed queue count is authoritative. Animation pauses on disconnect, operator pause/stop, completion and page hiding, and respects reduced motion. Polling the same tick does not restart movement. Older snapshots remain readable and show an activity-unavailable message.

## Rollout

1. Apply `supabase/migrations/202610240001_live_activity.sql`. This preserves old snapshots and commits, the voting wrapper, permissions, pacing and fencing.
2. Deploy the web/API code that accepts optional activity. Existing viewers using the older strict schema should reload before the updated worker runs.
3. Restart the rules worker with the updated code. Subsequent committed ticks contain activity; previous ticks are not rewritten.
4. Verify a running round in the hosted browser, including walking and operator pause/resume.

The migration and deployment have not been applied to the hosted environment by this change. Local validation covers PostgreSQL persistence/rejection, worker/recovery behaviour and browser interaction with fixture-backed live responses.
