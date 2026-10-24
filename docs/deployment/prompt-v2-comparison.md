# Prompt-v2 comparison — preparation

Requested: run a second private four-policy comparison with seed 7, compare it
with the completed prompt-v1 round, record all errors and analyze the result.

Run ID: `32b5d1e3-f6a2-4e0b-a5c0-38cec0c3a863`.
Previous round: `d7f7da47-8b31-4465-8cf9-77773683da3f`.
The round has not been created or dispatched. The additional Jev budget is
pending confirmation in `docs/providers/prompt-v2-comparison-approval.json`.

The one-use preparation service verifies that approval and completion of the
previous round, then amends the existing Coolify ledger in place. It retains all
attempts, reservations, request limits and prior exposure, replaces the allowed
round only through the explicit operator transition, and creates the private
seed-7 round. It never calls a provider or initializes missing storage. Stop the
idle campaign worker before provisioning; inspect the resulting ledger identity
and round state before any retry if provisioning is interrupted.

After preparation, stop the one-use service and deploy the comparison worker
using `compose.multi-worker-v2.yaml`, selecting the new round UUID. Preserve the
existing volume. No automatic repeat is allowed.

Error evidence: structured `provider-fallback` logs include provider, round,
tick, category, bounded diagnostic, attempt count and legal actions. Wire errors
retain their validated contract code, never raw responses or credentials.
Existing supervisor retry/halt logs remain enabled. Terminal accounting now also
breaks down attempts, allocations, reported native input units and latency by
round/provider/state, keeping invoices separate from reservations.

Post-run comparison: reconcile 121 unique events and 120 decisions per policy;
compare utility, profit, service/abandonment, action counts, forced waits,
stockout periods and restock behavior against v1. Inspect every fallback and
worker error. Models may vary between runs, so one seed cannot establish a
causal improvement from prompt changes. Rules must reproduce its original
score under identical seed/mechanics. This preparation adds diagnostics and an
explicit budget transition; prompt-v2 choices and game mechanics are unchanged.
