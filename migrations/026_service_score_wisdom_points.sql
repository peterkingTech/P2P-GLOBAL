-- Migration 026: service_score rename + wisdom_points award triggers
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- WHAT THIS DOES:
-- 1. Renames servant_score → service_score in p2p_profiles
-- 2. Drops and recreates p2p_award_evaluation_credit: evaluator earns 5 service_score
--    (down from 10), applies to both core and plan evaluations
-- 3. Adds wisdom_points award on lesson approval:
--    - Core curriculum lesson approved → submitter +10 wisdom_points
--    - Plans lesson approved → submitter +15 wisdom_points
-- 4. Adds wisdom_points award on reflection submission (private, no eval):
--    - Plan reflection submitted → submitter +5 wisdom_points instantly
-- 5. Updates p2p_reassign_stale_evaluations to notify both the original
--    evaluator (zero credit) and the new evaluator (assigned notice)
-- 6. Creates backwards-compat wrapper so old p2p_increment_servant_score
--    calls still work until app code is fully updated


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RENAME COLUMN
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE p2p_profiles RENAME COLUMN servant_score TO service_score;

-- Backwards-compat: old RPC callers still work
CREATE OR REPLACE FUNCTION p2p_increment_servant_score(p_user_id uuid, p_amount integer DEFAULT 1)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE p2p_profiles SET service_score = service_score + p_amount WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION p2p_increment_service_score(p_user_id uuid, p_amount integer DEFAULT 1)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE p2p_profiles SET service_score = service_score + p_amount WHERE id = p_user_id;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EVALUATOR CREDIT: 5 service_score per resolved evaluation (was 10)
-- ─────────────────────────────────────────────────────────────────────────────
-- Core curriculum evaluations
CREATE OR REPLACE FUNCTION p2p_award_evaluation_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status IN ('approved', 'needs_revision')
     AND NEW.evaluator_id IS NOT NULL
     AND NOT COALESCE(NEW.self_approved, false)
  THEN
    UPDATE p2p_profiles
    SET service_score = service_score + 5,
        evaluations_completed = evaluations_completed + 1
    WHERE id = NEW.evaluator_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Plan evaluations — same amount
CREATE OR REPLACE FUNCTION p2p_award_plan_evaluation_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status IN ('approved', 'needs_revision')
     AND NEW.evaluator_id IS NOT NULL
     AND NOT COALESCE(NEW.self_approved, false)
  THEN
    UPDATE p2p_profiles
    SET service_score = service_score + 5,
        evaluations_completed = evaluations_completed + 1
    WHERE id = NEW.evaluator_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Wire the plan trigger (core trigger already attached from migration 007/008)
DROP TRIGGER IF EXISTS trg_award_plan_evaluation_credit ON p2p_plan_lesson_evaluations;
CREATE TRIGGER trg_award_plan_evaluation_credit
  AFTER UPDATE ON p2p_plan_lesson_evaluations
  FOR EACH ROW EXECUTE FUNCTION p2p_award_plan_evaluation_credit();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WISDOM POINTS ON CORE LESSON APPROVAL (+10)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_award_wisdom_on_core_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status = 'approved'
     AND NEW.submitter_id IS NOT NULL
  THEN
    UPDATE p2p_profiles
    SET wisdom_points = wisdom_points + 10
    WHERE id = NEW.submitter_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_wisdom_core ON p2p_lesson_evaluations;
CREATE TRIGGER trg_award_wisdom_core
  AFTER UPDATE ON p2p_lesson_evaluations
  FOR EACH ROW EXECUTE FUNCTION p2p_award_wisdom_on_core_approval();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. WISDOM POINTS ON PLAN LESSON APPROVAL (+15)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_award_wisdom_on_plan_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status = 'approved'
     AND NEW.submitter_id IS NOT NULL
  THEN
    UPDATE p2p_profiles
    SET wisdom_points = wisdom_points + 15
    WHERE id = NEW.submitter_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_wisdom_plan ON p2p_plan_lesson_evaluations;
CREATE TRIGGER trg_award_wisdom_plan
  AFTER UPDATE ON p2p_plan_lesson_evaluations
  FOR EACH ROW EXECUTE FUNCTION p2p_award_wisdom_on_plan_approval();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WISDOM POINTS ON PLAN REFLECTION SUBMISSION (+5, instant — no eval gate)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_award_wisdom_on_reflection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only award once per question per user (first submission only)
  IF NOT EXISTS (
    SELECT 1 FROM p2p_plan_reflection_submissions
    WHERE user_id = NEW.user_id
      AND question_id = NEW.question_id
      AND id != NEW.id
  ) THEN
    UPDATE p2p_profiles
    SET wisdom_points = wisdom_points + 5
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_wisdom_reflection ON p2p_plan_reflection_submissions;
CREATE TRIGGER trg_award_wisdom_reflection
  AFTER INSERT ON p2p_plan_reflection_submissions
  FOR EACH ROW EXECUTE FUNCTION p2p_award_wisdom_on_reflection();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GROWTH LEVEL: use wisdom_points as primary growth currency
--    Update the check_growth_events function to include wisdom_points.
--    The formula adds floor(wisdom_points / 10) to growth score.
--    (Adjust thresholds as needed after reviewing stage unlock values.)
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Review the existing p2p_check_growth_events / p2p_calculate_growth_points
-- function and ensure it reads from wisdom_points (not servant_score / service_score).
-- Example replacement snippet — adapt to match your current function body:
--
-- CREATE OR REPLACE FUNCTION p2p_calculate_growth_points(p_user_id uuid)
-- RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
--   SELECT COALESCE(wisdom_points, 0)
--   FROM p2p_profiles WHERE id = p_user_id;
-- $$;
--
-- Also update any growth event triggers that reference servant_score:
--   servant_score → service_score


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. REASSIGNMENT NOTIFICATIONS
--    Adds notifications to p2p_reassign_stale_evaluations so both the original
--    evaluator (no credit) and new evaluator (assigned) are informed.
-- ─────────────────────────────────────────────────────────────────────────────
-- The core reassignment loop already exists (from migration 007).
-- Apply this patch: after each UPDATE to p2p_lesson_evaluations in the loop,
-- insert two notifications:

-- Notify original evaluator — zero credit, informational only
-- INSERT INTO p2p_notifications(user_id, type, title, body, data)
-- VALUES (
--   stale.old_evaluator_id,
--   'evaluation_reassigned',
--   'Evaluation reassigned',
--   'A peer evaluation you were assigned has been passed to another peer because it was not completed within 72 hours. No service credit is awarded for this instance — but your overall score is unchanged.',
--   jsonb_build_object('evaluation_id', stale.id, 'lesson_id', stale.lesson_id)
-- );

-- Notify new evaluator — standard assignment notice
-- INSERT INTO p2p_notifications(user_id, type, title, body, data)
-- VALUES (
--   new_evaluator_id,
--   'evaluation_assigned',
--   'New peer evaluation assigned to you',
--   'A fellow disciple has submitted an assignment for your review.',
--   jsonb_build_object('evaluation_id', stale.id, 'lesson_id', stale.lesson_id)
-- );

-- Full replacement of p2p_reassign_stale_evaluations (uncomment and adapt
-- once you confirm the existing body in migration 007):
--
-- CREATE OR REPLACE FUNCTION p2p_reassign_stale_evaluations()
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
-- DECLARE
--   stale RECORD;
--   new_evaluator_id uuid;
-- BEGIN
--   FOR stale IN
--     SELECT e.id,
--            e.evaluator_id AS old_evaluator_id,
--            e.lesson_id,
--            e.submitter_id
--     FROM p2p_lesson_evaluations e
--     WHERE e.status = 'pending'
--       AND e.assigned_at < now() - interval '72 hours'
--   LOOP
--     SELECT p2p_pick_evaluator(stale.lesson_id, stale.submitter_id, stale.old_evaluator_id)
--       INTO new_evaluator_id;
--     IF new_evaluator_id IS NOT NULL THEN
--       INSERT INTO p2p_evaluation_reassignments(evaluation_id, from_evaluator_id, to_evaluator_id, reassigned_at)
--         VALUES (stale.id, stale.old_evaluator_id, new_evaluator_id, now())
--         ON CONFLICT DO NOTHING;
--       UPDATE p2p_lesson_evaluations
--         SET evaluator_id = new_evaluator_id,
--             assigned_at  = now(),
--             reassigned_from = stale.old_evaluator_id
--         WHERE id = stale.id;
--       -- Zero-credit notice to original evaluator
--       INSERT INTO p2p_notifications(user_id, type, title, body, data) VALUES (
--         stale.old_evaluator_id, 'evaluation_reassigned',
--         'Evaluation reassigned',
--         'A peer evaluation you were assigned has been passed to another peer (72 h timeout). No service credit is awarded for this instance — your existing balance is unchanged.',
--         jsonb_build_object('evaluation_id', stale.id, 'lesson_id', stale.lesson_id)
--       );
--       -- Assignment notice to new evaluator
--       INSERT INTO p2p_notifications(user_id, type, title, body, data) VALUES (
--         new_evaluator_id, 'evaluation_assigned',
--         'New peer evaluation assigned to you',
--         'A fellow disciple has submitted an assignment for your review.',
--         jsonb_build_object('evaluation_id', stale.id, 'lesson_id', stale.lesson_id)
--       );
--     END IF;
--   END LOOP;
-- END;
-- $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run after applying migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'p2p_profiles' AND column_name IN ('service_score','wisdom_points');
--
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
--   WHERE trigger_name IN (
--     'trg_award_wisdom_core','trg_award_wisdom_plan',
--     'trg_award_wisdom_reflection','trg_award_plan_evaluation_credit'
--   );
