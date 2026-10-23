-- P5-F: durable deterministic resolution, applied with the atomic rules-worker tick.
alter table live_private.vote_windows add column resolution jsonb;
alter table live_private.vote_windows add column applied_tick integer check(applied_tick between 31 and 119);
alter table live_private.vote_windows add constraint vote_application_requires_resolution check(applied_tick is null or resolution is not null);

create function public.live_resolve_vote_window(p_round_id uuid,p_owner_id uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds; w live_private.vote_windows; counts jsonb; maximum integer; tied text[]; winner text; digest bytea; draw_r bigint; seed integer; result jsonb;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id;
 if r.classification<>'exhibition' or r.policy_ids<>array['rules']::text[] or r.status<>'running' or r.control_state<>'active'
   or s.recovery->>'workerVersion' is distinct from 'rules-worker-1' or s.recovery->>'voteWorkerVersion' is distinct from 'rules-voting-1' or s.recovery->'votingEnabled' is distinct from 'true'::jsonb then
   raise exception 'ineligible resolution boundary' using errcode='PT409';
 end if;
 select * into w from live_private.vote_windows where round_id=p_round_id;
 if not found then raise exception 'vote window unavailable' using errcode='PT409'; end if;
 if w.resolution is not null then return w.resolution; end if;
 if w.paused or w.status='disabled' then raise exception 'vote window unavailable' using errcode='PT409'; end if;
 if w.status='open' and w.deadline_ms>floor(extract(epoch from clock_timestamp())*1000)::bigint then return null; end if;
 if r.tick<30 or r.tick>=119 then raise exception 'resolution closing boundary' using errcode='PT409'; end if;
 if not live_private.safe_integer(s.recovery->'schedule'->'seed',0) or (s.recovery->'schedule'->>'seed')::bigint>99 then raise exception 'invalid vote seed' using errcode='22023'; end if;
 seed:=(s.recovery->'schedule'->>'seed')::integer;
 select jsonb_build_object('bus',count(*) filter(where v.option_id='bus'),'rain',count(*) filter(where v.option_id='rain'),'supplier-delay',count(*) filter(where v.option_id='supplier-delay')) into counts
 from live_private.audience_votes a join live_private.vote_receipts v using(round_id,session_id,request_id) where a.round_id=p_round_id;
 select max(value::integer) into maximum from jsonb_each_text(counts);
 select coalesce(array_agg(key order by key collate "C"),array[]::text[]) into tied from jsonb_each_text(counts) where value::integer=maximum and maximum>0;
 if cardinality(tied)>1 then
   digest:=sha256(convert_to('hawker-wars|demand-1|'||seed||'|vote_tie|0|0','UTF8'));
   draw_r:=get_byte(digest,0)::bigint*16777216+get_byte(digest,1)::bigint*65536+get_byte(digest,2)::bigint*256+get_byte(digest,3);
   winner:=tied[1+floor(draw_r::numeric*cardinality(tied)/4294967296)::integer];
 elsif cardinality(tied)=1 then winner:=tied[1]; end if;
 result:=jsonb_build_object('schemaVersion','live-vote-resolution-1','round_id',p_round_id,'window_index',0,'counts',counts,'winner',winner,'tied_options',to_jsonb(tied),'draw_r',draw_r,'draw_digest',encode(digest,'hex'),'effective_tick',r.tick+1);
 if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 update live_private.vote_windows set status='locked',deadline_ms=null,remaining_ms=0,resolution=result where round_id=p_round_id;
 return result;
end $$;
revoke all on function public.live_resolve_vote_window(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.live_resolve_vote_window(uuid,uuid,bigint) to service_role;
create function public.live_get_vote_result(p_round_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-vote-result-1','round_id',r.id,'winner',w.resolution->'winner','effective_tick',w.resolution->'effective_tick',
 'ends_at',case when w.resolution->>'winner' is null then null else (w.resolution->>'effective_tick')::integer+case when w.resolution->>'winner'='bus' then 0 else 9 end end,
 'counts',w.resolution->'counts','applied',w.applied_tick is not null)
 from public.rounds r join live_private.vote_windows w on w.round_id=r.id where r.id=p_round_id and r.published and w.resolution is not null
$$;
revoke all on function public.live_get_vote_result(uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_get_vote_result(uuid) to anon,authenticated,service_role;

-- Preserve the previously validated commit body while restricting its invocation to
-- this security-definer wrapper. No caller can bypass the new vote boundary checks.
alter function public.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb) set schema live_private;
alter function live_private.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb) rename to commit_tick_base;
revoke all on function live_private.commit_tick_base(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.live_commit_tick(p_round_id uuid,p_owner_id uuid,p_fence bigint,p_expected_sequence bigint,p_tick integer,p_commit_key uuid,p_snapshot jsonb,p_decisions jsonb,p_recovery jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds; w live_private.vote_windows; result jsonb; enabled boolean; integrated boolean; winner text; effect_tick integer; resolved jsonb;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 -- Base validates exact payload equality, fence and expiry even for historical retries.
 if exists(select 1 from live_private.tick_commits where round_id=p_round_id and commit_key=p_commit_key) then
   return live_private.commit_tick_base(p_round_id,p_owner_id,p_fence,p_expected_sequence,p_tick,p_commit_key,p_snapshot,p_decisions,p_recovery);
 end if;
 enabled:=s.recovery->'votingEnabled'='true'::jsonb;
 integrated:=enabled and s.recovery->>'voteWorkerVersion'='rules-voting-1';
 if p_recovery->'votingEnabled' is distinct from s.recovery->'votingEnabled' or p_recovery->'voteWorkerVersion' is distinct from s.recovery->'voteWorkerVersion' then raise exception 'voting mode immutable' using errcode='22023'; end if;
 if integrated then
   select * into r from public.rounds where id=p_round_id;
   if r.classification<>'exhibition' or r.policy_ids<>array['rules']::text[] or s.recovery->>'workerVersion' is distinct from 'rules-worker-1'
     or p_recovery->'workerVersion' is distinct from s.recovery->'workerVersion' or p_recovery->'schedule' is distinct from s.recovery->'schedule'
     or p_recovery->'schedule'->>'scenario' is distinct from 'clean' or p_recovery->'schedule'->'shock' is distinct from 'null'::jsonb
     or p_recovery->'schedule'->>'hash' is distinct from s.schedule_hash then raise exception 'invalid voting recovery base' using errcode='22023'; end if;
   select * into w from live_private.vote_windows where round_id=p_round_id;
   if p_tick>30 and not found then raise exception 'vote window unavailable' using errcode='PT409'; end if;
   if w.resolution is null then
     if p_recovery->'voteResolution' is distinct from 'null'::jsonb or p_recovery->'resolvedSchedule' is distinct from 'null'::jsonb then raise exception 'unresolved vote recovery' using errcode='22023'; end if;
     if p_tick>30 and (w.status<>'open' or w.paused or w.deadline_ms<=floor(extract(epoch from clock_timestamp())*1000)::bigint or p_tick>=120) then raise exception 'vote resolution required' using errcode='PT409'; end if;
   else
     if p_recovery->'voteResolution' is distinct from w.resolution then raise exception 'vote resolution mismatch' using errcode='22023'; end if;
     effect_tick:=(w.resolution->>'effective_tick')::integer;
     if (w.applied_tick is null and p_tick<>effect_tick) or p_tick<effect_tick then raise exception 'vote application boundary' using errcode='PT409'; end if;
     winner:=w.resolution->>'winner'; resolved:=p_recovery->'resolvedSchedule';
     if winner is null then
       if resolved is distinct from s.recovery->'schedule' then raise exception 'no-vote schedule mutation' using errcode='22023'; end if;
     elsif jsonb_typeof(resolved) is distinct from 'object' or resolved->>'version' is distinct from 'demand-1' or resolved->'seed' is distinct from s.recovery->'schedule'->'seed'
       or resolved->>'scenario' is distinct from winner or resolved->'shock' is distinct from jsonb_build_object('id','vote:'||p_round_id||':0','type',winner,'effectiveTick',effect_tick,'endsAt',effect_tick+case when winner='bus' then 0 else 9 end)
       or resolved->>'hash' is null or resolved->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'resolved schedule mismatch' using errcode='22023'; end if;
     if w.applied_tick is not null and p_recovery->'resolvedSchedule' is distinct from s.recovery->'resolvedSchedule' then raise exception 'resolved schedule immutable' using errcode='22023'; end if;
   end if;
 end if;
 result:=live_private.commit_tick_base(p_round_id,p_owner_id,p_fence,p_expected_sequence,p_tick,p_commit_key,p_snapshot,p_decisions,p_recovery);
 if integrated and p_tick>30 and w.resolution is null and w.deadline_ms<=floor(extract(epoch from clock_timestamp())*1000)::bigint then raise exception 'vote resolution required' using errcode='PT409'; end if;
 if integrated and p_tick=30 then perform public.live_open_vote_window(p_round_id,p_owner_id,p_fence); end if;
 if integrated and w.resolution is not null and w.applied_tick is null then
   update live_private.vote_windows set applied_tick=p_tick where round_id=p_round_id;
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 return result;
end $$;
revoke all on function public.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.live_commit_tick(uuid,uuid,bigint,bigint,integer,uuid,jsonb,jsonb,jsonb) to service_role;
create or replace function live_private.guard_unintegrated_voting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.tick is distinct from old.tick and exists(select 1 from live_private.round_state where round_id=new.id and recovery->'votingEnabled'='true'::jsonb and recovery->>'voteWorkerVersion' is distinct from 'rules-voting-1') then
   raise exception 'voting effect integration unavailable' using errcode='55000';
 end if;
 return new;
end $$;
