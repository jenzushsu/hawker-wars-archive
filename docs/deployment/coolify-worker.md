# Persistent rules worker on Coolify

The repository's `compose.worker.yaml` runs an outbound-only Node worker. Keep
the web/API deployment on Vercel and the shared database on Supabase. The worker
requires no public domain, exposed port, provider key, or browser cookie secret.

## Configure the resource

In the intended Coolify project and environment, add a Git application from
`https://github.com/jenzushsu/hawker-wars`, using the Docker Compose build pack.
Use repository root `/` and Compose path `/compose.worker.yaml`. Select the
reviewed commit before deploying. Do not enable an HTTP health check for this
outbound-only service.

Set these runtime environment variables in Coolify, never in Git or build args:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://csgyhgamvpcmemlhrwdk.supabase.co` for staging |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-only key for that staging project |
| `HAWKER_ROUND_ID` | An existing rules-only exhibition round UUID |

The worker image pins Node 24.19.0 and pnpm 11.25.0, installs the frozen lockfile,
runs as an unprivileged user, and includes no credentials. The optional
`proxy_ca` build secret supports managed build proxies; normal Coolify builds
do not need it. Configure any required runtime outbound proxy and CA trust on
the deployment host independently.

## Round selection and lifecycle

Create a round explicitly from trusted operator tooling with the existing
`worker:rules --create --publish --voting` command. Creation is separate from
container startup; deployment, restart, or reboot never creates a new round.
Set its UUID in Coolify and deploy. Only one worker service should own this
round; do not scale replicas. Database leases still fence overlapping workers.

The supervisor advances serially, waiting five seconds between active calls.
Each call reads durable recovery before doing work, and the database remains
authoritative for pacing. A paused round is checked every ten seconds; an
explicit database resume allows it to continue. Stopped and completed rounds
leave the container idle without additional database calls. Select a new round
and redeploy to run another exhibition.

Store failures back off for 10, 20, 40, and 60 seconds. Five consecutive failures,
invalid recovery, or an unexpected exception halt further requests. The process
stays idle and logs `halted`; investigate the durable state and configuration,
then explicitly restart through Coolify. Error messages and credentials are
never emitted. A process crash is restarted by Docker's `unless-stopped` policy.

SIGTERM/SIGINT stop new work and allow the in-flight tick and lease release to
finish. Coolify grants 120 seconds before forced termination. After a crash,
an unexpired lease may delay takeover; recovery must always use the database's
last committed boundary. Stopping the container does not cancel the round:
use the authenticated operator stop action first for a durable stop, then stop
the Coolify service. No provider dispatch is enabled by this setup.

Logs are rotated at 10 MB with three files. Monitor `halted`, repeated
`retrying`, and an unexpectedly stale active tick. A running container alone
does not prove that a round is advancing; idle after completion is intentional.

## Acceptance on the selected Coolify host

1. Confirm the deployed revision, selected round and staging database.
2. Observe consecutive commits, then restart the container and confirm that
   sequences continue without duplicates or another create call.
3. Pause through the operator API; verify ticks stop. Resume and verify progress.
4. Stop the round; verify the service stays idle through a container restart.
5. Reboot the server during a disposable round and verify Docker restarts the
   worker and it resumes from persisted state.

Local supervisor tests and a container build are preparatory checks. They do
not establish deployment or reboot recovery on the user's Coolify host.

## Validation recorded on 2026-10-24 UTC

TypeScript and 23 targeted tests passed, including six supervisor lifecycle
tests. The Compose definition validated and the Docker image built with its
pinned runtime and lockfile. The image ran as an unprivileged user with a
read-only root filesystem. Against a disposable staging round it advanced to
tick 2, resumed through tick 4 after a container restart, preserved the paused
boundary, resumed after an explicit operator action, and stopped durably at
tick 5. Its six events were sequential, and SIGTERM shut it down with exit 0.
A separate completed-round check remained idle across restart. Test containers
were removed and test rounds were stopped. These container checks ran in the
Codex cloud environment, not on the Coolify server.

Coolify supports [Git-based Compose applications](https://coolify.io/docs/applications/builds/docker-compose).
Its [API](https://coolify.io/docs/api/overview) requires enabled API access and a
team-scoped token with permissions for the requested operations. This cloud
chat also requires `i.makeitclick.dev` in its network allowlist before API access.
