-- Study Together C6 — participant removal.
--
-- Investigated first: p2p_call_logs.participants (jsonb array, C1) is the
-- authoritative "who is allowed in this call" list; Break Rooms already
-- have a precedent (/calls/rooms/:roomId/remove, host-only) for exactly
-- this kind of removal, but no equivalent exists for p2p_ (Study Together)
-- calls. Reuses the existing, already-synchronized Study Leader role
-- (p2p_study_sessions.leader_id) as the authority — not a new "call owner"
-- concept — since that's the terminology and mechanism the product spec
-- itself uses, and it's already real-time-synchronized across clients.
--
-- Removal is scoped to the CALL's participants array (not just the study),
-- since the spec's own architecture note on Break Rooms and the existing
-- comment in group.tsx/room.tsx both establish that Agora gives no
-- participant authority over another client's media stream — "removal" is
-- necessarily a cooperative signal the target's own app acts on by leaving
-- the Agora channel, which requires the server-side authorization list
-- (participants array) to actually revoke their ability to reconnect/
-- resubscribe. This mirrors exactly how /calls/token and the realtime
-- Study Together channel (migration 086) already gate access.

create or replace function p2p_remove_study_participant(p_call_id uuid, p_leader_id uuid, p_target_user_id uuid) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_call record;
  v_session record;
begin
  if p_leader_id = p_target_user_id then
    raise exception 'cannot_remove_self';
  end if;

  select id, participants, status into v_call from p2p_call_logs where id = p_call_id for update;
  if v_call is null then raise exception 'call_not_found'; end if;
  if v_call.status <> 'initiated' then raise exception 'call_ended'; end if;
  if not (v_call.participants ? p_target_user_id::text) then raise exception 'not_a_participant'; end if;

  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null or v_session.leader_id <> p_leader_id then
    raise exception 'not_leader';
  end if;

  update p2p_call_logs
  set participants = (select jsonb_agg(p) from jsonb_array_elements_text(participants) p where p <> p_target_user_id::text)
  where id = p_call_id;

  update p2p_study_session_participants set left_at = now()
  where study_session_id = v_session.id and user_id = p_target_user_id and left_at is null;
end;
$$;