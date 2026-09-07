-- 116: Family Worship sessions — the "one family, one room, one shared
-- experience" real-time gathering built on top of migration 115's family
-- foundation. Mirrors p2p_break_rooms' host/state shape (058/061) rather
-- than inventing a new one: a single mutable session row is the source of
-- truth for late-join/reconnect sync, while a private realtime broadcast
-- channel (named after this session, same pattern as circle_call_*/
-- room_signal_*) carries low-latency play/pause/seek/reaction events. No
-- per-tick writes: the row only changes on an actual state transition, and
-- playback position is derived from a server timestamp, never polled.

create table if not exists p2p_family_worship_sessions (
  id                          uuid primary key default gen_random_uuid(),
  family_id                   uuid not null references p2p_families(id) on delete cascade,
  host_id                     uuid not null references auth.users(id) on delete cascade,
  status                      text not null default 'starting',
    -- 'scheduled'|'starting'|'active'|'paused'|'scripture'|'prayer'|'sharing'|'silent_prayer'|'ending'|'ended'
  current_mode                text not null default 'worship',
    -- 'worship'|'scripture'|'prayer'|'sharing'|'silent_prayer'|'thanksgiving'
  media_type                  text,              -- 'video'|'audio'|null (no media selected yet)
  media_id                    text,
  media_url                   text,
  playback_base_position_ms   bigint not null default 0,
  playback_base_server_time   timestamptz not null default now(),
  playback_rate               numeric not null default 1,
  is_playing                  boolean not null default false,
  current_scripture           jsonb,             -- {reference, verseIndex}
  channel_name                text not null unique,   -- optional Agora presence, same convention as p2p_break_rooms.channel_name
  started_at                  timestamptz,
  ended_at                    timestamptz,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_p2p_family_worship_sessions_family on p2p_family_worship_sessions(family_id);
create index if not exists idx_p2p_family_worship_sessions_host on p2p_family_worship_sessions(host_id);
create index if not exists idx_p2p_family_worship_sessions_active on p2p_family_worship_sessions(family_id) where status not in ('ended');

-- One live (non-ended) session per family at a time — prevents a second
-- "Start Worship" from silently forking the gathering into two rooms.
create unique index if not exists idx_p2p_family_worship_sessions_one_live_per_family
  on p2p_family_worship_sessions(family_id) where status <> 'ended';

create table if not exists p2p_family_worship_participants (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  camera_on         boolean not null default false,
  mic_on            boolean not null default false,
  presence_status   text not null default 'joined', -- 'joined'|'listening'|'praying'|'away'
  unique(session_id, user_id)
);

create index if not exists idx_p2p_family_worship_participants_session on p2p_family_worship_participants(session_id);
create index if not exists idx_p2p_family_worship_participants_user on p2p_family_worship_participants(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_family_worship_sessions enable row level security;
alter table p2p_family_worship_participants enable row level security;

drop policy if exists "Family members view their worship sessions" on p2p_family_worship_sessions;
create policy "Family members view their worship sessions" on p2p_family_worship_sessions
  for select using (
    exists (select 1 from p2p_family_members m where m.family_id = p2p_family_worship_sessions.family_id and m.user_id = auth.uid() and m.status = 'active')
  );
drop policy if exists "Family members can start a session" on p2p_family_worship_sessions;
create policy "Family members can start a session" on p2p_family_worship_sessions
  for insert with check (
    auth.uid() = host_id
    and exists (select 1 from p2p_family_members m where m.family_id = p2p_family_worship_sessions.family_id and m.user_id = auth.uid() and m.status = 'active')
  );
drop policy if exists "Host updates their session" on p2p_family_worship_sessions;
create policy "Host updates their session" on p2p_family_worship_sessions
  for update using (auth.uid() = host_id) with check (auth.uid() = host_id);

drop policy if exists "Family members view worship participants" on p2p_family_worship_participants;
create policy "Family members view worship participants" on p2p_family_worship_participants
  for select using (
    exists (
      select 1 from p2p_family_worship_sessions s
      join p2p_family_members m on m.family_id = s.family_id and m.user_id = auth.uid() and m.status = 'active'
      where s.id = p2p_family_worship_participants.session_id
    )
  );
drop policy if exists "Users manage their own participation row" on p2p_family_worship_participants;
create policy "Users manage their own participation row" on p2p_family_worship_participants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);