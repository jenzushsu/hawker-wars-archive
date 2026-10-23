-- A bounded, sanitized read model. Shared readers never acquire worker ownership.
create function public.live_get_view(p_round_id uuid,p_after_sequence bigint default 0,p_limit integer default 100)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare boundary bigint; projection jsonb;
begin
 if p_round_id is null or p_after_sequence is null or p_after_sequence not between 0 and 121 or p_limit is null or p_limit not between 1 and 100 then
   raise exception 'invalid view cursor' using errcode='22023';
 end if;
 -- Every authoritative worker/control/vote mutation locks this row FOR UPDATE.
 -- FOR SHARE permits concurrent viewers while keeping the whole response at one boundary.
 perform 1 from live_private.round_state where round_id=p_round_id for share;
 if not found then return null; end if;
 select sequence into boundary from public.rounds where id=p_round_id and published;
 if not found then return null; end if;
 if p_after_sequence>boundary then raise exception 'view cursor beyond boundary' using errcode='PT409'; end if;
 projection:=jsonb_build_object('schemaVersion','live-view-1',
   'snapshot',public.live_get_snapshot(p_round_id),
   'events',public.live_get_events(p_round_id,p_after_sequence,p_limit),
   'vote_window',public.live_get_vote_window(p_round_id),
   'vote_result',public.live_get_vote_result(p_round_id),
   'server_time_ms',floor(extract(epoch from clock_timestamp())*1000)::bigint);
 return projection;
end $$;
revoke all on function public.live_get_view(uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.live_get_view(uuid,bigint,integer) to anon,authenticated,service_role;
