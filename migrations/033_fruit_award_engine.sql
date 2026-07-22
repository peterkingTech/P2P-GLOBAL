-- 033: P2P Fruit System — award engine (Phase 2)
--
-- IMPORTANT — read before assuming every fruit in the catalog can be earned:
-- Of the 52 fruits seeded in migration 032, this migration wires up REAL,
-- testable award logic for the ones whose conditions can be checked against
-- data that actually exists today. It deliberately does NOT fake logic for
-- fruits whose supporting systems don't exist yet:
--
--   NOT WIRED — no peer-verification/confirmation system exists anywhere in
--   this app yet (that's its own feature, "Phase 4" in the original 5-phase
--   roadmap, not part of these 5 prompts):
--     fellowship_fruit, encouragement_fruit, compassion_fruit, unity_fruit,
--     global_fruit, service_fruit, barnabas_fruit, epaphras_fruit
--
--   NOT WIRED — p2p_plans (Kingdom Plans) has zero rows and no theme/category
--   column; there is no real content to check against:
--     marketplace_fruit, educator_fruit, leadership_fruit, creator_fruit,
--     innovation_fruit, family_fruit, kingdom_fruit, revival_fruit,
--     mission_fruit, stephen_fruit (requires Kingdom Plans too)
--
--   NOT WIRED — no tracking exists for these specific actions and none is in
--   scope here (would need new instrumentation, a separate decision):
--     study_fruit ("every lesson resource" isn't a tracked concept distinct
--       from lessons themselves), berean_fruit (no "scripture reference
--       opened" event exists anywhere), lydia_fruit ("supports growth of a
--       discipleship group" has no defined metric)
--
-- WIRED — real, testable triggers built on data that exists today:
--   christ_identity, wisdom, prayer, evangelism (module-number fruits),
--   faith, obedience, reflection (any-module fruits), joy, peace,
--   perseverance, maturity, first_steps, rooted, fruitful, consistency,
--   diligence, endurance, steadfast, restoration, abiding (streak/gap
--   fruits), seed, growth, shepherd, timothy, forest, nations, legacy,
--   great_commission, teacher, paul, aquila_priscilla_fruit (all derived
--   from p2p_lesson_progress + p2p_discipleship_links, which are real).

-- ── Helper: active curriculum (mirrors the client's "published curriculum
-- with the most modules" heuristic — see .agents/memory/p2p-mock-data-migration.md) ──
create or replace function p2p_active_curriculum_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select c.id from p2p_curriculums c
  where c.status = 'published'
  order by (select count(*) from p2p_modules m where m.curriculum_id = c.id) desc
  limit 1;
$$;

-- ── Helper: distinct calendar dates of real learning activity (submissions
-- are insert-only and never overwritten, unlike p2p_lesson_progress.updated_at,
-- so they're the more reliable source for streak calculations) ──────────────
create or replace function p2p_user_activity_dates(p_user_id uuid)
returns table(activity_date date)
language sql stable security definer set search_path = public
as $$
  select distinct d::date from (
    select created_at as d from p2p_submissions where user_id = p_user_id
    union all
    select created_at as d from p2p_plan_assignment_submissions where user_id = p_user_id
  ) x
  order by 1 desc;
$$;

-- Longest-ever run of consecutive calendar days with activity (not just the
-- current streak) — a fruit like Diligence is earned the first time a
-- 7-day run ever happens, even if the streak has since broken.
create or replace function p2p_max_day_streak(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  with dates as (select activity_date from p2p_user_activity_dates(p_user_id)),
  grp as (
    select activity_date, activity_date - (row_number() over (order by activity_date))::int as grp
    from dates
  )
  select coalesce(max(cnt), 0)::int from (select count(*) as cnt from grp group by grp) t;
$$;

-- Longest-ever run of consecutive ISO calendar weeks with activity.
create or replace function p2p_max_week_streak(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  with weeks as (
    select distinct date_trunc('week', activity_date)::date as wk
    from p2p_user_activity_dates(p_user_id)
  ),
  grp as (
    select wk, (extract(epoch from wk) / 604800)::int - (row_number() over (order by wk))::int as grp
    from weeks
  )
  select coalesce(max(cnt), 0)::int from (select count(*) as cnt from grp group by grp) t;
$$;

-- Gap (in days) between today's activity and the most recent PRIOR distinct
-- activity date. Returns null if there is no prior activity at all (a brand
-- new learner's first-ever lesson must never look like "returning from a gap").
create or replace function p2p_days_since_previous_activity(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select (current_date - activity_date)::int
  from p2p_user_activity_dates(p_user_id)
  where activity_date < current_date
  order by activity_date desc
  limit 1;
$$;

-- ── Helper: is every lesson in a module completed for this user? ────────────
create or replace function p2p_module_fully_completed(p_user_id uuid, p_module_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select count(*) > 0 and count(*) = count(*) filter (where completed)
  from (
    select l.id, coalesce(lp.completed, false) as completed
    from p2p_lessons l
    left join p2p_lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_user_id
    where l.module_id = p_module_id
  ) x;
$$;

-- Every lesson in the module that HAS an assignment has been fully approved
-- (lesson_progress.status = 'completed' only happens once every assignment
-- question is approved — see migration 031).
create or replace function p2p_module_all_assignments_done(p_user_id uuid, p_module_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select count(*) filter (where a.id is not null) > 0
     and count(*) filter (where a.id is not null and coalesce(lp.status, 'not_started') <> 'completed') = 0
  from p2p_lessons l
  left join p2p_assignments a on a.lesson_id = l.id
  left join p2p_lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_user_id
  where l.module_id = p_module_id;
$$;

-- Every reflection question across the module's lessons has a submission.
create or replace function p2p_module_all_reflections_done(p_user_id uuid, p_module_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select count(*) filter (where rq.id is not null) > 0
     and count(*) filter (where rq.id is not null and s.id is null) = 0
  from p2p_lessons l
  join p2p_reflection_questions rq on rq.lesson_id = l.id
  left join p2p_submissions s on s.reflection_question_id = rq.id and s.user_id = p_user_id
  where l.module_id = p_module_id;
$$;

-- ── Central award function ───────────────────────────────────────────────────
create or replace function p2p_award_fruit(
  p_user_id uuid,
  p_fruit_key text,
  p_trigger_event text,
  p_source_type text,
  p_source_id uuid,
  p_evidence jsonb,
  p_awarded_by text default 'system'
)
returns boolean
language plpgsql security definer set search_path = public
as $$
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

  insert into p2p_notifications (user_id, title, message)
  values (
    p_user_id, 'New Fruit Earned 🍇',
    'You earned ' || v_catalog.name || ' — ' || coalesce(v_catalog.unlock_condition_description, '')
  );

  return true;
end;
$$;

-- Records a progress update without necessarily awarding — used for fruits
-- with a visible "X of Y" progress bar (Forest, Nations, Legacy, Paul).
create or replace function p2p_update_fruit_progress(p_user_id uuid, p_fruit_key text, p_current integer, p_required integer, p_details jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into p2p_fruit_progress (user_id, fruit_key, current_count, required_count, progress_details, last_updated)
  values (p_user_id, p_fruit_key, p_current, p_required, p_details, now())
  on conflict (user_id, fruit_key)
  do update set current_count = excluded.current_count, required_count = excluded.required_count,
                progress_details = excluded.progress_details, last_updated = now();
$$;

-- ── Central eligibility dispatcher ───────────────────────────────────────────
-- Called from the lesson-progress and discipleship-link triggers below.
-- p_source_id is the lesson_id (lesson_submitted/lesson_completed events) or
-- the discipleship_links.id (mentee_connected event).
create or replace function p2p_check_fruit_eligibility(p_user_id uuid, p_trigger_event text, p_source_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
      perform p2p_award_fruit(p_user_id, 'first_steps_fruit', p_trigger_event, 'lesson', p_source_id,
        jsonb_build_object('summary', 'Submitted your very first lesson.'));
    end if;

    -- Seed Fruit (mentor-side) — this submission is the disciple "beginning"
    -- Module 1. Checked here (not only at link-creation time) because a
    -- mentee is usually linked to a mentor before they've started anything.
    select module_id into v_module_id from p2p_lessons where id = p_source_id;
    if v_module_id = (select id from p2p_modules where curriculum_id = p2p_active_curriculum_id() and order_index = 1) then
      perform p2p_award_fruit(dl.mentor_id, 'seed_fruit', p_trigger_event, 'peer_action', p_source_id,
        jsonb_build_object('summary', 'Your first mentee began Module 1.'))
      from p2p_discipleship_links dl
      where dl.disciple_id = p_user_id and dl.active = true;
    end if;

    -- Streak fruits — evaluated on every submission, since a streak can
    -- complete on any day's activity, not just a "completed" transition.
    v_streak := p2p_max_day_streak(p_user_id);
    if v_streak >= 7 then
      perform p2p_award_fruit(p_user_id, 'diligence_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Completed a lesson on each of 7 consecutive days.', 'streak_days', v_streak));
    end if;
    if v_streak >= 14 then
      perform p2p_award_fruit(p_user_id, 'peace_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Active lesson progress across 14 consecutive days.', 'streak_days', v_streak));
    end if;

    v_streak := p2p_max_week_streak(p_user_id);
    if v_streak >= 4 then
      perform p2p_award_fruit(p_user_id, 'consistency_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', 'Active in each of 4 consecutive calendar weeks.', 'streak_weeks', v_streak));
    end if;

    -- Perseverance / Steadfast — returned after a 30+ day gap.
    v_gap := p2p_days_since_previous_activity(p_user_id);
    if v_gap is not null and v_gap >= 30 then
      perform p2p_award_fruit(p_user_id, 'perseverance_fruit', p_trigger_event, 'lesson', p_source_id,
        jsonb_build_object('summary', 'Returned and completed a lesson after ' || v_gap || ' days away.', 'gap_days', v_gap));
      perform p2p_award_fruit(p_user_id, 'steadfast_fruit', p_trigger_event, 'lesson', p_source_id,
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
      perform p2p_award_fruit(p_user_id, 'joy_fruit', p_trigger_event, 'streak', null,
        jsonb_build_object('summary', '10 consecutive lessons completed with no revision requested.'));
    end if;

  elsif p_trigger_event = 'lesson_completed' then
    select module_id into v_module_id from p2p_lessons where id = p_source_id;
    select order_index, curriculum_id into v_module_order, v_curriculum_id from p2p_modules where id = v_module_id;

    -- Rooted Fruit — first module ever fully completed.
    if p2p_module_fully_completed(p_user_id, v_module_id)
       and not exists (select 1 from p2p_user_fruits where user_id = p_user_id and fruit_key = 'rooted_fruit')
    then
      perform p2p_award_fruit(p_user_id, 'rooted_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Completed your very first full module.'));
    end if;

    if p2p_module_fully_completed(p_user_id, v_module_id) then
      -- Module-number fruits.
      if v_module_order = 1 then
        perform p2p_award_fruit(p_user_id, 'christ_identity_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 1: Your New Identity in Christ.'));
      elsif v_module_order = 5 then
        perform p2p_award_fruit(p_user_id, 'wisdom_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 5: The Bible — God''s Word to You.'));
      elsif v_module_order = 6 then
        perform p2p_award_fruit(p_user_id, 'prayer_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 6: Prayer — Talking with God.'));
      elsif v_module_order = 10 then
        perform p2p_award_fruit(p_user_id, 'evangelism_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed Module 10: Sharing Your Faith.'));
      end if;

      -- Obedience Fruit — every lesson, reflection AND assignment in the module.
      if p2p_module_all_reflections_done(p_user_id, v_module_id) then
        perform p2p_award_fruit(p_user_id, 'obedience_fruit', p_trigger_event, 'module', v_module_id,
          jsonb_build_object('summary', 'Completed every lesson, reflection, and assignment in a module.'));
      end if;
    end if;

    -- Faith Fruit — every assignment in this module is approved (module
    -- doesn't need to be otherwise "fully completed" if some lessons have no
    -- assignment at all).
    if p2p_module_all_assignments_done(p_user_id, v_module_id) then
      perform p2p_award_fruit(p_user_id, 'faith_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Completed every assignment in a module.'));
    end if;

    -- Reflection Fruit — every reflection question in this module answered.
    if p2p_module_all_reflections_done(p_user_id, v_module_id) then
      perform p2p_award_fruit(p_user_id, 'reflection_fruit', p_trigger_event, 'module', v_module_id,
        jsonb_build_object('summary', 'Answered every reflection question in a module.'));
    end if;

    -- Count-based fruits.
    select count(*) into v_completed_modules
    from p2p_modules m
    where p2p_module_fully_completed(p_user_id, m.id);

    if v_completed_modules >= 5 then
      perform p2p_award_fruit(p_user_id, 'fruitful_fruit', p_trigger_event, 'milestone', null,
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
      perform p2p_award_fruit(p_user_id, 'maturity_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Completed the entire 12-module Core Curriculum.'));
    end if;

    -- Endurance / Abiding — profile age + real activity.
    select created_at into v_profile_created_at from p2p_profiles where id = p_user_id;
    if v_profile_created_at <= now() - interval '180 days' then
      perform p2p_award_fruit(p_user_id, 'endurance_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Active for 180 days since joining.'));
    end if;
    if v_profile_created_at <= now() - interval '365 days' then
      perform p2p_award_fruit(p_user_id, 'abiding_fruit', p_trigger_event, 'milestone', null,
        jsonb_build_object('summary', 'Remained active for a full year since joining.'));
    end if;

    -- Restoration Fruit — returned after 14+ day gap AND completed a full module.
    v_gap := p2p_days_since_previous_activity(p_user_id);
    if v_gap is not null and v_gap >= 14 and p2p_module_fully_completed(p_user_id, v_module_id) then
      perform p2p_award_fruit(p_user_id, 'restoration_fruit', p_trigger_event, 'module', v_module_id,
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
$$;


-- ── Trigger: fires on p2p_lesson_progress status changes ────────────────────
-- Wired directly into p2p_lesson_progress_recompute() (migration 031) —
-- that function is the ONLY place status ever transitions, and it already
-- knows precisely which transition just happened, so this avoids a second,
-- redundant AFTER UPDATE trigger re-deriving the same thing.
create or replace function p2p_lesson_progress_recompute(p_user_id uuid, p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

      insert into p2p_notifications (user_id, title, message)
      values (
        p_user_id,
        'Lesson completed!',
        'Every answer for this lesson has been peer-approved. Great work!'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_completed', p_lesson_id);
    end if;
  elsif v_submitted_questions >= v_total_questions then
    if v_current_status = 'not_started' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'submitted', false, 50, now())
      on conflict (user_id, lesson_id)
      do update set status = 'submitted', updated_at = now();

      insert into p2p_notifications (user_id, title, message)
      values (
        p_user_id,
        'Lesson submitted',
        'Lesson submitted — your peer guide will review your answers.'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_submitted', p_lesson_id);
    end if;
  end if;
end;
$$;

-- ── Trigger: fires on a new mentee relationship (p2p_discipleship_links) ────
create or replace function p2p_check_seed_and_coMentor_fruit()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
      perform p2p_award_fruit(new.mentor_id, 'seed_fruit', 'mentee_connected', 'peer_action', new.id,
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
    perform p2p_award_fruit(new.mentor_id, 'aquila_priscilla_fruit', 'mentee_connected', 'peer_action', new.id,
      jsonb_build_object('summary', 'Co-mentoring the same disciple alongside another peer guide.'));
    perform p2p_award_fruit(v_other_mentor, 'aquila_priscilla_fruit', 'mentee_connected', 'peer_action', new.id,
      jsonb_build_object('summary', 'Co-mentoring the same disciple alongside another peer guide.'));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fruit_check_on_discipleship on p2p_discipleship_links;
create trigger trg_fruit_check_on_discipleship
  after insert on p2p_discipleship_links
  for each row execute function p2p_check_seed_and_coMentor_fruit();

-- ── Teacher Fruit — mentored 3 learners each to module completion ───────────
-- Evaluated as part of the mentor sweep so it stays current whenever any
-- mentee completes a module (reuses the same "graduated" style count, but at
-- the ANY-module threshold rather than full-curriculum).
create or replace function p2p_check_teacher_fruit(p_mentor_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
    perform p2p_award_fruit(p_mentor_id, 'teacher_fruit', 'mentee_module_completed', 'mentor_action', null,
      jsonb_build_object('summary', 'Successfully mentored 3 learners, each to module completion.', 'count', v_count));
  end if;
end;
$$;

-- Fold the Teacher Fruit check into the same mentor sweep used above.
create or replace function p2p_check_mentor_fruit_eligibility(p_disciple_id uuid, p_module_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
      perform p2p_award_fruit(v_mentor.mentor_id, 'shepherd_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
        jsonb_build_object('summary', 'A mentee completed a full module.'));

      if v_module_order = 1 then
        perform p2p_award_fruit(v_mentor.mentor_id, 'growth_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
          jsonb_build_object('summary', 'A mentee completed Module 1.'));
      end if;

      perform p2p_check_teacher_fruit(v_mentor.mentor_id);
    end if;

    if (
      select count(*) from p2p_modules m
      where m.curriculum_id = p2p_active_curriculum_id() and m.order_index between 1 and 12
        and p2p_module_fully_completed(p_disciple_id, m.id)
    ) = 12 then
      perform p2p_award_fruit(v_mentor.mentor_id, 'timothy_fruit', 'mentee_module_completed', 'mentor_action', p_disciple_id,
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
      perform p2p_award_fruit(v_mentor.mentor_id, 'forest_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', '5 mentees have each completed the entire Core Curriculum.', 'count', v_graduated_count));
    end if;

    v_core_graduated_count := v_graduated_count;
    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'legacy_fruit', v_core_graduated_count, 10,
      jsonb_build_object('graduated_mentees', v_core_graduated_count));
    if v_core_graduated_count >= 10 then
      perform p2p_award_fruit(v_mentor.mentor_id, 'legacy_fruit', 'mentee_module_completed', 'mentor_action', null,
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
      perform p2p_award_fruit(v_mentor.mentor_id, 'nations_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Mentees from 3 different countries have each completed modules.', 'count', v_country_count));
    end if;

    select count(*) into v_disciple_makers
    from p2p_discipleship_links dl
    where dl.mentor_id = v_mentor.mentor_id and dl.active = true
      and exists (select 1 from p2p_discipleship_links dl2 where dl2.mentor_id = dl.disciple_id and dl2.active = true);

    if v_disciple_makers >= 1 then
      perform p2p_award_fruit(v_mentor.mentor_id, 'great_commission_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Someone you personally discipled has gone on to disciple others.'));
    end if;

    perform p2p_update_fruit_progress(v_mentor.mentor_id, 'paul_fruit', v_disciple_makers, 10,
      jsonb_build_object('disciple_makers', v_disciple_makers));
    if v_disciple_makers >= 10 then
      perform p2p_award_fruit(v_mentor.mentor_id, 'paul_fruit', 'mentee_module_completed', 'mentor_action', null,
        jsonb_build_object('summary', 'Raised up 10 disciple-makers.', 'count', v_disciple_makers));
    end if;
  end loop;
end;
$$;
