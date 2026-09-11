-- 129: Family Gathering Discipleship Continuity — Stage 2.
--
-- Connects completed Gatherings to the app's ALREADY-EXISTING curriculum
-- system (p2p_curriculums / p2p_modules / p2p_lessons / p2p_lesson_progress
-- — the "Kingdom School" tab) without creating any second curriculum,
-- lesson-progress, or completion system. Investigated first: there is no
-- existing concept of a family (as opposed to an individual) being
-- "enrolled" in a curriculum, and no existing lesson_id/curriculum_id
-- column anywhere on any family table — this migration adds exactly the
-- one link needed for a Gathering to reference a specific existing lesson,
-- nothing more.
--
--   1. p2p_family_worship_sessions.lesson_id — set explicitly by the Guide
--      during a live Gathering (same authorization tier as current_scripture:
--      Guide-only, mutable mid-session), mirroring the existing
--      current_scripture column exactly. Nullable — a prayer-focused or
--      fellowship Gathering simply has none, per the spec's explicit "must
--      not assume every Gathering continues the previous lesson."
--   2. p2p_family_worship_history.lesson_id — snapshot of the above at
--      session end, same snapshot pattern migration 128 already used for
--      guide_id/started_at/ended_at (the session row can disappear later;
--      the history row is the permanent record).
--   3. p2p_family_worship_history.continuity_notes — the Guide's optional,
--      manually-written "next time we should..." note. Deliberately a
--      separate field from guide_summary (migration 128): guide_summary
--      answers "what happened", continuity_notes answers "what's next" —
--      conflating them would make the Prepare-Next-Gathering view show a
--      backward-looking summary where a forward-looking note belongs.
--
-- No new tables. Family Journey / Scripture Journey / Prayer Journey /
-- Discipleship Journey / Continue Study are all computed on read from
-- these two new columns plus the already-existing
-- p2p_family_worship_session_events, p2p_family_prayer_requests, and
-- p2p_lessons/p2p_modules/p2p_curriculums tables — see familyWorship.ts.
--
-- Completion semantics are NOT changed by this migration: no code path
-- introduced by Stage 2 writes to p2p_lesson_progress automatically. A
-- Gathering being "about" a lesson never implies that lesson is complete;
-- only an explicit Guide action (existing markLessonComplete-equivalent
-- upsert, gated the same way the app already gates it) can do that.

alter table p2p_family_worship_sessions
  add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null;

alter table p2p_family_worship_history
  add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null,
  add column if not exists continuity_notes text;

-- No RLS changes needed — both tables' existing family-scoped SELECT
-- policies (migration 116, 128) already cover all columns on the row.
