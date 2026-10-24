-- Four-policy clean exhibitions. Preserve the rules/voting worker protocol.
-- All RPCs remain service-role-only and use the existing private state/fence.

-- Explicit local forced WAIT is neither a model response nor an error fallback.
alter table public.decisions drop constraint decisions_source_check;
alter table public.decisions drop constraint decisions_check;
alter table public.decisions drop constraint decisions_check2;
alter table public.decisions add constraint decisions_attribution check (
 (policy_id='rules' and source='rules' and fallback_reason is null)
 or (policy_id<>'rules' and (
   (source='model' and fallback_reason is null)
   or (source='rules' and fallback_reason is not null)
   or (source='forced_wait' and action='WAIT' and fallback_reason is null)
 ))
);

create or replace function live_private.enforce_rules_worker_pacing() returns trigger
language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; now_at timestamptz;
begin
 if new.tick is not distinct from old.tick then return new; end if;
 select * into s from live_private.round_state where round_id=new.id for update;
 if s.recovery->>'workerVersion' in ('rules-worker-1','multi-policy-worker-1') then
   now_at:=clock_timestamp();
   if s.next_tick_at>now_at then raise exception 'worker pacing boundary' using errcode='55000'; end if;
   update live_private.round_state set next_tick_at=now_at+interval '5 seconds' where round_id=new.id;
 end if;
 return new;
end $$;

create or replace function public.live_control_round(p_round_id uuid,p_request_id uuid,p_action text,p_expected_revision bigint,p_actor_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds; prior live_private.control_receipts; next_state text; result jsonb;
begin
 if p_round_id is null or p_request_id is null or p_action is null or p_action not in ('pause','resume','stop')
   or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990
   or p_actor_id is null or p_actor_id !~ '^[A-Za-z0-9_-]{1,128}$' then
   raise exception 'invalid control request' using errcode='22023';
 end if;
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 select * into prior from live_private.control_receipts where round_id=p_round_id and request_id=p_request_id;
 if found then
   if prior.action<>p_action or prior.expected_revision<>p_expected_revision or prior.actor_id<>p_actor_id then
     raise exception 'control request conflict' using errcode='PT409';
   end if;
   return prior.response || jsonb_build_object('replayed',true);
 end if;
 select * into r from public.rounds where id=p_round_id for update;
 if r.classification<>'exhibition' or ((r.policy_ids=array['rules']::text[] and s.recovery->>'workerVersion'='rules-worker-1')
   or (r.policy_ids=array['rules','jev','zoom','zoom-pro']::text[] and s.recovery->>'workerVersion'='multi-policy-worker-1')) is not true then
   raise exception 'unsupported controlled round' using errcode='PT409';
 end if;
 if r.status<>'running' or r.control_state='stopped' or r.control_revision<>p_expected_revision then
   raise exception 'control boundary conflict' using errcode='PT409';
 end if;
 if (p_action='pause' and r.control_state<>'active') or (p_action='resume' and r.control_state<>'paused') then
   raise exception 'invalid control transition' using errcode='PT409';
 end if;
 if s.fence>=9007199254740991 then raise exception 'fence exhausted' using errcode='22003'; end if;
 next_state:=case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'stopped' end;
 update public.rounds set control_state=next_state,control_revision=control_revision+1 where id=p_round_id;
 -- Every transition invalidates prior worker ownership, including pause/resume cycles.
 update live_private.round_state set owner_id=null,expires_at=null,fence=fence+1 where round_id=p_round_id;
 result:=jsonb_build_object('schemaVersion','live-control-1','round_id',p_round_id,'request_id',p_request_id,'action',p_action,
   'control_state',next_state,'control_revision',r.control_revision+1,'tick',r.tick,'sequence',r.sequence,'replayed',false);
 insert into live_private.control_receipts(round_id,request_id,action,expected_revision,actor_id,response)
   values(p_round_id,p_request_id,p_action,p_expected_revision,p_actor_id,result);
 return result;
end $$;
revoke all on function public.live_control_round(uuid,uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.live_control_round(uuid,uuid,text,bigint,text) to service_role;


create or replace function public.live_get_round_status(p_round_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-round-status-1','round_id',r.id,'classification',r.classification,'policy_ids',r.policy_ids,'status',r.status,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'control_state',r.control_state,'control_revision',r.control_revision,'ready',r.status='running' and r.control_state='active' and case when s.recovery->>'workerVersion' in ('rules-worker-1','multi-policy-worker-1') then s.next_tick_at<=clock_timestamp() else true end)
 from public.rounds r join live_private.round_state s on s.round_id=r.id where r.id=p_round_id
$$;

create function live_private.guard_multi_recovery() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.rounds;
begin
 if tg_op='UPDATE' and old.recovery->>'workerVersion'='multi-policy-worker-1' then
   if new.recovery->'workerVersion' is distinct from old.recovery->'workerVersion'
     or new.recovery->'providerConfigurationHash' is distinct from old.recovery->'providerConfigurationHash'
     or new.recovery->'schedule' is distinct from old.recovery->'schedule' then
     raise exception 'multi-policy recovery identity immutable' using errcode='22023';
   end if;
 end if;
 if new.recovery->>'workerVersion'='multi-policy-worker-1' then
   select * into r from public.rounds where id=new.round_id;
   if r.classification<>'exhibition' or r.policy_ids<>array['rules','jev','zoom','zoom-pro']::text[]
     or new.recovery->'votingEnabled' is distinct from 'false'::jsonb
     or new.recovery->>'providerConfigurationHash' is null
     or new.recovery->>'providerConfigurationHash' !~ '^[a-f0-9]{64}$'
     or new.recovery->'schedule'->>'scenario' is distinct from 'clean'
     or new.recovery->'schedule'->'shock' is distinct from 'null'::jsonb
     or new.recovery->'schedule'->>'hash' is distinct from new.schedule_hash then
     raise exception 'invalid multi-policy recovery identity' using errcode='22023';
   end if;
 end if;
 return new;
end $$;
create trigger guard_multi_recovery before insert or update of recovery on live_private.round_state
for each row execute function live_private.guard_multi_recovery();
revoke all on function live_private.guard_multi_recovery() from public,anon,authenticated,service_role;

-- Startup capability check prevents dispatch against an older unpaced schema.
create function public.live_multi_worker_protocol() returns text
language sql immutable security invoker set search_path='' as $$ select 'multi-policy-worker-1'::text $$;
revoke all on function public.live_multi_worker_protocol() from public,anon,authenticated,service_role;
grant execute on function public.live_multi_worker_protocol() to service_role;
