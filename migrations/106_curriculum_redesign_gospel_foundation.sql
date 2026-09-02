-- Curriculum redesign: multiple stand-alone curricula instead of one single
-- "Core Curriculum." No new tables/columns -- p2p_curriculums already
-- supports being a flat list of top-level, independent rows (type='core');
-- the only thing that made "Foundations of Christianity" behave like the
-- single curriculum was DataContext.tsx's client-side "pick the curriculum
-- with the most modules" logic, which this pass's mobile changes replace
-- with genuine multi-curriculum browsing.
--
-- NOTE ON APPLICATION METHOD: the direct Postgres connection (port 6543)
-- was unreachable when this migration was authored (transient pooler
-- outage, confirmed via `curl` still reaching the REST API on the same
-- project). The data changes below were applied live via PostgREST using
-- the service-role key (which bypasses RLS the same way this connection
-- would). This file is the record of exactly what was executed, in SQL
-- form, for migration history and for anyone re-provisioning a fresh
-- database via the migrations/ pipeline.
--
-- Scope of this pass (deliberately conservative -- see the session's
-- product decision): only two existing modules with an unambiguous,
-- explicitly-named match are reclassified into their own stand-alone
-- curricula. "Foundations of Christianity"'s other 11 modules (Knowing
-- God, Lordship of Jesus Christ, Holy Spirit and You, The Bible, Prayer,
-- The Church, Water Baptism, The Christian and Sin, Sharing Your Faith,
-- Spiritual Disciplines, Living With Eternity in View) are NOT
-- redistributed into the new named categories in this pass -- several of
-- them clearly could be (The Bible, Prayer, The Holy Spirit, Church &
-- Community all have an obvious match), but that redistribution was not
-- explicitly requested and deserves its own dedicated, deliberate pass
-- rather than being bundled in here. Foundations of Christianity remains a
-- real, valid, unmodified curriculum with those 11 modules intact.

-- ── 1. Peer-to-Peer Orientation becomes its own stand-alone curriculum ──
insert into public.p2p_curriculums (title, description, type, status, display_order, is_visible, color_theme)
values (
  'Peer-to-Peer Orientation',
  'Learn how P2P Global works, how Peer Guides and discipleship relationships function, how Study Together works, and how to begin your journey on the platform.',
  'core', 'published', 0, true, '#1D9E75'
)
on conflict do nothing;

update public.p2p_modules
set curriculum_id = (select id from public.p2p_curriculums where title = 'Peer-to-Peer Orientation')
where id = '5795decd-2e97-4fc6-a221-8c44325197ce'; -- "Module 0: PEER-TO-PEER ORIENTATION"

-- ── 2. Your New Identity in Christ becomes its own stand-alone curriculum ─
insert into public.p2p_curriculums (title, description, type, status, display_order, is_visible, color_theme)
values (
  'Identity in Christ',
  'Discover who you are because of your relationship with Christ — regeneration, justification, adoption, grace, faith, and the new creation you now are.',
  'core', 'published', 1, true, '#1D9E75'
)
on conflict do nothing;

update public.p2p_modules
set curriculum_id = (select id from public.p2p_curriculums where title = 'Identity in Christ')
where id = 'd4c4ee76-7fb2-49ff-982b-35b56acbca8a'; -- "Module 1: YOUR NEW IDENTITY IN CHRIST"

-- ── 3. The Gospel & Salvation — new stand-alone curriculum, content is the
--       full, verbatim import of "The Gospel Foundation" PDF's four
--       modules. The complete data (module/lesson titles, memory verses,
--       every teaching section, prayer, assignment, and reflection
--       question, all copied verbatim from the source PDF) lives in
--       lib/db/gospel_curriculum_data.mjs, executed by
--       lib/db/import_curriculum_redesign.mjs. That script is idempotent
--       (checks for an existing "The Gospel & Salvation" row by title
--       before inserting anything), so it is safe to re-run against a
--       fresh database that hasn't had this content yet.
--
-- Structure created: 1 curriculum, 4 modules, 17 lessons, 68 teaching
-- sections + 17 prayer sections + 17 assignment sections (102 total
-- p2p_lesson_sections rows), 17 p2p_scriptures rows (one memory verse per
-- lesson), 51 p2p_reflection_questions rows (three per lesson) — all
-- verified via an automated QC pass (158/158 checks) confirming correct
-- module/lesson counts, sequential order_index values, no empty content,
-- no duplicate curriculum titles, and that both reclassified modules kept
-- all of their original lessons.
--
-- Run: node lib/db/import_curriculum_redesign.mjs (from lib/db, with
-- artifacts/api-server/.env populated) to apply this section.
