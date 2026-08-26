-- SQL function search_path hardening (Phase 3 of the security roadmap).
--
-- Audit: 82 SECURITY DEFINER functions exist in the public schema; 71
-- already pin `SET search_path` (an established convention in this
-- codebase). 11 do not: p2p_is_admin, p2p_is_peer (both used directly by
-- RLS policies — the two named in the roadmap), five Study Together
-- functions added across earlier phases of this same session
-- (p2p_start_study_session, p2p_join_study_session,
-- p2p_update_study_section, p2p_reassign_study_leader,
-- p2p_end_study_session), and four trigger functions
-- (p2p_increment_servant_score, p2p_log_growth_on_discipleship,
-- p2p_log_growth_on_lesson_complete, p2p_notify_on_help_request).
--
-- This is hardening only: every function below is CREATE OR REPLACE with
-- its EXACT existing body, signature, and return type — the only change is
-- adding `SET search_path TO 'public'`. Without a pinned search_path, a
-- SECURITY DEFINER function resolves unqualified object names (tables,
-- other functions) using the CALLER's session search_path, which a
-- sufficiently privileged caller could manipulate to shadow objects like
-- p2p_profiles with a same-named object in a schema earlier in their own
-- search_path — pinning search_path closes that class of risk. No
-- authorization semantics, return values, or business logic change.

CREATE OR REPLACE FUNCTION public.p2p_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM p2p_profiles
    WHERE id = auth.uid() AND role != 'student'
  );
$function$;

CREATE OR REPLACE FUNCTION public.p2p_is_peer(a uuid, b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    a = b
    OR EXISTS (
      SELECT 1 FROM p2p_discipleship_links
      WHERE active = true
        AND ((mentor_id = a AND disciple_id = b) OR (mentor_id = b AND disciple_id = a))
    )
    OR EXISTS (
      SELECT 1 FROM p2p_profiles pa, p2p_profiles pb
      WHERE pa.id = a AND pb.id = b AND pa.church_id IS NOT NULL AND pa.church_id = pb.church_id
    );
$function$;

CREATE OR REPLACE FUNCTION public.p2p_start_study_session(
  p_call_id uuid, p_user_id uuid, p_lesson_id uuid, p_module_id uuid, p_title text
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.p2p_join_study_session(p_call_id uuid, p_user_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.p2p_update_study_section(p_call_id uuid, p_caller_id uuid, p_index integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_session record;
begin
  select * into v_session from p2p_study_sessions where call_log_id = p_call_id and status = 'active' for update;
  if v_session is null then raise exception 'no_active_session'; end if;
  if v_session.leader_id <> p_caller_id then raise exception 'not_leader'; end if;
  update p2p_study_sessions set current_section_index = p_index where id = v_session.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_reassign_study_leader(p_call_id uuid, p_departed_user_id uuid, p_caller_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.p2p_end_study_session(p_call_id uuid, p_caller_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.p2p_increment_servant_score(p_user_id uuid, p_amount integer) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE p2p_profiles SET servant_score = servant_score + p_amount WHERE id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_log_growth_on_discipleship() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_disciple_name text;
  v_score_before integer;
  v_score_after integer;
begin
  if new.active = true then
    select full_name into v_disciple_name from p2p_profiles where id = new.disciple_id;

    v_score_before := p2p_calculate_growth_score(new.mentor_id);

    insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
    values (
      new.mentor_id,
      'disciple_gained',
      'New disciple: ' || coalesce(v_disciple_name, 'a fellow believer'),
      v_score_before,
      v_score_before
    );

    v_score_after := p2p_calculate_growth_score(new.mentor_id);
    update p2p_profiles
    set growth_level = greatest(growth_level, v_score_after)
    where id = new.mentor_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_log_growth_on_lesson_complete() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_module_id uuid;
  v_module_title text;
  v_lesson_title text;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_score_before integer;
  v_score_after integer;
begin
  -- Only fire on the transition into completed=true
  if new.completed = true and (old.completed is distinct from true) then

    select l.module_id, l.title, m.title
      into v_module_id, v_lesson_title, v_module_title
    from p2p_lessons l
    left join p2p_modules m on m.id = l.module_id
    where l.id = new.lesson_id;

    v_score_before := p2p_calculate_growth_score(new.user_id);

    insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
    values (
      new.user_id,
      'lesson_completed',
      coalesce(v_lesson_title, 'A lesson') || ' completed',
      v_score_before,
      v_score_before
    );

    -- Check whether this completion finished the whole module
    if v_module_id is not null then
      select count(*) into v_total_lessons
      from p2p_lessons where module_id = v_module_id;

      select count(*) into v_completed_lessons
      from p2p_lessons l
      join p2p_lesson_progress lp
        on lp.lesson_id = l.id and lp.user_id = new.user_id and lp.completed = true
      where l.module_id = v_module_id;

      if v_total_lessons > 0 and v_completed_lessons = v_total_lessons then
        v_score_after := p2p_calculate_growth_score(new.user_id);

        insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
        values (
          new.user_id,
          'module_completed',
          coalesce(v_module_title, 'Module') || ' completed',
          v_score_before,
          v_score_after
        );

        update p2p_profiles
        set growth_level = greatest(growth_level, v_score_after)
        where id = new.user_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_notify_on_help_request() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  requester_name text;
BEGIN
  SELECT full_name INTO requester_name FROM p2p_profiles WHERE id = NEW.user_id;

  IF NEW.tier = 'crisis' THEN
    -- Dedicated crisis_responder role (p2p_admin_roles) — deliberately NOT the
    -- general peer-guide/admin pool, per spec.
    INSERT INTO p2p_notifications (user_id, title, message)
    SELECT ar.user_id,
           'URGENT: Crisis help request',
           coalesce(requester_name, 'A user') || ' has requested immediate crisis help.'
    FROM p2p_admin_roles ar
    WHERE ar.role = 'crisis_responder';
  ELSE
    -- Any admin-capable profile (mirrors p2p_is_admin(): role != 'student').
    -- Does NOT depend on a specific peer-guide assignment.
    INSERT INTO p2p_notifications (user_id, title, message)
    SELECT p.id,
           'Someone reached out for support',
           coalesce(requester_name, 'A user') || ' shared they are struggling'
             || CASE WHEN NEW.category IS NOT NULL THEN ' (' || NEW.category || ')' ELSE '' END
             || '. Please follow up.'
    FROM p2p_profiles p
    WHERE p.role != 'student';
  END IF;

  RETURN NEW;
END;
$function$;