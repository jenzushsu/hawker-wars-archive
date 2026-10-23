\set ON_ERROR_STOP on
reset role;
create function test.effect_base() returns jsonb language sql immutable as $$
 select jsonb_build_object('schemaVersion','recovery-1','workerVersion','rules-worker-1','votingEnabled',true,'voteWorkerVersion','rules-voting-1','voteResolution',null,'resolvedSchedule',null,
 'schedule',jsonb_build_object('version','demand-1','seed',7,'scenario','clean','shock',null,'hash',repeat('b',64)))
$$;
create function test.effect_commit(p_tick integer,p_key uuid,p_recovery jsonb,p_fence bigint default 1) returns jsonb language sql as $$
 select public.live_commit_tick('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_fence,p_tick,p_tick,p_key,
 '{"policies":[{"policy_id":"rules","cash_cents":20000,"profit_cents":0,"utility_points":0,"served":0,"abandoned":0}]}',
 '[{"policy_id":"rules","action":"WAIT","source":"rules","fallback_reason":null}]',p_recovery)
$$;
create function test.effect_resolve(p_fence bigint default 1) returns jsonb language sql as $$
 select public.live_resolve_vote_window('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_fence)
$$;
grant execute on all functions in schema test to anon,authenticated,service_role;
delete from public.rounds;
insert into public.rounds(id,classification,policy_ids,configuration_hash,published,tick,sequence) values('11111111-1111-4111-8111-111111111111','exhibition',array['rules'],repeat('a',64),true,29,30);
insert into live_private.round_state(round_id,schedule_hash,recovery) values('11111111-1111-4111-8111-111111111111',repeat('b',64),test.effect_base());
set role service_role;
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60);
set role anon;
select test.rejects($q$select live_private.commit_tick_base('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,30,30,'00000000-0000-4000-8000-000000000501','{}','[]',test.effect_base())$q$,'base commit is inaccessible');
set role authenticated;
select test.rejects($q$select live_private.commit_tick_base('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,30,30,'00000000-0000-4000-8000-000000000501','{}','[]',test.effect_base())$q$,'base commit is inaccessible');
set role service_role;
select test.rejects($q$select live_private.commit_tick_base('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,30,30,'00000000-0000-4000-8000-000000000501','{}','[]',test.effect_base())$q$,'base commit is inaccessible');
select test.rejects($q$select test.effect_commit(30,'00000000-0000-4000-8000-000000000501',test.effect_base() || '{"votingEnabled":false}')$q$,'voting opt-in immutable');
select test.rejects($q$select test.effect_commit(30,'00000000-0000-4000-8000-000000000501',test.effect_base() - 'voteWorkerVersion')$q$,'voting worker version immutable');
-- A failed commit cannot leave an opened vote window.
select test.rejects($q$select test.effect_commit(30,'00000000-0000-4000-8000-000000000501',test.effect_base() || '{"resolvedSchedule":{}}')$q$,'unresolved payload rejected');
reset role;
select test.assert((select count(*) from live_private.vote_windows)=0,'rejected tick does not open window');
select test.assert((select tick from public.rounds)=29,'rejected tick boundary unchanged');
set role service_role;
select test.assert(test.effect_commit(30,'00000000-0000-4000-8000-000000000501',test.effect_base())->>'sequence'='31','tick30 commits');
select test.assert(public.live_get_vote_window('11111111-1111-4111-8111-111111111111')->>'status'='open','window opens atomically at30');
select test.assert(test.effect_resolve() is null,'before deadline no resolution');
select public.live_submit_vote('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','00000000-0000-4000-8000-000000000511','bus');
select public.live_submit_vote('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-4000-8000-000000000512','rain');
reset role;
update live_private.vote_windows set deadline_ms=0;
update live_private.round_state set next_tick_at='-infinity';
set role service_role;
select test.vote_rejects($q$select test.effect_commit(31,'00000000-0000-4000-8000-000000000502',test.effect_base())$q$,'PT409');
select test.rejects('select test.effect_resolve(0)','stale fence cannot resolve');
select test.effect_resolve();
reset role;
create temp table resolved as select resolution from live_private.vote_windows;
-- Independent fixed SHA vector for seed7; SQL must use the first unsigned big-endian word.
select test.assert((select resolution->>'draw_digest' from resolved)='5c90f87fb0f7a9e1e93f1c9d339f4285b3d722bb86dc0619e50e48f7cc8fdc3b','tie digest domain');
select test.assert((select resolution->>'draw_r' from resolved)='1553004671','tie unsigned big-endian word');
select test.assert((select resolution->>'winner' from resolved)='bus','tie selected lexical index');
select test.assert((select resolution->'tied_options' from resolved)='["bus","rain"]','lexical tie options');
select test.assert((select resolution->>'effective_tick' from resolved)='31','resolution targets next tick');
select test.assert((select resolution->'counts' from resolved)='{"bus":1,"rain":1,"supplier-delay":0}','accepted selections only');
select test.assert((select applied_tick is null from live_private.vote_windows),'resolution is not premature application');
grant select on resolved to service_role;
set role service_role;
select test.assert(test.effect_resolve()=(select resolution from resolved),'resolve retry stable');
select test.assert(test.effect_commit(30,'00000000-0000-4000-8000-000000000501',test.effect_base())->>'replayed'='true','oldtick retry remains safe after resolution');
select public.live_control_round('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000521','pause',0,'operator-test');
select test.rejects('select test.effect_resolve()','pause revokes resolution fence');
select public.live_control_round('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000522','resume',1,'operator-test');
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60);
select test.assert(test.effect_resolve(4)=(select resolution from resolved),'new worker resumes same resolution');
reset role;
create temp table application as select test.effect_base() || jsonb_build_object('voteResolution',resolution,'resolvedSchedule',jsonb_build_object('version','demand-1','seed',7,'scenario',resolution->>'winner','hash',repeat('c',64),'shock',jsonb_build_object('id','vote:11111111-1111-4111-8111-111111111111:0','type',resolution->>'winner','effectiveTick',31,'endsAt',case when resolution->>'winner'='bus' then 31 else 40 end))) recovery from resolved;
grant select on application to service_role;
set role service_role;
select test.rejects($q$select test.effect_commit(31,'00000000-0000-4000-8000-000000000502',(select recovery || '{"voteResolution":null}' from application),4)$q$,'missing resolution rollback');
select test.assert(public.live_get_vote_result('11111111-1111-4111-8111-111111111111')->>'applied'='false','failed application stays pending');
select test.assert(test.effect_commit(31,'00000000-0000-4000-8000-000000000502',(select recovery from application),4)->>'sequence'='32','resolution atomically applied');
select test.assert(test.effect_commit(31,'00000000-0000-4000-8000-000000000502',(select recovery from application),4)->>'replayed'='true','applied tick retry exactly once');
set role anon;
select test.assert(public.live_get_vote_result('11111111-1111-4111-8111-111111111111')->>'applied'='true','public observes committed effect');
select test.assert(not public.live_get_vote_result('11111111-1111-4111-8111-111111111111') ? 'draw_digest','public result excludes private draw');
select test.rejects('select test.effect_resolve(4)','anon cannot resolve');
set role authenticated;
select test.rejects('select test.effect_resolve(4)','authenticated cannot resolve');
reset role;
select test.assert((select count(*) from public.game_events)=2,'no duplicate events');
update live_private.round_state set next_tick_at='-infinity';
set role service_role;
select test.rejects($q$select test.effect_commit(32,'00000000-0000-4000-8000-000000000503',(select jsonb_set(recovery,'{resolvedSchedule,hash}',to_jsonb(repeat('d',64))) from application),4)$q$,'applied schedule immutable');
select test.assert(test.effect_commit(32,'00000000-0000-4000-8000-000000000503',(select recovery from application),4)->>'sequence'='33','subsequent tick keeps event');
reset role;
update public.rounds set published=false;
set role anon;
select test.assert(public.live_get_vote_result('11111111-1111-4111-8111-111111111111') is null,'private round result hidden');
reset role;
-- Independent no-vote case: preserve exact clean schedule and apply no chaos.
delete from public.rounds;
insert into public.rounds(id,classification,policy_ids,configuration_hash,published,tick,sequence) values('11111111-1111-4111-8111-111111111111','exhibition',array['rules'],repeat('a',64),true,29,30);
insert into live_private.round_state(round_id,schedule_hash,recovery) values('11111111-1111-4111-8111-111111111111',repeat('b',64),test.effect_base());
set role service_role;
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60);
select test.effect_commit(30,'00000000-0000-4000-8000-000000000531',test.effect_base());
reset role;
-- Force the deadline to elapse after wrapper preflight but before commit returns.
create function test.slow_effect_insert() returns trigger language plpgsql as $$ begin perform pg_sleep(0.3); return new; end $$;
create trigger slow_effect_insert before insert on public.game_events for each row when(new.tick=31) execute function test.slow_effect_insert();
update live_private.vote_windows set deadline_ms=floor(extract(epoch from clock_timestamp())*1000)::bigint+200;
update live_private.round_state set next_tick_at='-infinity';
set role service_role;
select test.vote_rejects($q$select test.effect_commit(31,'00000000-0000-4000-8000-000000000532',test.effect_base())$q$,'PT409');
reset role;
select test.assert((select tick from public.rounds)=30,'mid-commit deadline leaves tick unchanged');
select test.assert((select count(*) from public.game_events)=1,'mid-commit deadline rolls back event');
select test.assert((select next_tick_at='-infinity'::timestamptz from live_private.round_state),'mid-commit deadline rolls back pacing');
drop trigger slow_effect_insert on public.game_events;
set role service_role;
select test.assert(test.effect_resolve()->'winner'='null','no votes means no winner');
select test.assert(test.effect_resolve()->'draw_r'='null','no votes consumes no tie draw');
select test.assert(test.effect_commit(31,'00000000-0000-4000-8000-000000000532',test.effect_base() || jsonb_build_object('voteResolution',test.effect_resolve(),'resolvedSchedule',test.effect_base()->'schedule'))->>'sequence'='32','no-vote clean application');
select test.assert(public.live_get_vote_result('11111111-1111-4111-8111-111111111111')->'ends_at'='null','no event duration');
reset role;
-- A unique winner requires no tie draw.
delete from public.rounds;
insert into public.rounds(id,classification,policy_ids,configuration_hash,published,tick,sequence) values('11111111-1111-4111-8111-111111111111','exhibition',array['rules'],repeat('a',64),true,30,31);
insert into live_private.round_state(round_id,schedule_hash,recovery) values('11111111-1111-4111-8111-111111111111',repeat('b',64),test.effect_base());
set role service_role;
select public.live_acquire_lease('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60);
select public.live_open_vote_window('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1);
select public.live_submit_vote('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','00000000-0000-4000-8000-000000000541','supplier-delay');
reset role;
update live_private.vote_windows set deadline_ms=0;
set role service_role;
select test.assert(test.effect_resolve()->>'winner'='supplier-delay','single winner');
select test.assert(test.effect_resolve()->'draw_digest'='null' and test.effect_resolve()->'draw_r'='null','single winner skips tie draw');
reset role;
\echo 'Vote resolution, application, recovery and permission checks passed.'
