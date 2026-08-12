-- Plan Category Management admin features:
--   manually_unlocked  — admin override that keeps a plan unlocked regardless
--                        of the sequential lock chain (see resolveLockStatus
--                        in curriculum.ts, which must check this first).
--   is_visible         — hidden categories/plans still exist and are editable
--                        in admin, just excluded from user-facing queries.
--   is_featured_in_category — at most one plan per category should have this
--                        set; enforced in application code, not a DB constraint,
--                        consistent with how is_featured (plan-level) already works.
--   admin_notes        — internal-only, never returned by user-facing endpoints.
--   icon               — single emoji, used on both plan_category rows (the
--                        category's icon) and, optionally, individual plans.

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS manually_unlocked boolean DEFAULT false;

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true;

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS is_featured_in_category boolean DEFAULT false;

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS admin_notes text;

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS icon text;