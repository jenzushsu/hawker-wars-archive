#!/usr/bin/env bash
# Isolated local Postgres + PostgREST only. Never accepts a hosted DB URL.
set -euo pipefail
: "${P5_POSTGRES_CONTAINER:?Set P5_POSTGRES_CONTAINER to the disposable local Postgres container}"
case "$P5_POSTGRES_CONTAINER" in *[!a-zA-Z0-9_.-]*|'') echo 'Invalid container name' >&2; exit 1;; esac
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test_database="hawker_p5_view_${$}_${RANDOM}"
authenticator="p5_view_auth_${$}_${RANDOM}"
gateway="hawker-p5-view-${$}-${RANDOM}"
# Fixed synthetic test secret, usable only in the unexposed disposable gateway.
export P5_HTTP_JWT_SECRET='hawker-p5-disposable-local-http-test-only-secret'
docker_local() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
psql_db() { docker_local exec -i "$P5_POSTGRES_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$test_database" "$@"; }
cleanup() {
  docker_local rm -f "$gateway" >/dev/null 2>&1 || true
  docker_local exec "$P5_POSTGRES_CONTAINER" dropdb -U postgres --if-exists "$test_database" >/dev/null
  docker_local exec "$P5_POSTGRES_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U postgres -c "DROP ROLE IF EXISTS $authenticator" >/dev/null
}
if [[ "$(docker_local inspect --format '{{.HostConfig.NetworkMode}}' "$P5_POSTGRES_CONTAINER")" != none ]]; then
  echo 'HTTP validation requires an isolated --network none Postgres container' >&2; exit 1
fi
trap cleanup EXIT
docker_local exec "$P5_POSTGRES_CONTAINER" createdb -U postgres "$test_database"
psql_db <<SQL
DO \$\$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
CREATE ROLE $authenticator LOGIN NOINHERIT;
GRANT anon,authenticated,service_role TO $authenticator;
SQL
for migration in "$repo_root"/supabase/migrations/*.sql; do psql_db < "$migration"; done
# Only this disposable test database omits visual pacing. All simulation ticks,
# leases, vote deadlines and atomic commits still use the production worker/RPCs.
# The separate live HTTP suite verifies production five-second pacing.
psql_db <<'SQL'
CREATE OR REPLACE FUNCTION live_private.enforce_rules_worker_pacing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN NEW; END $$;
INSERT INTO public.rounds(id,classification,policy_ids,configuration_hash,published,status,tick,sequence)
VALUES('99999999-9999-4999-8999-999999999999','exhibition',array['rules'],repeat('a',64),false,'completed',120,121);
INSERT INTO live_private.round_state(round_id,schedule_hash,recovery)
VALUES('99999999-9999-4999-8999-999999999999',repeat('b',64),'{"schemaVersion":"recovery-1"}');
SQL
docker_local run -d --name "$gateway" --network "container:$P5_POSTGRES_CONTAINER" \
  -e "PGRST_DB_URI=postgres://$authenticator@127.0.0.1:5432/$test_database" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_SERVER_PORT=3103 \
  -e "PGRST_JWT_SECRET=$P5_HTTP_JWT_SECRET" \
  postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228 >/dev/null
# The test node process shares the same isolated loopback, with no published host ports.
docker_local run --rm --network "container:$P5_POSTGRES_CONTAINER" \
  --mount "type=bind,src=$repo_root,dst=/app,readonly" -w /app \
  -e "P5_HTTP_JWT_SECRET=$P5_HTTP_JWT_SECRET" \
  node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 node --import tsx scripts/validate-live-view-http.ts
