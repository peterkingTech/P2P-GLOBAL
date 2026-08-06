-- 051: Living Tree real data RPC — backs the SVG tree visualization with
-- real user data instead of a static staged photo.
--
-- Corrected against the real schema (several values in the original spec
-- don't exist on this project):
--   - p2p_curriculums.type is 'core' | 'plan', never 'curriculum'.
--   - p2p_profiles has streak_days, not consistency_streak.
--   - "modules_completed" must mean ALL lessons in a module done, not just
--     "any lesson in it done" — reuses the same p2p_module_fully_completed()
--     helper already relied on by the fruit engine, dashboard RPC, and peer
--     guide eligibility, restricted to order_index 1-12 (order_index 0 is
--     the orientation module — same "12-module Core Curriculum" convention
--     as the Maturity Fruit trigger in migration 032).
--   - second_gen_disciples filters both link levels on active = true, same
--     convention as the generational-depth BFS in migration 035/041 — an
--     ended (active=false) relationship was never meant to count as reach.

create or replace function get_user_tree_data(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
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

grant execute on function get_user_tree_data(uuid) to authenticated;