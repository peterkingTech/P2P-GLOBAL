-- 050: Dashboard activity tracking — backs the 6 "(coming soon)" stats on
-- the Kingdom Impact dashboard with real events instead of hardcoded 0s.
-- Renumbered from the spec's 049 — 049 was already used for the Elijah
-- Protocol / Dormant Seed pastoral care system.

CREATE TABLE IF NOT EXISTS p2p_user_activity_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched'
  )),
  metadata    jsonb not null default '{}',
  -- session_held: { session_id, peer_id }
  -- peer_encouraged: { target_user_id, context }
  -- prayer_offered: { prayer_id, recipient_id }
  -- scripture_opened: { reference, lesson_id }
  -- plan_completed: { plan_id, plan_title }
  -- mountain_touched: { mountain_name, plan_id }
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_user ON p2p_user_activity_events(user_id, event_type);

ALTER TABLE p2p_user_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own activity events" ON p2p_user_activity_events;
CREATE POLICY "Users manage their own activity events" ON p2p_user_activity_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── p2p_get_growth_dashboard, third revision (035 -> 041 -> here) ───────────
-- Only the 6 previously-hardcoded-0 fields change; everything else is
-- unchanged from migration 041's version.
CREATE OR REPLACE FUNCTION p2p_get_growth_dashboard(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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

GRANT EXECUTE ON FUNCTION p2p_get_growth_dashboard(uuid) TO authenticated;