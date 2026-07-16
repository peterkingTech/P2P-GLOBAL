-- ── Plans evaluation system: two fixes ────────────────────────────────────────
--
-- Confirmed via direct comparison against the live database (not assumed from
-- the migration file alone) that p2p_plan_pick_evaluator() and
-- p2p_plan_assign_evaluator_on_submission() are live, unmodified, and already
-- correctly scope evaluator eligibility to the SAME lesson_id (not a broader
-- "completed anything" pool) and already have the first-person-through
-- self-approval fallback, mirroring core curriculum exactly. No changes
-- needed there — this migration only covers the two real gaps found:
--
-- 1. Plan reflection questions have NO submission mechanism at all today —
--    the lesson screen only displays the question text (no input, no submit,
--    no storage table). Given how sensitive Plans topics are (Addiction
--    Recovery, Purity and Lust, Grief and Loss, etc.), this needs to be
--    private, personal-processing content — never peer-evaluated. Adding a
--    dedicated table with no evaluation gate/trigger at all, matching the
--    "separate tables, no coupling" philosophy migration 018 already set for
--    this schema.
--
-- 2. Plan assignment evaluations notify the EVALUATOR (p2p_plan_notify_evaluator,
--    confirmed live) but never notified the SUBMITTER when resolved — the
--    exact same gap fixed for core curriculum in migration 025. Same fix,
--    same pattern, applied to the Plans tables.

-- ── Private reflection submissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_plan_reflection_submissions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id uuid NOT NULL REFERENCES p2p_plan_reflection_questions(id) ON DELETE CASCADE,
  lesson_id   uuid NOT NULL REFERENCES p2p_plan_lessons(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES p2p_profiles(id) ON DELETE CASCADE,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p2p_plan_reflection_sub_user   ON p2p_plan_reflection_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_plan_reflection_sub_lesson ON p2p_plan_reflection_submissions(lesson_id);

ALTER TABLE p2p_plan_reflection_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own plan reflection submissions" ON p2p_plan_reflection_submissions;
CREATE POLICY "Users can view own plan reflection submissions" ON p2p_plan_reflection_submissions
  FOR SELECT USING (auth.uid() = user_id OR p2p_is_admin());

DROP POLICY IF EXISTS "Users can insert own plan reflection submissions" ON p2p_plan_reflection_submissions;
CREATE POLICY "Users can insert own plan reflection submissions" ON p2p_plan_reflection_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Deliberately no evaluator-visibility policy and no INSERT/UPDATE trigger of
-- any kind here — that absence IS the fix. No one but the submitter (and
-- admins, for moderation/support parity with every other content table) can
-- ever see this content, and nothing ever assigns an evaluator to it.
DROP POLICY IF EXISTS "Admins manage plan reflection submissions" ON p2p_plan_reflection_submissions;
CREATE POLICY "Admins manage plan reflection submissions" ON p2p_plan_reflection_submissions
  FOR ALL USING (p2p_is_admin()) WITH CHECK (p2p_is_admin());

-- ── Notify the SUBMITTER when their Plan evaluation resolves ─────────────────
-- Exact mirror of p2p_notify_submitter_on_resolution (025), on the Plans table.
CREATE OR REPLACE FUNCTION p2p_plan_notify_submitter_on_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF old.status = 'pending' AND new.status IN ('approved', 'needs_revision') THEN
    INSERT INTO p2p_notifications (user_id, title, message)
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
      END
    );
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_plan_notify_submitter_on_resolution ON p2p_plan_lesson_evaluations;
CREATE TRIGGER trg_p2p_plan_notify_submitter_on_resolution
  AFTER UPDATE OF status ON p2p_plan_lesson_evaluations
  FOR EACH ROW EXECUTE FUNCTION p2p_plan_notify_submitter_on_resolution();
