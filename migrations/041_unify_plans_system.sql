-- 041: Unify the two "Plans" systems into a single source of truth —
-- p2p_curriculums (type = 'plan'). System B (p2p_plans / p2p_plan_modules /
-- p2p_plan_lessons and everything built on top of them) was never actually
-- launched: p2p_plans has zero rows in production. System A already has two
-- real, published plan-type curriculums (Victory Over Lustful Thoughts, The
-- Media Mandate) using the exact same modules/lessons tables and admin editor
-- as core curriculum.
--
-- IMPORTANT — this migration goes further than a first read suggests:
-- dropping just p2p_plans/p2p_plan_modules/p2p_plan_lessons (as a minimal
-- read of "unify the plans tables" might imply) would fail outright — ten
-- more empty System-B-only tables still hold foreign keys into them. Two of
-- those FK'd tables are also read directly, by name, from two ACTIVE,
-- unrelated functions used by every real user regardless of whether Plans
-- has content (p2p_user_activity_dates for fruit-streak awarding,
-- p2p_get_growth_dashboard for the growth dashboard's "plans completed"
-- stat) — those are patched below rather than left to error at runtime.

-- ── Step 1: confirm p2p_plans is empty before doing anything destructive ────
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from p2p_plans;
  if v_count > 0 then
    raise exception 'p2p_plans has % row(s) — STOP. This migration assumes System B is empty and unused; a non-empty p2p_plans means real content would be lost by the DROP TABLE statements below. Do not proceed without a migration plan for that data.', v_count;
  end if;
end $$;

-- ── Step 2: additive columns on p2p_curriculums ──────────────────────────────
-- Note: p2p_curriculums already has a `cover_image` column (not
-- `cover_image_url`) serving the same purpose — using it rather than adding a
-- second, redundant image column. `description` also already exists.
-- subtitle: needed for "Plan subtitle or tagline" (WHAT NEEDS TO TRANSLATE
-- item 1) and the GET /plans response shape — not in the original column
-- list handed to this migration, but nothing else provides it.
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_name text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_role text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_church text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_location text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_youtube text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_instagram text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS teaching_credit_twitter text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS color_theme text DEFAULT '#1D9E75';
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS difficulty_level text DEFAULT 'beginner';
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS estimated_weeks integer;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS prerequisites jsonb DEFAULT '[]';
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS target_audience text;
ALTER TABLE p2p_curriculums ADD COLUMN IF NOT EXISTS display_order integer;

-- ── Step 3: additive columns on p2p_modules ──────────────────────────────────
-- Note: p2p_modules already has cover_image_url, color_theme, and
-- estimated_weeks (added in an earlier, undocumented pass) and already uses
-- order_index (not display_order) for sequencing — these IF NOT EXISTS calls
-- are no-ops for those, kept only for is_locked/unlock_condition which are
-- genuinely new. No reading code is wired to is_locked/unlock_condition yet —
-- lock state is still computed client-side from lesson progress, matching
-- how every other module-locking decision in this app already works; these
-- columns exist for a future admin-settable override, not used today.
ALTER TABLE p2p_modules ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE p2p_modules ADD COLUMN IF NOT EXISTS color_theme text;
ALTER TABLE p2p_modules ADD COLUMN IF NOT EXISTS display_order integer;
ALTER TABLE p2p_modules ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;
ALTER TABLE p2p_modules ADD COLUMN IF NOT EXISTS unlock_condition text;

-- ── Step 4: content_translations content_type constraint ────────────────────
-- Already satisfied — migration 029_plan_content_translations.sql already
-- widened this constraint to include plan/plan_module/plan_lesson alongside
-- the full existing set (curriculum, module, lesson, section, scripture,
-- question, assignment, quiz, devotional, journal). Re-running the literal
-- snippet from this task's instructions would have REMOVED those other
-- content types (section/scripture/question/assignment/quiz/devotional/
-- journal), which translationEngine.ts's ContentType union and existing
-- p2p_content_translations rows still depend on — that would have been a
-- real regression, not a no-op. Left as-is; verified live before writing
-- this migration (see chat transcript).

-- ── Step 5: drop System B — full cleanup, in FK-dependency order ────────────
-- (CASCADE is a safety net for FK constraints only; it does not drop
-- unrelated tables, so the explicit ordering below still matters for
-- clarity even though every one of these is confirmed empty.)
DROP TABLE IF EXISTS p2p_plan_lesson_evaluations CASCADE;
DROP TABLE IF EXISTS p2p_plan_reflection_submissions CASCADE;
DROP TABLE IF EXISTS p2p_plan_assignment_submissions CASCADE;
DROP TABLE IF EXISTS p2p_plan_reflection_questions CASCADE;
DROP TABLE IF EXISTS p2p_plan_assignment_questions CASCADE;
DROP TABLE IF EXISTS p2p_plan_lesson_progress CASCADE;
DROP TABLE IF EXISTS p2p_plan_teaching_sessions CASCADE;
DROP TABLE IF EXISTS p2p_plan_teaching_outlines CASCADE;
DROP TABLE IF EXISTS p2p_plan_discussion_questions CASCADE;
DROP TABLE IF EXISTS p2p_plan_source_teachers CASCADE;
DROP TABLE IF EXISTS p2p_plan_lessons CASCADE;
DROP TABLE IF EXISTS p2p_plan_modules CASCADE;
DROP TABLE IF EXISTS p2p_plans CASCADE;

-- Orphaned functions — every trigger that used to call these was attached to
-- a table just dropped above (and went with it); these standalone/trigger
-- function definitions would otherwise remain as dead, never-callable code.
DROP FUNCTION IF EXISTS p2p_plan_pick_evaluator(uuid, uuid[]);
DROP FUNCTION IF EXISTS p2p_plan_assign_evaluator_on_submission();
DROP FUNCTION IF EXISTS p2p_plan_notify_evaluator();
DROP FUNCTION IF EXISTS p2p_plan_award_evaluation_credit();
DROP FUNCTION IF EXISTS p2p_plan_apply_evaluation_outcome();
DROP FUNCTION IF EXISTS p2p_plan_notify_submitter_on_resolution();
DROP FUNCTION IF EXISTS p2p_award_plan_evaluation_credit();
DROP FUNCTION IF EXISTS p2p_award_wisdom_on_plan_approval();
DROP FUNCTION IF EXISTS p2p_award_wisdom_on_reflection();

-- ── Step 6: patch the two ACTIVE functions that queried System-B tables ──────

-- p2p_user_activity_dates (033): drop the UNION with the now-dropped
-- p2p_plan_assignment_submissions. Streak/activity calculations now come
-- from core p2p_submissions only.
CREATE OR REPLACE FUNCTION p2p_user_activity_dates(p_user_id uuid)
RETURNS TABLE(activity_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT created_at::date AS activity_date
  FROM p2p_submissions
  WHERE user_id = p_user_id
  ORDER BY 1 DESC;
$$;

-- p2p_get_growth_dashboard (035): recompute "plans completed" from the
-- unified system (p2p_curriculums type='plan' + p2p_modules + the existing
-- p2p_module_fully_completed() helper, migration 033) instead of the dropped
-- p2p_plan_modules/p2p_plan_lessons/p2p_plan_lesson_progress tables. This
-- also means the stat now reflects real progress on Victory/Media Mandate
-- instead of permanently reading zero.
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

  RETURN jsonb_build_object(
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
END;
$$;

GRANT EXECUTE ON FUNCTION p2p_get_growth_dashboard(uuid) TO authenticated;

-- Known, deliberately-left dead code: p2p_get_submitter_evaluation_context()
-- (migration 030) still has a `p_source = 'plan'` branch referencing the
-- now-dropped p2p_plan_lesson_evaluations/p2p_plan_lessons/p2p_plan_modules.
-- It is not rewritten here — DataContext.tsx's refreshPendingEvaluations()
-- no longer queries p2p_plan_lesson_evaluations at all post-unification (see
-- the mobile app changes in this same commit), so nothing can ever again
-- produce a PendingEvaluation with source:'plan', and this branch can never
-- be reached. Rewriting a function only half-seen in this session carried
-- more risk than leaving a genuinely unreachable branch in place.

-- ── Step 6.5: backfill real teaching-credit data for the two existing plans ──
-- This data already existed, hardcoded client-side in the old module/[id].tsx
-- ATTRIBUTION_MAP/VICTORY_ATTRIBUTION constants (a stopgap from before this
-- table had real teaching-credit columns) — moving it into the DB row it
-- actually describes rather than leaving these two real plans with a blank
-- teaching-credit section under the new unified screen.
UPDATE p2p_curriculums SET
  teaching_credit_name = 'Pastor Dolapo Lawal',
  teaching_credit_role = 'Lead Pastor',
  teaching_credit_church = 'Zoe Household Global',
  teaching_credit_location = 'Austell, GA / Lagos, Nigeria',
  teaching_credit_youtube = '@PastorDolapoLawal',
  teaching_credit_instagram = '@thedolapolawal'
WHERE id = 'c2000000-0000-0000-0000-000000000002' AND teaching_credit_name IS NULL;

UPDATE p2p_curriculums SET
  teaching_credit_name = 'Dr. Myles Munroe',
  teaching_credit_church = 'Bahamas Faith Ministries International',
  teaching_credit_location = 'Nassau, The Bahamas',
  teaching_credit_youtube = '@MunroeGlobal',
  teaching_credit_instagram = '@munroeglobal'
WHERE id = 'b0000000-0000-0000-0000-000000000001' AND teaching_credit_name IS NULL;

-- ── Step 7: backward-compat view ─────────────────────────────────────────────
CREATE OR REPLACE VIEW p2p_plans_view AS
SELECT
  id,
  title,
  description,
  subtitle,
  cover_image AS cover_image_url,
  thumbnail_url,
  color_theme,
  tags,
  is_featured,
  difficulty_level,
  estimated_weeks,
  teaching_credit_name,
  teaching_credit_role,
  teaching_credit_church,
  teaching_credit_location,
  teaching_credit_youtube,
  teaching_credit_instagram,
  status,
  display_order,
  created_at,
  created_by
FROM p2p_curriculums
WHERE type = 'plan'
ORDER BY is_featured DESC, display_order ASC NULLS LAST, created_at ASC;
