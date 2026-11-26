-- 259: fruit awarded to the right person again (PROPOSED — owner approval required before applying).
--
-- Problem (found 2026-11-20 while seeding demo activity): since migration 097,
-- p2p_award_fruit refuses any p_user_id other than auth.uid(). That guard was
-- meant for direct RPC calls from the app, but the fruit engine also calls it
-- INTERNALLY to award someone other than the person whose session is running:
--   • a learner's Module 1 submission awards the GUIDE's Seed Fruit
--     (p2p_check_fruit_eligibility) → not_authorized → the learner's whole
--     submission rolls back: learners with an active guide cannot submit Module 1;
--   • a peer evaluator's approval completes the LEARNER's lesson and checks the
--     learner's fruits (rooted, Module fruits, endurance after 180 days …) →
--     the approval rolls back once any such fruit is due;
--   • confirming a peer's compassion / service / fellowship / encouragement
--     (p2p_process_confirmation) awards the OTHER person → fails;
--   • guide fruits, teacher, global, circle (API, no auth.uid()) and session
--     completion awards → fail the same way.
--
-- Fix (no data change, no table change):
--   1. p2p_award_fruit_system: the award itself, unchanged, WITHOUT the caller
--      check. Not executable by anon/authenticated — only SECURITY DEFINER
--      engine functions (which run as the owner) and service_role reach it.
--   2. p2p_award_fruit (what the app may call directly) keeps the auth.uid()
--      guard and then calls p2p_award_fruit_system. Same signature, same result.
--   3. The 8 engine functions call p2p_award_fruit_system instead (44 call
--      sites). Their bodies are otherwise the live definitions, byte for byte.
--   4. p2p_check_fruit_eligibility and p2p_check_global_fruit are engine-only
--      (no app or API caller); direct RPC execution is revoked so nobody can run
--      an eligibility sweep for someone else (e.g. award a guide's Seed Fruit
--      without a real submission).
-- Rollback: re-create p2p_award_fruit and the 8 functions from the
-- pre-apply backup (pg_get_functiondef), then drop p2p_award_fruit_system.

begin;

-- 1. The award itself, for the engine.
CREATE OR REPLACE FUNCTION public.p2p_award_fruit_system(p_user_id uuid, p_fruit_key text, p_trigger_event text, p_source_type text, p_source_id uuid, p_evidence jsonb, p_awarded_by text DEFAULT 'system'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_catalog p2p_fruits_catalog%rowtype;
  v_already boolean;
begin
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

revoke all on function public.p2p_award_fruit_system(uuid, text, text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.p2p_award_fruit_system(uuid, text, text, text, uuid, jsonb, text) to service_role;

-- 2. The app-callable entry point: own account only (unchanged rule).
CREATE OR REPLACE FUNCTION public.p2p_award_fruit(p_user_id uuid, p_fruit_key text, p_trigger_event text, p_source_type text, p_source_id uuid, p_evidence jsonb, p_awarded_by text DEFAULT 'system'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_authorized';
  end if;
  return p2p_award_fruit_system(p_user_id, p_fruit_key, p_trigger_event, p_source_type, p_source_id, p_evidence, p_awarded_by);
end;
$function$;

-- 3. The engine awards through p2p_award_fruit_system (live bodies otherwise unchanged).
-- p2p_check_teacher_fruit(uuid)
CREATE OR REPLACE FUNCTION public.p2p_check_teacher_fruit(p_mentor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  select count(distinct dl.disciple_id) into v_count
  from p2p_discipleship_links dl
  where dl.mentor_id = p_mentor_id and dl.active = true
    and exists (
      select 1 from p2p_modules m
      where p2p_module_fully_completed(dl.disciple_id, m.id)
    );

  if v_count >= 3 then
    perform p2p_award_fruit_system(p_mentor_id, 'teacher_fruit', 'mentee_module_completed', 'mentor_action', null,
      jsonb_build_object('summary', 'Successfully mentored 3 learners, each to module completion.', 'count', v_count));
  end if;
end;
$function$
;

-- p2p_check_fruit_eligibility(uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.p2p_check_fruit_eligibility(p_user_id uuid, p_trigger_event text, p_source_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module_id uuid;
  v_module_order int;
  v_curriculum_id uuid;
  v_completed_modules int;
  v_streak int;
  v_gap int;
  v_profile_created_at timestamptz;
begin
  insert into p2p_fruit_audit_log (user_id, fruit_key, event_type, trigger_event, trigger_source_id, result)
  values (p_user_id, '_dispatch', 'eligibility_check', p_trigger_event, p_source_id, jsonb_build_object('note', 'eligibility sweep started'));

  if p_trigger_event = 'lesson_submitted' then
    -- The First Steps Fruit — first ever submission of any kind.
    if not exists (
      select 1 from p2p_user_fruits where user_id = p_user_id and fruit_key = 'first_steps_fruit'
    ) then
      perform p2p_award_fruit_system(p_user_id, 'first_steps_fruit', p_trigger_event, 'lesson', p_source_id,
        jsonb_build_object('summary', 'Submitted your very first lesson.'));
    end if;

    -- Seed Fruit (mentor-side) — this submission is the disciple "beginning"
    -- Module 1. Checked here (not only at link-creation time) because a
    -- mentee is usually linked to a mentor before they've started anything.
    select module_id into v_module_id from p2p_lessons where id = p_source_id;
    if v_module_id = (select id from p2p_modules where curriculum_id = p2p_active_curriculum_id() and order_index = 1) then
      perform p2p_award_fruit_system(dl.mentor_id, 'seed_fruit', p_trigger_event, 'peer_action', p_source_id,
        jsonb_build_object('summary', 'Your first mentee began Module 1.'))
      from p2p_discipleship_links dl
      where dl.disciple_id = p_user_id and dl.active = true;
    end if;

    -- Streak fruits — evaluated on every submission, since a streak can
    -- complete on any day's activity, not just a "completed" transition.
    v_streak := p2p_max_day_streak(p_user_id);
    if v_streak >= 7 then
      perform p2p_award_fruit_system(p_user_id, 'diligence_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Completed a lesson on each of 7 consecutive days.', 'streak_days', v_streak));
    end if;
    if v_streak >= 14 then
      perform p2p_award_fruit_system(p_user_id, 'peace_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Active lesson progress across 14 consecutive days.', 'streak_days', v_streak));
    end if;

    v_streak := p2p_max_week_streak(p_user_id);
    if v_streak >= 4 then
      perform p2p_award_fruit_system(p_user_id, 'consistency_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Active in each of 4 consecutive calendar weeks.', 'streak_weeks', v_streak));
    end if;

    -- Perseverance / Steadfast — returned after a 30+ day gap.
    v_gap := p2p_days_since_previous_activity(p_user_id);
    if v_gap is not null and v_gap >= 30 then
      perform p2p_award_fruit_system(p_user_id, 'perseverance_fruit', p_trigger_event, 'lesson', p_source_id,
        jsonb_build_object('summary', 'Returned and completed a lesson after ' || v_gap || ' days away.', 'gap_days', v_gap));
      perform p2p_award_fruit_system(p_user_id, 'steadfast_fruit', p_trigger_event, 'lesson', p_source_id,
        jsonb_build_object('summary', 'Returned and completed a lesson after ' || v_gap || ' days away.', 'gap_days', v_gap));
    end if;

    -- Joy Fruit — last 10 completed lessons with no needs_revision ever.
    if (
      select count(*) from (
        select lp.lesson_id
        from p2p_lesson_progress lp
        where lp.user_id = p_user_id and lp.status = 'completed'
        order by lp.updated_at desc
        limit 10
      ) recent
      where not exists (
        select 1 from p2p_lesson_evaluations e
        join p2p_submissions s on s.id = e.submission_id
        where s.lesson_id = recent.lesson_id and s.user_id = p_user_id and e.status = 'needs_revision'
      )
    ) = 10 then
      perform p2p_award_fruit_system(p_user_id, 'joy_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', '10 consecutive lessons completed with no revision requested.'));
    end if;

  elsif p_trigger_event = 'lesson_completed' then
    select module_id into v_module_id from p2p_lessons where id = p_source_id;
    select order_index, curriculum_id into v_module_order, v_curriculum_id from p2p_modules where id = v_module_id;

    -- Rooted Fruit — first module ever fully completed.
    if p2p_module_fully_completed(p_user_id, v_module_id)
       and not exists (select 1 from p2p_user_fruits where user_id = p_user_id and fruit_key = 'rooted_fruit')
    then
      perform p2p_award_fruit_system(p_user_id, 'rooted_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Completed your very first full module.'));
    end if;

    if p2p_module_fully_completed(p_user_id, v_module_id) then
      -- Module-number fruits.
      if v_module_order = 1 then
        perform p2p_award_fruit_system(p_user_id, 'christ_identity_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 1: Your New Identity in Christ.'));
      elsif v_module_order = 5 then
        perform p2p_award_fruit_system(p_user_id, 'wisdom_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 5: The Bible — God''s Word to You.'));
      elsif v_module_order = 6 then
        perform p2p_award_fruit_system(p_user_id, 'prayer_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 6: Prayer — Talking with God.'));
      elsif v_module_order = 10 then
        perform p2p_award_fruit_system(p_user_id, 'evangelism_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 10: Sharing Your Faith.'));
      end if;

      -- Obedience Fruit — every lesson, reflection AND assignment in the module.
      if p2p_module_all_reflections_done(p_user_id, v_module_id) then
        perform p2p_award_fruit_system(p_user_id, 'obedience_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed every lesson, reflection, and assignment in a module.'));
      end if;
    end if;

    -- Faith Fruit — every assignment in this module is approved (module
    -- doesn't need to be otherwise "fully completed" if some lessons have no
    -- assignment at all).
    if p2p_module_all_assignments_done(p_user_id, v_module_id) then
      perform p2p_award_fruit_system(p_user_id, 'faith_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Completed every assignment in a module.'));
    end if;

    -- Reflection Fruit — every reflection question in this module answered.
    if p2p_module_all_reflections_done(p_user_id, v_module_id) then
      perform p2p_award_fruit_system(p_user_id, 'reflection_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Answered every reflection question in a module.'));
    end if;

    -- Count-based fruits.
    select count(*) into v_completed_modules
    from p2p_modules m
    where p2p_module_fully_completed(p_user_id, m.id);

    if v_completed_modules >= 5 then
      perform p2p_award_fruit_system(p_user_id, 'fruitful_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Completed 5 modules total.', 'modules_completed', v_completed_modules));
    end if;

    if v_curriculum_id = p2p_active_curriculum_id()
       and (select count(*) from p2p_modules where curriculum_id = v_curriculum_id and order_index between 1 and 12) = 12
       and (
         select count(*) from p2p_modules m
         where m.curriculum_id = v_curriculum_id and m.order_index between 1 and 12
           and p2p_module_fully_completed(p_user_id, m.id)
       ) = 12
    then
      perform p2p_award_fruit_system(p_user_id, 'maturity_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Completed the entire 12-module Core Curriculum.'));
    end if;

    -- Endurance / Abiding — profile age + real activity.
    select created_at into v_profile_created_at from p2p_profiles where id = p_user_id;
    if v_profile_created_at <= now() - interval '180 days' then
      perform p2p_award_fruit_system(p_user_id, 'endurance_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Active for 180 days since joining.'));
    end if;
    if v_profile_created_at <= now() - interval '365 days' then
      perform p2p_award_fruit_system(p_user_id, 'abiding_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Remained active for a full year since joining.'));
    end if;

    -- Restoration Fruit — returned after 14+ day gap AND completed a full module.
    v_gap := p2p_days_since_previous_activity(p_user_id);
    if v_gap is not null and v_gap >= 14 and p2p_module_fully_completed(p_user_id, v_module_id) then
      perform p2p_award_fruit_system(p_user_id, 'restoration_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Returned and completed a full module after ' || v_gap || ' days away.', 'gap_days', v_gap));
    end if;

    -- Peer-guide (mentor) checks — did this completion satisfy a fruit for
    -- whoever is discipling this learner?
    perform p2p_check_mentor_fruit_eligibility(p_user_id, v_module_id);

  elsif p_trigger_event = 'mentee_connected' then
    -- The Seed Fruit — fires once the mentee later BEGINS module 1, handled
    -- from the lesson_submitted branch via p2p_check_mentor_fruit_eligibility
    -- too; here we only log the connection itself.
    null;
  end if;
end;
$function$
;

-- p2p_check_global_fruit(uuid)
CREATE OR REPLACE FUNCTION public.p2p_check_global_fruit(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
  v_countries text;
begin
  select count(distinct p.country), string_agg(distinct p.country, ', ')
    into v_count, v_countries
  from p2p_sessions s
  join p2p_profiles p on p.id = (case when s.mentor_id = p_user_id then s.participant_id else s.mentor_id end)
  where (s.mentor_id = p_user_id or s.participant_id = p_user_id)
    and s.status = 'completed'
    and p.country is not null;

  if v_count >= 3 then
    perform p2p_award_fruit_system(p_user_id, 'global_fruit', 'session_completed', 'milestone', null,
      jsonb_build_object('summary', 'Peer sessions completed across ' || v_count || ' different countries: ' || coalesce(v_countries, '')));
  end if;
end;
$function$
;

-- p2p_check_seed_and_comentor_fruit()
CREATE OR REPLACE FUNCTION public.p2p_check_seed_and_comentor_fruit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module1_id uuid;
  v_began boolean;
  v_other_mentor uuid;
begin
  if new.active is not true then
    return new;
  end if;

  select id into v_module1_id from p2p_modules
  where curriculum_id = p2p_active_curriculum_id() and order_index = 1;

  if v_module1_id is not null then
    select exists (
      select 1 from p2p_lesson_progress lp
      join p2p_lessons l on l.id = lp.lesson_id
      where l.module_id = v_module1_id and lp.user_id = new.disciple_id
    ) into v_began;

    if v_began then
      perform p2p_award_fruit_system(new.mentor_id, 'seed_fruit', 'mentee_connected', 'peer_action', new.id,
        jsonb_build_object('summary', 'Your first mentee began Module 1.'));
    end if;
  end if;

  -- Aquila and Priscilla Fruit — this disciple already has another active
  -- mentor (co-mentoring), derivable directly from the links table itself.
  select mentor_id into v_other_mentor
  from p2p_discipleship_links
  where disciple_id = new.disciple_id and active = true and mentor_id <> new.mentor_id
  limit 1;

  if v_other_mentor is not null then
    perform p2p_award_fruit_system(new.mentor_id, 'aquila_priscilla_fruit', 'mentee_connected', 'peer_action', new.id,
      jsonb_build_object('summary', 'Co-mentoring the same disciple alongside another peer guide.'));
    perform p2p_award_fruit_system(v_other_mentor, 'aquila_priscilla_fruit', 'mentee_connected', 'peer_action', new.id,
      jsonb_build_object('summary', 'Co-mentoring the same disciple alongside another peer guide.'));
  end if;

  return new;
end;
$function$
;

-- p2p_check_mentor_fruit_eligibility(uuid,uuid)
CREATE OR REPLACE FUNCTION public.p2p_check_mentor_fruit_eligibility(p_disciple_id uuid, p_module_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mentor record;
  v_module_order int;
  v_graduated_count int;
  v_country_count int;
  v_core_graduated_count int;
  v_disciple_makers int;
begin
  select order_index into v_module_order from p2p_modules where id = p_module_id;

  for v_mentor in
    select mentor_id from p2p_discipleship_links where disciple_id = p_disciple_id and active = true
  loop
    if p2p_module_fully_completed(p_disciple_id, p_module_id) then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'shepherd_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
        jsonb_build_object('summary', 'A mentee completed a full module.'));

      if v_module_order = 1 then
        perform p2p_award_fruit_system(v_mentor.mentor_id, 'growth_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
          jsonb_build_object('summary', 'A mentee completed Module 1.'));
      end if;

      perform p2p_check_teacher_fruit(v_mentor.mentor_id);
    end if;

    if (
      select count(*) from p2p_modules m
      where m.curriculum_id = p2p_active_curriculum_id() and m.order_index between 1 and 12
        and p2p_module_fully_completed(p_disciple_id, m.id)
    ) = 12 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'timothy_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
        jsonb_build_object('summary', 'A mentee completed the entire Core Curriculum.'));
    end if;

    select count(*) into v_graduated_count
    from p2p_discipleship_links dl
    where dl.mentor_id = v_mentor.mentor_id and dl.active = true
      and (
        select count(*) from p2p_modules m
        where m.curriculum_id = p2p_active_curriculum_id() and m.order_index between 1 and 12
          and p2p_module_fully_completed(dl.disciple_id, m.id)
      ) = 12;

    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'forest_fruit', v_graduated_count, 5,
      jsonb_build_object('graduated_mentees', v_graduated_count));
    if v_graduated_count >= 5 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'forest_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', '5 mentees have each completed the entire Core Curriculum.', 'count', v_graduated_count));
    end if;

    v_core_graduated_count := v_graduated_count;
    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'legacy_fruit', v_core_graduated_count, 10,
      jsonb_build_object('graduated_mentees', v_core_graduated_count));
    if v_core_graduated_count >= 10 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'legacy_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', '10 mentees have completed the entire Core Curriculum.', 'count', v_core_graduated_count));
    end if;

    select count(distinct p.country) into v_country_count
    from p2p_discipleship_links dl
    join p2p_profiles p on p.id = dl.disciple_id
    where dl.mentor_id = v_mentor.mentor_id and dl.active = true
      and p.country is not null
      and (
        select count(*) from p2p_modules m
        where m.curriculum_id = p2p_active_curriculum_id() and m.order_index between 1 and 12
          and p2p_module_fully_completed(dl.disciple_id, m.id)
      ) >= 1;

    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'nations_fruit', v_country_count, 3,
      jsonb_build_object('countries_reached', v_country_count));
    if v_country_count >= 3 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'nations_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Mentees from 3 different countries have each completed modules.', 'count', v_country_count));
    end if;

    select count(*) into v_disciple_makers
    from p2p_discipleship_links dl
    where dl.mentor_id = v_mentor.mentor_id and dl.active = true
      and exists (select 1 from p2p_discipleship_links dl2 where dl2.mentor_id = dl.disciple_id and dl2.active = true);

    if v_disciple_makers >= 1 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'great_commission_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Someone you personally discipled has gone on to disciple others.'));
    end if;

    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'paul_fruit', v_disciple_makers, 10,
      jsonb_build_object('disciple_makers', v_disciple_makers));
    if v_disciple_makers >= 10 then
      perform p2p_award_fruit_system(v_mentor.mentor_id, 'paul_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Raised up 10 disciple-makers.', 'count', v_disciple_makers));
    end if;
  end loop;
end;
$function$
;

-- p2p_process_confirmation(uuid)
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
      v_awarded := p2p_award_fruit_system(v_conf.actor_user_id, 'encouragement_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', v_confirmed_count || ' peers confirmed your encouragement genuinely helped them.'));
      if v_awarded then v_fruit_key := 'encouragement_fruit'; end if;
    end if;

  elsif v_conf.confirmation_type = 'compassion' then
    v_awarded := p2p_award_fruit_system(v_conf.actor_user_id, 'compassion_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
      jsonb_build_object('summary', 'A peer confirmed you prayed with them.'));
    if v_awarded then v_fruit_key := 'compassion_fruit'; end if;

  elsif v_conf.confirmation_type = 'service' then
    v_awarded := p2p_award_fruit_system(v_conf.actor_user_id, 'service_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
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
      v_awarded := p2p_award_fruit_system(v_conf.actor_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', 'Both peers confirmed a real discussion session happened.'));
      if v_awarded then v_fruit_key := 'fellowship_fruit'; end if;
      perform p2p_award_fruit_system(v_conf.confirmer_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
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
$function$
;

-- p2p_handle_session_completion()
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
      perform p2p_award_fruit_system(new.mentor_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_participant_country || '.'));
      perform p2p_award_fruit_system(new.participant_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_mentor_country || '.'));
    end if;

    perform p2p_check_global_fruit(new.mentor_id);
    perform p2p_check_global_fruit(new.participant_id);
  end if;
  return new;
end;
$function$
;

-- p2p_process_circle_evaluation(uuid,uuid)
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
      perform p2p_award_fruit_system(
        v_leader_id, 'shepherd_fruit', 'circle_member_module_complete', 'peer_action', p_circle_id,
        jsonb_build_object('summary', 'A member of your circle completed a module.')
      );

      select curriculum_id into v_curriculum_id from p2p_modules where id = v_module_id;
      if v_curriculum_id is not null then
        select bool_and(p2p_module_fully_completed(v_submitter_id, m.id)) into v_plan_complete
        from p2p_modules m where m.curriculum_id = v_curriculum_id;

        if coalesce(v_plan_complete, false) then
          -- The member who just finished the whole plan earns The Fellowship Fruit.
          perform p2p_award_fruit_system(
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
              perform p2p_award_fruit_system(
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
$function$
;

-- 4. Engine-only sweeps: no direct RPC.
revoke execute on function public.p2p_check_fruit_eligibility(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_check_global_fruit(uuid) from public, anon, authenticated;

commit;
