-- 202: a Family Gathering can be about a family's own (custom) lesson.
--
-- Migration 129 let a Gathering reference one central lesson
-- (p2p_family_worship_sessions.lesson_id -> p2p_lessons; P2P Plans are
-- curricula of type 'plan', so their lessons already fit there). A family's
-- own lessons live in p2p_family_study_lessons, so they need their own
-- reference. Only the reference is stored — never lesson text or Bible text.
--
--   1. p2p_family_worship_sessions.family_lesson_id — set by the Guide
--      during a live Gathering (same Guide-only rule as lesson_id; the API
--      checks the lesson belongs to this family and is published).
--   2. p2p_family_worship_history.family_lesson_id — snapshot at session end.
--   3. A Gathering is about at most one lesson: not both kinds at once.
--
-- Additive only. Existing rows keep family_lesson_id null, so the check
-- holds for every existing row. No RLS change: both tables' existing
-- family-scoped read policies already cover every column of the row, and
-- clients never write these tables directly.

alter table public.p2p_family_worship_sessions
  add column if not exists family_lesson_id uuid references public.p2p_family_study_lessons(id) on delete set null;

alter table public.p2p_family_worship_history
  add column if not exists family_lesson_id uuid references public.p2p_family_study_lessons(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_family_worship_sessions_one_lesson_check') then
    alter table public.p2p_family_worship_sessions
      add constraint p2p_family_worship_sessions_one_lesson_check check (lesson_id is null or family_lesson_id is null);
  end if;
end $$;

create index if not exists p2p_family_worship_history_family_lesson_idx
  on public.p2p_family_worship_history (family_lesson_id) where family_lesson_id is not null;
