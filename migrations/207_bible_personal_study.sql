-- 207: personal Bible study — highlights, notes and saved passages on Bible
-- passages (the new Bible reader).
--
-- Reuses the two existing personal tables rather than creating duplicates:
--   p2p_user_highlights (owner-only RLS; lesson highlights today)
--   p2p_user_notes      (owner-only RLS; personal notes today)
-- and adds one small table for saved passages, because the existing
-- p2p_saved_scriptures only points at curated prayer-library rows
-- (scripture_id NOT NULL), not arbitrary passages.
--
-- Only REFERENCES are stored — translation, USFM book code (GEN…REV),
-- chapter, verse range — never Bible text (licensed content stays with the
-- API.Bible pipeline). The translation is stored because verse numbering can
-- differ between translations: a highlight is shown only in the translation
-- it was made in, never silently re-attached to another.
--
-- Everything is private: the existing owner-only policies (auth.uid() =
-- user_id) cover the new columns; the new table gets the same policy. No
-- leader, family, church or admin access is added. Additive only.

-- ── Highlights ──────────────────────────────────────────────────────────────
alter table public.p2p_user_highlights
  add column if not exists translation_code text,
  add column if not exists book_code text,
  add column if not exists chapter integer,
  add column if not exists start_verse integer,
  add column if not exists end_verse integer,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_user_highlights_bible_ref_check') then
    alter table public.p2p_user_highlights add constraint p2p_user_highlights_bible_ref_check check (
      book_code is null
      or (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$' and translation_code is not null and chapter between 1 and 150
          and start_verse >= 1 and end_verse >= start_verse and end_verse - start_verse <= 199)
    );
  end if;
end $$;
create index if not exists idx_p2p_user_highlights_bible
  on public.p2p_user_highlights (user_id, translation_code, book_code, chapter) where book_code is not null;

-- ── Notes ───────────────────────────────────────────────────────────────────
alter table public.p2p_user_notes
  add column if not exists translation_code text,
  add column if not exists book_code text,
  add column if not exists chapter integer,
  add column if not exists start_verse integer,
  add column if not exists end_verse integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_user_notes_bible_ref_check') then
    alter table public.p2p_user_notes add constraint p2p_user_notes_bible_ref_check check (
      book_code is null
      or (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$' and translation_code is not null and chapter between 1 and 150
          and start_verse >= 1 and end_verse >= start_verse and end_verse - start_verse <= 199)
    );
  end if;
end $$;
create index if not exists idx_p2p_user_notes_bible
  on public.p2p_user_notes (user_id, book_code, chapter) where book_code is not null;

-- ── Saved passages ──────────────────────────────────────────────────────────
create table if not exists public.p2p_bible_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  translation_code text not null,
  book_code text not null check (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  chapter integer not null check (chapter between 1 and 150),
  start_verse integer not null check (start_verse >= 1),
  end_verse integer not null,
  created_at timestamptz not null default now(),
  constraint p2p_bible_bookmarks_range check (end_verse >= start_verse and end_verse - start_verse <= 199),
  constraint p2p_bible_bookmarks_unique unique (user_id, translation_code, book_code, chapter, start_verse, end_verse)
);
create index if not exists idx_p2p_bible_bookmarks_user on public.p2p_bible_bookmarks (user_id, created_at desc);

alter table public.p2p_bible_bookmarks enable row level security;
drop policy if exists p2p_bible_bookmarks_owner on public.p2p_bible_bookmarks;
create policy p2p_bible_bookmarks_owner on public.p2p_bible_bookmarks
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.p2p_bible_bookmarks from anon;
grant select, insert, update, delete on public.p2p_bible_bookmarks to authenticated;
grant all on public.p2p_bible_bookmarks to service_role;

-- Rollback (removes saved passages and the Bible-reference columns; lesson
-- highlights and plain notes are untouched):
--   drop table if exists public.p2p_bible_bookmarks;
--   alter table public.p2p_user_notes drop constraint if exists p2p_user_notes_bible_ref_check;
--   drop index if exists public.idx_p2p_user_notes_bible;
--   alter table public.p2p_user_notes drop column if exists translation_code, drop column if exists book_code, drop column if exists chapter, drop column if exists start_verse, drop column if exists end_verse;
--   alter table public.p2p_user_highlights drop constraint if exists p2p_user_highlights_bible_ref_check;
--   drop index if exists public.idx_p2p_user_highlights_bible;
--   alter table public.p2p_user_highlights drop column if exists translation_code, drop column if exists book_code, drop column if exists chapter, drop column if exists start_verse, drop column if exists end_verse, drop column if exists updated_at;
