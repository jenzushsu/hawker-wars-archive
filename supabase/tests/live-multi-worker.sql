-- Disposable DB only, after the baseline store tests. No remote provider calls.
begin;
truncate public.rounds cascade;
create function test.multi_recovery() returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion','recovery-1','workerVersion','multi-policy-worker-1',
 'providerConfigurationHash',repeat('b',64),'votingEnabled',false,
 'schedule',jsonb_build_object('hash',repeat('c',64),'scenario','clean','shock',null))
$$;
create function test.multi_commit(t integer,f bigint,rec jsonb default test.multi_recovery()) returns jsonb language sql as $$
 select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',f,t,t,
 ('00000000-0000-4000-8000-'||lpad((t+1)::text,12,'0'))::uuid,
 jsonb_build_object('policies',(select jsonb_agg(jsonb_build_object('policy_id',p,'cash_cents',20000,'profit_cents',0,'utility_points',0,'served',0,'abandoned',0)) from unnest(array['rules','jev','zoom','zoom-pro']) p)),
 (select jsonb_agg(jsonb_build_object('policy_id',p,'action','WAIT','source',case when p='rules' then 'rules' else 'forced_wait' end,'fallback_reason',null)) from unnest(array['rules','jev','zoom','zoom-pro']) p),rec)
$$;
grant execute on function test.multi_recovery(),test.multi_commit(integer,bigint,jsonb) to service_role;
set role anon;
do $$ begin
 begin perform public.live_multi_worker_protocol(); raise exception 'anonymous protocol access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select test.assert(public.live_multi_worker_protocol()='multi-policy-worker-1','multi protocol capability');
select public.live_create_round('11111111-1111-4111-8111-111111111111','exhibition',array['rules','jev','zoom','zoom-pro'],repeat('a',64),repeat('c',64),test.multi_recovery(),true);
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30);
select test.multi_commit(0,1);
select test.assert((public.live_get_round_status('11111111-1111-4111-8111-111111111111')->>'ready')::boolean=false,'database pacing is authoritative for multi worker');
do $$ begin
 begin perform test.multi_commit(1,1); raise exception 'multi pacing bypass'; exception when sqlstate '55000' then null; end;
end $$;
reset role;
select test.assert((select count(*)=4 from public.stall_snapshots),'one atomic four-stall snapshot');
select test.assert((select count(*)=3 from public.decisions where source='forced_wait' and fallback_reason is null),'forced waits are not model calls or fallbacks');
update live_private.round_state set next_tick_at='-infinity';
set role service_role;
do $$ begin
 begin perform test.multi_commit(1,1,jsonb_set(test.multi_recovery(),'{providerConfigurationHash}',to_jsonb(repeat('d',64)))); raise exception 'runtime identity changed'; exception when sqlstate '22023' then null; end;
end $$;
select test.assert((public.live_get_round_status('11111111-1111-4111-8111-111111111111')->>'tick')::integer=0,'invalid recovery rolls back whole tick');
select test.multi_commit(1,1);
select public.live_control_round('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000100','pause',0,'multi-test');
do $$ begin
 begin perform test.multi_commit(2,1); raise exception 'stale fence committed'; exception when sqlstate '55000' then null; end;
end $$;
select public.live_control_round('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000101','resume',1,'multi-test');
select public.live_control_round('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000102','stop',2,'multi-test');
select test.assert((public.live_get_round_status('11111111-1111-4111-8111-111111111111')->>'control_state')='stopped','multi stop durable');
-- Reject unsupported mixed voting and avoid creating an active fixture.
do $$ begin
 begin perform public.live_create_round('22222222-2222-4222-8222-222222222222','exhibition',array['rules','jev','zoom','zoom-pro'],repeat('a',64),repeat('c',64),jsonb_set(test.multi_recovery(),'{votingEnabled}','true'),false); raise exception 'multi voting silently enabled'; exception when sqlstate '22023' then null; end;
end $$;
reset role;
do $$ begin
 begin update public.decisions set source='model' where policy_id='rules'; raise exception 'baseline claimed model'; exception when check_violation then null; end;
 begin update public.decisions set action='COOK' where source='forced_wait'; raise exception 'non-WAIT local action'; exception when check_violation then null; end;
 begin update public.decisions set source='rules',fallback_reason=null where policy_id='jev'; raise exception 'unattributed fallback'; exception when check_violation then null; end;
end $$;
rollback;
select 'Multi-policy SQL pacing, atomicity, attribution, controls, identity and permission checks passed.';
