-- 058: Agora call infrastructure — call history, Break Rooms, and incoming
-- call signaling (p2p_incoming_calls rows are how the recipient's app knows
-- to show the ringing screen, via Supabase realtime on this table).

-- ── p2p_call_logs ─────────────────────────────────────────────────────────────
create table if not exists p2p_call_logs (
  id                uuid primary key default gen_random_uuid(),
  channel_name      text not null,
  call_type         text not null,                      -- 'audio'|'video'|'group'|'pastoral'|'crisis'
  initiated_by      uuid not null references auth.users(id) on delete cascade,
  participants      jsonb not null default '[]',         -- array of user_id strings
  started_at        timestamptz,
  ended_at          timestamptz,
  duration_seconds  integer,
  status            text not null default 'initiated',   -- 'initiated'|'connected'|'missed'|'declined'|'ended'
  session_id        uuid references p2p_sessions(id) on delete set null,
  circle_id         uuid references p2p_peer_circles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_p2p_call_logs_initiated_by on p2p_call_logs(initiated_by);
create index if not exists idx_p2p_call_logs_session on p2p_call_logs(session_id);
create index if not exists idx_p2p_call_logs_circle on p2p_call_logs(circle_id);

-- ── p2p_break_rooms ───────────────────────────────────────────────────────────
create table if not exists p2p_break_rooms (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  room_type             text not null default 'open',    -- 'open'|'topic'|'language'|'church'
  category              text,                             -- plan category key, if a topic room
  language_code         text,                             -- if a language room
  host_id               uuid not null references auth.users(id) on delete cascade,
  channel_name          text not null unique,
  max_participants      integer not null default 20,
  current_participants  integer not null default 0,
  is_live               boolean not null default true,
  created_at            timestamptz not null default now(),
  ended_at              timestamptz
);

create index if not exists idx_p2p_break_rooms_live on p2p_break_rooms(is_live);
create index if not exists idx_p2p_break_rooms_host on p2p_break_rooms(host_id);

create table if not exists p2p_break_room_participants (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references p2p_break_rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique(room_id, user_id)
);

create index if not exists idx_p2p_break_room_participants_user on p2p_break_room_participants(user_id);
create index if not exists idx_p2p_break_room_participants_room on p2p_break_room_participants(room_id);

-- ── p2p_incoming_calls ────────────────────────────────────────────────────────
-- INSERTs into this table are what the recipient's app picks up via Supabase
-- realtime to show the incoming-call screen (see DataContext.tsx).
create table if not exists p2p_incoming_calls (
  id            uuid primary key default gen_random_uuid(),
  channel_name  text not null,
  call_type     text not null,                       -- 'audio'|'video'|'pastoral'|'crisis'
  caller_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'ringing',      -- 'ringing'|'accepted'|'declined'|'missed'|'cancelled'
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

create index if not exists idx_p2p_incoming_calls_recipient on p2p_incoming_calls(recipient_id, status);
create index if not exists idx_p2p_incoming_calls_caller on p2p_incoming_calls(caller_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_call_logs enable row level security;
alter table p2p_break_rooms enable row level security;
alter table p2p_break_room_participants enable row level security;
alter table p2p_incoming_calls enable row level security;

drop policy if exists "Users see own call logs" on p2p_call_logs;
create policy "Users see own call logs" on p2p_call_logs
  for select using (
    auth.uid() = initiated_by
    or auth.uid()::text = any(array(select jsonb_array_elements_text(participants)))
  );

drop policy if exists "Anyone can see live break rooms" on p2p_break_rooms;
create policy "Anyone can see live break rooms" on p2p_break_rooms
  for select using (is_live = true or auth.uid() = host_id);
drop policy if exists "Hosts manage their rooms" on p2p_break_rooms;
create policy "Hosts manage their rooms" on p2p_break_rooms
  for all using (auth.uid() = host_id) with check (auth.uid() = host_id);

drop policy if exists "Participants see room rosters" on p2p_break_room_participants;
create policy "Participants see room rosters" on p2p_break_room_participants
  for select using (
    auth.uid() = user_id
    or exists (select 1 from p2p_break_rooms r where r.id = room_id and r.host_id = auth.uid())
  );
drop policy if exists "Users manage their own room participation" on p2p_break_room_participants;
create policy "Users manage their own room participation" on p2p_break_room_participants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users see own incoming calls" on p2p_incoming_calls;
create policy "Users see own incoming calls" on p2p_incoming_calls
  for select using (auth.uid() = caller_id or auth.uid() = recipient_id);
drop policy if exists "Users create outgoing calls" on p2p_incoming_calls;
create policy "Users create outgoing calls" on p2p_incoming_calls
  for insert with check (auth.uid() = caller_id);
drop policy if exists "Recipients update own incoming calls" on p2p_incoming_calls;
create policy "Recipients update own incoming calls" on p2p_incoming_calls
  for update using (auth.uid() = recipient_id);