-- ── Notify the SUBMITTER when their own evaluation resolves ──────────────────
-- p2p_notify_evaluator() (007/008) already notifies the EVALUATOR on
-- assignment/reassignment — confirmed still live. There was never a matching
-- notification back to the submitter when the evaluator actually resolves it,
-- which is the real UX gap: a learner submits, then has no way to know their
-- work was looked at unless they manually reopen the lesson.
--
-- Same firing condition as p2p_award_evaluation_credit (pending -> approved
-- or needs_revision), so credit and notification always happen together.
-- Deliberately does NOT fire on the self-approval INSERT path (first learner
-- through a lesson) — that resolves synchronously as part of the learner's
-- own submit action, so there's nothing to "notify" them about after the
-- fact; they already know the outcome from the same request.
CREATE OR REPLACE FUNCTION p2p_notify_submitter_on_resolution()
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

DROP TRIGGER IF EXISTS trg_notify_submitter_on_resolution ON p2p_lesson_evaluations;
CREATE TRIGGER trg_notify_submitter_on_resolution
  AFTER UPDATE OF status ON p2p_lesson_evaluations
  FOR EACH ROW EXECUTE FUNCTION p2p_notify_submitter_on_resolution();
