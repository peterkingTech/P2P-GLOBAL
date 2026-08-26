-- Study Together C4 + C6: participant-lifecycle fix and lesson-scoped notes.
--
-- C4 FIX: C3's p2p_reassign_study_leader only marked a departure's left_at
-- when the departed user WAS the leader — a non-leader who left a call
-- stayed listed as an "active" study participant forever (C4.7 requires
-- removing any departed participant from active study participation, not
-- just a departed leader). Replacing the function to always mark the
-- departure and only compute a new leader when the departure actually
-- affects leadership.
--
-- C6: investigated first per spec — p2p_user_notes (id, user_id, title,
-- body, created_at) has no lesson/module/session linkage at all, so it
-- cannot represent a lesson-scoped note today. Extending it (nullable
-- columns, fully backward compatible with every existing note and the
-- existing /notes screen) rather than creating a second notes table —
-- p2p_journal_reflections already exists for the deliberately different
-- longitudinal/versioned use case and is left untouched.

alter table p2p_user_notes add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null;
alter table p2p_user_notes add column if not exists module_id uuid references p2p_modules(id) on delete set null;
alter table p2p_user_notes add column if not exists study_session_id uuid references p2p_study_sessions(id) on delete set null;
alter table p2p_user_notes add column if not exists updated_at timestamptz not null default now();

create index if not exists p2p_user_notes_lesson_id_idx on p2p_user_notes(lesson_id) where lesson_id is not null;

create or replace function p2p_reassign_study_leader(p_call_id uuid, p_departed_user_id uuid, p_caller_id uuid) returns jsonb
language plpgsql security definer as $$
declare
  v_session record;
  v_next_leader uuid;
  v_was_leader boolean;
begin
  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then
    raise exception 'no_active_session';
  end if;

  if not exists (
    select 1 from p2p_study_session_participants
    where study_session_id = v_session.id and user_id = p_caller_id and left_at is null
  ) then
    raise exception 'not_participant';
  end if;

  -- Idempotent: the departed participant was already marked gone (by this
  -- caller or a concurrent one) — nothing left to do.
  if not exists (
    select 1 from p2p_study_session_participants
    where study_session_id = v_session.id and user_id = p_departed_user_id and left_at is null
  ) then
    return jsonb_build_object('sessionId', v_session.id, 'leaderId', v_session.leader_id, 'ended', false, 'leaderChanged', false);
  end if;

  v_was_leader := (v_session.leader_id = p_departed_user_id);

  update p2p_study_session_participants set left_at = now()
  where study_session_id = v_session.id and user_id = p_departed_user_id and left_at is null;

  if not v_was_leader then
    return jsonb_build_object('sessionId', v_session.id, 'leaderId', v_session.leader_id, 'ended', false, 'leaderChanged', false);
  end if;

  select user_id into v_next_leader from p2p_study_session_participants
  where study_session_id = v_session.id and user_id <> p_departed_user_id and left_at is null
  order by joined_at asc limit 1;

  if v_next_leader is null then
    update p2p_study_sessions set status = 'ended', ended_at = now() where id = v_session.id;
    return jsonb_build_object('sessionId', v_session.id, 'leaderId', null, 'ended', true, 'leaderChanged', true);
  end if;

  update p2p_study_sessions set leader_id = v_next_leader where id = v_session.id;
  return jsonb_build_object('sessionId', v_session.id, 'leaderId', v_next_leader, 'ended', false, 'leaderChanged', true);
end;
$$;