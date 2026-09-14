-- 138: Prayer 2.0 Stage 1 — Peer-to-peer prayer coordination foundation.
--
-- FORENSIC BASIS (Prayer 2.0 Stage 0 report): three separate, uncoordinated
-- "prayer request" systems already exist — the legacy, UNAUTHENTICATED
-- p2p_prayer_requests (routes/prayer.ts, no RLS, no verifyCaller anywhere),
-- the live social p2p_prayer_wall_posts/_comments/_reactions (untracked
-- origin, reactions table has zero RLS in source control), and the
-- correctly-built family-scoped p2p_family_prayer_requests (migration 117).
-- None of them represent "a peer is available to pray, invite them, an
-- actual gathering happens, someone actually participated" — that concept
-- does not exist anywhere in this codebase. This migration adds exactly
-- that, as a new, clearly-named namespace (p2p_prayer_coord_*) so it is
-- never confused with any of the three existing systems, none of which
-- this migration touches, alters, or reads from.
--
-- "Praying" here is deliberately NOT a reaction/counter (unlike
-- p2p_prayer_wall_reactions) — p2p_prayer_coord_participants is a real
-- attendance record, seeded at gathering-creation time as 'invited' and
-- only ever flipped to 'joined'/'left' by a server-verified event (Stage 3
-- wires this to the real, unmodified Direct Call join/leave lifecycle —
-- this migration only creates the table Stage 3 will write to).
--
-- Ownership is always the authenticated user (auth.uid()), never a
-- client-supplied id — every RLS policy below mirrors that; the API layer
-- (routes/prayerCoordination.ts) re-derives identity via verifyCaller()
-- and does its own fresh DB checks, with RLS as the backstop, matching
-- this codebase's established churchStudyPlans.ts/familyStudyPlans.ts
-- convention exactly.
--
-- Timezone: p2p_profiles.timezone (migration 047) already exists but is
-- unused by anything prayer-related and unvalidated. Rather than trust a
-- free-text profile field, every availability slot stores its OWN
-- IANA timezone (validated at the API layer via Node's Intl.supportedValuesOf)
-- alongside either an absolute date (one-off) or a day-of-week (weekly) plus
-- local start/end time — the actual UTC instant is computed server-side
-- with date-fns-tz (newly added dependency, see package.json) at read/match
-- time, never by comparing raw local-time strings across two rows.

-- ── p2p_prayer_coord_requests ────────────────────────────────────────────
-- "Would anyone like to pray with me?" A deliberately separate table from
-- p2p_prayer_wall_posts: the wall is a social feed (reactions, comments,
-- free-text testimonies); this is a structured coordination request with
-- a prayer mode and an expiration, neither of which the wall schema has
-- room for without overloading its already-fragile, untracked schema.
create table if not exists p2p_prayer_coord_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  title                text not null,
  prayer_point         text not null,
  category             text,
  scripture_reference  jsonb,
  is_anonymous         boolean not null default false,
  -- 'open': discoverable by any authenticated peer (still respects
  -- is_anonymous for display). 'private': never browsable — reachable only
  -- through a direct invitation that references it.
  visibility           text not null default 'open' check (visibility in ('open', 'private')),
  prayer_mode          text not null default 'both' check (prayer_mode in ('pray_for_me', 'pray_with_me', 'both')),
  status               text not null default 'open' check (status in ('open', 'answered', 'cancelled', 'expired')),
  expires_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_p2p_prayer_coord_requests_user on p2p_prayer_coord_requests(user_id, status);
create index if not exists idx_p2p_prayer_coord_requests_open on p2p_prayer_coord_requests(status, visibility) where status = 'open' and visibility = 'open';

-- ── p2p_prayer_coord_availability ────────────────────────────────────────
-- A published "I can pray at this time" slot. Either a single occurrence
-- (recurrence='once', specific_date) or a weekly recurring slot
-- (recurrence='weekly', day_of_week) — never both, enforced by the CHECK
-- below. start_time/end_time are the LOCAL wall-clock time in `timezone`;
-- the actual UTC instant for a given occurrence is computed at query time
-- (routes/prayerCoordination.ts), never stored as a bare local string
-- compared directly against another row's local string.
create table if not exists p2p_prayer_coord_availability (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  timezone       text not null,
  recurrence     text not null default 'once' check (recurrence in ('once', 'weekly')),
  specific_date  date,
  day_of_week    smallint check (day_of_week between 0 and 6),
  start_time     time not null,
  end_time       time not null,
  visibility     text not null default 'open' check (visibility in ('open', 'private')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_time > start_time),
  check (
    (recurrence = 'once' and specific_date is not null and day_of_week is null)
    or
    (recurrence = 'weekly' and day_of_week is not null and specific_date is null)
  )
);

create index if not exists idx_p2p_prayer_coord_availability_user on p2p_prayer_coord_availability(user_id, is_active);
create index if not exists idx_p2p_prayer_coord_availability_open on p2p_prayer_coord_availability(is_active, visibility) where is_active = true and visibility = 'open';

-- ── p2p_prayer_coord_invitations ─────────────────────────────────────────
-- request_id is nullable — an invitation MAY stand alone (an ad-hoc "let's
-- pray together" with only an inline message), or reference a formal
-- request (in which case the API enforces requester_id = request.user_id:
-- only the request's own owner can invite people to it).
create table if not exists p2p_prayer_coord_invitations (
  id                  uuid primary key default gen_random_uuid(),
  requester_id        uuid not null references auth.users(id) on delete cascade,
  recipient_id        uuid not null references auth.users(id) on delete cascade,
  request_id          uuid references p2p_prayer_coord_requests(id) on delete set null,
  proposed_start_at   timestamptz not null,
  proposed_end_at     timestamptz not null,
  message             text,
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  responded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (proposed_end_at > proposed_start_at),
  check (requester_id <> recipient_id)
);

create index if not exists idx_p2p_prayer_coord_invitations_recipient on p2p_prayer_coord_invitations(recipient_id, status);
create index if not exists idx_p2p_prayer_coord_invitations_requester on p2p_prayer_coord_invitations(requester_id, status);

-- Duplicate-invitation protection: the same requester cannot have more
-- than one PENDING invitation open to the same recipient for the same
-- (request_id, proposed_start_at) combination. coalesce() lets this cover
-- both request-linked and ad-hoc invitations with one index.
create unique index if not exists uq_p2p_prayer_coord_invitations_pending
  on p2p_prayer_coord_invitations (requester_id, recipient_id, coalesce(request_id::text, ''), proposed_start_at)
  where status = 'pending';

-- ── p2p_prayer_coord_gatherings ──────────────────────────────────────────
-- Created automatically the moment an invitation is accepted (never
-- client-createable directly). channel_name/call_log_id/actual_start_at/
-- actual_end_at stay null until Stage 3 wires the real, EXISTING, unmodified
-- Direct Call flow (POST /calls/peer-channel, /calls/start, /calls/token) —
-- this migration only reserves the columns; it does not implement or
-- duplicate any Agora/call logic.
create table if not exists p2p_prayer_coord_gatherings (
  id                   uuid primary key default gen_random_uuid(),
  invitation_id        uuid not null unique references p2p_prayer_coord_invitations(id) on delete cascade,
  host_id              uuid not null references auth.users(id) on delete cascade,
  recipient_id         uuid not null references auth.users(id) on delete cascade,
  request_id           uuid references p2p_prayer_coord_requests(id) on delete set null,
  scheduled_start_at   timestamptz not null,
  scheduled_end_at     timestamptz not null,
  status               text not null default 'scheduled' check (status in ('scheduled', 'starting', 'live', 'completed', 'cancelled', 'expired')),
  prayer_focus         text,
  scripture_reference  jsonb,
  channel_name         text,
  call_log_id          uuid references p2p_call_logs(id) on delete set null,
  actual_start_at      timestamptz,
  actual_end_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_p2p_prayer_coord_gatherings_host on p2p_prayer_coord_gatherings(host_id, status);
create index if not exists idx_p2p_prayer_coord_gatherings_recipient on p2p_prayer_coord_gatherings(recipient_id, status);

-- ── p2p_prayer_coord_participants ────────────────────────────────────────
-- The whole point of this table: distinguish "was invited to this
-- gathering" from "actually joined and prayed." Seeded with two 'invited'
-- rows (host + recipient) the instant a gathering is created; joined_at/
-- left_at are only ever set server-side from a verified call event
-- (Stage 3), never a client "I clicked Enter" self-report.
create table if not exists p2p_prayer_coord_participants (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references p2p_prayer_coord_gatherings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'participant' check (role in ('host', 'participant')),
  status        text not null default 'invited' check (status in ('invited', 'joined', 'left')),
  joined_at     timestamptz,
  left_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (gathering_id, user_id)
);

create index if not exists idx_p2p_prayer_coord_participants_gathering on p2p_prayer_coord_participants(gathering_id);
create index if not exists idx_p2p_prayer_coord_participants_user on p2p_prayer_coord_participants(user_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Backstop only — the real authorization is server-side in
-- routes/prayerCoordination.ts (service-role client + verifyCaller() +
-- fresh DB-derived checks), matching every other route file audited this
-- session. RLS here still must be correct and non-leaky on its own.

alter table p2p_prayer_coord_requests enable row level security;
alter table p2p_prayer_coord_availability enable row level security;
alter table p2p_prayer_coord_invitations enable row level security;
alter table p2p_prayer_coord_gatherings enable row level security;
alter table p2p_prayer_coord_participants enable row level security;

-- Requests: owner always; others only when open+visible+unexpired, OR when
-- the caller has a (pending/accepted) invitation that references this
-- request — so an invited recipient can read the request they were invited
-- about even if the owner later sets it private/cancelled mid-flow.
drop policy if exists "Own or open prayer requests" on p2p_prayer_coord_requests;
create policy "Own or open prayer requests" on p2p_prayer_coord_requests
  for select using (
    user_id = auth.uid()
    or (visibility = 'open' and status = 'open' and (expires_at is null or expires_at > now()))
    or exists (
      select 1 from p2p_prayer_coord_invitations i
      where i.request_id = p2p_prayer_coord_requests.id and i.recipient_id = auth.uid()
    )
  );
drop policy if exists "Create own prayer requests" on p2p_prayer_coord_requests;
create policy "Create own prayer requests" on p2p_prayer_coord_requests
  for insert with check (user_id = auth.uid());
drop policy if exists "Manage own prayer requests" on p2p_prayer_coord_requests;
create policy "Manage own prayer requests" on p2p_prayer_coord_requests
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Availability: owner always; others only when active+open (never a
-- private slot, never a disabled one).
drop policy if exists "Own or open availability" on p2p_prayer_coord_availability;
create policy "Own or open availability" on p2p_prayer_coord_availability
  for select using (
    user_id = auth.uid()
    or (is_active = true and visibility = 'open')
  );
drop policy if exists "Create own availability" on p2p_prayer_coord_availability;
create policy "Create own availability" on p2p_prayer_coord_availability
  for insert with check (user_id = auth.uid());
drop policy if exists "Manage own availability" on p2p_prayer_coord_availability;
create policy "Manage own availability" on p2p_prayer_coord_availability
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Delete own availability" on p2p_prayer_coord_availability;
create policy "Delete own availability" on p2p_prayer_coord_availability
  for delete using (user_id = auth.uid());

-- Invitations: only the two named parties ever see a row — never a global
-- "browse invitations" surface for anyone else.
drop policy if exists "Parties see their own invitations" on p2p_prayer_coord_invitations;
create policy "Parties see their own invitations" on p2p_prayer_coord_invitations
  for select using (requester_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Requester creates invitation" on p2p_prayer_coord_invitations;
create policy "Requester creates invitation" on p2p_prayer_coord_invitations
  for insert with check (requester_id = auth.uid());
drop policy if exists "Parties update their own invitations" on p2p_prayer_coord_invitations;
create policy "Parties update their own invitations" on p2p_prayer_coord_invitations
  for update using (requester_id = auth.uid() or recipient_id = auth.uid())
  with check (requester_id = auth.uid() or recipient_id = auth.uid());

-- Gatherings: only host or recipient — no third party, no cross-family/
-- cross-user leakage of any kind (this table has no other scoping concept
-- to leak across; it's inherently 1:1 in Stage 1).
drop policy if exists "Participants see their own gatherings" on p2p_prayer_coord_gatherings;
create policy "Participants see their own gatherings" on p2p_prayer_coord_gatherings
  for select using (host_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Participants update their own gatherings" on p2p_prayer_coord_gatherings;
create policy "Participants update their own gatherings" on p2p_prayer_coord_gatherings
  for update using (host_id = auth.uid() or recipient_id = auth.uid())
  with check (host_id = auth.uid() or recipient_id = auth.uid());
-- No client-side INSERT policy — a gathering is only ever created by the
-- service-role API (on invitation acceptance), never directly by a client.

-- Participants: a user can see the roster of a gathering they're actually
-- in (never someone else's gathering's roster).
drop policy if exists "See participants of my own gatherings" on p2p_prayer_coord_participants;
create policy "See participants of my own gatherings" on p2p_prayer_coord_participants
  for select using (
    exists (
      select 1 from p2p_prayer_coord_gatherings g
      where g.id = gathering_id and (g.host_id = auth.uid() or g.recipient_id = auth.uid())
    )
  );
-- No client-side INSERT/UPDATE policy — rows are seeded and updated only
-- by the service-role API (gathering creation, and later Stage 3's
-- server-verified join/leave events).
