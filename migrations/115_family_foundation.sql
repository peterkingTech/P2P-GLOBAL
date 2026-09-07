-- 115: My Family foundation — a family/household with role-based membership,
-- built as the prerequisite for the "Worship Together" feature. Nothing
-- called "family" existed anywhere in this codebase before this migration
-- (confirmed by full-repo audit) — this deliberately mirrors the shape and
-- RLS style of p2p_peer_circles/p2p_peer_circle_members (migration 044)
-- rather than inventing a new pattern, with two differences: named roles
-- instead of leader/member, and exactly one active family per user (a
-- family is a single household, not an open-enrollment learning group).

-- ── p2p_families ──────────────────────────────────────────────────────────────
create table if not exists p2p_families (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  shepherd_id  uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists idx_p2p_families_shepherd on p2p_families(shepherd_id);

-- ── p2p_family_members ────────────────────────────────────────────────────────
create table if not exists p2p_family_members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references p2p_families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'adult',   -- 'shepherd'|'co_shepherd'|'adult'|'teen'|'child'
  status      text not null default 'active',  -- 'active'|'invited'|'left'
  joined_at   timestamptz not null default now(),
  unique(family_id, user_id)
);

create index if not exists idx_p2p_family_members_user on p2p_family_members(user_id);
create index if not exists idx_p2p_family_members_family on p2p_family_members(family_id, status);

-- One active family per user — a household is singular, unlike Peer Circles
-- which deliberately allow multi-membership. Accepting a new invitation
-- while already active elsewhere must be rejected at the application layer
-- (routes/family.ts), this index is the hard backstop.
create unique index if not exists idx_p2p_family_members_one_active_per_user
  on p2p_family_members(user_id) where status = 'active';

-- ── p2p_family_invitations ────────────────────────────────────────────────────
create table if not exists p2p_family_invitations (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references p2p_families(id) on delete cascade,
  invited_by       uuid not null references auth.users(id) on delete cascade,
  invited_user_id  uuid not null references auth.users(id) on delete cascade,
  role             text not null default 'adult',
  status           text not null default 'pending', -- 'pending'|'accepted'|'declined'
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  unique(family_id, invited_user_id)
);

create index if not exists idx_p2p_family_invitations_invitee on p2p_family_invitations(invited_user_id, status);
create index if not exists idx_p2p_family_invitations_family on p2p_family_invitations(family_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_families enable row level security;
alter table p2p_family_members enable row level security;
alter table p2p_family_invitations enable row level security;

drop policy if exists "Members view their own family" on p2p_families;
create policy "Members view their own family" on p2p_families
  for select using (
    auth.uid() = shepherd_id
    or exists (select 1 from p2p_family_members m where m.family_id = p2p_families.id and m.user_id = auth.uid() and m.status = 'active')
  );
drop policy if exists "Shepherd manages their family" on p2p_families;
create policy "Shepherd manages their family" on p2p_families
  for all using (auth.uid() = shepherd_id) with check (auth.uid() = shepherd_id);
drop policy if exists "Authenticated users can create a family" on p2p_families;
create policy "Authenticated users can create a family" on p2p_families
  for insert with check (auth.uid() = shepherd_id);

drop policy if exists "Members view their family roster" on p2p_family_members;
create policy "Members view their family roster" on p2p_family_members
  for select using (
    auth.uid() = user_id
    or exists (select 1 from p2p_family_members m2 where m2.family_id = p2p_family_members.family_id and m2.user_id = auth.uid() and m2.status = 'active')
  );
drop policy if exists "Users manage their own membership row" on p2p_family_members;
create policy "Users manage their own membership row" on p2p_family_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Shepherd and co-shepherd manage roster" on p2p_family_members;
create policy "Shepherd and co-shepherd manage roster" on p2p_family_members
  for all using (
    exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
    or exists (select 1 from p2p_family_members m3 where m3.family_id = p2p_family_members.family_id and m3.user_id = auth.uid() and m3.status = 'active' and m3.role = 'co_shepherd')
  );

drop policy if exists "Users see invitations sent to or by them" on p2p_family_invitations;
create policy "Users see invitations sent to or by them" on p2p_family_invitations
  for select using (auth.uid() = invited_user_id or auth.uid() = invited_by);
drop policy if exists "Invitee responds to their own invitation" on p2p_family_invitations;
create policy "Invitee responds to their own invitation" on p2p_family_invitations
  for update using (auth.uid() = invited_user_id) with check (auth.uid() = invited_user_id);
drop policy if exists "Shepherd and co-shepherd send invitations" on p2p_family_invitations;
create policy "Shepherd and co-shepherd send invitations" on p2p_family_invitations
  for insert with check (
    auth.uid() = invited_by
    and (
      exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
      or exists (select 1 from p2p_family_members m4 where m4.family_id = p2p_family_invitations.family_id and m4.user_id = auth.uid() and m4.status = 'active' and m4.role = 'co_shepherd')
    )
  );