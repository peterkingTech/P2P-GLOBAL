-- 128: Family Gathering Session Summary — Stage 1.
--
-- The summary is a DERIVED view of the existing Family Worship session
-- architecture, not a second Gathering system. p2p_family_worship_history
-- (migration 117, extended 124) already is the "one row per completed
-- session" summary record the spec asks for — this migration only adds
-- what genuinely doesn't exist anywhere yet:
--
--   1. guide_id/started_at/ended_at snapshots on the history row itself.
--      Today these only live on p2p_family_worship_sessions, which
--      cascade-deletes if the session row is ever removed — for a row
--      whose whole purpose is being a permanent historical record, that's
--      a real integrity gap (spec section 23: "Investigate whether they
--      should be immutable... underlying session records remain
--      authoritative" — snapshotting protects against the session being
--      the only copy of facts about itself).
--   2. guide_summary + updated_at — the one genuinely new, optional,
--      manually-written field the spec asks for. Plain text; no rich-text
--      infrastructure, per the explicit instruction not to over-build this.
--   3. p2p_family_worship_session_events — the one new table this feature
--      needs. Neither "which distinct Scripture passages were shown" nor
--      "which distinct media items were played" nor "a session timeline"
--      can be reconstructed from any existing table: current_scripture/
--      media_id on the session row hold only the LAST value (overwritten
--      on every change, per migration 116's design), and
--      p2p_family_worship_queue rows are deleted the moment they're played
--      (familyWorship.ts's queue/next handler). This is exactly the
--      "existing event granularity is insufficient, implement the
--      smallest useful event additions" case the spec anticipates — one
--      lightweight, append-only log, written only on real state
--      transitions the app already gates behind an explicit Guide action
--      (mode/Scripture/media changes, start, end), never per-tick.

alter table p2p_family_worship_history
  add column if not exists guide_id     uuid references auth.users(id) on delete set null,
  add column if not exists started_at   timestamptz,
  add column if not exists ended_at     timestamptz,
  add column if not exists guide_summary text,
  add column if not exists updated_at   timestamptz not null default now();

-- Guide/Shepherd-authorized edits to guide_summary happen through the API
-- (route re-verifies guide_id/shepherd_id itself, service-role write) —
-- this policy only grants read access, mirroring every other worship
-- table's family-scoped SELECT policy exactly.
drop policy if exists "Family sees their worship history" on p2p_family_worship_history;
create policy "Family sees their worship history" on p2p_family_worship_history
  for select using (
    exists (select 1 from p2p_family_members m where m.family_id = p2p_family_worship_history.family_id and m.user_id = auth.uid() and m.status = 'active')
  );

create table if not exists p2p_family_worship_session_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  family_id   uuid not null references p2p_families(id) on delete cascade,
  event_type  text not null, -- 'started'|'mode_changed'|'scripture_changed'|'media_played'|'ended'
  event_data  jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_p2p_family_worship_session_events_session on p2p_family_worship_session_events(session_id, created_at);
create index if not exists idx_p2p_family_worship_session_events_family on p2p_family_worship_session_events(family_id);

alter table p2p_family_worship_session_events enable row level security;

-- Read-only RLS, same division of responsibility as p2p_family_worship_queue:
-- all writes go through familyWorship.ts's service-role client (the state
-- and start/end handlers already re-verify Guide/membership authorization
-- before writing the session row itself; the event row is written
-- alongside that same already-authorized write, never independently).
drop policy if exists "Family sees their session events" on p2p_family_worship_session_events;
create policy "Family sees their session events" on p2p_family_worship_session_events
  for select using (
    exists (select 1 from p2p_family_members m where m.family_id = p2p_family_worship_session_events.family_id and m.user_id = auth.uid() and m.status = 'active')
  );
