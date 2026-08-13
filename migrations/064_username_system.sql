-- 064: @username identity system.
--
-- Deviations from the original spec, and why:
--   * No `is_public` column — p2p_profiles already has `profile_visibility`
--     ('public'|'peers'|'private', see AuthContext.tsx's UserProfile type).
--     Adding a second boolean would just be a second source of truth for the
--     same concept; the public-profile-by-username view treats
--     profile_visibility = 'public' as the "visible to anyone" case.
--   * No `bio` column added — it already exists.
--   * No `is_blocked_list` jsonb column on p2p_profiles — this migration
--     already creates a real p2p_user_blocks join table below; keeping both
--     would let them drift out of sync for no benefit.
--   * pg_trgm extension is created BEFORE the trigram index, not after —
--     CREATE INDEX ... USING gin (col gin_trgm_ops) fails outright if the
--     operator class doesn't exist yet, so the original ordering (index
--     first, extension second) would never have applied cleanly on a fresh
--     database. (It's already installed on this DB, confirmed live, but the
--     ordering is fixed regardless for correctness on any other environment.)
--   * p2p_connection_requests.circle_id references p2p_peer_circles(id) —
--     the spec left this column with no FK at all.

create extension if not exists pg_trgm;

alter table p2p_profiles
  add column if not exists username text,
  add column if not exists username_changed_at timestamptz,
  add column if not exists username_previous text,
  add column if not exists username_previous_held_until timestamptz,
  add column if not exists bio text,
  add column if not exists show_real_name_publicly boolean not null default true,
  add column if not exists show_progress_publicly boolean not null default true,
  add column if not exists username_change_required boolean not null default false;

create unique index if not exists idx_profiles_username_lower
  on p2p_profiles (lower(username));

create index if not exists idx_profiles_username_trgm
  on p2p_profiles using gin (username gin_trgm_ops);

create table if not exists p2p_reserved_usernames (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  reason text,
  reserved_by uuid references auth.users(id) on delete set null,
  reserved_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table if not exists p2p_username_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  old_username text,
  new_username text,
  changed_at timestamptz not null default now()
);
create index if not exists idx_p2p_username_history_user on p2p_username_history(user_id);

create table if not exists p2p_connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null, -- 'peer_guide' | 'connect' | 'circle_invite'
  circle_id uuid references p2p_peer_circles(id) on delete cascade,
  message text,
  status text not null default 'pending', -- 'pending' | 'accepted' | 'declined' | 'cancelled'
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(from_user_id, to_user_id, request_type)
);
create index if not exists idx_p2p_connection_requests_to on p2p_connection_requests(to_user_id, status);
create index if not exists idx_p2p_connection_requests_from on p2p_connection_requests(from_user_id);

create table if not exists p2p_user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id)
);
create index if not exists idx_p2p_user_blocks_blocker on p2p_user_blocks(blocker_id);
create index if not exists idx_p2p_user_blocks_blocked on p2p_user_blocks(blocked_id);

alter table p2p_reserved_usernames enable row level security;
alter table p2p_username_history enable row level security;
alter table p2p_connection_requests enable row level security;
alter table p2p_user_blocks enable row level security;

-- Real admin roles in this app are peer_guide/church_leader/regional_admin/
-- moderator/super_admin (see middleware/adminAuth.ts) — 'admin' is not a
-- role value that exists anywhere in p2p_profiles (confirmed live: only
-- 'student' and 'super_admin' rows currently exist). A policy checking
-- role = 'admin' would never match a real user.
drop policy if exists "Admins manage reserved usernames" on p2p_reserved_usernames;
create policy "Admins manage reserved usernames" on p2p_reserved_usernames
  for all using (
    exists (
      select 1 from p2p_profiles
      where id = auth.uid() and role in ('church_leader', 'regional_admin', 'moderator', 'super_admin')
    )
  );

drop policy if exists "Public can read reserved usernames" on p2p_reserved_usernames;
create policy "Public can read reserved usernames" on p2p_reserved_usernames
  for select using (true);

drop policy if exists "Users see own username history" on p2p_username_history;
create policy "Users see own username history" on p2p_username_history
  for select using (auth.uid() = user_id);

drop policy if exists "Users see own connection requests" on p2p_connection_requests;
create policy "Users see own connection requests" on p2p_connection_requests
  for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "Users create connection requests" on p2p_connection_requests;
create policy "Users create connection requests" on p2p_connection_requests
  for insert with check (auth.uid() = from_user_id);

drop policy if exists "Recipients update connection requests" on p2p_connection_requests;
create policy "Recipients update connection requests" on p2p_connection_requests
  for update using (auth.uid() = to_user_id or auth.uid() = from_user_id);

drop policy if exists "Users manage own blocks" on p2p_user_blocks;
create policy "Users manage own blocks" on p2p_user_blocks
  for all using (auth.uid() = blocker_id);

insert into p2p_reserved_usernames (username, reason) values
  ('admin', 'System reserved'),
  ('p2pglobal', 'Brand reserved'),
  ('amentech', 'Company reserved'),
  ('support', 'System reserved'),
  ('kingdom', 'Brand reserved'),
  ('jesus', 'Sacred name'),
  ('god', 'Sacred name'),
  ('super_admin', 'System reserved'),
  ('moderator', 'System reserved'),
  ('p2p_crises_response', 'System reserved'),
  ('p2pglobal_announcement', 'Brand reserved'),
  ('angel', 'Sacred name'),
  ('p2pglobal_finance', 'System reserved'),
  ('help', 'System reserved'),
  ('official', 'Brand reserved'),
  ('team', 'Brand reserved'),
  ('staff', 'System reserved'),
  ('null', 'System reserved'),
  ('undefined', 'System reserved'),
  ('root', 'System reserved'),
  ('system', 'System reserved'),
  ('anonymous', 'System reserved'),
  ('deleted', 'System reserved'),
  ('ghost', 'System reserved'),
  ('holy_spirit', 'Sacred name'),
  ('christ', 'Sacred name'),
  ('lord', 'Sacred name'),
  ('saviour', 'Sacred name'),
  ('savior', 'Sacred name')
on conflict (username) do nothing;