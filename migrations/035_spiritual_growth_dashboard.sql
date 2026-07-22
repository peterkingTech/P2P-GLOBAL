-- 035: Spiritual Growth Dashboard — a single RPC computing every metric the
-- dashboard screen needs in one round trip, rather than replicating the
-- module-completion / mentee-graduation join logic from migration 033 in
-- client-side TypeScript (one source of truth for "what counts as graduated").
--
-- Same transparency note as migrations 032/033: metrics that depend on
-- tracking which doesn't exist yet (peer sessions, encouragement, prayer-for-
-- a-learner, scripture-references-opened, Kingdom Plans/"Mountains") are
-- returned as 0 / empty rather than fabricated — the dashboard screen must
-- label these honestly as not-yet-tracked, not hide the gap.

create or replace function p2p_get_growth_dashboard(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
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
begin
  select count(*) into v_lessons_completed
  from p2p_lesson_progress where user_id = p_user_id and completed = true;

  select count(*) into v_modules_completed
  from p2p_modules m where p2p_module_fully_completed(p_user_id, m.id);

  select count(*) into v_plans_completed
  from p2p_plan_modules pm
  where (
    select count(*) from p2p_plan_lessons pl where pl.module_id = pm.id
  ) > 0 and (
    select count(*) from p2p_plan_lessons pl
    left join p2p_plan_lesson_progress plp on plp.lesson_id = pl.id and plp.user_id = p_user_id
    where pl.module_id = pm.id and coalesce(plp.completed, false)
  ) = (
    select count(*) from p2p_plan_lessons pl where pl.module_id = pm.id
  );

  select count(distinct lesson_id) into v_assignments_submitted
  from p2p_submissions where user_id = p_user_id and assignment_id is not null;

  select count(*) into v_reflections_answered
  from p2p_submissions where user_id = p_user_id and reflection_question_id is not null;

  select array_agg(activity_date order by activity_date desc) into v_activity_dates
  from p2p_user_activity_dates(p_user_id);

  v_total_days_active := coalesce(array_length(v_activity_dates, 1), 0);

  if v_activity_dates is not null and v_activity_dates[1] >= current_date - 1 then
    v_current_streak := 1;
    for v_i in 2..array_length(v_activity_dates, 1) loop
      if v_activity_dates[v_i - 1] - v_activity_dates[v_i] = 1 then
        v_current_streak := v_current_streak + 1;
      else
        exit;
      end if;
    end loop;
  end if;

  select count(*) into v_active_mentees
  from p2p_discipleship_links where mentor_id = p_user_id and active = true;

  select count(*) into v_mentees_module_complete
  from p2p_discipleship_links dl
  where dl.mentor_id = p_user_id and dl.active = true
    and exists (select 1 from p2p_modules m where p2p_module_fully_completed(dl.disciple_id, m.id));

  select count(*) into v_mentees_graduated
  from p2p_discipleship_links dl
  where dl.mentor_id = p_user_id and dl.active = true
    and (
      select count(*) from p2p_modules m
      where m.curriculum_id = p2p_active_curriculum_id() and m.order_index between 1 and 12
        and p2p_module_fully_completed(dl.disciple_id, m.id)
    ) = 12;

  select count(distinct p.country) into v_countries_reached
  from p2p_discipleship_links dl
  join p2p_profiles p on p.id = dl.disciple_id
  where dl.mentor_id = p_user_id and dl.active = true and p.country is not null;

  -- Generational depth: how many "mentees of mentees of..." levels exist
  -- below this user, capped at 5 to guard against runaway recursion.
  select array_agg(distinct disciple_id) into v_frontier
  from p2p_discipleship_links where mentor_id = p_user_id and active = true;

  for v_i in 1..5 loop
    exit when v_frontier is null or array_length(v_frontier, 1) is null;
    select array_agg(distinct disciple_id) into v_next_frontier
    from p2p_discipleship_links where mentor_id = any(v_frontier) and active = true;
    exit when v_next_frontier is null or array_length(v_next_frontier, 1) is null;
    v_generational_depth := v_i;
    v_frontier := v_next_frontier;
  end loop;

  select count(*) into v_fruits_total from p2p_user_fruits where user_id = p_user_id;

  select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb) into v_fruits_by_category
  from (
    select c.category, count(*) as cnt
    from p2p_user_fruits uf
    join p2p_fruits_catalog c on c.fruit_key = uf.fruit_key
    where uf.user_id = p_user_id
    group by c.category
  ) x;

  select jsonb_build_object('fruitKey', uf.fruit_key, 'name', c.name, 'icon', c.icon, 'awardedAt', uf.awarded_at)
    into v_most_recent_fruit
  from p2p_user_fruits uf
  join p2p_fruits_catalog c on c.fruit_key = uf.fruit_key
  where uf.user_id = p_user_id
  order by uf.awarded_at desc
  limit 1;

  select jsonb_build_object('fruitKey', fp.fruit_key, 'name', c.name, 'icon', c.icon, 'current', fp.current_count, 'required', fp.required_count)
    into v_next_fruit
  from p2p_fruit_progress fp
  join p2p_fruits_catalog c on c.fruit_key = fp.fruit_key
  where fp.user_id = p_user_id
    and not exists (select 1 from p2p_user_fruits uf where uf.user_id = p_user_id and uf.fruit_key = fp.fruit_key)
  order by (fp.current_count::float / greatest(fp.required_count, 1)) desc
  limit 1;

  return jsonb_build_object(
    'lessonsCompleted', v_lessons_completed,
    'modulesCompleted', v_modules_completed,
    'plansCompleted', coalesce(v_plans_completed, 0),
    'assignmentsSubmitted', v_assignments_submitted,
    'reflectionsAnswered', v_reflections_answered,
    'currentStreakDays', v_current_streak,
    'totalDaysActive', v_total_days_active,
    'peerSessionsHeld', 0,
    'peersEncouraged', 0,
    'prayersOfferedForOthers', 0,
    'scriptureReferencesOpened', 0,
    'activeMentees', v_active_mentees,
    'menteesModuleComplete', v_mentees_module_complete,
    'menteesGraduated', v_mentees_graduated,
    'generationalDepth', v_generational_depth,
    'countriesReached', coalesce(v_countries_reached, 0),
    'fruitsTotal', v_fruits_total,
    'fruitsByCategory', v_fruits_by_category,
    'mostRecentFruit', v_most_recent_fruit,
    'nextFruitProgress', v_next_fruit,
    'kingdomPlansCompleted', 0,
    'mountainsTouched', '[]'::jsonb
  );
end;
$$;

grant execute on function p2p_get_growth_dashboard(uuid) to authenticated;

-- ── Activity timeline — first occurrence of each major milestone type ────────
create or replace function p2p_get_activity_timeline(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_first_lesson jsonb;
  v_first_module jsonb;
  v_first_mentee jsonb;
  v_first_fruit jsonb;
begin
  select jsonb_build_object('label', 'First lesson completed', 'at', min(created_at))
    into v_first_lesson
  from p2p_submissions where user_id = p_user_id;

  select jsonb_build_object('label', 'First module completed', 'at', min(uf.awarded_at))
    into v_first_module
  from p2p_user_fruits uf where uf.user_id = p_user_id and uf.fruit_key = 'rooted_fruit';

  select jsonb_build_object('label', 'First mentee connected', 'at', min(created_at))
    into v_first_mentee
  from p2p_discipleship_links where mentor_id = p_user_id;

  select jsonb_build_object('label', 'First fruit earned', 'at', min(awarded_at))
    into v_first_fruit
  from p2p_user_fruits where user_id = p_user_id;

  return jsonb_build_object(
    'firstLesson', v_first_lesson,
    'firstModule', v_first_module,
    'firstMentee', v_first_mentee,
    'firstFruit', v_first_fruit
  );
end;
$$;

grant execute on function p2p_get_activity_timeline(uuid) to authenticated;
