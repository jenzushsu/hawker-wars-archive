\set ON_ERROR_STOP on
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO anon, authenticated, service_role;
CREATE FUNCTION test.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION test.rejects(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('22023','23514','23502','23505','55000','42501') THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', label; END IF;
END $$;
-- Helpers are deliberately security invoker so permission probes execute as the selected role.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO anon, authenticated, service_role;
CREATE FUNCTION test.snapshot() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT '{"policies":[{"policy_id":"rules","cash_cents":20000,"profit_cents":0,"utility_points":0,"served":0,"abandoned":0},{"policy_id":"jev","cash_cents":20000,"profit_cents":0,"utility_points":0,"served":0,"abandoned":0}]}'::jsonb
$$;
CREATE FUNCTION test.decisions() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT '[{"policy_id":"rules","action":"WAIT","source":"rules","fallback_reason":null},{"policy_id":"jev","action":"WAIT","source":"rules","fallback_reason":"timeout"}]'::jsonb
$$;
CREATE FUNCTION test.recovery() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT '{"schemaVersion":"recovery-1","private_seed":7,"marker":"private-canary"}'::jsonb
$$;
CREATE FUNCTION test.commit(p_tick integer,p_sequence bigint,p_key uuid,p_fence bigint default 1,p_owner uuid default 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNS jsonb LANGUAGE sql AS $$
SELECT public.live_commit_tick('11111111-1111-4111-8111-111111111111',p_owner,p_fence,p_sequence,p_tick,p_key,test.snapshot(),case when p_tick=120 then '[]'::jsonb else test.decisions() end,test.recovery())
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO anon, authenticated, service_role;

SET ROLE service_role;
SELECT test.assert(public.live_create_round('11111111-1111-4111-8111-111111111111','exhibition',array['rules','jev'],repeat('a',64),repeat('b',64),test.recovery(),false)->>'sequence'='0','new round sequence');
SELECT test.rejects($q$select public.live_create_round('22222222-2222-4222-8222-222222222222','exhibition',array['rules'],repeat('a',64),repeat('b',64),test.recovery(),true)$q$,'only one active round');
SELECT test.rejects('select * from live_private.round_state','service role cannot directly read private state');
SELECT test.rejects('update public.rounds set tick=10','service role cannot directly bypass commit RPC');
RESET ROLE;
SELECT test.assert((SELECT count(*) FROM public.rounds)=1,'failed second round is atomic');
SELECT test.assert((SELECT count(*) FROM live_private.round_state)=1,'failed second round leaves no private row');

SET ROLE anon;
SELECT test.assert((SELECT count(*) FROM public.rounds)=0,'anon cannot see unpublished round');
SELECT test.assert(public.live_get_snapshot('11111111-1111-4111-8111-111111111111') IS NULL,'unpublished snapshot unavailable');
SELECT test.rejects('select * from live_private.round_state','private recovery denied to anon');
SELECT test.rejects($q$select public.live_get_recovery('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)$q$,'private recovery RPC denied to anon');
SELECT test.rejects($q$select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30)$q$,'anon lease execution denied');
SELECT test.rejects('delete from public.rounds','anon mutation denied');
RESET ROLE;
UPDATE public.rounds SET published=true;
SET ROLE authenticated;
SELECT test.assert((SELECT count(*) FROM public.rounds)=1,'authenticated can read published round');
SELECT test.rejects('update public.rounds set published=false','authenticated mutation denied');
SELECT test.rejects('select * from live_private.tick_commits','idempotency data is private');
SELECT test.rejects($q$select public.live_create_round('33333333-3333-4333-8333-333333333333','exhibition',array['rules'],repeat('a',64),repeat('b',64),test.recovery(),true)$q$,'authenticated create RPC denied');
RESET ROLE;
\echo 'Permission and publication checks passed.'

SET ROLE service_role;
SELECT test.assert((public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60)->>'fence')::bigint=1,'first fence');
SELECT test.assert((public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60)->>'fence')::bigint=1,'same active owner acquisition is idempotent');
SELECT test.rejects($q$select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',60)$q$,'second worker cannot acquire active lease');
SELECT test.rejects($q$select public.live_renew_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,60)$q$,'stale fence cannot renew');
SELECT test.rejects($q$select public.live_renew_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,61)$q$,'TTL bound');
SELECT test.assert((public.live_get_recovery('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)->'recovery'->>'marker')='private-canary','current worker can recover private state');
SELECT test.assert((test.commit(0,0,'00000000-0000-4000-8000-000000000001')->>'sequence')::bigint=1,'first atomic commit');
SELECT test.assert((test.commit(0,0,'00000000-0000-4000-8000-000000000001')->>'replayed')::boolean,'exact retry acknowledged');
SELECT test.rejects($q$select test.commit(0,0,'00000000-0000-4000-8000-000000000002')$q$,'new key cannot double commit tick');
SELECT test.rejects($q$select test.commit(2,1,'00000000-0000-4000-8000-000000000003')$q$,'skipped tick rejected');
SELECT test.rejects($q$select test.commit(1,0,'00000000-0000-4000-8000-000000000003')$q$,'stale sequence rejected');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,0,0,'00000000-0000-4000-8000-000000000001',test.snapshot(),test.decisions(),'{"schemaVersion":"recovery-1","changed":true}')$q$,'same key changed private payload rejected');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,1,'00000000-0000-4000-8000-000000000003',test.snapshot() || '{"secret":"private-canary"}',test.decisions(),test.recovery())$q$,'unknown public snapshot fields rejected');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,1,'00000000-0000-4000-8000-000000000003',test.snapshot(),jsonb_set(test.decisions(),'{1,source}','"model"'),test.recovery())$q$,'model cannot claim fallback');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,1,'00000000-0000-4000-8000-000000000003',test.snapshot(),test.decisions()-1,test.recovery())$q$,'missing policy decision rejected');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,1,'00000000-0000-4000-8000-000000000003',test.snapshot(),'[{},{}]',test.recovery())$q$,'empty decision records rejected');
SELECT test.rejects($q$select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,1,'00000000-0000-4000-8000-000000000003',test.snapshot(),jsonb_set(test.decisions(),'{0}',(test.decisions()->0)-'fallback_reason'),test.recovery())$q$,'missing decision field rejected');
DO $$ DECLARE bad jsonb; BEGIN
 FOR bad IN SELECT value FROM jsonb_array_elements('[{}, {"policies":null}, {"policies":[]}, {"policies":[{},{}]}, {"secret":"private-canary"}]'::jsonb) LOOP
   PERFORM test.rejects(format('select public.live_commit_tick(''11111111-1111-4111-8111-111111111111'',''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',1,1,1,''00000000-0000-4000-8000-000000000004'',%L::jsonb,test.decisions(),test.recovery())',bad::text),'malformed public snapshot rejected');
 END LOOP;
END $$;
RESET ROLE;
SELECT test.assert((SELECT tick=0 AND sequence=1 FROM public.rounds),'rejected commits leave boundary unchanged');
SELECT test.assert((SELECT count(*) FROM public.game_events)=1,'exact retry and failures leave one event');
SELECT test.assert((SELECT count(*) FROM public.decisions)=2,'exact retry and failures leave one decision per policy');
SELECT test.assert((SELECT count(*) FROM public.stall_snapshots)=2,'exact retry and failures leave one snapshot per policy');
SELECT test.assert((SELECT count(*) FROM live_private.tick_commits)=1,'only successful key retained');
SELECT test.assert((SELECT recovery=test.recovery() FROM live_private.round_state),'private recovery unchanged by failed commits');
\echo 'Atomic commit, public sanitization and idempotency checks passed.'

SET ROLE anon;
SELECT test.assert(public.live_get_snapshot('11111111-1111-4111-8111-111111111111')::text NOT LIKE '%private-canary%','public snapshot excludes recovery marker');
SELECT test.assert(public.live_get_events('11111111-1111-4111-8111-111111111111',0,100)::text NOT LIKE '%private-canary%','public events exclude recovery marker');
SELECT test.assert((SELECT count(*) FROM public.decisions)=2,'published decisions readable');
SELECT test.rejects($q$select public.live_get_events('11111111-1111-4111-8111-111111111111',0,1001)$q$,'cursor limit bounded');
SELECT test.rejects($q$select test.commit(1,1,'00000000-0000-4000-8000-000000000003')$q$,'anonymous commit denied');
RESET ROLE;
UPDATE public.rounds SET published=false;
SET ROLE anon;
SELECT test.assert((SELECT count(*) FROM public.game_events)=0,'unpublished event rows hidden by RLS');
SELECT test.assert((SELECT count(*) FROM public.decisions)=0,'unpublished decisions hidden by RLS');
SELECT test.assert((SELECT count(*) FROM public.stall_snapshots)=0,'unpublished stall snapshots hidden by RLS');
SELECT test.assert(public.live_get_events('11111111-1111-4111-8111-111111111111',0,100)='{"high_water":0,"events":[]}'::jsonb,'unpublished cursor hides existence and history');
RESET ROLE;
UPDATE public.rounds SET published=true;

UPDATE live_private.round_state SET expires_at=clock_timestamp()-interval '1 second';
SET ROLE service_role;
SELECT test.rejects($q$select test.commit(1,1,'00000000-0000-4000-8000-000000000003')$q$,'expired owner commit denied');
SELECT test.assert((public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60)->>'fence')::bigint=2,'same-owner expired reacquisition increments fence');
SELECT test.rejects($q$select test.commit(1,1,'00000000-0000-4000-8000-000000000003')$q$,'old fence rejected after same-owner takeover');
SELECT test.assert((test.commit(1,1,'00000000-0000-4000-8000-000000000003',2)->>'sequence')::bigint=2,'new fence commits');
SELECT test.assert(public.live_release_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2),'current lease releases');
SELECT test.assert((public.live_acquire_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',60)->>'fence')::bigint=3,'new owner acquisition increments fence');
SELECT test.rejects($q$select public.live_release_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2)$q$,'old owner cannot release replacement lease');
SELECT test.assert((test.commit(0,0,'00000000-0000-4000-8000-000000000001',3,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'replayed')::boolean,'replacement owner can acknowledge exact prior commit');
SELECT test.assert((public.live_get_recovery('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',3)->>'sequence')::bigint=2,'replacement recovers latest durable boundary despite older commit retry');
SELECT test.rejects($q$select test.commit(0,0,'00000000-0000-4000-8000-000000000001',2)$q$,'replaced owner cannot acknowledge via stale lease');
DO $$ BEGIN
 FOR t IN 2..120 LOOP
   PERFORM test.commit(t,t,('00000000-0000-4000-8000-' || lpad((t+10)::text,12,'0'))::uuid,3,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 END LOOP;
END $$;
SELECT test.assert((test.commit(120,120,'00000000-0000-4000-8000-000000000130',3,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'replayed')::boolean,'closing exact retry allowed under current valid lease');
SELECT test.rejects($q$select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',60)$q$,'completed round cannot acquire');
SELECT test.rejects($q$select public.live_renew_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',3,60)$q$,'completed round cannot renew');
SELECT test.assert(public.live_release_lease('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',3),'completed round may release lease');
RESET ROLE;
SELECT test.assert((SELECT tick=120 AND sequence=121 AND status='completed' FROM public.rounds),'terminal commit settles round');
SELECT test.assert((SELECT count(*) FROM public.game_events)=121,'contiguous sequence log');
SELECT test.assert((SELECT count(*) FROM public.decisions)=240,'closing has no decisions');
SELECT test.assert((SELECT count(*) FROM public.stall_snapshots)=242,'closing contains final snapshots');
SELECT test.assert((SELECT event_type='round-closed' FROM public.game_events WHERE tick=120),'closing event distinct');
SET ROLE anon;
SELECT test.assert(jsonb_array_length(public.live_get_events('11111111-1111-4111-8111-111111111111',119,1)->'events')=1,'cursor page bounded');
SELECT test.assert((public.live_get_events('11111111-1111-4111-8111-111111111111',119,1)->>'high_water')::bigint=121,'cursor high-water independent of page limit');
RESET ROLE;
\echo 'Expiry, replacement fencing, terminal state and cursor checks passed.'
-- Leave a fresh clean round for the separate-process lease and lock-wait races.
DELETE FROM public.rounds;
SET ROLE service_role;
SELECT public.live_create_round('11111111-1111-4111-8111-111111111111','exhibition',array['rules','jev'],repeat('a',64),repeat('b',64),test.recovery(),true);
RESET ROLE;
