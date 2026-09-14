-- 139: Prayer 2.0 Stage 4 — Prayer Commitments, Follow-Up, Prayer Journey.
--
-- FORENSIC BASIS: "I will pray for this" does not exist anywhere as a real
-- entity — the only prior mechanisms are a wall reaction (a count, not a
-- commitment) or nothing at all. This migration adds exactly one new
-- table for that concept, plus follow-up fields on the existing Stage 1
-- p2p_prayer_coord_requests table (never a second requests table).
--
-- Growth events: p2p_growth_events (migration 010) is the SCORE engine
-- (p2p_calculate_growth_score reads it directly) and its event_type CHECK
-- has exactly 3 hardcoded values with no prayer-related one — adding to it
-- would mean changing how growth SCORES are computed, which this stage
-- explicitly must not do ("Do not inflate growth scores simply because
-- someone opened a screen"). p2p_user_activity_events (migration 050) is a
-- SEPARATE, purely informational dashboard/activity-timeline table that
-- already has a 'prayer_offered' event type and carries zero scoring
-- weight — this is the correct, already-safe extension point. Only that
-- table's CHECK constraint is widened here (two new values), and
-- p2p_growth_events/p2p_calculate_growth_score are not touched at all.

create table if not exists p2p_prayer_coord_commitments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  request_id   uuid not null references p2p_prayer_coord_requests(id) on delete cascade,
  status       text not null default 'active' check (status in ('active', 'completed', 'continued', 'released')),
  reminder_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- "No duplicate commitments" — a user commits to a given request at most
  -- once at a time; re-committing after releasing is still just one row.
  unique (user_id, request_id)
);

create index if not exists idx_p2p_prayer_coord_commitments_user on p2p_prayer_coord_commitments(user_id, status);
create index if not exists idx_p2p_prayer_coord_commitments_request on p2p_prayer_coord_commitments(request_id);

alter table p2p_prayer_coord_commitments enable row level security;

drop policy if exists "Users manage their own prayer commitments" on p2p_prayer_coord_commitments;
create policy "Users manage their own prayer commitments" on p2p_prayer_coord_commitments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Request-owner visibility: the person whose request it is can see who has
-- committed to pray for it (their own name/identity only — never another
-- committer's private info beyond the fact that they committed).
drop policy if exists "Request owner sees commitments to their request" on p2p_prayer_coord_commitments;
create policy "Request owner sees commitments to their request" on p2p_prayer_coord_commitments
  for select using (
    exists (select 1 from p2p_prayer_coord_requests r where r.id = request_id and r.user_id = auth.uid())
  );

-- ── Request follow-up fields ─────────────────────────────────────────────
-- "How is this prayer going?" is informational narrative, never a forced
-- answer and never a second status machine — progress_note_type is a soft
-- label the owner can optionally set; only 'no_longer_needed' also moves
-- the existing status to 'cancelled' (handled in the API, not by a trigger,
-- so it stays an explicit, reviewable decision rather than an automatic
-- side effect hidden in the database).
alter table p2p_prayer_coord_requests
  add column if not exists progress_note text,
  add column if not exists progress_note_type text
    check (progress_note_type in ('still_praying', 'god_is_answering', 'partially_answered', 'no_longer_needed')),
  add column if not exists progress_updated_at timestamptz,
  add column if not exists answer_note text;

-- p2p_user_activity_events — additive only, see comment above. Widening a
-- CHECK constraint on a table whose own RLS already lets a user freely
-- insert/select their own rows (migration 050) — no new RLS needed.
alter table p2p_user_activity_events drop constraint if exists p2p_user_activity_events_event_type_check;
alter table p2p_user_activity_events add constraint p2p_user_activity_events_event_type_check
  check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched',
    'prayer_gathering_completed', 'peer_prayer_supported'
  ));
