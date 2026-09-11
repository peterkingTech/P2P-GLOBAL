-- 131: Church Calls — Stages 2-5 (Experience/Moderation, Scheduling/
-- Notifications, Ministry-tool integration, History/Summary/Continuity).
--
-- FORENSIC FINDINGS (before writing a single line of this migration):
--
-- 1. Chat: p2p_family_worship_messages (migration 122) is the exact
--    reusable shape — session-scoped, RLS gated on an active (left_at is
--    null) participant row. p2p_church_call_participants already exists
--    (migration 130) with the identical shape, so p2p_church_call_messages
--    below mirrors 122 verbatim, scoped to call_id instead of session_id.
--    No generic/shared chat table is introduced — this codebase's own
--    convention (peer_circles/break_rooms/family_worship each have their
--    OWN scoped message/participant tables) is followed, not reinvented.
--
-- 2. Reactions + Raise Hand: app/call/group.tsx and family/worship/
--    [sessionId].tsx both implement these as EPHEMERAL Supabase Realtime
--    broadcast events — nothing persisted, nothing in a table. No new
--    table is created for either; Church Calls reuses the same private
--    broadcast-channel pattern in the mobile client only.
--
-- 3. Moderation (mute/remove/video-disable): group.tsx's own comment is
--    explicit — "Agora RTC gives no participant authority over another
--    participant's stream... 'mute all'/'remove' are cooperative signals
--    the receiving client acts on itself, not something the sender can
--    force directly." That is a real Agora RTC (not RTM) architectural
--    limit, not a laziness shortcut, and this migration does not attempt
--    to work around it with a new Agora REST/RTM integration (explicitly
--    out of scope per the Stage 2 mandate: "only implement capabilities
--    supported by the existing Agora architecture"). What CAN be made
--    genuinely server-authorized, and is added here:
--      - remove: already enforced today via p2p_church_call_participants
--        .left_at (set server-side, checked by calls.ts's church_call_
--        token branch before minting any token) — a removed participant
--        cannot rejoin. This migration adds nothing new for removal.
--      - mic/video "disabled by host": two new persisted boolean flags on
--        p2p_church_call_participants. The host-only endpoint that sets
--        them is the server-authorized part; the client honors them by
--        forcing its own local mute/camera-off (on toggle AND on
--        load/rejoin) — the same "cooperative enforcement, persisted
--        server-side so a rejoin can't escape it" shape as every other
--        moderation primitive already in this codebase.
--
-- 4. Notes: p2p_family_worship_notes (migration 122-adjacent) is the
--    reusable shared/private shape. p2p_church_call_notes below mirrors
--    it exactly, scoped to call_id.
--
-- 5. Prayer (Stage 4): investigated p2p_family_prayer_requests (family-
--    scoped) and p2p_prayer_wall_posts (migration 096 — a GLOBAL/personal
--    prayer wall, predates tracked migrations). Neither is church-scoped;
--    there is no existing "church prayer request" system to safely
--    connect a Church Call to. Per the mandate's own instruction ("Do not
--    duplicate prayer requests... respect existing privacy/visibility"),
--    the safest and most correct action is NOT to wire Prayer-purpose
--    calls into either wrong-scoped system. Prayer mode is presentation-
--    only (contextual UI) plus the same optional Scripture attachment
--    every purpose gets. No prayer table is added.
--
-- 6. Scripture (Stage 4): p2p_family_worship_sessions.current_scripture
--    (migration 116) is a jsonb {translation,book,chapter,startVerse,
--    endVerse} shape with no Bible text stored anywhere in this app (the
--    Bible text itself lives in an external API.Bible integration,
--    fetched by lib/bibleApi.ts-equivalent — confirmed by grep: no
--    p2p_bible_verses/scripture text table exists). church_calls.
--    scripture_reference below reuses this exact jsonb shape. No Bible
--    text is duplicated.
--
-- 7. Lesson (Stage 4): p2p_lessons/p2p_modules/p2p_curriculums have no
--    church_id column anywhere (confirmed via grep across every
--    migration) — curriculum is a single global catalog, not per-church,
--    so attaching any published lesson to any church's call carries no
--    cross-church leak risk. p2p_church_calls.lesson_id is a plain FK,
--    exactly mirroring p2p_family_worship_sessions.lesson_id (migration
--    129) — read-only association, never writes p2p_lesson_progress.
--
-- 8. Media (Stage 4): mirrors p2p_family_worship_sessions' media_provider/
--    media_id/media_url columns (migration 116) verbatim — same shape,
--    same "YouTube Error 152 implementation is not touched" boundary
--    (this migration adds no media-playback code, only a reference).
--
-- 9. History/Summary (Stage 5): p2p_church_calls rows are NEVER deleted
--    by any existing code path (unlike p2p_family_worship_sessions, which
--    is why Family Gathering needed a SEPARATE, permanent
--    p2p_family_worship_history table to survive session deletion). A
--    p2p_church_calls row with status='ended' already IS the permanent
--    history record — Stage 1's own "Recent Calls" list already queries
--    exactly this. Per the mandate's own instruction ("determine whether
--    existing summary architecture can be safely GENERALIZED... do not
--    create duplicate history systems without proving they are needed"),
--    no second p2p_church_call_history table is created — host_summary/
--    continuity_notes are added directly to p2p_church_calls instead.
--    The one genuinely new thing needed (per-session-events, since a call
--    row only holds the LATEST scripture/media value, never a timeline)
--    is p2p_church_call_events, mirroring p2p_family_worship_session_
--    events (migration 128) exactly.
--
-- 10. Scheduling (Stage 3): no existing church event/calendar table was
--    found (p2p_church_cohorts has target_start_date/end_date but that's
--    a cohort's own multi-week span, not a single schedulable event).
--    Rather than invent a second event system, 'scheduled' is added as a
--    third p2p_church_calls.status value alongside the existing 'live'/
--    'ended' — a scheduled call becomes the SAME row when started (no
--    second live-call record), matching the mandate's explicit
--    requirement ("should not create a second live-call record").
--    Reminders reuse the existing node-cron + p2p_notifications + Expo
--    push pipeline (artifacts/api-server/src/index.ts already runs a
--    once-a-minute cron for push dispatch) — reminder_sent_at is a plain
--    dedup guard column, not a new scheduling service.

alter table p2p_church_calls drop constraint if exists p2p_church_calls_status_check;
alter table p2p_church_calls add constraint p2p_church_calls_status_check
  check (status in ('scheduled', 'live', 'ended'));

alter table p2p_church_calls
  -- Stage 3 — scheduling
  add column if not exists scheduled_start_at         timestamptz,
  add column if not exists expected_duration_minutes  integer,
  add column if not exists description                text,
  add column if not exists reminder_sent_at            timestamptz,
  -- Stage 4 — ministry-tool integration (all optional, all read-only
  -- associations into existing systems)
  add column if not exists lesson_id                  uuid references p2p_lessons(id) on delete set null,
  add column if not exists scripture_reference         jsonb,
  add column if not exists media_provider              text,
  add column if not exists media_id                    text,
  add column if not exists media_url                   text,
  -- Stage 5 — manual, non-AI summary/continuity text
  add column if not exists host_summary                text,
  add column if not exists continuity_notes             text,
  add column if not exists updated_at                  timestamptz not null default now();

-- channel_name/host_id were NOT NULL in migration 130 (every call was
-- created already-live). A scheduled call has neither until it starts,
-- so both must become nullable — this is the one genuinely structural
-- change in this migration, made only because 'scheduled' status
-- requires it, not a speculative redesign.
alter table p2p_church_calls alter column channel_name drop not null;
alter table p2p_church_calls drop constraint if exists p2p_church_calls_channel_name_key;
create unique index if not exists p2p_church_calls_channel_name_key on p2p_church_calls(channel_name) where channel_name is not null;

create index if not exists idx_p2p_church_calls_scheduled on p2p_church_calls(church_id, status, scheduled_start_at) where status = 'scheduled';

-- Stage 2 — host-authorized, persisted mute/video-disable state. Checked
-- server-side (churchCalls.ts) before being set; honored client-side by
-- the affected participant's own client, on both the toggle broadcast and
-- on load/rejoin (so it can't be escaped by reconnecting).
alter table p2p_church_call_participants
  add column if not exists mic_disabled_by_host    boolean not null default false,
  add column if not exists video_disabled_by_host  boolean not null default false;

-- Stage 2 — chat, mirrors p2p_family_worship_messages (migration 122) verbatim.
create table if not exists p2p_church_call_messages (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references p2p_church_calls(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_p2p_church_call_messages_call on p2p_church_call_messages(call_id, created_at);

alter table p2p_church_call_messages enable row level security;

drop policy if exists "Active call participants read messages" on p2p_church_call_messages;
create policy "Active call participants read messages" on p2p_church_call_messages
  for select using (
    exists (
      select 1 from p2p_church_call_participants p
      where p.call_id = p2p_church_call_messages.call_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

drop policy if exists "Active call participants send their own messages" on p2p_church_call_messages;
create policy "Active call participants send their own messages" on p2p_church_call_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from p2p_church_call_participants p
      where p.call_id = p2p_church_call_messages.call_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

-- Stage 4 — shared/private meeting notes, mirrors p2p_family_worship_notes exactly.
create table if not exists p2p_church_call_notes (
  id                    uuid primary key default gen_random_uuid(),
  call_id               uuid not null references p2p_church_calls(id) on delete cascade,
  author_id             uuid not null references auth.users(id) on delete cascade,
  content               text not null,
  visibility            text not null default 'shared' check (visibility in ('shared', 'private')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_p2p_church_call_notes_call on p2p_church_call_notes(call_id, created_at);

alter table p2p_church_call_notes enable row level security;

drop policy if exists "Active call participants read shared or own notes" on p2p_church_call_notes;
create policy "Active call participants read shared or own notes" on p2p_church_call_notes
  for select using (
    (visibility = 'shared' or author_id = auth.uid())
    and exists (
      select 1 from p2p_church_call_participants p
      where p.call_id = p2p_church_call_notes.call_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

drop policy if exists "Active call participants write their own notes" on p2p_church_call_notes;
create policy "Active call participants write their own notes" on p2p_church_call_notes
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1 from p2p_church_call_participants p
      where p.call_id = p2p_church_call_notes.call_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

-- Stage 5 — meaningful-event timeline, mirrors p2p_family_worship_session_events exactly.
create table if not exists p2p_church_call_events (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references p2p_church_calls(id) on delete cascade,
  church_id   uuid not null references p2p_churches(id) on delete cascade,
  event_type  text not null, -- 'started'|'scripture_attached'|'lesson_attached'|'media_attached'|'ended'
  event_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_p2p_church_call_events_call on p2p_church_call_events(call_id, created_at);
create index if not exists idx_p2p_church_call_events_church on p2p_church_call_events(church_id);

alter table p2p_church_call_events enable row level security;

drop policy if exists "Church members see their church's call events" on p2p_church_call_events;
create policy "Church members see their church's call events" on p2p_church_call_events
  for select using (p2p_is_church_member(church_id, auth.uid()));
