-- Sequential plan locking within a category — a topic plan (type='plan') is
-- locked until the plan referenced by unlock_after_plan_id is completed (all
-- its lessons have p2p_lesson_progress.completed = true for the user). The
-- first plan in every category has unlock_after_plan_id = NULL, so it's
-- always unlocked. is_locked is the PDF-import-time default; actual
-- per-user lock state is computed at read time in curriculum.ts, not stored
-- per-user here.
--
-- prerequisite_plan_ids is kept for forward compatibility with plans that
-- might one day need more than one prerequisite, but the current locking
-- logic (curriculum.ts) only ever reads unlock_after_plan_id — a single
-- linear chain per category, matching what was actually specified.

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS unlock_after_plan_id uuid REFERENCES p2p_curriculums(id);

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS prerequisite_plan_ids jsonb DEFAULT '[]';
