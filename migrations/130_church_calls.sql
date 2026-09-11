-- 130: Church Calls — Stage 1.
--
-- FORENSIC INVESTIGATION FIRST (per the mandate): confirmed the following
-- before writing a single line of this migration —
--   * Church already exists (migrations 072-074): p2p_churches,
--     p2p_church_members (role in senior_pastor/discipleship_pastor/
--     small_group_leader/peer_guide/member, is_active), p2p_church_cohorts
--     (the project's real "small group" concept), and three SECURITY
--     DEFINER helper functions already used by every church RLS policy:
--     p2p_is_church_member, p2p_is_church_leadership, p2p_is_church_pastor.
--   * Direct Calls' Agora token route (POST /calls/token, calls.ts) already
--     branches authorization by channel-name PREFIX (p2p_/circle_/room_/
--     family_worship_) — the established, additive extension point. Church
--     Calls adds one more branch (church_call_) rather than a second Agora
--     App ID/token system/call SDK.
--   * p2p_break_rooms/p2p_break_room_participants is the closest existing
--     precedent for "multiple participants in one call, one host, simple
--     lifecycle" — this migration's two new tables mirror that shape
--     exactly rather than inventing a new "rooms" abstraction.
--
-- Two new tables, both minimal, both p2p_church_-prefixed per the
-- project's existing church-table naming convention:
--
--   1. p2p_church_calls — one row per Church Call. Lifecycle is exactly
--      the mandate's "Created -> Live -> Ended": a call is inserted
--      already 'live' (Start Call = create + go live in one action, same
--      as Family Gathering's "Start Gathering" and Break Rooms' "create
--      room"), then transitions to 'ended'. Scope is deliberately narrow
--      for Stage 1 — 'church' (any active member) and 'cohort' (the
--      existing p2p_church_cohorts small-group concept, since the spec
--      explicitly says "if ministry/team/group scopes exist, enforce
--      those too") — 'invited' is NOT built here (would need a new
--      invitee-picker UI with no existing precedent; flagged for a later
--      stage rather than invented now).
--   2. p2p_church_call_participants — who is/was in a call, an exact
--      structural copy of p2p_break_room_participants
--      (unique(call_id,user_id), joined_at/left_at) since forensic
--      investigation found that shape already fits perfectly — no new
--      "generic room participants" abstraction invented.
--
-- RLS: read-only for clients, gated through the EXISTING
-- p2p_is_church_member SECURITY DEFINER function (never a new recursive
-- EXISTS subquery — migration 072 already documented and fixed that trap
-- once). Every write goes through the API server's service-role client
-- (routes/churchCalls.ts), which re-verifies identity (verifyCaller — a
-- real Supabase JWT, never a client-supplied id) and re-checks church-role
-- authorization on every mutating call — matching the exact
-- division-of-responsibility already established by
-- p2p_family_worship_session_events (migration 128).

create table if not exists p2p_church_calls (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references p2p_churches(id) on delete cascade,
  host_id       uuid references auth.users(id) on delete set null,
  title         text not null,
  purpose       text not null default 'meeting'
                check (purpose in ('meeting','teaching','bible_study','prayer','leadership','small_group','fellowship','church_gathering','other')),
  scope         text not null default 'church' check (scope in ('church','cohort')),
  cohort_id     uuid references p2p_church_cohorts(id) on delete set null,
  channel_name  text not null unique,
  status        text not null default 'live' check (status in ('live','ended')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_p2p_church_calls_church on p2p_church_calls(church_id, status);

create table if not exists p2p_church_call_participants (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references p2p_church_calls(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  unique(call_id, user_id)
);

create index if not exists idx_p2p_church_call_participants_call on p2p_church_call_participants(call_id);
create index if not exists idx_p2p_church_call_participants_user on p2p_church_call_participants(user_id);

alter table p2p_church_calls enable row level security;
alter table p2p_church_call_participants enable row level security;

drop policy if exists "Church members see their church's calls" on p2p_church_calls;
create policy "Church members see their church's calls" on p2p_church_calls
  for select using (p2p_is_church_member(church_id, auth.uid()));

drop policy if exists "Church members see call participants" on p2p_church_call_participants;
create policy "Church members see call participants" on p2p_church_call_participants
  for select using (
    exists (
      select 1 from p2p_church_calls c
      where c.id = call_id and p2p_is_church_member(c.church_id, auth.uid())
    )
  );
