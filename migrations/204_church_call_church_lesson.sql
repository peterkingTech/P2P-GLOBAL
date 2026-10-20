-- 204: a Church Gathering (church call) can be about the church's own lesson.
--
-- p2p_church_calls.lesson_id (Stage 4) references a central lesson
-- (p2p_lessons — Core Foundation and P2P Plans). A church's own lessons live
-- in p2p_church_study_lessons, so they need their own reference — the same
-- shape migration 202 added for Family Gatherings. Only the reference is
-- stored, never lesson or Bible text. The church call row is its own
-- permanent record (no separate history table), so one column is enough.
--
-- The API checks the lesson belongs to the call's church and is published,
-- and only the host or a church pastor may set it (existing rule).
-- Additive only; existing rows keep church_lesson_id null. No RLS change:
-- clients never write church calls directly.

alter table public.p2p_church_calls
  add column if not exists church_lesson_id uuid references public.p2p_church_study_lessons(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_church_calls_one_lesson_check') then
    alter table public.p2p_church_calls
      add constraint p2p_church_calls_one_lesson_check check (lesson_id is null or church_lesson_id is null);
  end if;
end $$;

create index if not exists p2p_church_calls_church_lesson_idx
  on public.p2p_church_calls (church_lesson_id) where church_lesson_id is not null;

-- Rollback:
--   alter table public.p2p_church_calls drop constraint if exists p2p_church_calls_one_lesson_check;
--   drop index if exists public.p2p_church_calls_church_lesson_idx;
--   alter table public.p2p_church_calls drop column if exists church_lesson_id;
