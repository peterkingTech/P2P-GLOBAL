-- 117: Family Prayer requests, Worship history, and the family-journey
-- integration point. current_scripture already lives on the session row
-- (migration 116) and reads passages from the existing bible.ts data — no
-- new Scripture storage needed. Reactions are deliberately NOT persisted
-- (broadcast-only, ephemeral, per spec) — no table for them.

-- ── p2p_family_prayer_requests ────────────────────────────────────────────────
-- visibility mirrors 045_prayer_expansion.sql's prayer-wall pattern: a
-- 'private' row is simply never selected by any family-scoped query, so it
-- cannot accidentally surface in Family Worship — privacy by omission, not
-- a runtime check that can be forgotten.
create table if not exists p2p_family_prayer_requests (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references p2p_families(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  content      text not null,
  visibility   text not null default 'family',  -- 'private'|'family'
  status       text not null default 'open',    -- 'open'|'prayed'|'answered'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_p2p_family_prayer_requests_family on p2p_family_prayer_requests(family_id, visibility, status);
create index if not exists idx_p2p_family_prayer_requests_user on p2p_family_prayer_requests(user_id);

alter table p2p_family_prayer_requests enable row level security;

drop policy if exists "Family sees shared prayer requests" on p2p_family_prayer_requests;
create policy "Family sees shared prayer requests" on p2p_family_prayer_requests
  for select using (
    auth.uid() = user_id
    or (
      visibility = 'family'
      and exists (select 1 from p2p_family_members m where m.family_id = p2p_family_prayer_requests.family_id and m.user_id = auth.uid() and m.status = 'active')
    )
  );
drop policy if exists "Users manage their own prayer requests" on p2p_family_prayer_requests;
create policy "Users manage their own prayer requests" on p2p_family_prayer_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── p2p_family_worship_history ────────────────────────────────────────────────
-- One summary row per completed session — not a per-participant attendance
-- log (spec's explicit "don't make this feel like surveillance" rule).
create table if not exists p2p_family_worship_history (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references p2p_families(id) on delete cascade,
  session_id          uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  duration_seconds    integer not null default 0,
  modes_visited       text[] not null default '{}',
  participant_count   integer not null default 0,
  scripture_reference text,
  created_at          timestamptz not null default now(),
  unique(session_id)
);

create index if not exists idx_p2p_family_worship_history_family on p2p_family_worship_history(family_id, created_at desc);

alter table p2p_family_worship_history enable row level security;

drop policy if exists "Family sees their worship history" on p2p_family_worship_history;
create policy "Family sees their worship history" on p2p_family_worship_history
  for select using (
    exists (select 1 from p2p_family_members m where m.family_id = p2p_family_worship_history.family_id and m.user_id = auth.uid() and m.status = 'active')
  );

-- ── p2p_family_journey_events ─────────────────────────────────────────────────
-- Deliberately minimal — the explicit "clean integration point" the spec
-- asks for so a future family tree can consume this signal, without
-- touching the existing, already-shipped, per-user tree_growth_score
-- system (migration 113/114), which this does not modify or read.
create table if not exists p2p_family_journey_events (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references p2p_families(id) on delete cascade,
  event_type   text not null,   -- 'worship_session_completed' (only value used today; extensible)
  source_id    uuid,            -- e.g. the p2p_family_worship_history.id that produced this event
  created_at   timestamptz not null default now()
);

create index if not exists idx_p2p_family_journey_events_family on p2p_family_journey_events(family_id, created_at desc);

alter table p2p_family_journey_events enable row level security;

drop policy if exists "Family sees their journey events" on p2p_family_journey_events;
create policy "Family sees their journey events" on p2p_family_journey_events
  for select using (
    exists (select 1 from p2p_family_members m where m.family_id = p2p_family_journey_events.family_id and m.user_id = auth.uid() and m.status = 'active')
  );