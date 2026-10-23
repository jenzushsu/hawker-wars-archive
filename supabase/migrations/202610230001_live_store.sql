-- P5-B persistence foundation. Service-side worker only; no provider dispatch or voting API.
create schema if not exists live_private;
revoke all on schema live_private from public, anon, authenticated;

create table public.rounds (
  id uuid primary key,
  classification text not null check (classification in ('offline-contract','clean','stress','exhibition','replay')),
  policy_ids text[] not null,
  configuration_hash text not null check (configuration_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running','completed')),
  published boolean not null default false,
  tick integer not null default -1 check (tick between -1 and 120),
  sequence bigint not null default 0 check (sequence between 0 and 121),
  snapshot jsonb not null default '{"policies":[]}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (sequence = tick + 1),
  check ((status = 'completed') = (tick = 120))
);
create unique index one_running_round on public.rounds ((status)) where status = 'running';
create table live_private.round_state (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  schedule_hash text not null check (schedule_hash ~ '^[0-9a-f]{64}$'),
  recovery jsonb not null,
  owner_id uuid,
  fence bigint not null default 0 check (fence >= 0),
  expires_at timestamptz,
  check ((owner_id is null) = (expires_at is null))
);
create table public.stall_snapshots (
  round_id uuid not null references public.rounds(id) on delete cascade,
  tick integer not null check (tick between 0 and 120),
  policy_id text not null check (policy_id in ('rules','jev','zoom','zoom-pro')),
  cash_cents bigint not null check (cash_cents between 0 and 9007199254740991),
  profit_cents bigint not null check (profit_cents between -9007199254740991 and 9007199254740991),
  utility_points bigint not null check (utility_points between -9007199254740991 and 9007199254740991),
  served bigint not null check (served between 0 and 9007199254740991),
  abandoned bigint not null check (abandoned between 0 and 9007199254740991),
  primary key(round_id,tick,policy_id)
);
create table public.decisions (
  round_id uuid not null references public.rounds(id) on delete cascade,
  tick integer not null check (tick between 0 and 119),
  policy_id text not null check (policy_id in ('rules','jev','zoom','zoom-pro')),
  action text not null check (action in ('SERVE','COOK','RESTOCK','PROMOTE','WAIT')),
  source text not null check (source in ('rules','model')),
  fallback_reason text check (fallback_reason in ('invalid','illegal','network','rate-limit','timeout','uncertain','budget','quota')),
  primary key(round_id,tick,policy_id),
  check (source <> 'model' or (fallback_reason is null and policy_id <> 'rules')),
  check (policy_id <> 'rules' or fallback_reason is null),
  check (policy_id = 'rules' or source = 'model' or fallback_reason is not null)
);
create table public.game_events (
  round_id uuid not null references public.rounds(id) on delete cascade,
  sequence bigint not null check (sequence between 1 and 121),
  tick integer not null check (tick between 0 and 120),
  event_type text not null check (event_type in ('tick-committed','round-closed')),
  snapshot jsonb not null,
  primary key(round_id,sequence),
  unique(round_id,tick),
  check (sequence = tick + 1),
  check ((event_type = 'round-closed') = (tick = 120))
);
create table live_private.tick_commits (
  round_id uuid not null references public.rounds(id) on delete cascade,
  commit_key uuid not null,
  payload_hash text not null,
  tick integer not null,
  sequence bigint not null,
  primary key(round_id,commit_key),
  unique(round_id,tick)
);

alter table public.rounds enable row level security;
alter table public.stall_snapshots enable row level security;
alter table public.decisions enable row level security;
alter table public.game_events enable row level security;
alter table live_private.round_state enable row level security;
alter table live_private.tick_commits enable row level security;
create policy published_rounds on public.rounds for select to anon, authenticated using (published);
create policy published_stalls on public.stall_snapshots for select to anon, authenticated using (exists(select 1 from public.rounds r where r.id=round_id and r.published));
create policy published_decisions on public.decisions for select to anon, authenticated using (exists(select 1 from public.rounds r where r.id=round_id and r.published));
create policy published_events on public.game_events for select to anon, authenticated using (exists(select 1 from public.rounds r where r.id=round_id and r.published));
revoke all on public.rounds,public.stall_snapshots,public.decisions,public.game_events from public,anon,authenticated,service_role;
grant select on public.rounds,public.stall_snapshots,public.decisions,public.game_events to anon,authenticated;
revoke all on all tables in schema live_private from public,anon,authenticated,service_role;

-- Internal validators never interpolate payloads into errors.
create function live_private.check_recovery(p_value jsonb) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' or p_value->>'schemaVersion' is distinct from 'recovery-1' or octet_length(p_value::text)>1048576 then
    raise exception 'invalid recovery envelope' using errcode='22023';
  end if;
end $$;
create function live_private.exact_keys(p_value jsonb,p_keys text[]) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)='object' then
  coalesce((select array_agg(k order by k) from jsonb_object_keys(p_value) k) = (select array_agg(k order by k) from unnest(p_keys) k),false)
 else false end
$$;
create function live_private.safe_integer(p_value jsonb,p_min bigint) returns boolean language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if p_value is null or jsonb_typeof(p_value)<>'number' then return false; end if;
 n:=p_value::text::numeric;
 return n=trunc(n) and n>=p_min and n<=9007199254740991;
end $$;

create function public.live_create_round(p_round_id uuid,p_classification text,p_policy_ids text[],p_configuration_hash text,p_schedule_hash text,p_recovery jsonb,p_published boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_round_id is null or p_classification is null or p_classification not in ('offline-contract','clean','stress','exhibition','replay')
   or p_configuration_hash is null or p_configuration_hash !~ '^[0-9a-f]{64}$' or p_schedule_hash is null or p_schedule_hash !~ '^[0-9a-f]{64}$'
   or p_published is null or p_policy_ids is null or cardinality(p_policy_ids) not between 1 and 4
   or not p_policy_ids <@ array['rules','jev','zoom','zoom-pro']::text[] or array_position(p_policy_ids,null) is not null
   or cardinality(p_policy_ids)<>(select count(distinct x) from unnest(p_policy_ids) x) or not 'rules'=any(p_policy_ids) then
   raise exception 'invalid round configuration' using errcode='22023';
 end if;
 perform live_private.check_recovery(p_recovery);
 insert into public.rounds(id,classification,policy_ids,configuration_hash,published) values(p_round_id,p_classification,p_policy_ids,p_configuration_hash,p_published);
 insert into live_private.round_state(round_id,schedule_hash,recovery) values(p_round_id,p_schedule_hash,p_recovery);
 return jsonb_build_object('round_id',p_round_id,'tick',-1,'sequence',0);
end $$;

create function public.live_acquire_lease(p_round_id uuid,p_owner_id uuid,p_ttl_seconds integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; n timestamptz; new_fence bigint; expires timestamptz;
begin
 if p_owner_id is null or p_ttl_seconds is null or p_ttl_seconds not between 1 and 60 then raise exception 'invalid lease request' using errcode='22023'; end if;
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 n:=clock_timestamp();
 if (select status from public.rounds where id=p_round_id)<>'running' then raise exception 'round closed' using errcode='55000'; end if;
 if s.owner_id is not null and s.expires_at>n then
   if s.owner_id<>p_owner_id then raise exception 'lease held' using errcode='55000'; end if;
   return jsonb_build_object('fence',s.fence,'expires_at',s.expires_at);
 end if;
 if s.fence>=9007199254740991 then raise exception 'fence exhausted' using errcode='22003'; end if;
 new_fence:=s.fence+1; expires:=n+make_interval(secs=>p_ttl_seconds);
 update live_private.round_state set owner_id=p_owner_id,fence=new_fence,expires_at=expires where round_id=p_round_id;
 return jsonb_build_object('fence',new_fence,'expires_at',expires);
end $$;
create function public.live_renew_lease(p_round_id uuid,p_owner_id uuid,p_fence bigint,p_ttl_seconds integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; n timestamptz; expires timestamptz;
begin
 if p_ttl_seconds is null or p_ttl_seconds not between 1 and 60 then raise exception 'invalid lease request' using errcode='22023'; end if;
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 n:=clock_timestamp();
 if (select status from public.rounds where id=p_round_id)<>'running' then raise exception 'round closed' using errcode='55000'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=n then raise exception 'stale lease' using errcode='55000'; end if;
 expires:=n+make_interval(secs=>p_ttl_seconds);
 update live_private.round_state set expires_at=expires where round_id=p_round_id;
 return jsonb_build_object('fence',s.fence,'expires_at',expires);
end $$;
create function public.live_release_lease(p_round_id uuid,p_owner_id uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare s live_private.round_state;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 update live_private.round_state set owner_id=null,expires_at=null where round_id=p_round_id;
 return true;
end $$;

create function public.live_commit_tick(p_round_id uuid,p_owner_id uuid,p_fence bigint,p_expected_sequence bigint,p_tick integer,p_commit_key uuid,p_snapshot jsonb,p_decisions jsonb,p_recovery jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds; prior live_private.tick_commits; payload_hash text;
  item jsonb; seen text[]:=array[]::text[]; decision_seen text[]:=array[]::text[]; policy text; metric text; next_sequence bigint;
begin
 if p_owner_id is null or p_fence is null or p_commit_key is null or p_expected_sequence is null or p_expected_sequence not between 0 and 120 or p_tick is null or p_tick not between 0 and 120
   or p_snapshot is null or p_decisions is null or octet_length(p_snapshot::text)>16384 or octet_length(p_decisions::text)>16384 then raise exception 'invalid commit envelope' using errcode='22023'; end if;
 perform live_private.check_recovery(p_recovery);
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id for update;
 payload_hash:=encode(sha256(convert_to(jsonb_build_object('expected_sequence',p_expected_sequence,'tick',p_tick,'snapshot',p_snapshot,'decisions',p_decisions,'recovery',p_recovery)::text,'UTF8')),'hex');
 select * into prior from live_private.tick_commits c where c.round_id=p_round_id and c.commit_key=p_commit_key;
 if found then
   if prior.payload_hash<>payload_hash then raise exception 'commit key conflict' using errcode='22023'; end if;
   if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
   return jsonb_build_object('round_id',p_round_id,'tick',prior.tick,'sequence',prior.sequence,'replayed',true);
 end if;
 if r.status<>'running' or r.sequence<>p_expected_sequence or p_tick<>r.tick+1 then raise exception 'commit boundary conflict' using errcode='55000'; end if;
 if not live_private.exact_keys(p_snapshot,array['policies']) or jsonb_typeof(p_snapshot->'policies') is distinct from 'array'
   or jsonb_array_length(p_snapshot->'policies')<>cardinality(r.policy_ids) or jsonb_typeof(p_decisions) is distinct from 'array' then raise exception 'invalid public projection' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_snapshot->'policies') loop
   if not live_private.exact_keys(item,array['policy_id','cash_cents','profit_cents','utility_points','served','abandoned']) then raise exception 'invalid public metric fields' using errcode='22023'; end if;
   policy:=item->>'policy_id';
   if policy is null or not policy=any(r.policy_ids) or policy=any(seen) then raise exception 'invalid public policies' using errcode='22023'; end if;
   seen:=array_append(seen,policy);
   foreach metric in array array['cash_cents','profit_cents','utility_points','served','abandoned'] loop
     if not live_private.safe_integer(item->metric,case when metric in ('profit_cents','utility_points') then -9007199254740991 else 0 end) then raise exception 'invalid public metric' using errcode='22023'; end if;
   end loop;
 end loop;
 if jsonb_array_length(p_decisions)<>(case when p_tick=120 then 0 else cardinality(r.policy_ids) end) then raise exception 'invalid decision count' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_decisions) loop
   if not live_private.exact_keys(item,array['policy_id','action','source','fallback_reason']) then raise exception 'invalid public decision fields' using errcode='22023'; end if;
   policy:=item->>'policy_id';
   if policy is null or not policy=any(r.policy_ids) or policy=any(decision_seen) then raise exception 'invalid decision policies' using errcode='22023'; end if;
   decision_seen:=array_append(decision_seen,policy);
   if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
   -- Table constraints validate action, source and fallback attribution; nulls are not allowed except fallback_reason.
   insert into public.decisions(round_id,tick,policy_id,action,source,fallback_reason)
   values(p_round_id,p_tick,policy,item->>'action',item->>'source',item->>'fallback_reason');
 end loop;
 if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 for item in select value from jsonb_array_elements(p_snapshot->'policies') loop
   insert into public.stall_snapshots(round_id,tick,policy_id,cash_cents,profit_cents,utility_points,served,abandoned)
   values(p_round_id,p_tick,item->>'policy_id',(item->>'cash_cents')::bigint,(item->>'profit_cents')::bigint,(item->>'utility_points')::bigint,(item->>'served')::bigint,(item->>'abandoned')::bigint);
 end loop;
 next_sequence:=r.sequence+1;
 insert into public.game_events(round_id,sequence,tick,event_type,snapshot)
 values(p_round_id,next_sequence,p_tick,case when p_tick=120 then 'round-closed' else 'tick-committed' end,p_snapshot);
 insert into live_private.tick_commits(round_id,commit_key,payload_hash,tick,sequence) values(p_round_id,p_commit_key,payload_hash,p_tick,next_sequence);
 update public.rounds set tick=p_tick,sequence=next_sequence,snapshot=p_snapshot,status=case when p_tick=120 then 'completed' else 'running' end where id=p_round_id;
 update live_private.round_state set recovery=p_recovery where round_id=p_round_id;
 if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 return jsonb_build_object('round_id',p_round_id,'tick',p_tick,'sequence',next_sequence,'replayed',false);
end $$;

create function public.live_get_snapshot(p_round_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-snapshot-1','round_id',r.id,'classification',r.classification,'tick',r.tick,'sequence',r.sequence,'status',r.status,'configuration_hash',r.configuration_hash,'snapshot',r.snapshot)
 from public.rounds r where r.id=p_round_id and r.published
$$;
create function public.live_get_events(p_round_id uuid,p_after_sequence bigint,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare high_water bigint; events jsonb;
begin
 if p_after_sequence is null or p_after_sequence not between 0 and 121 or p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid event cursor' using errcode='22023'; end if;
 select sequence into high_water from public.rounds where id=p_round_id and published;
 if not found then return jsonb_build_object('high_water',0,'events','[]'::jsonb); end if;
 if p_after_sequence>high_water then raise exception 'cursor beyond boundary' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x.event order by x.sequence),'[]'::jsonb) into events from (
   select e.sequence,jsonb_build_object('round_id',e.round_id,'sequence',e.sequence,'tick',e.tick,'event_type',e.event_type,'snapshot',e.snapshot) as event
   from public.game_events e where e.round_id=p_round_id and e.sequence>p_after_sequence and e.sequence<=high_water order by e.sequence limit p_limit
 ) x;
 return jsonb_build_object('high_water',high_water,'events',events);
end $$;
create function public.live_get_recovery(p_round_id uuid,p_owner_id uuid,p_fence bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id;
 return jsonb_build_object('schemaVersion','live-recovery-1','round_id',r.id,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'recovery',s.recovery);
end $$;

-- Explicitly revoke default PUBLIC execute; do not rely on project default privileges.
revoke all on function live_private.check_recovery(jsonb),live_private.exact_keys(jsonb,text[]),live_private.safe_integer(jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function public.live_create_round(uuid,text,text[],text,text,jsonb,boolean),public.live_acquire_lease(uuid,uuid,integer),public.live_renew_lease(uuid,uuid,bigint,integer),public.live_release_lease(uuid,uuid,bigint),public.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb),public.live_get_recovery(uuid,uuid,bigint),public.live_get_snapshot(uuid),public.live_get_events(uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.live_create_round(uuid,text,text[],text,text,jsonb,boolean),public.live_acquire_lease(uuid,uuid,integer),public.live_renew_lease(uuid,uuid,bigint,integer),public.live_release_lease(uuid,uuid,bigint),public.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb),public.live_get_recovery(uuid,uuid,bigint) to service_role;
grant execute on function public.live_get_snapshot(uuid),public.live_get_events(uuid,bigint,integer) to anon,authenticated,service_role;

-- Publish only the already-sanitized event table. PostgreSQL sends changes after commit.
-- Realtime delivery remains an optimization; clients must recover gaps through persisted cursors.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_events') then
     alter publication supabase_realtime add table public.game_events;
   end if;
 end if;
end $$;
