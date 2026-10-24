# Four-policy worker on Coolify

The new worker advances rules, TypeSafe Jev, Zoom Decisions Standard and Zoom
Decisions Pro on the same clean demand schedule. Each stall has its own state
and decisions; all four snapshots commit at one fenced database boundary. The
existing viewer displays all four scores and lets spectators select a stall.
This protocol disables audience voting and creates private exhibitions by default.

## Current readiness

Implementation and local validation are complete; this worker has not been
deployed to Coolify or run with all three remote providers. The existing
rules-only Coolify worker remains selected on its completed staging round.
The new migration has not been applied to hosted Supabase.

The runtime manifest intentionally remains blocked:

- Jev campaign spending is now approved at USD 0.34, including the prior
  USD 0.002753 smoke reservation. Its local ledger was amended without resetting
  any attempts or counters; see `docs/providers/jev-campaign-amendment.json`.
- Both Zoom models passed explicitly authorized exception smoke tests. They
  still lack a verified maximum request charge for normal campaign dispatch. A response deadline or input byte limit is not a
  billing bound. The current Zoom documentation does not establish the missing
  maximum charge; no guessed value has been inserted.
- The existing ledger must retain its prior smoke reservation when transferred
  to Coolify. The Jev-only cap amendment is complete locally; adding verified
  Zoom charge bounds will require a separate validated configuration amendment.
  Startup rejects an old or missing ledger instead of replacing it.

The original worker implementation used no remote inference. Subsequently,
one authorized exception smoke per Zoom model passed; see the provider activation
record. Their charges need reconciliation before campaign dispatch. Mock validation is
not evidence of model performance or live account readiness.

## Deployment sequence after gates are resolved

1. Record approved Jev campaign spending, verified Zoom bounds and bounded smoke
   evidence in the runtime configuration. Preserve the existing campaign ledger;
   do not run initialization to replenish the budget. Check `pnpm providers:status`.
2. Apply `20261024180152_multi_policy_worker.sql` through the normal Supabase
   migration workflow. The worker checks a service-role-only protocol RPC before
   starting, and refuses to run against the older schema.
3. On the single selected Coolify host, provision the external Docker volume
   `hawker-provider-ledger`. Transfer a consistent, closed copy of the approved
   existing ledger into its `campaign` directory, preserving all records and
   private permissions. The worker runs as Node's unprivileged user (UID 1000).
   Verify ownership and identity before starting. Never share this SQLite ledger
   across hosts or run independently copied campaigns.
4. From trusted operator tooling with that same ledger and runtime secrets, run
   `pnpm worker:multi:create --seed 7`. Set
   `HAWKER_PROVIDER_LEDGER_DIRECTORY` to the absolute campaign directory. Creation
   validates configuration, storage and database protocol but performs no inference.
   Save the returned round UUID. Use `--publish` only for an intended public round.
5. Configure Coolify's GitHub App source and pin the reviewed revision. Select
   `/compose.multi-worker.yaml`; configure runtime-only `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `HAWKER_ROUND_ID`, `TYPESAFE_API_KEY` and
   `ZOOM_AI_SERVICES_API_KEY`. Use the full staging Supabase HTTPS URL. No inbound
   ports or HTTP health check are required. Run exactly one replica on one host.
6. Validate a private round: consecutive four-policy commits, provider/fallback
   attribution, pause/resume/stop, active restart, retained ledger reservations
   and final tick 120 / sequence 121. Only then select a public comparison.

Provider calls use the existing durable adapters, four-second deadlines and
shared Zoom rate/budget accounting. Saved responses are reused after a failed
commit; uncertain dispatches are never resent. A restart reconstructs simulation
state from committed actions. Invalid recovery or changed configuration halts
work. Sole legal WAIT is local and recorded as `forced_wait`, not a model choice.

Control actions invalidate the lease fence. An already dispatched request may
still consume its reservation, but a stale worker cannot commit a partial tick.
Completed/stopped rounds idle under the existing supervisor. Docker restart and
SIGTERM behavior follow the [Coolify operations guide](coolify-worker.md).

## Validation

- TypeScript and the complete unit/reference suite, including durable adapter
  recovery, shared Zoom budget enforcement and a 121-boundary simulated round.
- Local Supabase security/performance advisors at error level: no issues found.
- Disposable PostgreSQL migration and SQL tests for atomic commits, pacing,
  attribution, service-role grants, stale fences and control actions.
- Local PostgREST integration for independent policy states, durable recovery,
  coherent read-only viewers and controls, using mock controllers.
- Playwright at both supported desktop sizes: four score rows and selectable
  stall animation, using a mocked public projection.
- Worker image build and Compose validation; blocked startup performs no dispatch.

These checks do not establish hosted multi-policy acceptance, actual provider
billing, or a full comparison with live models.
