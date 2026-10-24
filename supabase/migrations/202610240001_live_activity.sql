-- Optional bounded activity on committed snapshots. Existing snapshots remain valid.
create or replace function live_private.commit_tick_base(p_round_id uuid,p_owner_id uuid,p_fence bigint,p_expected_sequence bigint,p_tick integer,p_commit_key uuid,p_snapshot jsonb,p_decisions jsonb,p_recovery jsonb)
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
   if not live_private.exact_keys(item - 'activity',array['policy_id','cash_cents','profit_cents','utility_points','served','abandoned']) then raise exception 'invalid public metric fields' using errcode='22023'; end if;
   if item ? 'activity' then
     if not live_private.exact_keys(item->'activity',array['queue','queuePoses','received','departed','cooking','ready','raw','action'])
       or jsonb_typeof(item->'activity'->'queuePoses') is distinct from 'array'
       or jsonb_typeof(item->'activity'->'cooking') is distinct from 'boolean' then
       raise exception 'invalid public activity' using errcode='22023';
     end if;
     foreach metric in array array['queue','received','departed','ready','raw'] loop
       if not live_private.safe_integer(item->'activity'->metric,0)
         or (item->'activity'->>metric)::bigint > (case when metric='raw' then 60 else 30 end) then
         raise exception 'invalid public activity count' using errcode='22023';
       end if;
     end loop;
     if jsonb_array_length(item->'activity'->'queuePoses') <> least(3,(item->'activity'->>'queue')::integer)
       or exists(select 1 from jsonb_array_elements(item->'activity'->'queuePoses') pose where pose not in ('"walk"'::jsonb,'"wait"'::jsonb,'"impatient"'::jsonb))
       or item->'activity'->'action' not in ('null'::jsonb,'"SERVE"'::jsonb,'"COOK"'::jsonb,'"RESTOCK"'::jsonb,'"PROMOTE"'::jsonb,'"WAIT"'::jsonb) then
       raise exception 'invalid public activity pose' using errcode='22023';
     end if;
   end if;
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
