-- 253 — Study workspace: Scripture emphasis (editorial), Deep Study History, playlist "read" marks.
-- Written 2026-11-18. APPLIED TO PRODUCTION 2026-11-18 (owner approval; guarded apply: in-transaction checks + postcheck PASS).
-- ADDITIVE ONLY: three new tables; no existing row, column or policy changes.
--
--   p2p_scripture_emphasis         editorial references for the emphasis categories that NO Bible source marks
--                                  (Holy Spirit, God the Father, commands, promises, prophecy, prayer & worship).
--                                  Words of Jesus are NOT stored here: they come from each translation's own
--                                  red-letter markup (lib/bibleProviders/helloao.ts). Four eyes: a reference is
--                                  shown to participants only when PUBLISHED (approved by a second editor).
--   p2p_deep_studies               a participant's own Deep Study / My Plan studies (Deep Study History):
--                                  title, the search or passage, the chosen resources, findings, notes, folder.
--                                  PERSONAL: only the owner, never counted as lessons, evaluations or growth.
--                                  client_key makes an offline-created study sync exactly once.
--   p2p_scripture_collection_reads a participant's own "read" mark on a playlist passage (playlists can be
--                                  shared, so the mark is per person and never changes the playlist).
--
-- Security: API-only (RLS on, no client policies, no anon/authenticated grants), like 249 and 251.
-- Rollback: drop the three tables.

begin;

create table if not exists public.p2p_scripture_emphasis (
  id               uuid primary key default gen_random_uuid(),
  category         text not null check (category in ('holy_spirit', 'father', 'commands', 'promises', 'prophecy', 'prayer_worship')),
  book_code        text not null check (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  chapter          integer not null check (chapter between 1 and 150),
  start_verse      integer not null check (start_verse between 1 and 200),
  end_verse        integer not null check (end_verse between 1 and 200),
  -- Why this passage belongs to the category (shown in the legend's detail), and the editor's source.
  note             text check (note is null or char_length(note) <= 500),
  source           text check (source is null or char_length(source) <= 300),
  editorial_status text not null default 'draft' check (editorial_status in ('draft', 'under_review', 'approved', 'published', 'archived')),
  created_by       uuid references public.p2p_profiles(id) on delete set null,
  submitted_by     uuid references public.p2p_profiles(id) on delete set null,
  reviewed_by      uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint p2p_scripture_emphasis_range check (end_verse >= start_verse),
  constraint p2p_scripture_emphasis_once unique (category, book_code, chapter, start_verse, end_verse),
  constraint p2p_scripture_emphasis_four_eyes check (editorial_status not in ('approved', 'published')
    or (reviewed_by is not null and submitted_by is not null and reviewed_by <> submitted_by)),
  constraint p2p_scripture_emphasis_published_at check (editorial_status <> 'published' or published_at is not null)
);
create index if not exists p2p_scripture_emphasis_chapter_idx on public.p2p_scripture_emphasis (book_code, chapter) where editorial_status = 'published';

create table if not exists public.p2p_deep_studies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.p2p_profiles(id) on delete cascade,
  kind           text not null default 'deep_study' check (kind in ('deep_study', 'my_plan', 'topic_study')),
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  -- What was studied: a search ({ q }), a passage ({ book, chapter, startVerse?, endVerse? }) or a subject.
  focus          jsonb not null default '{}'::jsonb check (jsonb_typeof(focus) = 'object'),
  -- The chosen resources, saved findings, temporary study highlights and where the person stopped.
  state          jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 200000),
  notes          text check (notes is null or char_length(notes) <= 20000),
  folder         text check (folder is null or char_length(folder) <= 80),
  client_key     text check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  -- Optimistic concurrency for offline sync: a change carries the version it was based on.
  version        integer not null default 1 check (version >= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index if not exists p2p_deep_studies_client_key on public.p2p_deep_studies (user_id, client_key) where client_key is not null;
create index if not exists p2p_deep_studies_user_idx on public.p2p_deep_studies (user_id, last_opened_at desc) where deleted_at is null;

create table if not exists public.p2p_scripture_collection_reads (
  item_id    uuid not null references public.p2p_scripture_collection_items(id) on delete cascade,
  user_id    uuid not null references public.p2p_profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (item_id, user_id)
);

alter table public.p2p_scripture_emphasis enable row level security;
alter table public.p2p_deep_studies enable row level security;
alter table public.p2p_scripture_collection_reads enable row level security;
do $$ declare t text; begin
  foreach t in array array['p2p_scripture_emphasis', 'p2p_deep_studies', 'p2p_scripture_collection_reads'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant select, insert, update, delete on public.%I to service_role', t); end if;
  end loop;
end $$;

commit;
