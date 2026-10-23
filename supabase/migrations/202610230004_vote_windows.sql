-- P5-E durable vote acceptance only. Effect resolution/application is deliberately gated.
create table live_private.vote_windows (
 round_id uuid primary key references public.rounds(id) on delete cascade,
 status text not null check(status in ('open','locked','disabled')),
 paused boolean not null default false,
 deadline_ms bigint,
 remaining_ms integer not null check(remaining_ms between 0 and 20000),
 check((status='open' and ((paused and deadline_ms is null) or (not paused and deadline_ms is not null))) or (status<>'open' and deadline_ms is null and remaining_ms=0))
);
create table live_private.vote_receipts (
 round_id uuid not null references live_private.vote_windows(round_id) on delete cascade,
 session_id uuid not null, request_id uuid not null,
 option_id text not null check(option_id in ('bus','rain','supplier-delay')),
 accepted_at_ms bigint not null,
 primary key(round_id,session_id,request_id)
);
create index vote_receipts_rate on live_private.vote_receipts(round_id,accepted_at_ms);
create table live_private.audience_votes (
 round_id uuid not null, session_id uuid not null, request_id uuid not null,
 primary key(round_id,session_id),
 foreign key(round_id,session_id,request_id) references live_private.vote_receipts(round_id,session_id,request_id) on delete cascade
);
alter table live_private.vote_windows enable row level security;
alter table live_private.vote_receipts enable row level security;
alter table live_private.audience_votes enable row level security;
revoke all on live_private.vote_windows,live_private.vote_receipts,live_private.audience_votes from public,anon,authenticated,service_role;

create function live_private.vote_window_projection(p_round_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare w live_private.vote_windows; now_ms bigint; effective_status text; counts jsonb;
begin
 select * into w from live_private.vote_windows where round_id=p_round_id;
 if not found then return null; end if;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 effective_status:=case when w.status='open' and not w.paused and now_ms>=w.deadline_ms then 'locked' else w.status end;
 select jsonb_build_object('bus',count(*) filter(where v.option_id='bus'),'rain',count(*) filter(where v.option_id='rain'),'supplier-delay',count(*) filter(where v.option_id='supplier-delay')) into counts
 from live_private.audience_votes a join live_private.vote_receipts v using(round_id,session_id,request_id) where a.round_id=p_round_id;
 return jsonb_build_object('schemaVersion','live-vote-window-1','round_id',p_round_id,'window_index',0,'status',effective_status,'paused',w.paused,
   'deadline_ms',case when effective_status='open' then w.deadline_ms else null end,
   'remaining_ms',case when effective_status<>'open' then 0 when w.paused then w.remaining_ms else greatest(0,least(20000,w.deadline_ms-now_ms)) end,
   'counts',counts,'eligible_options',case when effective_status='open' and not w.paused then '["bus","rain","supplier-delay"]'::jsonb else '[]'::jsonb end);
end $$;
revoke all on function live_private.vote_window_projection(uuid) from public,anon,authenticated,service_role;
create function public.live_get_vote_window(p_round_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 if not exists(select 1 from public.rounds where id=p_round_id and published) then return null; end if;
 return live_private.vote_window_projection(p_round_id);
end $$;
revoke all on function public.live_get_vote_window(uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_get_vote_window(uuid) to anon,authenticated,service_role;

create function public.live_open_vote_window(p_round_id uuid,p_owner_id uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; r public.rounds; now_ms bigint;
begin
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'round not found' using errcode='P0002'; end if;
 if p_owner_id is null or p_fence is null or s.owner_id is distinct from p_owner_id or s.fence<>p_fence or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'stale lease' using errcode='55000'; end if;
 select * into r from public.rounds where id=p_round_id;
 if r.classification<>'exhibition' or r.policy_ids<>array['rules']::text[] or r.status<>'running' or r.control_state<>'active' or r.tick<>30 or s.recovery->>'workerVersion' is distinct from 'rules-worker-1' or s.recovery->'votingEnabled' is distinct from 'true'::jsonb then
   raise exception 'ineligible voting boundary' using errcode='PT409';
 end if;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 insert into live_private.vote_windows(round_id,status,paused,deadline_ms,remaining_ms) values(p_round_id,'open',false,now_ms+20000,20000) on conflict(round_id) do nothing;
 return live_private.vote_window_projection(p_round_id);
end $$;

create function public.live_submit_vote(p_round_id uuid,p_session_id uuid,p_request_id uuid,p_option_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s live_private.round_state; w live_private.vote_windows; prior live_private.vote_receipts; now_ms bigint; total_count integer; session_count integer; recent_count integer; session_recent integer;
begin
 if p_round_id is null or p_session_id is null or p_request_id is null or p_option_id is null or p_option_id not in ('bus','rain','supplier-delay') then raise exception 'invalid vote' using errcode='22023'; end if;
 select * into s from live_private.round_state where round_id=p_round_id for update;
 if not found then raise exception 'vote unavailable' using errcode='PT409'; end if;
 select * into prior from live_private.vote_receipts where round_id=p_round_id and session_id=p_session_id and request_id=p_request_id;
 if found then
   if prior.option_id<>p_option_id then raise exception 'vote request conflict' using errcode='PT409'; end if;
   return jsonb_build_object('schemaVersion','live-vote-receipt-1','round_id',p_round_id,'window_index',0,'request_id',p_request_id,'option_id',prior.option_id,'accepted_at_ms',prior.accepted_at_ms,'replayed',true);
 end if;
 select * into w from live_private.vote_windows where round_id=p_round_id;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if not found or w.status<>'open' or w.paused or now_ms>=w.deadline_ms or not exists(select 1 from public.rounds where id=p_round_id and published and status='running' and control_state='active') then raise exception 'voting closed' using errcode='PT409'; end if;
 select count(*),count(*) filter(where session_id=p_session_id),count(*) filter(where accepted_at_ms>now_ms-1000),count(*) filter(where session_id=p_session_id and accepted_at_ms>now_ms-1000)
 into total_count,session_count,recent_count,session_recent from live_private.vote_receipts where round_id=p_round_id;
 if total_count>=400 or session_count>=20 or recent_count>=20 or session_recent>=2 then raise exception 'vote rate limit' using errcode='PT429'; end if;
 insert into live_private.vote_receipts values(p_round_id,p_session_id,p_request_id,p_option_id,now_ms);
 insert into live_private.audience_votes values(p_round_id,p_session_id,p_request_id) on conflict(round_id,session_id) do update set request_id=excluded.request_id;
 return jsonb_build_object('schemaVersion','live-vote-receipt-1','round_id',p_round_id,'window_index',0,'request_id',p_request_id,'option_id',p_option_id,'accepted_at_ms',now_ms,'replayed',false);
end $$;
create function public.live_get_vote_receipt(p_round_id uuid,p_session_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion','live-vote-receipt-1','round_id',v.round_id,'window_index',0,'request_id',v.request_id,'option_id',v.option_id,'accepted_at_ms',v.accepted_at_ms,'replayed',false)
 from live_private.audience_votes a join live_private.vote_receipts v using(round_id,session_id,request_id) where a.round_id=p_round_id and a.session_id=p_session_id
$$;
revoke all on function public.live_open_vote_window(uuid,uuid,bigint),public.live_submit_vote(uuid,uuid,uuid,text),public.live_get_vote_receipt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.live_open_vote_window(uuid,uuid,bigint),public.live_submit_vote(uuid,uuid,uuid,text),public.live_get_vote_receipt(uuid,uuid) to service_role;

-- live_control_round already owns round_state before updating rounds. Vote submissions
-- take the same lock, so pause, stop, deadline sampling and acceptance cannot interleave.
create function live_private.control_vote_window() returns trigger
language plpgsql security definer set search_path='' as $$
declare w live_private.vote_windows; now_ms bigint;
begin
 if new.control_state is not distinct from old.control_state then return new; end if;
 select * into w from live_private.vote_windows where round_id=new.id;
 if not found then return new; end if;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if new.control_state='stopped' then
   update live_private.vote_windows set status='disabled',paused=false,deadline_ms=null,remaining_ms=0 where round_id=new.id;
 elsif new.control_state='paused' then
   if w.status='open' and w.deadline_ms>now_ms then
     update live_private.vote_windows set paused=true,remaining_ms=least(20000,w.deadline_ms-now_ms),deadline_ms=null where round_id=new.id;
   else
     update live_private.vote_windows set status='locked',paused=true,deadline_ms=null,remaining_ms=0 where round_id=new.id;
   end if;
 elsif new.control_state='active' then
   update live_private.vote_windows set paused=false,deadline_ms=case when status='open' then now_ms+remaining_ms else null end where round_id=new.id;
 end if;
 return new;
end $$;
create trigger control_vote_window after update of control_state on public.rounds for each row execute function live_private.control_vote_window();
create function live_private.guard_unintegrated_voting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.tick is distinct from old.tick and exists(select 1 from live_private.round_state where round_id=new.id and recovery->'votingEnabled'='true'::jsonb) then
   raise exception 'voting effect integration unavailable' using errcode='55000';
 end if;
 return new;
end $$;
create trigger guard_unintegrated_voting before update of tick on public.rounds for each row execute function live_private.guard_unintegrated_voting();
revoke all on function live_private.control_vote_window(),live_private.guard_unintegrated_voting() from public,anon,authenticated,service_role;
