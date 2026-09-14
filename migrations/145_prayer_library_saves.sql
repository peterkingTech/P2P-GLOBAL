-- 145: "Pray the Word" Stage 5 — Personal Prayer Library (saved items).
--
-- Shape copied directly from the existing p2p_plan_saves precedent
-- (migration 042: id, user_id, {thing}_id, saved_at, unique(user_id,
-- thing_id), owner-only RLS) — not a new bookmark architecture, three
-- tables because there are three genuinely different "thing"s being
-- saved, each FK'd to its own real source-of-truth table. None of these
-- duplicate content: they store a reference id only.
--
-- "Saved Prayers" reuses the EXISTING p2p_prayer_library table (045) —
-- the curated prayer set — rather than inventing a way to "save" a
-- journal entry (a user's own journal entries are already always visible
-- to them; saving one's own private prayer back to itself would be
-- meaningless). "Answered Prayers" and "Recent" need no new table at all:
-- Answered Prayers reads p2p_prayer_journal directly (is_answered = true,
-- already the source of truth); Recent reads p2p_user_activity_events'
-- prayer_topic_viewed/prayer_scripture_viewed/prayer_path_started rows
-- (widened onto that table in 142) — both are pure read queries against
-- existing data, not copies.

create table if not exists p2p_saved_scriptures (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  scripture_id   uuid not null references p2p_scripture_references(id) on delete cascade,
  topic_id       uuid references p2p_prayer_topics(id) on delete set null,
  saved_at       timestamptz not null default now(),
  unique (user_id, scripture_id)
);
create index if not exists idx_p2p_saved_scriptures_user on p2p_saved_scriptures(user_id, saved_at desc);

create table if not exists p2p_saved_prayers (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  prayer_library_id  uuid not null references p2p_prayer_library(id) on delete cascade,
  saved_at           timestamptz not null default now(),
  unique (user_id, prayer_library_id)
);
create index if not exists idx_p2p_saved_prayers_user on p2p_saved_prayers(user_id, saved_at desc);

create table if not exists p2p_saved_prayer_paths (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  path_id      uuid not null references p2p_prayer_paths(id) on delete cascade,
  saved_at     timestamptz not null default now(),
  unique (user_id, path_id)
);
create index if not exists idx_p2p_saved_prayer_paths_user on p2p_saved_prayer_paths(user_id, saved_at desc);

alter table p2p_saved_scriptures enable row level security;
alter table p2p_saved_prayers enable row level security;
alter table p2p_saved_prayer_paths enable row level security;

drop policy if exists "Users manage their own saved scriptures" on p2p_saved_scriptures;
create policy "Users manage their own saved scriptures" on p2p_saved_scriptures
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own saved prayers" on p2p_saved_prayers;
create policy "Users manage their own saved prayers" on p2p_saved_prayers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own saved prayer paths" on p2p_saved_prayer_paths;
create policy "Users manage their own saved prayer paths" on p2p_saved_prayer_paths
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
