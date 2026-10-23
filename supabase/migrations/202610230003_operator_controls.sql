-- P5-D: rules-only exhibition controls. Tick and control revisions are independent.
alter table public.rounds add column control_state text not null default 'active' check (control_state in ('active','paused','stopped'));
alter table public.rounds add column control_revision bigint not null default 0 check (control_revision between 0 and 9007199254740991);
drop index public.one_running_round;
create unique index one_running_round on public.rounds ((status)) where status='running' and control_state<>'stopped';

create table live_private.control_receipts (
 round_id uuid not null references public.rounds(id) on delete cascade,
 request_id uuid not null,
 action text not null check (action in ('pause','resume','stop')),
 expected_revision bigint not null check (expected_revision between 0 and 9007199254740990),
 actor_id text not null check (actor_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 response jsonb not null,
 accepted_at timestamptz not null default clock_timestamp(),
 primary key(round_id,request_id)
);
alter table live_private.control_receipts enable row level security;
revoke all on live_private.control_receipts from public,anon,authenticated,service_role;

-- Existing RPCs already lock round_state before any lease or tick mutation. These
-- guards preserve that ordering and reject a paused/stopped write transactionally.
create function live_private.guard_controlled_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id is not null and (select control_state from public.rounds where id=new.round_id)<>'active' then
   raise exception 'round not active' using errcode='55000';
 end if;
 return new;
end $$;
create trigger controlled_lease before update of owner_id,expires_at on live_private.round_state
 for each row execute function live_private.guard_controlled_lease();
create function live_private.guard_controlled_tick() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.tick is distinct from old.tick and old.control_state<>'active' then
   raise exception 'round not active' using errcode='55000';
 end if;
 return new;
end $$;
create trigger controlled_tick before update of tick on public.rounds for each row execute function live_private.guard_controlled_tick();
revoke all on function live_private.guard_controlled_lease(),live_private.guard_controlled_tick() from public,anon,authenticated,service_role;

create function public.live_control_round(p_round_id uuid,p_request_id uuid,p_action text,p_expected_revision bigint,p_actor_id text)
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
 if r.classification<>'exhibition' or r.policy_ids<>array['rules']::text[] or s.recovery->>'workerVersion' is distinct from 'rules-worker-1' then
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

create or replace function public.live_get_snapshot(p_round_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-snapshot-1','round_id',r.id,'classification',r.classification,'tick',r.tick,'sequence',r.sequence,'status',r.status,'configuration_hash',r.configuration_hash,'snapshot',r.snapshot,'control_state',r.control_state,'control_revision',r.control_revision)
 from public.rounds r where r.id=p_round_id and r.published
$$;
create or replace function public.live_get_round_status(p_round_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-round-status-1','round_id',r.id,'classification',r.classification,'policy_ids',r.policy_ids,'status',r.status,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'control_state',r.control_state,'control_revision',r.control_revision,'ready',r.status='running' and r.control_state='active' and case when s.recovery->>'workerVersion'='rules-worker-1' then s.next_tick_at<=clock_timestamp() else true end)
 from public.rounds r join live_private.round_state s on s.round_id=r.id where r.id=p_round_id
$$;
create or replace function public.live_get_recovery(p_round_id uuid,p_owner_id uuid,p_fence bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id;
 return jsonb_build_object('schemaVersion','live-recovery-1','round_id',r.id,'classification',r.classification,'policy_ids',r.policy_ids,'status',r.status,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'recovery',s.recovery,'control_state',r.control_state,'control_revision',r.control_revision);
end $$;
-- CREATE OR REPLACE retains the established role grants and security-definer search paths.
