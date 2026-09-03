-- Simplify to exactly three stand-alone top-level curriculum categories:
-- Peer-to-Peer Orientation, The Gospel & Salvation, The Christian Foundation.
--
-- No new tables/columns. p2p_curriculums already has cover_image/icon/
-- color_theme (used by the existing Kingdom School Plans admin editor,
-- extended in this same pass to also work for type='core' curricula rather
-- than building a second image system).
--
-- Peer-to-Peer Orientation and The Gospel & Salvation already exist as
-- their own real, published, populated curricula (migration 106) and are
-- untouched here.
--
-- The Christian Foundation is created by RENAMING the existing "Foundations
-- of Christianity" curriculum in place (same row, same id, same 11 modules
-- already attached via curriculum_id — zero lesson/progress/module changes)
-- and reparenting the "Your New Identity in Christ" module back onto it
-- from its temporary standalone "Identity in Christ" curriculum (migration
-- 106). That module's own order_index (1) was never changed by 106, so
-- reparenting it back needs no reordering: it already sorts before the
-- remaining modules' order_index values (2-12).
--
-- This is a pure reclassification: no p2p_modules row is deleted, no
-- p2p_lessons/p2p_lesson_sections/p2p_scriptures/p2p_reflection_questions
-- row is touched, and p2p_lesson_progress (keyed by lesson_id, not
-- curriculum_id) is completely unaffected.

update public.p2p_curriculums
set
  title = 'The Christian Foundation',
  description = 'Grow deeper in your faith through biblical truth — your identity in Christ, the Bible, prayer, the Holy Spirit, spiritual growth, discipleship, relationships, Kingdom living, and living with eternity in view.',
  display_order = 2
where id = '30ff038a-0bde-4a2b-a16e-de986159fdab'; -- was "Foundations of Christianity"

update public.p2p_modules
set curriculum_id = '30ff038a-0bde-4a2b-a16e-de986159fdab' -- The Christian Foundation
where id = 'd4c4ee76-7fb2-49ff-982b-35b56acbca8a'; -- "Module 1: YOUR NEW IDENTITY IN CHRIST"

-- The now-empty "Identity in Christ" standalone curriculum row (0 modules
-- remaining) is a leftover artifact of migration 106's now-superseded
-- structure, not real content -- safe to remove since nothing references
-- it anymore (its one module was just reparented above, no lessons or
-- progress rows reference a curriculum_id directly).
delete from public.p2p_curriculums
where id = '20718622-2318-4353-a520-5750780c9044' -- "Identity in Christ"
  and not exists (select 1 from public.p2p_modules where curriculum_id = '20718622-2318-4353-a520-5750780c9044');

-- Keep The Gospel & Salvation and Peer-to-Peer Orientation's own
-- display_order stable relative to the renamed Christian Foundation.
update public.p2p_curriculums set display_order = 0 where id = '74acfe9c-9d4a-4507-b5c1-6672b37132ca'; -- Peer-to-Peer Orientation
update public.p2p_curriculums set display_order = 1 where id = 'f6a2b3f6-b66d-45d6-8065-c46d7b63441b'; -- The Gospel & Salvation