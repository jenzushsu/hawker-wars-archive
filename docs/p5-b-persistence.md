# P5-B persistence and deployment foundation

This increment adds Supabase-compatible Postgres storage and a server-only RPC client for a single active shared round. It prepares actual shared-service deployment; it does not yet run a round, accept audience votes, restore simulator state, dispatch inference or connect the browser to live records.

## Authoritative persistence boundary

The database owns lease expiry time and monotonic fencing tokens. A worker must acquire a lease, renew it while valid, and supply its owner identity and fence for each commit. Expired and superseded workers cannot commit. An exact commit retry uses the same idempotency key and payload; a changed payload under the same key is rejected. Every tick atomically writes the public aggregate snapshot, per-policy decisions, one sequence event and a private recovery envelope. Tick and sequence advance together once.

Only one running round is allowed. Decisions are unique per round/tick/policy, and events per round/sequence and round/tick. Tick 120 closes the round without a new decision. A future worker must recover and validate all simulator/version/configuration/schedule semantics before resuming. The current recovery envelope validates its version marker and size, not its simulation correctness. Persistent storage alone does not establish restart recovery or exactly-once provider billing.

Public data has a closed field set: policy IDs, integer aggregate metrics and action/fallback attribution. Unknown payload fields are rejected. Private recovery, schedules, lease identity and idempotency records are stored separately. Published rounds are readable under RLS; unpublished rounds are hidden. Anonymous and authenticated roles cannot mutate authoritative tables or invoke worker RPCs. Service-role operations use explicit RPC grants. Only sanitized committed events are added to an existing Supabase Realtime publication.

The TypeScript client validates inputs and responses, uses bounded payloads and deadlines, refuses redirects, performs no automatic retries and returns sanitized errors. It belongs in a trusted Node process, not in a client component. Public reads are bounded and do not create or advance rounds.

## Reproduction

Use a disposable local PostgreSQL container and run:

```sh
P5_POSTGRES_CONTAINER=hawker-p5-postgres pnpm validate:p5-store
P5_POSTGRES_CONTAINER=hawker-p5-postgres pnpm validate:p5-http
pnpm exec vitest run tests/live-store.test.ts
```

The SQL runner creates a uniquely named temporary database, bootstraps Supabase role names for permission tests, applies migrations and removes only that temporary database. It does not accept a hosted database URL. Local SQL role tests are not evidence of Supabase HTTP gateway or Realtime delivery behavior.

## Deployment alignment

See [Vercel and Supabase deployment](deployment/vercel-supabase.md) for project settings, hosting boundaries and acceptance requirements. The frontend production build remains independently deployable as an offline replay. Hosted migrations, credentials, worker deployment and actual multi-viewer behavior remain unverified.

## Validation

Root TypeScript and all 427 unit tests across 31 files pass, including 11 new RPC-client tests. The Vercel build command, `corepack pnpm build`, passes from `apps/web` with the pinned pnpm version. No frontend behavior changed, so prior browser interaction results are not reclassified as new live-service acceptance.

The independent SQL runner passes on PostgreSQL 17: role/grant/RLS checks, public/private separation, rejection of malformed public payloads, atomic rollback after a partial decision insert, exact and conflicting commit retries, all 121 tick boundaries, expired/superseded/same-owner fencing and terminal-state checks. Two actual concurrent database sessions compete for one lease; exactly one succeeds. A worker waiting behind a row lock is rejected when its lease expires before acquiring that lock.

The source identity now includes SQL migrations/tests, shell validators and Vercel configuration, so these deployment-relevant files participate in guarded provenance checks. Local PostgREST 13.0.7 HTTP integration also passes using a dedicated non-superuser, NOINHERIT authenticator and signed synthetic test JWTs. The actual `LiveStore` RPC client performs create/acquire/commit/exact-retry/recovery/cursor/release operations. Anonymous/authenticated roles can read published data, cannot see unpublished rows, and receive permission errors for table writes and private worker RPCs. Direct service-role table writes are also denied. Conflicting retries, stale ownership and malformed public payloads leave the committed boundary unchanged. The test transport maps the client's HTTPS URL to the isolated local HTTP gateway; production HTTPS validation remains unchanged. Pinned container images use Node 24.22.1, compatible with the repository's Node 24 range. No host ports are exposed; temporary database/authenticator/gateway resources are removed.

This HTTP check covers PostgREST directly, not Supabase's hosted gateway, TLS termination or Realtime delivery. P0, P2-A and P2-B regressions pass: 800 rules and 80 mixed episode executions, 24 persisted archives, 72 replay executions and 72 report reloads. Guarded provenance refresh preserved every frozen behavioral reference. Source identity is `2a6e9a4d0d5aa1658f1142faaeee85123fa4e2e9f7d9a22802916a2d6d600c5b`; the static dataset hash remains `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`. No provider calls, trial campaign or hosted migration was performed.

## Remaining P5 scope

Durable voting/receipt tables, signed sessions, rate limits, worker execution and semantic recovery, uniform audience-event integration, operator pause/kill/restart handling, authenticated API routes, cursor/Realtime reconnect and browser integration remain pending. Actual Supabase permission paths and two-viewer/restart tests are required before P5 exit. Provider budgets and G0-B readiness remain separate gates.
