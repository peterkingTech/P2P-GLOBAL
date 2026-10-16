-- 196: Notification types for the database triggers + two push switches.
--
-- 1. Every notification the database writes itself now carries a
--    notification_type (before: NULL — 756 rows in production by
--    2026-10-16), so the per-category push switches
--    (api-server lib/notificationCategories.ts) can apply to them:
--      fruit_awarded, prayer_confirmation_request,
--      encouragement_confirmation_request, session_confirmation_request,
--      lesson_completed, lesson_submitted, evaluation_waiting,
--      evaluation_resolved, circle_evaluation_resolved,
--      peer_confirmation_confirmed, help_request, crisis_help_request.
--    Each function below is the LIVE production definition (read with
--    pg_get_functiondef on 2026-10-16) with exactly one change: the
--    p2p_notifications insert also writes notification_type. Titles,
--    messages, recipients, security (SECURITY DEFINER, search_path, auth
--    checks) and every other statement are unchanged. Existing rows are not
--    touched. Help / crisis requests stay "always delivered".
--
-- 2. notify_admin_overdue — super admins can switch off the push for the
--    overdue reminders (contact_message_overdue, admin_report_overdue).
--    Default true = today's behaviour. The reminder still appears in the
--    in-app Notification Center either way.
--
-- (notifications_enabled, the master switch, already exists — 012/174.)
--
-- Grants follow 193: the owner reads/writes the new column; row-level
-- policies are unchanged. Additive and re-runnable.

alter table public.p2p_profiles
  add column if not exists notify_admin_overdue boolean not null default true;

grant select (notify_admin_overdue) on public.p2p_profiles to authenticated;
grant update (notify_admin_overdue) on public.p2p_profiles to authenticated;

CREATE OR REPLACE FUNCTION public.p2p_award_fruit(p_user_id uuid, p_fruit_key text, p_trigger_event text, p_source_type text, p_source_id uuid, p_evidence jsonb, p_awarded_by text DEFAULT 'system'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_catalog p2p_fruits_catalog%rowtype;
  v_already boolean;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_catalog from p2p_fruits_catalog where fruit_key = p_fruit_key and is_active = true;
  if not found then
    insert into p2p_fruit_audit_log (user_id, fruit_key, event_type, trigger_event, trigger_source_id, result)
    values (p_user_id, p_fruit_key, 'not_eligible', p_trigger_event, p_source_id, jsonb_build_object('reason', 'fruit_not_found_or_inactive'));
    return false;
  end if;

  select exists(
    select 1 from p2p_user_fruits where user_id = p_user_id and fruit_key = p_fruit_key
  ) into v_already;

  if v_already then
    insert into p2p_fruit_audit_log (user_id, fruit_key, event_type, trigger_event, trigger_source_id, result)
    values (p_user_id, p_fruit_key, 'already_held', p_trigger_event, p_source_id, p_evidence);
    return false;
  end if;

  insert into p2p_user_fruits (user_id, fruit_key, awarded_by, evidence, evidence_summary, source_type, source_id)
  values (
    p_user_id, p_fruit_key, p_awarded_by, p_evidence,
    coalesce(p_evidence->>'summary', v_catalog.unlock_condition_description),
    p_source_type, p_source_id
  );

  insert into p2p_fruit_audit_log (user_id, fruit_key, event_type, trigger_event, trigger_source_id, result)
  values (p_user_id, p_fruit_key, 'awarded', p_trigger_event, p_source_id, p_evidence);

  insert into p2p_notifications (user_id, title, message, notification_type)
  values (
    p_user_id, 'New Fruit Earned 🍇',
    'You earned ' || v_catalog.name || ' — ' || coalesce(v_catalog.unlock_condition_description, ''),
    'fruit_awarded'
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_create_compassion_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_post_author uuid;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.reaction_type = 'praying' then
    select user_id into v_post_author from p2p_prayer_wall_posts where id = new.post_id;
    if v_post_author is not null and v_post_author <> new.user_id then
      insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
      values ('compassion', new.user_id, v_post_author, 'prayer', new.id, v_expires)
      on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

      insert into p2p_notifications (user_id, title, message, notification_type)
      values (v_post_author, 'Someone prayed for you 🙏', 'Did you feel supported? Tap to confirm.', 'prayer_confirmation_request');
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_create_encouragement_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_mentor boolean;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.status in ('approved', 'needs_revision')
     and new.feedback is not null and length(trim(new.feedback)) > 20
     and new.evaluator_id <> new.submitter_id
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.feedback is distinct from new.feedback)
  then
    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('encouragement', new.evaluator_id, new.submitter_id, 'evaluation_feedback', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    select exists (
      select 1 from p2p_discipleship_links
      where mentor_id = new.evaluator_id and disciple_id = new.submitter_id and active = true
    ) into v_is_mentor;

    if v_is_mentor then
      insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
      values ('service', new.evaluator_id, new.submitter_id, 'evaluation_feedback', new.id, v_expires)
      on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;
    end if;

    insert into p2p_notifications (user_id, title, message, notification_type)
    values (
      new.submitter_id, 'A peer left you encouragement',
      'Did their feedback genuinely help? Tap to confirm and help them earn a fruit.',
      'encouragement_confirmation_request'
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_handle_session_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mentor_country text;
  v_participant_country text;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.mentor_id is not null and new.participant_id is not null
  then
    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('fellowship', new.mentor_id, new.participant_id, 'session', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('fellowship', new.participant_id, new.mentor_id, 'session', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    insert into p2p_notifications (user_id, title, message, notification_type)
    values
      (new.participant_id, 'Confirm your peer session', 'Did this discussion session really happen? Tap to confirm.', 'session_confirmation_request'),
      (new.mentor_id, 'Confirm your peer session', 'Did this discussion session really happen? Tap to confirm.', 'session_confirmation_request');

    select country into v_mentor_country from p2p_profiles where id = new.mentor_id;
    select country into v_participant_country from p2p_profiles where id = new.participant_id;

    if v_mentor_country is not null and v_participant_country is not null and v_mentor_country <> v_participant_country then
      perform p2p_award_fruit(new.mentor_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_participant_country || '.'));
      perform p2p_award_fruit(new.participant_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_mentor_country || '.'));
    end if;

    perform p2p_check_global_fruit(new.mentor_id);
    perform p2p_check_global_fruit(new.participant_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_lesson_progress_recompute(p_user_id uuid, p_lesson_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment_id uuid;
  v_total_questions integer;
  v_submitted_questions integer;
  v_approved_questions integer;
  v_current_status text;
begin
  select id into v_assignment_id from p2p_assignments where lesson_id = p_lesson_id limit 1;
  if v_assignment_id is null then
    return;
  end if;

  select count(*) into v_total_questions
  from p2p_assignment_questions where assignment_id = v_assignment_id;

  if v_total_questions = 0 then
    return;
  end if;

  select count(distinct assignment_question_id) into v_submitted_questions
  from p2p_submissions
  where user_id = p_user_id and lesson_id = p_lesson_id and assignment_question_id is not null;

  select count(*) into v_approved_questions
  from (
    select distinct on (s.assignment_question_id)
      s.assignment_question_id, e.status
    from p2p_submissions s
    left join p2p_lesson_evaluations e on e.submission_id = s.id
    where s.user_id = p_user_id and s.lesson_id = p_lesson_id and s.assignment_question_id is not null
    order by s.assignment_question_id, s.created_at desc
  ) latest
  where latest.status = 'approved';

  select status into v_current_status
  from p2p_lesson_progress where user_id = p_user_id and lesson_id = p_lesson_id;
  v_current_status := coalesce(v_current_status, 'not_started');

  if v_approved_questions >= v_total_questions then
    if v_current_status is distinct from 'completed' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'completed', true, 100, now())
      on conflict (user_id, lesson_id)
      do update set status = 'completed', completed = true, progress_percent = 100, updated_at = now();

      update p2p_profiles set wisdom_points = wisdom_points + 10 where id = p_user_id;

      insert into p2p_notifications (user_id, title, message, notification_type)
      values (
        p_user_id,
        'Lesson completed!',
        'Every answer for this lesson has been peer-approved. Great work!',
        'lesson_completed'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_completed', p_lesson_id);
    end if;
  elsif v_submitted_questions >= v_total_questions then
    if v_current_status = 'not_started' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'submitted', false, 50, now())
      on conflict (user_id, lesson_id)
      do update set status = 'submitted', updated_at = now();

      insert into p2p_notifications (user_id, title, message, notification_type)
      values (
        p_user_id,
        'Lesson submitted',
        'Lesson submitted — your peer guide will review your answers.',
        'lesson_submitted'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_submitted', p_lesson_id);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_notify_evaluator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'pending' then
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (
      new.evaluator_id,
      'You have a lesson evaluation waiting',
      'A fellow disciple submitted work for review. Please evaluate it when you can.',
      'evaluation_waiting'
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_notify_on_help_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  requester_name text;
BEGIN
  SELECT full_name INTO requester_name FROM p2p_profiles WHERE id = NEW.user_id;

  IF NEW.tier = 'crisis' THEN
    -- Dedicated crisis_responder role (p2p_admin_roles) — deliberately NOT the
    -- general peer-guide/admin pool, per spec.
    INSERT INTO p2p_notifications (user_id, title, message, notification_type)
    SELECT ar.user_id,
           'URGENT: Crisis help request',
           coalesce(requester_name, 'A user') || ' has requested immediate crisis help.',
           'crisis_help_request'
    FROM p2p_admin_roles ar
    WHERE ar.role = 'crisis_responder';
  ELSE
    -- Any admin-capable profile (mirrors p2p_is_admin(): role != 'student').
    -- Does NOT depend on a specific peer-guide assignment.
    INSERT INTO p2p_notifications (user_id, title, message, notification_type)
    SELECT p.id,
           'Someone reached out for support',
           coalesce(requester_name, 'A user') || ' shared they are struggling'
             || CASE WHEN NEW.category IS NOT NULL THEN ' (' || NEW.category || ')' ELSE '' END
             || '. Please follow up.',
           'help_request'
    FROM p2p_profiles p
    WHERE p.role != 'student';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_notify_submitter_on_resolution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF old.status = 'pending' AND new.status IN ('approved', 'needs_revision') THEN
    INSERT INTO p2p_notifications (user_id, title, message, notification_type)
    VALUES (
      new.submitter_id,
      CASE WHEN new.status = 'approved'
        THEN 'Your submission was approved!'
        ELSE 'Your submission needs a revision'
      END,
      CASE WHEN new.status = 'approved'
        THEN 'A peer reviewed your work and approved it. Great job!'
        ELSE 'A peer reviewed your work and requested a revision.' ||
          CASE WHEN new.feedback IS NOT NULL AND length(trim(new.feedback)) > 0
            THEN ' Feedback: ' || new.feedback
            ELSE ' Open the lesson to see what to adjust.'
          END
      END,
      'evaluation_resolved'
    );
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_process_circle_evaluation(p_submission_id uuid, p_circle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_leader_id uuid;
  v_leader_decision text;
  v_lesson_id uuid;
  v_submitter_id uuid;
  v_final_decision text;
  v_first_two record;
  v_approve_count integer;
  v_revision_count integer;
  v_module_id uuid;
  v_curriculum_id uuid;
  v_plan_complete boolean;
  v_multi_country boolean;
  v_member_id uuid;
  v_deciding_evaluator uuid;
begin
  select leader_id into v_leader_id from p2p_peer_circles where id = p_circle_id;

  select lesson_id, submitter_id into v_lesson_id, v_submitter_id
  from p2p_peer_circle_evaluations
  where submission_id = p_submission_id
  limit 1;

  if v_lesson_id is null then
    return;
  end if;

  -- Leader's word is always final, whenever cast.
  select decision into v_leader_decision
  from p2p_peer_circle_evaluations
  where submission_id = p_submission_id and evaluator_id = v_leader_id;

  if v_leader_decision is not null then
    v_final_decision := v_leader_decision;
    v_deciding_evaluator := v_leader_id;
  else
    -- Otherwise, only the first two non-leader evaluations decide anything.
    select count(*) filter (where decision = 'approved'),
           count(*) filter (where decision = 'needs_revision')
    into v_approve_count, v_revision_count
    from (
      select decision
      from p2p_peer_circle_evaluations
      where submission_id = p_submission_id and evaluator_id <> v_leader_id
      order by evaluated_at asc
      limit 2
    ) first_two;

    if v_approve_count = 2 then
      v_final_decision := 'approved';
      select evaluator_id into v_deciding_evaluator
      from p2p_peer_circle_evaluations
      where submission_id = p_submission_id and evaluator_id <> v_leader_id and decision = 'approved'
      order by evaluated_at asc limit 1;
    elsif v_revision_count = 2 then
      v_final_decision := 'needs_revision';
    else
      -- Split (or fewer than 2 votes so far) — wait for the leader.
      return;
    end if;
  end if;

  if v_final_decision = 'approved' then
    -- p2p_lesson_progress_recompute (migration 031) only ever looks at
    -- p2p_lesson_evaluations to decide whether a submission is approved —
    -- it has no idea p2p_peer_circle_evaluations exists. Record the
    -- circle's consensus there too (already resolved, attributed to
    -- whoever cast the deciding vote) so the shared recompute/wisdom-point/
    -- notification logic just works, instead of duplicating it here.
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, feedback, assigned_at, resolved_at)
    values (p_submission_id, v_lesson_id, v_submitter_id, coalesce(v_deciding_evaluator, v_leader_id), 'approved', 'Approved by circle consensus.', now(), now())
    on conflict do nothing;

    perform p2p_lesson_progress_recompute(v_submitter_id, v_lesson_id);
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (v_submitter_id, 'Your circle approved your submission', 'Your peer circle approved your lesson submission. Keep going!', 'circle_evaluation_resolved');

    -- ── Fruits for Circles (PROMPT 4 Step 7) — reuse the existing central
    -- p2p_award_fruit function; no new fruit-catalog rows needed. ──
    select module_id into v_module_id from p2p_lessons where id = v_lesson_id;
    if v_module_id is not null and p2p_module_fully_completed(v_submitter_id, v_module_id) then
      -- Circle Leader earns The Shepherd Fruit whenever any member completes a module.
      perform p2p_award_fruit(
        v_leader_id, 'shepherd_fruit', 'circle_member_module_complete', 'peer_action', p_circle_id,
        jsonb_build_object('summary', 'A member of your circle completed a module.')
      );

      select curriculum_id into v_curriculum_id from p2p_modules where id = v_module_id;
      if v_curriculum_id is not null then
        select bool_and(p2p_module_fully_completed(v_submitter_id, m.id)) into v_plan_complete
        from p2p_modules m where m.curriculum_id = v_curriculum_id;

        if coalesce(v_plan_complete, false) then
          -- The member who just finished the whole plan earns The Fellowship Fruit.
          perform p2p_award_fruit(
            v_submitter_id, 'fellowship_fruit', 'circle_plan_complete', 'peer_action', p_circle_id,
            jsonb_build_object('summary', 'Completed a plan through a peer circle.')
          );

          -- If the circle spans more than one country, every active member
          -- earns The Unity Fruit (p2p_award_fruit itself no-ops for anyone
          -- who already holds it, so this is safe to run every time).
          select count(distinct pr.country) > 1 into v_multi_country
          from p2p_peer_circle_members m
          join p2p_profiles pr on pr.id = m.user_id
          where m.circle_id = p_circle_id and m.status = 'active' and pr.country is not null;

          if coalesce(v_multi_country, false) then
            for v_member_id in
              select user_id from p2p_peer_circle_members where circle_id = p_circle_id and status = 'active'
            loop
              perform p2p_award_fruit(
                v_member_id, 'unity_fruit', 'circle_plan_complete_multinational', 'peer_action', p_circle_id,
                jsonb_build_object('summary', 'A circle spanning multiple nations completed a plan together.')
              );
            end loop;
          end if;
        end if;
      end if;
    end if;
  else
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (v_submitter_id, 'Your circle asked for a revision', 'Your peer circle asked you to revise your submission before moving on.', 'circle_evaluation_resolved');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_process_confirmation(p_confirmation_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conf p2p_peer_confirmations%rowtype;
  v_awarded boolean;
  v_fruit_key text;
  v_confirmed_count int;
begin
  select * into v_conf from p2p_peer_confirmations
  where id = p_confirmation_id and confirmation_status = 'pending' and confirmer_user_id = auth.uid();
  if not found then
    return null;
  end if;

  update p2p_peer_confirmations set confirmation_status = 'confirmed', confirmed_at = now()
  where id = p_confirmation_id;

  insert into p2p_peer_confirmation_audit (confirmation_id, event, performed_by, metadata)
  values (p_confirmation_id, 'confirmed', v_conf.confirmer_user_id, '{}'::jsonb);

  if v_conf.confirmation_type = 'encouragement' then
    select count(*) into v_confirmed_count from p2p_peer_confirmations
    where confirmation_type = 'encouragement' and actor_user_id = v_conf.actor_user_id and confirmation_status = 'confirmed';

    perform p2p_update_fruit_progress(v_conf.actor_user_id, 'encouragement_fruit', v_confirmed_count, 5,
      jsonb_build_object('confirmed_count', v_confirmed_count));

    if v_confirmed_count >= 5 then
      v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'encouragement_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', v_confirmed_count || ' peers confirmed your encouragement genuinely helped them.'));
      if v_awarded then v_fruit_key := 'encouragement_fruit'; end if;
    end if;

  elsif v_conf.confirmation_type = 'compassion' then
    v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'compassion_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
      jsonb_build_object('summary', 'A peer confirmed you prayed with them.'));
    if v_awarded then v_fruit_key := 'compassion_fruit'; end if;

  elsif v_conf.confirmation_type = 'service' then
    v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'service_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
      jsonb_build_object('summary', 'A mentee confirmed your guidance helped them through a lesson.'));
    if v_awarded then v_fruit_key := 'service_fruit'; end if;

  elsif v_conf.confirmation_type = 'fellowship' then
    -- Fellowship requires BOTH directions confirmed (each participant
    -- confirming the other's participation) before either side earns it.
    if exists (
      select 1 from p2p_peer_confirmations
      where confirmation_type = 'fellowship' and source_id = v_conf.source_id
        and actor_user_id = v_conf.confirmer_user_id and confirmer_user_id = v_conf.actor_user_id
        and confirmation_status = 'confirmed'
    ) then
      v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', 'Both peers confirmed a real discussion session happened.'));
      if v_awarded then v_fruit_key := 'fellowship_fruit'; end if;
      perform p2p_award_fruit(v_conf.confirmer_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', 'Both peers confirmed a real discussion session happened.'));
    end if;
  end if;

  if v_fruit_key is not null then
    insert into p2p_peer_confirmation_audit (confirmation_id, event, performed_by, metadata)
    values (p_confirmation_id, 'fruit_awarded', v_conf.confirmer_user_id, jsonb_build_object('fruit_key', v_fruit_key));
  end if;

  insert into p2p_notifications (user_id, title, message, notification_type)
  values (
    v_conf.actor_user_id, 'Confirmed! 🙏',
    case v_conf.confirmation_type
      when 'encouragement' then 'A peer confirmed your encouragement genuinely helped them.'
      when 'compassion' then 'A peer confirmed you prayed with them.'
      when 'service' then 'A mentee confirmed your guidance helped them through a lesson.'
      when 'fellowship' then 'A peer confirmed your discussion session happened.'
      else 'Your action was confirmed.'
    end,
    'peer_confirmation_confirmed'
  );

  return v_fruit_key;
end;
$function$;
