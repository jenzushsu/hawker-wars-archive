-- P5-C worker recovery metadata. Keep private state fenced; expose status only to the service role.
create or replace function public.live_get_recovery(p_round_id uuid,p_owner_id uuid,p_fence bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id;
 return jsonb_build_object('schemaVersion','live-recovery-1','round_id',r.id,'classification',r.classification,'policy_ids',r.policy_ids,'status',r.status,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'recovery',s.recovery);
end $$;

-- Rules-worker pacing belongs to the same atomic transaction as the committed boundary.
-- Existing persistence-only envelopes have no workerVersion and retain their prior behavior.
alter table live_private.round_state add column next_tick_at timestamptz not null default '-infinity';
create function live_private.enforce_rules_worker_pacing() returns trigger
language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; now_at timestamptz;
begin
 if new.tick is not distinct from old.tick then return new; end if;
 select * into s from live_private.round_state where round_id=new.id for update;
 if s.recovery->>'workerVersion' = 'rules-worker-1' then
   now_at:=clock_timestamp();
   if s.next_tick_at>now_at then raise exception 'worker pacing boundary' using errcode='55000'; end if;
   update live_private.round_state set next_tick_at=now_at+interval '5 seconds' where round_id=new.id;
 end if;
 return new;
end $$;
revoke all on function live_private.enforce_rules_worker_pacing() from public,anon,authenticated,service_role;
create trigger rules_worker_pacing before update of tick on public.rounds for each row execute function live_private.enforce_rules_worker_pacing();

-- Reads do not create, acquire, renew, publish or advance a round. Includes unpublished/completed
-- rounds so a restarting worker can stop cleanly without acquiring an impossible terminal lease.
create function public.live_get_round_status(p_round_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-round-status-1','round_id',r.id,'classification',r.classification,'policy_ids',r.policy_ids,'status',r.status,'tick',r.tick,'sequence',r.sequence,'configuration_hash',r.configuration_hash,'schedule_hash',s.schedule_hash,'ready',r.status='running' and case when s.recovery->>'workerVersion'='rules-worker-1' then s.next_tick_at<=clock_timestamp() else true end)
 from public.rounds r join live_private.round_state s on s.round_id=r.id where r.id=p_round_id
$$;
revoke all on function public.live_get_recovery(uuid,uuid,bigint),public.live_get_round_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_get_recovery(uuid,uuid,bigint),public.live_get_round_status(uuid) to service_role;
