-- 220: Scripture collections and listening playlists — private by default,
-- shareable with peers, Family Circles, Churches, Circles, Groups and Study
-- Together studies, with explicit permission levels, personal copies,
-- collaborative editing, an activity history and revocable sign-in links.
--
-- References only — translation, USFM book code, chapter, verse range —
-- never Bible text (licensed content stays with the API.Bible pipeline).
--
-- Privacy:
--   * Nothing here reads or links to anyone's private notes, highlights,
--     reflections or prayers (p2p_user_notes / p2p_user_highlights). The only
--     note that can travel with a passage is `shared_note`, which the
--     collection's owner writes deliberately for sharing.
--   * A collection is private until its owner shares it.
-- Access: RLS on with NO client policies (the Study Together pattern, 216).
-- Every read and write goes through the API (service role), which identifies
-- the caller from their token and checks ownership, live group membership,
-- blocks, child accounts, revocation and permission level on every request.
-- Additive only: new tables, nothing existing changes.

create table if not exists public.p2p_scripture_collections (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.p2p_profiles(id) on delete cascade,
  kind                  text not null default 'collection' check (kind in ('collection', 'playlist')),
  title                 text not null check (char_length(btrim(title)) between 1 and 120),
  description           text check (description is null or char_length(description) <= 500),
  -- A personal copy points at the collection it was copied from. The copy is
  -- independent: changes to the original never change it.
  origin_collection_id  uuid references public.p2p_scripture_collections(id) on delete set null,
  origin_owner_id       uuid references public.p2p_profiles(id) on delete set null,
  copied_at             timestamptz,
  -- Bumped by every content change; edits name the revision they started
  -- from, so a stale edit is refused instead of silently overwriting.
  revision              integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index if not exists p2p_scripture_collections_owner_idx on public.p2p_scripture_collections (owner_id, kind, updated_at desc) where deleted_at is null;
create index if not exists p2p_scripture_collections_origin_idx on public.p2p_scripture_collections (origin_collection_id) where origin_collection_id is not null;

create table if not exists public.p2p_scripture_collection_items (
  id                uuid primary key default gen_random_uuid(),
  collection_id     uuid not null references public.p2p_scripture_collections(id) on delete cascade,
  translation_code  text not null,
  book_code         text not null check (book_code ~ '^[1-3A-Z][A-Z0-9]{2}$'),
  chapter           integer not null check (chapter between 1 and 150),
  start_verse       integer not null check (start_verse >= 1),
  end_verse         integer not null,
  position          integer not null default 0,
  shared_note       text check (shared_note is null or char_length(shared_note) <= 1000),
  added_by          uuid references public.p2p_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint p2p_scripture_collection_items_range check (end_verse >= start_verse and end_verse - start_verse <= 199)
);
create index if not exists p2p_scripture_collection_items_order_idx on public.p2p_scripture_collection_items (collection_id, position);

create table if not exists public.p2p_scripture_collection_shares (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.p2p_scripture_collections(id) on delete cascade,
  target_type     text not null check (target_type in ('peer', 'family', 'church', 'circle', 'group', 'study')),
  -- The family / church / circle / group / shared-study id; null for a peer.
  target_id       uuid,
  -- The person, for a peer share (including people who joined by link).
  user_id         uuid references public.p2p_profiles(id) on delete cascade,
  permission      text not null check (permission in ('view', 'copy', 'collaborate')),
  can_reshare     boolean not null default false,
  shared_by       uuid references public.p2p_profiles(id) on delete set null,
  via_link_id     uuid,
  status          text not null default 'active' check (status in ('active', 'revoked')),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references public.p2p_profiles(id) on delete set null,
  check ((target_type = 'peer') = (user_id is not null and target_id is null)),
  check ((target_type = 'peer') or (target_id is not null))
);
create index if not exists p2p_scripture_collection_shares_coll_idx on public.p2p_scripture_collection_shares (collection_id, status);
create index if not exists p2p_scripture_collection_shares_user_idx on public.p2p_scripture_collection_shares (user_id, status) where user_id is not null;
create index if not exists p2p_scripture_collection_shares_target_idx on public.p2p_scripture_collection_shares (target_type, target_id, status) where target_id is not null;
-- One active share per collection and recipient (re-sharing updates it).
create unique index if not exists p2p_scripture_collection_shares_one_peer
  on public.p2p_scripture_collection_shares (collection_id, user_id) where status = 'active' and user_id is not null;
create unique index if not exists p2p_scripture_collection_shares_one_group
  on public.p2p_scripture_collection_shares (collection_id, target_type, target_id) where status = 'active' and target_id is not null;

-- Sign-in links. Only a SHA-256 fingerprint of the code is stored, so a
-- database leak never yields a working link. A link grants at most
-- "view" or "copy" — never collaborative editing.
create table if not exists public.p2p_scripture_collection_links (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.p2p_scripture_collections(id) on delete cascade,
  token_hash      text not null unique,
  permission      text not null default 'view' check (permission in ('view', 'copy')),
  max_uses        integer check (max_uses is null or max_uses between 1 and 1000),
  uses            integer not null default 0,
  expires_at      timestamptz,
  created_by      uuid references public.p2p_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists p2p_scripture_collection_links_coll_idx on public.p2p_scripture_collection_links (collection_id);

create table if not exists public.p2p_scripture_collection_activity (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.p2p_scripture_collections(id) on delete cascade,
  actor_id        uuid references public.p2p_profiles(id) on delete set null,
  action          text not null check (char_length(action) <= 40),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists p2p_scripture_collection_activity_idx on public.p2p_scripture_collection_activity (collection_id, created_at desc);

-- No client access at all: the API (service role) is the only way in.
alter table public.p2p_scripture_collections enable row level security;
alter table public.p2p_scripture_collection_items enable row level security;
alter table public.p2p_scripture_collection_shares enable row level security;
alter table public.p2p_scripture_collection_links enable row level security;
alter table public.p2p_scripture_collection_activity enable row level security;
revoke all on public.p2p_scripture_collections, public.p2p_scripture_collection_items, public.p2p_scripture_collection_shares,
  public.p2p_scripture_collection_links, public.p2p_scripture_collection_activity from anon, authenticated;
grant all on public.p2p_scripture_collections, public.p2p_scripture_collection_items, public.p2p_scripture_collection_shares,
  public.p2p_scripture_collection_links, public.p2p_scripture_collection_activity to service_role;

-- Rollback (removes collections, playlists, shares, links and their history;
-- saved passages, notes and highlights are untouched):
--   drop table if exists public.p2p_scripture_collection_activity, public.p2p_scripture_collection_links,
--     public.p2p_scripture_collection_shares, public.p2p_scripture_collection_items, public.p2p_scripture_collections;
