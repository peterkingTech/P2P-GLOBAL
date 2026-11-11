-- 245 — Private groups and Communities. Written 2026-11-10. REQUIRES 229 (conversation_type check).
-- NOT APPLIED. Additive: new tables, new nullable columns, one more conversation_type, one new trigger.
-- No existing conversation, member, message, Family, Church or Circle row changes.
--
-- A private GROUP is an ordinary group conversation (p2p_conversations type 'group',
-- conversation_type 'private_group'), so chat, receipts, media, calls and the existing
-- membership rule (p2p_is_conversation_member — RLS on conversations, members and messages) all apply
-- unchanged: only members can see it exists, read it or post. Removing a member removes their row, so
-- access to future content ends immediately (history rows stay, as for every conversation).
--
-- A COMMUNITY is a private space holding several groups. Community membership NEVER grants access to
-- its groups — each group keeps its own members. Family and Church are not copied into communities:
-- the API presents them as communities from their existing records (no duplicates, no data move);
-- the optional family_id / church_id link is reserved for a later, separately approved step.
--
--   p2p_communities                 name, description, image, creator, archived
--   p2p_community_members           community roles: owner | admin | member
--   p2p_conversations (+ columns)   community_id, description, photo_url, created_by, archived_at,
--                                   posting ('everyone' | 'admins'), is_announcements
--   p2p_conversation_members (+ role) 'admin' | 'member' (existing rows: member; NULL never)
--   p2p_group_invitations           a person invited to a group or community: pending/accepted/declined/revoked
--   p2p_group_invite_links          shareable links: hashed token, expiry, revocation, use limit, approval
--   p2p_group_join_requests         link joins that need an administrator's approval
--   p2p_group_events                append-only audit of membership and administration
--
-- Security: the new tables are API-ONLY (RLS on, no client policies or grants). Group posting rules are
-- enforced by a trigger on p2p_messages (posting = 'admins' → only group admins; archived → nobody).
-- Rollback: drop the trigger, the new tables and the new columns; restore the 229 conversation_type check.

-- ── Groups live in p2p_conversations ──────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'p2p_conversations_conversation_type_check'
             and pg_get_constraintdef(oid) not like '%private_group%') then
    alter table public.p2p_conversations drop constraint p2p_conversations_conversation_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_conversations_conversation_type_check') then
    alter table public.p2p_conversations add constraint p2p_conversations_conversation_type_check
      check (conversation_type = any (array['direct', 'crisis_response', 'help_request', 'pastoral', 'support', 'peer_group', 'circle', 'family', 'church', 'evaluation', 'private_group']));
  end if;
end $$;

create table if not exists public.p2p_communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 1000),
  photo_url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  family_id uuid unique references public.p2p_families(id) on delete set null,
  church_id uuid unique references public.p2p_churches(id) on delete set null
);

create table if not exists public.p2p_community_members (
  community_id uuid not null references public.p2p_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (community_id, user_id)
);
create index if not exists idx_p2p_community_members_user on public.p2p_community_members (user_id);

alter table public.p2p_conversations add column if not exists community_id uuid references public.p2p_communities(id) on delete set null;
alter table public.p2p_conversations add column if not exists description text;
alter table public.p2p_conversations add column if not exists photo_url text;
alter table public.p2p_conversations add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.p2p_conversations add column if not exists archived_at timestamptz;
alter table public.p2p_conversations add column if not exists posting text not null default 'everyone';
alter table public.p2p_conversations add column if not exists is_announcements boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_conversations_posting_check') then
    alter table public.p2p_conversations add constraint p2p_conversations_posting_check check (posting in ('everyone', 'admins'));
  end if;
end $$;
create index if not exists idx_p2p_conversations_community on public.p2p_conversations (community_id) where community_id is not null;

alter table public.p2p_conversation_members add column if not exists role text not null default 'member';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_conversation_members_role_check') then
    alter table public.p2p_conversation_members add constraint p2p_conversation_members_role_check check (role in ('admin', 'member'));
  end if;
end $$;

create table if not exists public.p2p_group_invitations (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('group', 'community')),
  target_id uuid not null,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists uq_p2p_group_invitations_pending on public.p2p_group_invitations (target_type, target_id, invited_user_id) where status = 'pending';
create index if not exists idx_p2p_group_invitations_user on public.p2p_group_invitations (invited_user_id, status);

create table if not exists public.p2p_group_invite_links (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('group', 'community')),
  target_id uuid not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  requires_approval boolean not null default false,
  revoked_at timestamptz
);

create table if not exists public.p2p_group_join_requests (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('group', 'community')),
  target_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid references public.p2p_group_invite_links(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);
create unique index if not exists uq_p2p_group_join_requests_pending on public.p2p_group_join_requests (target_type, target_id, user_id) where status = 'pending';

create table if not exists public.p2p_group_events (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('group', 'community')),
  target_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  subject_id uuid references auth.users(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_p2p_group_events_target on public.p2p_group_events (target_type, target_id, created_at);
create or replace function public.p2p_group_events_append_only() returns trigger language plpgsql as $$
begin raise exception 'p2p_group_events is append-only' using errcode = '42501'; end $$;
drop trigger if exists trg_p2p_group_events_append_only on public.p2p_group_events;
create trigger trg_p2p_group_events_append_only before update or delete on public.p2p_group_events
  for each row execute function public.p2p_group_events_append_only();

-- ── Posting rules, enforced in the database for every writer (app, API, old builds) ──
create or replace function public.p2p_group_posting_rule() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; r text;
begin
  select posting, archived_at, conversation_type into c from p2p_conversations where id = new.conversation_id;
  if c is null or c.conversation_type is distinct from 'private_group' then return new; end if;
  if c.archived_at is not null then
    raise exception 'This group is closed' using errcode = '42501';
  end if;
  if c.posting = 'admins' then
    select role into r from p2p_conversation_members where conversation_id = new.conversation_id and user_id = new.sender_id;
    if r is distinct from 'admin' then
      raise exception 'Only group administrators can post here' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_group_posting_rule on public.p2p_messages;
create trigger trg_p2p_group_posting_rule before insert on public.p2p_messages
  for each row execute function public.p2p_group_posting_rule();

-- ── API-only tables ───────────────────────────────────────────────────────────
alter table public.p2p_communities enable row level security;
alter table public.p2p_community_members enable row level security;
alter table public.p2p_group_invitations enable row level security;
alter table public.p2p_group_invite_links enable row level security;
alter table public.p2p_group_join_requests enable row level security;
alter table public.p2p_group_events enable row level security;
revoke all on public.p2p_communities, public.p2p_community_members, public.p2p_group_invitations, public.p2p_group_invite_links,
  public.p2p_group_join_requests, public.p2p_group_events from anon, authenticated;
grant select, insert, update, delete on public.p2p_communities, public.p2p_community_members, public.p2p_group_invitations,
  public.p2p_group_invite_links, public.p2p_group_join_requests, public.p2p_group_events to service_role;
revoke all on function public.p2p_group_posting_rule() from public, anon, authenticated;
revoke all on function public.p2p_group_events_append_only() from public, anon, authenticated;

do $$ begin raise notice 'P2P_GROUPS_245: private groups and communities ready (% existing conversations unchanged)', (select count(*) from public.p2p_conversations); end $$;
