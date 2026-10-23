#!/usr/bin/env bash
# Isolated local Postgres + PostgREST only. Never accepts a hosted DB URL.
set -euo pipefail
: "${P5_POSTGRES_CONTAINER:?Set P5_POSTGRES_CONTAINER to the disposable local Postgres container}"
case "$P5_POSTGRES_CONTAINER" in *[!a-zA-Z0-9_.-]*|'') echo 'Invalid container name' >&2; exit 1;; esac
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test_database="hawker_p5_votes_${$}_${RANDOM}"
authenticator="p5_votes_auth_${$}_${RANDOM}"
gateway="hawker-p5-votes-${$}-${RANDOM}"
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
# Synthetic opt-in fixture only: the production rules worker still rejects votingEnabled=true.
# Direct inserts avoid pretending this is a fully integrated simulator/effect round.
psql_db <<'SQL'
INSERT INTO public.rounds(id,classification,policy_ids,configuration_hash,published,tick,sequence)
VALUES('11111111-1111-4111-8111-111111111111','exhibition',array['rules'],repeat('a',64),true,30,31);
INSERT INTO live_private.round_state(round_id,schedule_hash,recovery)
VALUES('11111111-1111-4111-8111-111111111111',repeat('b',64),'{"schemaVersion":"recovery-1","workerVersion":"rules-worker-1","votingEnabled":true}');
SQL
docker_local run -d --name "$gateway" --network "container:$P5_POSTGRES_CONTAINER" \
  -e "PGRST_DB_URI=postgres://$authenticator@127.0.0.1:5432/$test_database" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_SERVER_PORT=3100 \
  -e "PGRST_JWT_SECRET=$P5_HTTP_JWT_SECRET" \
  postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228 >/dev/null
# The test node process shares the same isolated loopback, with no published host ports.
docker_local run --rm --network "container:$P5_POSTGRES_CONTAINER" \
  --mount "type=bind,src=$repo_root,dst=/app,readonly" -w /app \
  -e "P5_HTTP_JWT_SECRET=$P5_HTTP_JWT_SECRET" \
  node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 node --import tsx scripts/validate-votes-http.ts
