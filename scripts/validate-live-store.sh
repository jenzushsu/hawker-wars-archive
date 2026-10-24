#!/usr/bin/env bash
# Run only against a local, disposable Postgres container. No hosted database URI is accepted.
set -euo pipefail
: "${P5_POSTGRES_CONTAINER:?Set P5_POSTGRES_CONTAINER to the disposable local Postgres container name}"
case "$P5_POSTGRES_CONTAINER" in *[!a-zA-Z0-9_.-]*|'') echo 'Invalid container name' >&2; exit 1;; esac
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test_database="hawker_p5_test_${$}_${RANDOM}"
docker_local() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
psql_db() { docker_local exec -i "$P5_POSTGRES_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" "$@"; }
race_directory=$(mktemp -d)
cleanup() { docker_local exec "$P5_POSTGRES_CONTAINER" dropdb -U postgres --if-exists "$test_database" >/dev/null; rm -rf -- "$race_directory"; }
trap cleanup EXIT
docker_local exec "$P5_POSTGRES_CONTAINER" createdb -U postgres "$test_database"
# Supabase's built-in roles, reproduced only for SQL grant/RLS testing.
psql_db -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
SQL
for migration in "$repo_root"/supabase/migrations/*.sql; do psql_db -q < "$migration"; done
psql_db -qAt < "$repo_root/supabase/tests/live-store.sql" > "$race_directory/lifecycle.log"
rg '\S' "$race_directory/lifecycle.log"
# Two real database sessions contend for the same round; only one lease can win.
psql_db -qAt -c "begin; set local role service_role; select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30); select pg_sleep(0.25); commit;" > "$race_directory/owner-a.log" 2>&1 &
owner_a_pid=$!
psql_db -qAt -c "begin; set local role service_role; select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',30); select pg_sleep(0.25); commit;" > "$race_directory/owner-b.log" 2>&1 &
owner_b_pid=$!
owner_a_status=0; wait "$owner_a_pid" || owner_a_status=$?
owner_b_status=0; wait "$owner_b_pid" || owner_b_status=$?
if [[ "$owner_a_status" -eq 0 && "$owner_b_status" -ne 0 ]]; then
  rg -q 'lease held' "$race_directory/owner-b.log"
elif [[ "$owner_b_status" -eq 0 && "$owner_a_status" -ne 0 ]]; then
  rg -q 'lease held' "$race_directory/owner-a.log"
else
  cat "$race_directory/owner-a.log" "$race_directory/owner-b.log" >&2
  echo 'Expected exactly one lease acquisition winner' >&2; exit 1
fi
psql_db -qAt -c "select test.assert((select fence=1 and owner_id is not null from live_private.round_state),'one race winner'); update live_private.round_state set expires_at=clock_timestamp()-interval '1 second'; set role service_role; select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1);" > "$race_directory/lease.log"
# Hold the row lock until after expiry. A waiter must sample DB time after obtaining the lock.
psql_db -qAt -c "set application_name='p5-expiry-blocker'; begin; select round_id from live_private.round_state for update; select pg_sleep(2); commit;" > "$race_directory/blocker.log" 2>&1 &
blocker_pid=$!
blocker_ready=false
for ((attempt=0; attempt<50; attempt++)); do
  if [[ "$(psql_db -qAt -c "select count(*) from pg_stat_activity where application_name='p5-expiry-blocker' and wait_event='PgSleep';")" == 1 ]]; then blocker_ready=true; break; fi
  sleep 0.02
done
if [[ "$blocker_ready" != true ]]; then wait "$blocker_pid" || true; echo 'Could not observe lock blocker' >&2; exit 1; fi
stale_status=0
psql_db -qAt -c "set role service_role; select test.commit(0,0,'00000000-0000-4000-8000-000000000999',2);" > "$race_directory/stale.log" 2>&1 || stale_status=$?
wait "$blocker_pid"
if [[ "$stale_status" -eq 0 ]]; then echo 'Expired lock-waiting worker committed' >&2; exit 1; fi
rg -q 'stale lease' "$race_directory/stale.log"
psql_db -qAt <<'SQL'
select test.assert((select tick=-1 and sequence=0 from public.rounds),'blocked stale worker leaves boundary unchanged');
select test.assert((select count(*) from public.game_events)=0,'blocked stale worker writes no events');
select test.assert((select count(*) from public.decisions)=0,'blocked stale worker writes no decisions');
set role service_role;
select test.assert((public.live_acquire_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',30)->>'fence')::bigint=3,'post-expiry replacement gets new fence');
select test.assert((test.commit(0,0,'00000000-0000-4000-8000-000000000999',3,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'sequence')::bigint=1,'replacement commits once');
SQL
printf '%s\n' 'Concurrent lease and lock-wait expiry checks passed.'
# A pause owns the same state lock as a worker commit. A waiting stale worker must
# observe the revoked fence after the control transaction commits, never append a tick.
psql_db -qAt <<'SQL' > "$race_directory/control-setup.log"
delete from public.rounds;
set role service_role;
select public.live_create_round('11111111-1111-4111-8111-111111111111','exhibition',array['rules'],repeat('a',64),repeat('b',64),test.recovery() || '{"workerVersion":"rules-worker-1"}',true);
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30);
SQL
psql_db -qAt -c "set application_name='p5-control-blocker'; begin; set local role service_role; select test.control('00000000-0000-4000-8000-000000000301','pause',0); select pg_sleep(1); commit;" > "$race_directory/control-blocker.log" 2>&1 &
control_pid=$!
control_ready=false
for ((attempt=0; attempt<50; attempt++)); do
  if [[ "$(psql_db -qAt -c "select count(*) from pg_stat_activity where application_name='p5-control-blocker' and wait_event='PgSleep';")" == 1 ]]; then control_ready=true; break; fi
  sleep 0.02
done
if [[ "$control_ready" != true ]]; then wait "$control_pid" || true; echo 'Could not observe control lock blocker' >&2; exit 1; fi
control_commit_status=0
psql_db -qAt -c "set role service_role; select test.commit(0,0,'00000000-0000-4000-8000-000000000302',1);" > "$race_directory/control-stale.log" 2>&1 || control_commit_status=$?
wait "$control_pid"
if [[ "$control_commit_status" -eq 0 ]]; then echo 'Paused lock-waiting worker committed' >&2; exit 1; fi
rg -q 'stale lease' "$race_directory/control-stale.log"
psql_db -qAt <<'SQL'
select test.assert((select control_state='paused' and control_revision=1 and tick=-1 and sequence=0 from public.rounds),'pause acknowledgement keeps committed boundary');
select test.assert((select count(*) from public.game_events)=0,'pause race writes no event');
select test.assert((select count(*) from live_private.control_receipts)=1,'pause race has one durable acknowledgement');
SQL
printf '%s\n' 'Concurrent control/commit lock and fence checks passed.'

psql_db -qAt < "$repo_root/supabase/tests/live-votes.sql" > "$race_directory/votes.log"
rg '\S' "$race_directory/votes.log"
# Concurrent duplicate requests share one durable receipt; deadline is sampled after locking.
psql_db -qAt <<'SQL' > "$race_directory/vote-race-setup.log"
delete from live_private.vote_receipts;
update live_private.vote_windows set deadline_ms=floor(extract(epoch from clock_timestamp())*1000)::bigint+20000;
SQL
vote_duplicate="set role service_role; select public.live_submit_vote('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','00000000-0000-4000-8000-000000000401','rain');"
psql_db -qAt -c "$vote_duplicate" > "$race_directory/vote-a.log" 2>&1 &
vote_a_pid=$!
psql_db -qAt -c "$vote_duplicate" > "$race_directory/vote-b.log" 2>&1 &
vote_b_pid=$!
wait "$vote_a_pid"
wait "$vote_b_pid"
psql_db -qAt <<'SQL'
select test.assert((select count(*) from live_private.vote_receipts)=1,'duplicate race has one receipt');
select test.assert((select count(*) from live_private.audience_votes)=1,'duplicate race has one selection');
SQL
psql_db -qAt -c "set application_name='p5-vote-deadline-blocker'; begin; select round_id from live_private.round_state for update; update live_private.vote_windows set deadline_ms=floor(extract(epoch from clock_timestamp())*1000)::bigint+500; select pg_sleep(1); commit;" > "$race_directory/vote-deadline-blocker.log" 2>&1 &
vote_blocker_pid=$!
vote_blocker_ready=false
for ((attempt=0; attempt<50; attempt++)); do
  if [[ "$(psql_db -qAt -c "select count(*) from pg_stat_activity where application_name='p5-vote-deadline-blocker' and wait_event='PgSleep';")" == 1 ]]; then vote_blocker_ready=true; break; fi
  sleep 0.02
done
if [[ "$vote_blocker_ready" != true ]]; then wait "$vote_blocker_pid" || true; echo 'Could not observe vote lock blocker' >&2; exit 1; fi
vote_late_status=0
psql_db -qAt -c "set role service_role; select public.live_submit_vote('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-4000-8000-000000000402','bus');" > "$race_directory/vote-late.log" 2>&1 || vote_late_status=$?
wait "$vote_blocker_pid"
if [[ "$vote_late_status" -eq 0 ]]; then echo 'Lock-waiting vote crossed deadline' >&2; exit 1; fi
rg -q 'voting closed' "$race_directory/vote-late.log"
psql_db -qAt -c "select test.assert((select count(*) from live_private.vote_receipts)=1,'late lock-waiting vote adds no receipt');"
printf '%s\n' 'Concurrent vote duplicate and lock-wait deadline checks passed.'
psql_db -qAt < "$repo_root/supabase/tests/live-vote-effects.sql" > "$race_directory/vote-effects.log"
rg '\S' "$race_directory/vote-effects.log"
psql_db -qAt < "$repo_root/supabase/tests/live-view.sql" > "$race_directory/view.log"
rg '\S' "$race_directory/view.log"
psql_db -qAt < "$repo_root/supabase/tests/live-multi-worker.sql" > "$race_directory/multi-worker.log"
rg '\S' "$race_directory/multi-worker.log"
printf '%s\n' 'P5 SQL lifecycle and permission validation passed (local Postgres; no PostgREST/Realtime claim).'
