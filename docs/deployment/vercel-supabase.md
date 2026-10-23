# Vercel and Supabase deployment

The application is aligned with a Vercel frontend and Supabase shared backend. A [bounded rules-only worker](../p5-c-rules-worker.md) is now available with verified recovery and database pacing; rules-only rounds can explicitly opt into [durable vote effects](../p5-f-vote-effects.md), and a [shared live score/voting view](../p5-g-live-viewer.md) is available. Multi-policy inference and the live animated arena remain pending. The homepage remains an offline recorded replay; `/live` connects to configured published rounds. Deploying the frontend does not start a worker or enable model inference. P5 is adding the backend in verified increments. No hosted deployment or production migration has been performed by these changes.

## Execution boundaries

| Component | Intended host | Responsibility |
|---|---|---|
| Next.js UI and static assets | Vercel | Spectator interface, replay, short request/response API handlers |
| PostgreSQL | Supabase | Durable state, atomic commits, lease fencing, public projections and private recovery records |
| Live event delivery | Bounded API polling with persisted cursor recovery; Supabase Realtime planned | Deliver committed public changes; never the sole source of truth |
| Round worker | Separate durable Node worker | Five-second pacing, fenced tick execution, operator controls and future gated provider dispatch |

Do not start a round from a page read, run the game loop in a browser, or leave an unawaited background loop inside a Vercel request. Serverless invocations can end or overlap. A separate worker is the recommended PoC deployment. A bounded-job scheduler could replace it later only with demonstrated scheduling, recovery and fencing; Vercel plus Supabase alone does not supply that implemented orchestration today.

## Vercel project configuration

Import `jenzushsu/hawker-wars` and set **Root Directory** to `apps/web`, with access to files outside that directory enabled. Use the Next.js framework preset and the Node 24 runtime compatible with the root manifest. Keep the default Next.js output directory; do not select a static-export override. `apps/web/vercel.json` installs from the workspace root with the pinned package manager and builds the web package. The root `packageManager` pins pnpm 11.25.0; Corepack must be available in the build image. Do not silently replace the pinned runtime/package manager to make a hosted build pass.

The production build includes `/`, `/decision-states`, `/live`, `/live/[roundId]`, the dynamic `/api/admin/rounds/control`, `/api/votes` and `/api/live/rounds/[roundId]` endpoints and the public art/replay assets. Local reproduction is `corepack pnpm install --frozen-lockfile`, followed by `pnpm build:web`. A successful local Next build is evidence of compilation, not evidence that the hosted Vercel deployment has been validated.

The offline frontend needs no provider or Supabase secret. Keep server credentials out of `NEXT_PUBLIC_*`, static JSON, source control and logs. The [operator control endpoint](../p5-d-operator-controls.md) requires a dedicated `HAWKER_OPERATOR_TOKEN`, server audit identity `HAWKER_OPERATOR_ID` and Supabase server credentials. Configure them separately for Preview and Production; use separate Supabase projects or isolated test data. Never point preview mutation tests at production.

## Supabase rollout boundary

The checked-in SQL migrations are intended for a Supabase Postgres database. Review and apply them first to a staging project using the Supabase migration workflow. Direct anonymous/authenticated writes to authoritative data must remain denied; privileged worker operations use restricted RPCs. A server service-role key bypasses RLS and belongs only in trusted backend secret configuration. It must never be provided to the spectator browser.

Local PostgreSQL validation creates and drops only a uniquely named test database. It bootstraps Supabase role names so grants/RLS and transactional behavior can be tested. A separate local PostgREST HTTP test verifies the real client RPC contract, JWT role permissions and public/private access using an isolated gateway and non-superuser authenticator. This is not Supabase's hosted gateway or Realtime service: hosted paths, TLS, Realtime visibility, project configuration and credentials still need staging verification before deployment approval.

The provider reservation ledger currently uses a local SQLite file. It cannot be placed on ephemeral Vercel storage or shared safely by independent workers on different filesystems. Before live provider dispatch is enabled, use a single durable worker volume or migrate reservations to a shared transactional store and verify crash/uncertain-attempt behavior. Database fencing prevents duplicate committed ticks; it does not itself prevent duplicate external billing.

## Deployment acceptance still required

- Provision the Vercel project, Supabase staging/production projects and a durable worker host.
- Verify the implemented rules/voting worker and polling viewer in hosted staging, then add Realtime and authoritative live arena projection; demonstrate two viewers sharing one round.
- Apply reviewed migrations in staging and test actual anonymous/authenticated/service-role HTTP and Realtime access.
- Configure server secrets, origin/cookie policy and operational limits; verify none appear in public bundles or responses.
- Verify persistent provider reservations and independently satisfy each enabled provider's access/budget gates.
- Run hosted build, asset, API, reconnect, restart and permission checks before promoting a live deployment.

The offline site can be deployed independently while those live-service gates remain closed.

Use the [rules-only staging runbook](staging-runbook.md) for host-specific configuration, preflight, rollout order and the hosted acceptance record. P5-H prepares this handoff; it does not claim hosted acceptance.
