-- Study Together C3: Group Study Together.
--
-- WHY THIS MIGRATION EXISTS (investigated per C3 spec §19 before writing it):
-- p2p_sessions is a strict two-party table (mentor_id/participant_id columns,
-- RLS literally checks auth.uid() = mentor_id OR auth.uid() = participant_id).
-- It cannot represent a 3-6 person study session — there is no way to add a
-- third/fourth/fifth/sixth participant without changing its shape, and doing
-- so would risk the existing 1:1 Study Together and unrelated mentor/participant
-- session records that already depend on that exact two-column shape. So 1:1
-- Study Together keeps using p2p_sessions completely unchanged (see
-- useStudySession.ts's isGroup-false branch), and group sessions get their own
-- table instead of overloading p2p_sessions.
--
-- A second, genuinely new need drove this: mid-call join (spec §9) and
-- reconnect/restoration (spec §18) require a server-authoritative "what's the
-- current group study state" that a client can query on demand — something
-- the existing purely-ephemeral Realtime Broadcast channel (study_<channel>,
-- used for section sync / discussion / scripture share) cannot answer, since
-- broadcast has no history for someone who wasn't listening at the moment a
-- signal was sent. This is not a shortcut migration — group study is
-- structurally impossible to build correctly without persisting at least
-- "who is in the study, who leads it, what lesson, what shared position."

create table if not exists p2p_study_sessions (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid not null references p2p_call_logs(id) on delete cascade,
  channel_name text not null,
  lesson_id uuid not null references p2p_lessons(id),
  module_id uuid references p2p_modules(id),
  title text,
  leader_id uuid not null references p2p_profiles(id),
  current_section_index int not null default 0,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid not null references p2p_profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Only one active group study session per call at a time — this is what
-- lets a mid-call joiner be offered "Join Study" instead of accidentally
-- starting a second, competing session (spec §8/§9's "do not create a
-- completely second Study Together session").
create unique index if not exists p2p_study_sessions_one_active_per_call
  on p2p_study_sessions (call_log_id) where status = 'active';

create index if not exists p2p_study_sessions_call_log_id_idx on p2p_study_sessions(call_log_id);

create table if not exists p2p_study_session_participants (
  id uuid primary key default gen_random_uuid(),
  study_session_id uuid not null references p2p_study_sessions(id) on delete cascade,
  user_id uuid not null references p2p_profiles(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (study_session_id, user_id)
);

create index if not exists p2p_study_session_participants_session_idx on p2p_study_session_participants(study_session_id);

alter table p2p_study_sessions enable row level security;
alter table p2p_study_session_participants enable row level security;

-- Read-only client policies (SELECT only) — every write goes through the
-- service-role endpoints below, which independently verify real caller
-- identity via a Supabase auth token (see verifyCaller in calls.ts, the
-- same scoped exception C2 introduced for invitations). This mirrors
-- p2p_call_invitations' exact pattern rather than inventing a new one.
create policy "Study session participants can view their session" on p2p_study_sessions
  for select using (
    exists (
      select 1 from p2p_study_session_participants ssp
      where ssp.study_session_id = p2p_study_sessions.id and ssp.user_id = auth.uid()
    )
  );

create policy "Study session participants can view the roster" on p2p_study_session_participants
  for select using (
    exists (
      select 1 from p2p_study_session_participants ssp2
      where ssp2.study_session_id = p2p_study_session_participants.study_session_id and ssp2.user_id = auth.uid()
    )
  );

-- p2p_start_study_session — creates the group study session for an active
-- call. Row-locks the call so a race between two people simultaneously
-- starting Study Together can't create two competing sessions (the partial
-- unique index above is the final backstop; the lock keeps the error path
-- clean instead of a raw constraint violation).
create or replace function p2p_start_study_session(
  p_call_id uuid, p_user_id uuid, p_lesson_id uuid, p_module_id uuid, p_title text
) returns uuid
language plpgsql security definer as $$
declare
  v_call record;
  v_session_id uuid;
begin
  select id, channel_name, participants, status into v_call
  from p2p_call_logs where id = p_call_id for update;

  if v_call is null then
    raise exception 'call_not_found';
  end if;
  if v_call.status <> 'initiated' then
    raise exception 'call_ended';
  end if;
  if not (v_call.participants ? p_user_id::text) then
    raise exception 'not_participant';
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

-- p2p_join_study_session — used both for a genuine mid-call "Join Study"
-- and for reconnect/restoration (spec §18): idempotent, so a client that
-- calls this again after a dropped connection simply clears left_at rather
-- than erroring.
create or replace function p2p_join_study_session(p_call_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer as $$
declare
  v_call record;
  v_session record;
begin
  select id, participants, status into v_call from p2p_call_logs where id = p_call_id for update;
  if v_call is null then raise exception 'call_not_found'; end if;
  if not (v_call.participants ? p_user_id::text) then raise exception 'not_participant'; end if;

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

-- p2p_update_study_section — leader-only, enforced here (not just in the
-- client) per spec §17/§20: a non-leader calling this must not be able to
-- move the group's shared position.
create or replace function p2p_update_study_section(p_call_id uuid, p_caller_id uuid, p_index int) returns void
language plpgsql security definer as $$
declare
  v_session record;
begin
  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then raise exception 'no_active_session'; end if;
  if v_session.leader_id <> p_caller_id then raise exception 'not_leader'; end if;
  update p2p_study_sessions set current_section_index = p_index where id = v_session.id;
end;
$$;

-- p2p_reassign_study_leader — deterministic reassignment (spec §6): next
-- leader is the remaining active participant with the earliest joined_at,
-- never arbitrary/random. Row-locked and idempotent — safe if several
-- remaining clients notice the departure and call this at once, since only
-- the first actually changes anything and the rest observe the same result.
create or replace function p2p_reassign_study_leader(p_call_id uuid, p_departed_user_id uuid, p_caller_id uuid) returns jsonb
language plpgsql security definer as $$
declare
  v_session record;
  v_next_leader uuid;
begin
  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then raise exception 'no_active_session'; end if;

  if not exists (
    select 1 from p2p_study_session_participants
    where study_session_id = v_session.id and user_id = p_caller_id and left_at is null
  ) then
    raise exception 'not_participant';
  end if;

  -- Already reassigned by someone else — no-op, return current state.
  if v_session.leader_id <> p_departed_user_id then
    return jsonb_build_object('sessionId', v_session.id, 'leaderId', v_session.leader_id, 'ended', false);
  end if;

  update p2p_study_session_participants set left_at = now()
  where study_session_id = v_session.id and user_id = p_departed_user_id and left_at is null;

  select user_id into v_next_leader from p2p_study_session_participants
  where study_session_id = v_session.id and user_id <> p_departed_user_id and left_at is null
  order by joined_at asc limit 1;

  if v_next_leader is null then
    update p2p_study_sessions set status = 'ended', ended_at = now() where id = v_session.id;
    return jsonb_build_object('sessionId', v_session.id, 'leaderId', null, 'ended', true);
  end if;

  update p2p_study_sessions set leader_id = v_next_leader where id = v_session.id;
  return jsonb_build_object('sessionId', v_session.id, 'leaderId', v_next_leader, 'ended', false);
end;
$$;

create or replace function p2p_end_study_session(p_call_id uuid, p_caller_id uuid) returns void
language plpgsql security definer as $$
declare
  v_session record;
begin
  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then raise exception 'no_active_session'; end if;
  if not exists (
    select 1 from p2p_study_session_participants
    where study_session_id = v_session.id and user_id = p_caller_id
  ) then
    raise exception 'not_participant';
  end if;
  update p2p_study_sessions set status = 'ended', ended_at = now() where id = v_session.id;
end;
$$;