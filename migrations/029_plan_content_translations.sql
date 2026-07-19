-- 029: Extend p2p_content_translations to support Plans content, mirroring the
-- existing curriculum/module/lesson content_type values exactly.
--
-- 'plan'        -> p2p_plans (title, tagline->subtitle, overview->description)
-- 'plan_module' -> p2p_plan_modules (title only, matches "module" pattern)
-- 'plan_lesson' -> p2p_plan_lessons (title only, matches "lesson" pattern)
--
-- Only 'plan' is consumed by the app today (loadPlansV2() overlay). The
-- 'plan_module'/'plan_lesson' values are added now so the admin review queue
-- and future per-lesson overlay work can use the same table without another
-- constraint migration later.

ALTER TABLE p2p_content_translations
  DROP CONSTRAINT p2p_content_translations_content_type_check;

ALTER TABLE p2p_content_translations
  ADD CONSTRAINT p2p_content_translations_content_type_check
  CHECK (content_type = ANY (ARRAY[
    'curriculum','module','lesson','section','scripture','question',
    'assignment','quiz','devotional','journal',
    'plan','plan_module','plan_lesson'
  ]));
