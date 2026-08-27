-- Closes the remaining "raw p_user_id SECURITY DEFINER" finding deferred
-- from the prior security pass, for the three functions confirmed
-- exploitable and safe to fix without breaking any real caller.
--
-- p2p_get_growth_dashboard(p_user_id), get_user_tree_data(p_user_id), and
-- p2p_award_fruit(p_user_id, ...) all accepted p_user_id from the caller
-- with zero check that it matched the caller's own identity. Live-confirmed
-- exploitable: any authenticated user can call a SECURITY DEFINER RPC
-- directly via supabase.rpc() (these are never routed through an
-- api-server auth check — they're called straight from the mobile client),
-- so any user could read another user's full growth dashboard / living
-- tree data (lesson/module completion counts, streaks, active mentee
-- counts, fruit progress, activity timeline) — the exact category of data
-- discipleship.ts's disciple-detail endpoint correctly requires an active
-- mentor relationship for, bypassed entirely by calling these RPCs
-- directly. p2p_award_fruit additionally allows granting an achievement
-- (and its notification) to an arbitrary other user.
--
-- Confirmed safe to add an auth.uid() = p_user_id guard: grepped the
-- entire mobile app and api-server for every call site of all three
-- functions — every single one (DataContext.tsx's loadTreeData,
-- checkCurriculumCompletion, and my-discipleship/journey.tsx) always
-- passes the caller's own profile.id, with zero exception, and no
-- api-server route calls any of these three at all (so there's no
-- service-role caller whose auth.uid() would be null and get wrongly
-- rejected). Exact existing bodies preserved otherwise — this is
-- CREATE OR REPLACE with one guard clause added at the top of each.
--
-- Not fixed here (separate, lower-severity, out-of-scope-for-this-pass
-- concern noted for the record): p2p_award_fruit still trusts the
-- caller's claimed p_fruit_key/p_evidence/p_trigger_event at face value
-- once the p_user_id = auth.uid() check passes, so a user could still
-- self-award an unearned fruit to their OWN account (a gamification-
-- integrity issue, not a cross-user data exposure) — this audit's scope
-- was specifically the horizontal p_user_id manipulation, not
-- self-fraud on the achievement system.

create or replace function p2p_get_growth_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
DECLARE
  v_lessons_completed int;
  v_modules_completed int;
  v_plans_completed int;
  v_assignments_submitted int;
  v_reflections_answered int;
  v_activity_dates date[];
  v_current_streak int := 0;
  v_total_days_active int;
  v_active_mentees int;
  v_mentees_module_complete int;
  v_mentees_graduated int;
  v_generational_depth int := 0;
  v_countries_reached int;
  v_fruits_total int;
  v_fruits_by_category jsonb;
  v_most_recent_fruit jsonb;
  v_next_fruit jsonb;
  v_i int;
  v_frontier uuid[];
  v_next_frontier uuid[];
  v_peer_sessions_held int;
  v_peers_encouraged int;
  v_prayers_offered int;
  v_scripture_opens int;
  v_kingdom_plans_completed int;
  v_mountains_touched jsonb;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT count(*) INTO v_lessons_completed
  FROM p2p_lesson_progress WHERE user_id = p_user_id AND completed = true;

  SELECT count(*) INTO v_modules_completed
  FROM p2p_modules m WHERE p2p_module_fully_completed(p_user_id, m.id);

  SELECT count(*) INTO v_plans_completed
  FROM p2p_modules m
  JOIN p2p_curriculums c ON c.id = m.curriculum_id AND c.type = 'plan'
  WHERE p2p_module_fully_completed(p_user_id, m.id);

  SELECT count(DISTINCT lesson_id) INTO v_assignments_submitted
  FROM p2p_submissions WHERE user_id = p_user_id AND assignment_id IS NOT NULL;

  SELECT count(*) INTO v_reflections_answered
  FROM p2p_submissions WHERE user_id = p_user_id AND reflection_question_id IS NOT NULL;

  SELECT array_agg(activity_date ORDER BY activity_date DESC) INTO v_activity_dates
  FROM p2p_user_activity_dates(p_user_id);

  v_total_days_active := coalesce(array_length(v_activity_dates, 1), 0);

  IF v_activity_dates IS NOT NULL AND v_activity_dates[1] >= current_date - 1 THEN
    v_current_streak := 1;
    FOR v_i IN 2..array_length(v_activity_dates, 1) LOOP
      IF v_activity_dates[v_i - 1] - v_activity_dates[v_i] = 1 THEN
        v_current_streak := v_current_streak + 1;
      ELSE
        EXIT;
      END IF;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_active_mentees
  FROM p2p_discipleship_links WHERE mentor_id = p_user_id AND active = true;

  SELECT count(*) INTO v_mentees_module_complete
  FROM p2p_discipleship_links dl
  WHERE dl.mentor_id = p_user_id AND dl.active = true
    AND EXISTS (SELECT 1 FROM p2p_modules m WHERE p2p_module_fully_completed(dl.disciple_id, m.id));

  SELECT count(*) INTO v_mentees_graduated
  FROM p2p_discipleship_links dl
  WHERE dl.mentor_id = p_user_id AND dl.active = true
    AND (
      SELECT count(*) FROM p2p_modules m
      WHERE m.curriculum_id = p2p_active_curriculum_id() AND m.order_index BETWEEN 1 AND 12
        AND p2p_module_fully_completed(dl.disciple_id, m.id)
    ) = 12;

  SELECT count(DISTINCT p.country) INTO v_countries_reached
  FROM p2p_discipleship_links dl
  JOIN p2p_profiles p ON p.id = dl.disciple_id
  WHERE dl.mentor_id = p_user_id AND dl.active = true AND p.country IS NOT NULL;

  SELECT array_agg(DISTINCT disciple_id) INTO v_frontier
  FROM p2p_discipleship_links WHERE mentor_id = p_user_id AND active = true;

  FOR v_i IN 1..5 LOOP
    EXIT WHEN v_frontier IS NULL OR array_length(v_frontier, 1) IS NULL;
    SELECT array_agg(DISTINCT disciple_id) INTO v_next_frontier
    FROM p2p_discipleship_links WHERE mentor_id = ANY(v_frontier) AND active = true;
    EXIT WHEN v_next_frontier IS NULL OR array_length(v_next_frontier, 1) IS NULL;
    v_generational_depth := v_i;
    v_frontier := v_next_frontier;
  END LOOP;

  SELECT count(*) INTO v_fruits_total FROM p2p_user_fruits WHERE user_id = p_user_id;

  SELECT coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb) INTO v_fruits_by_category
  FROM (
    SELECT c.category, count(*) AS cnt
    FROM p2p_user_fruits uf
    JOIN p2p_fruits_catalog c ON c.fruit_key = uf.fruit_key
    WHERE uf.user_id = p_user_id
    GROUP BY c.category
  ) x;

  SELECT jsonb_build_object('fruitKey', uf.fruit_key, 'name', c.name, 'icon', c.icon, 'awardedAt', uf.awarded_at)
    INTO v_most_recent_fruit
  FROM p2p_user_fruits uf
  JOIN p2p_fruits_catalog c ON c.fruit_key = uf.fruit_key
  WHERE uf.user_id = p_user_id
  ORDER BY uf.awarded_at DESC
  LIMIT 1;

  SELECT jsonb_build_object('fruitKey', fp.fruit_key, 'name', c.name, 'icon', c.icon, 'current', fp.current_count, 'required', fp.required_count)
    INTO v_next_fruit
  FROM p2p_fruit_progress fp
  JOIN p2p_fruits_catalog c ON c.fruit_key = fp.fruit_key
  WHERE fp.user_id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM p2p_user_fruits uf WHERE uf.user_id = p_user_id AND uf.fruit_key = fp.fruit_key)
  ORDER BY (fp.current_count::float / greatest(fp.required_count, 1)) DESC
  LIMIT 1;

  SELECT count(*) INTO v_peer_sessions_held
  FROM p2p_user_activity_events WHERE user_id = p_user_id AND event_type = 'session_held';

  SELECT count(DISTINCT metadata->>'target_user_id') INTO v_peers_encouraged
  FROM p2p_user_activity_events WHERE user_id = p_user_id AND event_type = 'peer_encouraged';

  SELECT count(*) INTO v_prayers_offered
  FROM p2p_user_activity_events WHERE user_id = p_user_id AND event_type = 'prayer_offered';

  SELECT count(*) INTO v_scripture_opens
  FROM p2p_user_activity_events WHERE user_id = p_user_id AND event_type = 'scripture_opened';

  SELECT count(*) INTO v_kingdom_plans_completed
  FROM p2p_user_activity_events WHERE user_id = p_user_id AND event_type = 'plan_completed';

  SELECT coalesce(jsonb_agg(DISTINCT mountain_name), '[]'::jsonb) INTO v_mountains_touched
  FROM (
    SELECT metadata->>'mountain_name' AS mountain_name
    FROM p2p_user_activity_events
    WHERE user_id = p_user_id AND event_type = 'mountain_touched' AND metadata->>'mountain_name' IS NOT NULL
  ) m;

  RETURN jsonb_build_object(
    'lessonsCompleted', v_lessons_completed,
    'modulesCompleted', v_modules_completed,
    'plansCompleted', coalesce(v_plans_completed, 0),
    'assignmentsSubmitted', v_assignments_submitted,
    'reflectionsAnswered', v_reflections_answered,
    'currentStreakDays', v_current_streak,
    'totalDaysActive', v_total_days_active,
    'peerSessionsHeld', coalesce(v_peer_sessions_held, 0),
    'peersEncouraged', coalesce(v_peers_encouraged, 0),
    'prayersOfferedForOthers', coalesce(v_prayers_offered, 0),
    'scriptureReferencesOpened', coalesce(v_scripture_opens, 0),
    'activeMentees', v_active_mentees,
    'menteesModuleComplete', v_mentees_module_complete,
    'menteesGraduated', v_mentees_graduated,
    'generationalDepth', v_generational_depth,
    'countriesReached', coalesce(v_countries_reached, 0),
    'fruitsTotal', v_fruits_total,
    'fruitsByCategory', v_fruits_by_category,
    'mostRecentFruit', v_most_recent_fruit,
    'nextFruitProgress', v_next_fruit,
    'kingdomPlansCompleted', coalesce(v_kingdom_plans_completed, 0),
    'mountainsTouched', coalesce(v_mountains_touched, '[]'::jsonb)
  );
END;
$$;

create or replace function get_user_tree_data(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_curriculum_id uuid;
  v_lessons_completed int;
  v_modules_completed int;
  v_active_days int;
  v_active_mentees int;
  v_wilting_mentees int;
  v_fruit_count int;
  v_fruit_keys text[];
  v_second_gen_disciples int;
  v_last_active_at timestamptz;
  v_joined_at timestamptz;
  v_streak_days int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_authorized';
  end if;

  select p2p_active_curriculum_id() into v_curriculum_id;

  select count(*) into v_lessons_completed
  from p2p_lesson_progress lp
  join p2p_lessons l on l.id = lp.lesson_id
  join p2p_modules m on m.id = l.module_id
  where lp.user_id = p_user_id and lp.completed = true
    and m.curriculum_id = v_curriculum_id;

  select count(*) into v_modules_completed
  from p2p_modules m
  where m.curriculum_id = v_curriculum_id
    and m.order_index between 1 and 12
    and p2p_module_fully_completed(p_user_id, m.id);

  select count(distinct date(lp.updated_at)) into v_active_days
  from p2p_lesson_progress lp where lp.user_id = p_user_id;

  select count(*) into v_active_mentees
  from p2p_discipleship_links where mentor_id = p_user_id and active = true;

  select count(*) into v_wilting_mentees
  from p2p_discipleship_links dl
  join p2p_profiles p on p.id = dl.disciple_id
  where dl.mentor_id = p_user_id and dl.active = true
    and p.last_active_at < now() - interval '14 days';

  select count(*) into v_fruit_count from p2p_user_fruits where user_id = p_user_id;
  select coalesce(array_agg(fruit_key), array[]::text[]) into v_fruit_keys
  from p2p_user_fruits where user_id = p_user_id;

  select count(distinct dl2.disciple_id) into v_second_gen_disciples
  from p2p_discipleship_links dl1
  join p2p_discipleship_links dl2 on dl2.mentor_id = dl1.disciple_id and dl2.active = true
  where dl1.mentor_id = p_user_id and dl1.active = true;

  select last_active_at, created_at, coalesce(streak_days, 0)
    into v_last_active_at, v_joined_at, v_streak_days
  from p2p_profiles where id = p_user_id;

  return jsonb_build_object(
    'lessonsCompleted', v_lessons_completed,
    'modulesCompleted', v_modules_completed,
    'activeDays', coalesce(v_active_days, 0),
    'activeMentees', v_active_mentees,
    'wiltingMentees', v_wilting_mentees,
    'fruitCount', v_fruit_count,
    'fruitKeys', coalesce(to_jsonb(v_fruit_keys), '[]'::jsonb),
    'secondGenDisciples', coalesce(v_second_gen_disciples, 0),
    'lastActiveAt', v_last_active_at,
    'joinedAt', v_joined_at,
    'streakDays', v_streak_days
  );
end;
$$;

create or replace function p2p_award_fruit(
  p_user_id uuid, p_fruit_key text, p_trigger_event text, p_source_type text,
  p_source_id uuid, p_evidence jsonb, p_awarded_by text default 'system'::text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
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

  insert into p2p_notifications (user_id, title, message)
  values (
    p_user_id, 'New Fruit Earned 🍇',
    'You earned ' || v_catalog.name || ' — ' || coalesce(v_catalog.unlock_condition_description, '')
  );

  return true;
end;
$$;