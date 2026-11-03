-- 227 (approved by the owner 2026-11-03; restore-tested, applied with the guarded
-- production procedure): Scripture Listening Library — data foundation.
--
-- Builds on what exists instead of a parallel system:
--   • Playlists and collections stay in p2p_scripture_collections (220): + cover
--     and tags. Each item keeps its own reference (translation, book, chapter,
--     verses); a passage's identity IS that reference, so one Scripture in
--     several playlists is the same small reference, never a copied record.
--   • Saved Scriptures stay in p2p_bible_bookmarks (207): + personal title,
--     tags, memorisation status, updated_at. Existing saved passages are
--     untouched (new columns are empty / default).
--   • New, owner-only: favourites (passages, playlists, collections), listening
--     history (one row per passage listened, never per progress tick) and
--     per-person resume state for each playlist or collection.
--
-- References only — never Bible text or audio (licensed content stays with the
-- providers). Private by design: favourites, history, resume state, titles,
-- tags and memorisation belong to their owner alone; sharing a playlist never
-- exposes any of them, and leaders can't read them.
-- Access: the three new tables follow 220 — RLS on, NO client policies, no
-- client grants; every read and write goes through the API (service role),
-- which checks the caller's token and their access to any collection named.
-- Additive only: no table is dropped or renamed, no existing row changes.

begin;

-- ── Playlists / collections: cover and tags ────────────────────────────────
alter table public.p2p_scripture_collections
  add column if not exists cover_kind text
    constraint p2p_scripture_collections_cover_kind_check check (cover_kind is null or cover_kind in ('artwork', 'colour', 'image')),
  add column if not exists cover_ref text
    constraint p2p_scripture_collections_cover_ref_check check (cover_ref is null or char_length(cover_ref) between 1 and 200),
  add column if not exists tags text[] not null default '{}'
    constraint p2p_scripture_collections_tags_check check (cardinality(tags) <= 20);

-- ── Saved Scriptures (p2p_bible_bookmarks): personal details ────────────────
alter table public.p2p_bible_bookmarks
  add column if not exists title text
    constraint p2p_bible_bookmarks_title_check check (title is null or char_length(btrim(title)) between 1 and 120),
  add column if not exists tags text[] not null default '{}'
    constraint p2p_bible_bookmarks_tags_check check (cardinality(tags) <= 20),
  add column if not exists memorisation_status text
    constraint p2p_bible_bookmarks_memorisation_check check (memorisation_status is null or memorisation_status in ('to_learn', 'practising', 'memorised')),
  add column if not exists updated_at timestamptz not null default now();

-- ── Favourites: a passage (by reference) OR a playlist/collection ───────────
create table if not exists public.p2p_scripture_favourites (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.p2p_profiles(id) on delete cascade,
  collection_id     uuid references public.p2p_scripture_collections(id) on delete cascade,
  translation_code  text,
  book_code         text check (book_code is null or book_code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  chapter           integer check (chapter is null or chapter between 1 and 150),
  start_verse       integer check (start_verse is null or start_verse >= 1),
  end_verse         integer,
  created_at        timestamptz not null default now(),
  -- Exactly one of: a collection, or a complete passage reference.
  constraint p2p_scripture_favourites_target check (
    (collection_id is not null and translation_code is null and book_code is null and chapter is null and start_verse is null and end_verse is null)
    or (collection_id is null and translation_code is not null and book_code is not null and chapter is not null and start_verse is not null and end_verse is not null
        and end_verse >= start_verse and end_verse - start_verse <= 199))
);
create unique index if not exists p2p_scripture_favourites_one_collection on public.p2p_scripture_favourites (user_id, collection_id) where collection_id is not null;
create unique index if not exists p2p_scripture_favourites_one_passage on public.p2p_scripture_favourites (user_id, translation_code, book_code, chapter, start_verse, end_verse) where collection_id is null;
create index if not exists p2p_scripture_favourites_user_idx on public.p2p_scripture_favourites (user_id, created_at desc);

-- ── Listening history: one row per passage listened ─────────────────────────
create table if not exists public.p2p_scripture_listening_history (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.p2p_profiles(id) on delete cascade,
  -- The playlist/collection it was played from (kept as history if that is deleted later).
  collection_id     uuid references public.p2p_scripture_collections(id) on delete set null,
  item_id           uuid references public.p2p_scripture_collection_items(id) on delete set null,
  translation_code  text not null,
  book_code         text not null check (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  chapter           integer not null check (chapter between 1 and 150),
  start_verse       integer not null check (start_verse >= 1),
  end_verse         integer not null,
  source            text not null default 'library' check (source in ('playlist', 'collection', 'bible', 'search', 'library')),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  listened_seconds  integer check (listened_seconds is null or listened_seconds between 0 and 86400),
  constraint p2p_scripture_listening_history_range check (end_verse >= start_verse and end_verse - start_verse <= 199),
  constraint p2p_scripture_listening_history_order check (completed_at is null or completed_at >= started_at)
);
create index if not exists p2p_scripture_listening_history_user_idx on public.p2p_scripture_listening_history (user_id, started_at desc);

-- ── Resume: where this person is in each playlist / collection ──────────────
create table if not exists public.p2p_scripture_listening_state (
  user_id        uuid not null references public.p2p_profiles(id) on delete cascade,
  collection_id  uuid not null references public.p2p_scripture_collections(id) on delete cascade,
  item_id        uuid references public.p2p_scripture_collection_items(id) on delete set null,
  part_key       text check (part_key is null or char_length(part_key) <= 200),
  part_offset    integer not null default 0 check (part_offset between 0 and 100000),
  -- The listening order in use (a shuffled order is kept here; the saved playlist order never changes).
  queue          uuid[] not null default '{}' check (cardinality(queue) <= 200),
  shuffle        boolean not null default false,
  repeat_mode    text not null default 'off' check (repeat_mode in ('off', 'one', 'all')),
  rate           numeric(3, 2) not null default 1 check (rate in (0.75, 1, 1.25, 1.5)),
  updated_at     timestamptz not null default now(),
  primary key (user_id, collection_id)
);
create index if not exists p2p_scripture_listening_state_user_idx on public.p2p_scripture_listening_state (user_id, updated_at desc);

-- No client access at all: the API (service role) is the only way in.
alter table public.p2p_scripture_favourites enable row level security;
alter table public.p2p_scripture_listening_history enable row level security;
alter table public.p2p_scripture_listening_state enable row level security;
revoke all on public.p2p_scripture_favourites, public.p2p_scripture_listening_history, public.p2p_scripture_listening_state from anon, authenticated;
grant all on public.p2p_scripture_favourites, public.p2p_scripture_listening_history, public.p2p_scripture_listening_state to service_role;

commit;

-- Rollback (removes favourites, listening history and resume positions; saved
-- passages, playlists and collections themselves are untouched):
--   drop table if exists public.p2p_scripture_listening_state, public.p2p_scripture_listening_history, public.p2p_scripture_favourites;
--   alter table public.p2p_bible_bookmarks drop column if exists title, drop column if exists tags,
--     drop column if exists memorisation_status, drop column if exists updated_at;
--   alter table public.p2p_scripture_collections drop column if exists cover_kind, drop column if exists cover_ref, drop column if exists tags;
