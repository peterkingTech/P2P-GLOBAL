-- 061: Break Rooms extras — structured/open speaking mode, safety (flags +
-- 24h rejoin blocks), and a per-user toggle for room-open notifications.
-- Flags and blocks are server-owned only (no client-facing RLS policy, same
-- pattern as p2p_call_logs in 058) — every write goes through calls.ts's
-- service-role client, never a direct client insert, so flaggers stay
-- anonymous to other participants and blocks can't be self-removed.

alter table p2p_break_rooms
  add column if not exists speaking_mode text not null default 'open'; -- 'open'|'structured'
alter table p2p_break_rooms
  add column if not exists current_speaker_id uuid references auth.users(id) on delete set null;

create table if not exists p2p_break_room_flags (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references p2p_break_rooms(id) on delete cascade,
  flagger_id  uuid not null references auth.users(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_p2p_break_room_flags_room on p2p_break_room_flags(room_id);
alter table p2p_break_room_flags enable row level security;

create table if not exists p2p_break_room_blocks (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references p2p_break_rooms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  blocked_until timestamptz not null,
  created_at    timestamptz not null default now(),
  unique(room_id, user_id)
);
create index if not exists idx_p2p_break_room_blocks_room_user on p2p_break_room_blocks(room_id, user_id);
alter table p2p_break_room_blocks enable row level security;

alter table p2p_profiles
  add column if not exists notify_break_rooms boolean not null default true;