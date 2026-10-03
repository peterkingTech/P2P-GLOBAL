-- P2P Calling Stage 25D — Circle call lifecycle + Study Together
-- Circle-aware authorization bridge.
--
-- Builds on migration 169's additive schema (p2p_call_logs.circle_session_id,
-- p2p_call_logs_one_initiated_per_circle). This migration:
--   1. Adds p2p_start_circle_call — a new, atomic get-or-create for a
--      Circle's live call log + scheduled business session, replacing the
--      non-atomic find-or-create previously done in application code
--      (circles.ts's start-session route), which had a genuine race
--      exposed by migration 169's new unique indexes.
--   2. Extends three EXISTING Study Together RPCs (p2p_start_study_session,
--      p2p_join_study_session, p2p_remove_study_participant) with a
--      Circle-aware authorization branch. Every 1:1 branch below is
--      copied byte-for-byte from the currently-deployed function bodies
--      (migrations 084/094) — only a new `if v_call.circle_id is not null`
--      branch is added alongside it. No 1:1 behavior changes.
--
-- Nothing here touches RLS, drops a constraint, deletes a row, or retypes
-- an existing column.

-- ── 1. Atomic Circle call-log + scheduled-session get-or-create ────────────
-- Locks the p2p_peer_circles row first, which serializes ALL concurrent
-- start attempts for the same circle — this is what makes it structurally
-- impossible to hit migration 169's p2p_call_logs_one_initiated_per_circle
-- or the new p2p_peer_circle_sessions_one_scheduled_per_circle unique
-- indexes via a race, rather than catching the resulting error after the
-- fact. Mirrors the exact row-locking pattern already proven in
-- p2p_start_study_session/p2p_reassign_study_leader (migration 084).
create or replace function p2p_start_circle_call(p_circle_id uuid, p_caller_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_circle record;
  v_session record;
  v_call_log record;
begin
  select id, leader_id, current_lesson_id, name into v_circle
  from p2p_peer_circles where id = p_circle_id for update;
  if v_circle is null then raise exception 'circle_not_found'; end if;
  if v_circle.leader_id <> p_caller_id then raise exception 'not_leader'; end if;
  if v_circle.current_lesson_id is null then raise exception 'no_current_lesson'; end if;

  select * into v_session from p2p_peer_circle_sessions
  where circle_id = p_circle_id and lesson_id = v_circle.current_lesson_id and session_status = 'scheduled'
  for update;
  if v_session is null then
    insert into p2p_peer_circle_sessions (circle_id, lesson_id, session_status, created_by)
    values (p_circle_id, v_circle.current_lesson_id, 'scheduled', p_caller_id)
    returning * into v_session;
  end if;

  select * into v_call_log from p2p_call_logs
  where circle_id = p_circle_id and status = 'initiated' for update;
  if v_call_log is null then
    insert into p2p_call_logs (channel_name, call_type, initiated_by, participants, status, circle_id, circle_session_id)
    values ('circle_' || p_circle_id::text, 'group', p_caller_id, jsonb_build_array(p_caller_id::text), 'initiated', p_circle_id, v_session.id)
    returning * into v_call_log;
  elsif v_call_log.circle_session_id is distinct from v_session.id then
    -- An active call log already exists (a prior start-session call that
    -- hasn't ended yet) but isn't linked to the current scheduled session
    -- (e.g. the lesson advanced between calls) — relink rather than
    -- creating a second row, since the unique index only allows one
    -- 'initiated' call log per circle at all.
    update p2p_call_logs set circle_session_id = v_session.id where id = v_call_log.id;
  end if;

  return jsonb_build_object(
    'channelName', v_call_log.channel_name, 'sessionId', v_session.id,
    'callLogId', v_call_log.id, 'circleName', v_circle.name
  );
end;
$$;

-- ── 2. p2p_start_study_session — Circle-aware branch added ──────────────────
-- 1:1 branch (v_call.circle_id is null): BYTE-IDENTICAL to migration 084's
-- original body. Circle branch: authorizes against active
-- p2p_peer_circle_members instead of the call log's participants array.
create or replace function p2p_start_study_session(
  p_call_id uuid, p_user_id uuid, p_lesson_id uuid, p_module_id uuid, p_title text
) returns uuid
language plpgsql security definer as $$
declare
  v_call record;
  v_session_id uuid;
begin
  select id, channel_name, participants, status, circle_id into v_call
  from p2p_call_logs where id = p_call_id for update;

  if v_call is null then
    raise exception 'call_not_found';
  end if;
  if v_call.status <> 'initiated' then
    raise exception 'call_ended';
  end if;

  if v_call.circle_id is not null then
    if not exists (
      select 1 from p2p_peer_circle_members
      where circle_id = v_call.circle_id and user_id = p_user_id and status = 'active'
    ) then
      raise exception 'not_participant';
    end if;
  else
    if not (v_call.participants ? p_user_id::text) then
      raise exception 'not_participant';
    end if;
  end if;

  if exists (select 1 from p2p_study_sessions where call_log_id = p_call_id and status = 'active') then
    raise exception 'session_already_active';
  end if;

  insert into p2p_study_sessions (call_log_id, channel_name, lesson_id, module_id, title, leader_id, created_by)
  values (p_call_id, v_call.channel_name, p_lesson_id, p_module_id, p_title, p_user_id, p_user_id)
  returning id into v_session_id;

  insert into p2p_study_session_participants (study_session_id, user_id) values (v_session_id, p_user_id);

  return v_session_id;
end;
$$;

-- ── 3. p2p_join_study_session — Circle-aware branch added ───────────────────
-- Same shape as above: 1:1 branch identical to migration 084's original.
create or replace function p2p_join_study_session(p_call_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer as $$
declare
  v_call record;
  v_session record;
begin
  select id, participants, status, circle_id into v_call from p2p_call_logs where id = p_call_id for update;
  if v_call is null then raise exception 'call_not_found'; end if;

  if v_call.circle_id is not null then
    if not exists (
      select 1 from p2p_peer_circle_members
      where circle_id = v_call.circle_id and user_id = p_user_id and status = 'active'
    ) then
      raise exception 'not_participant';
    end if;
  else
    if not (v_call.participants ? p_user_id::text) then raise exception 'not_participant'; end if;
  end if;

  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then raise exception 'no_active_session'; end if;

  insert into p2p_study_session_participants (study_session_id, user_id)
  values (v_session.id, p_user_id)
  on conflict (study_session_id, user_id) do update set left_at = null;

  return jsonb_build_object(
    'sessionId', v_session.id, 'leaderId', v_session.leader_id,
    'lessonId', v_session.lesson_id, 'moduleId', v_session.module_id, 'title', v_session.title,
    'currentSectionIndex', v_session.current_section_index
  );
end;
$$;

-- ── 4. p2p_remove_study_participant — Circle-aware branch added ─────────────
-- IMPORTANT ASYMMETRY, documented rather than silently accepted: for 1:1/
-- p2p_ calls this function's participants-array mutation has real teeth —
-- it is exactly what /calls/token's p2p_ branch checks before minting a
-- fresh token, so removal there genuinely revokes rejoin capability. For
-- Circle calls, rejoin authorization comes from p2p_peer_circle_members
-- (permanent membership) instead, which this function must NOT touch (per
-- Stage 25D's explicit instruction not to implement permanent-membership
-- removal here) — so the Circle branch below can only remove someone from
-- the LIVE STUDY (p2p_study_session_participants), not revoke their ability
-- to rejoin the underlying Agora call. This is a real, accepted limitation
-- of this stage's scope, not an oversight — see the Stage 25D report.
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

  select id, participants, status, circle_id into v_call from p2p_call_logs where id = p_call_id for update;
  if v_call is null then raise exception 'call_not_found'; end if;
  if v_call.status <> 'initiated' then raise exception 'call_ended'; end if;

  if v_call.circle_id is not null then
    if not exists (
      select 1 from p2p_peer_circle_members
      where circle_id = v_call.circle_id and user_id = p_target_user_id and status = 'active'
    ) then
      raise exception 'not_a_participant';
    end if;
  else
    if not (v_call.participants ? p_target_user_id::text) then raise exception 'not_a_participant'; end if;
  end if;

  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null or v_session.leader_id <> p_leader_id then
    raise exception 'not_leader';
  end if;

  if v_call.circle_id is null then
    update p2p_call_logs
    set participants = (select jsonb_agg(p) from jsonb_array_elements_text(participants) p where p <> p_target_user_id::text)
    where id = p_call_id;
  end if;
  -- Circle branch deliberately does NOT mutate p2p_call_logs.participants
  -- (it is not the Circle rejoin-authorization source, see comment above)
  -- and never touches p2p_peer_circle_members (permanent membership).

  update p2p_study_session_participants set left_at = now()
  where study_session_id = v_session.id and user_id = p_target_user_id and left_at is null;
end;
$$;
