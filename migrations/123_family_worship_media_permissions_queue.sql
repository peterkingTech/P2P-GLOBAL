-- 123: Media Permissions + Media Shelf (shared queue) for P2P Together
-- Phase 5. Additive only — three new columns on the existing session row
-- (same pattern as media_provider in migration 119) plus one new,
-- minimal queue table.
alter table p2p_family_worship_sessions
  add column if not exists media_permission text not null default 'guide_only', -- 'guide_only'|'trusted'|'everyone'
  add column if not exists trusted_user_ids uuid[] not null default '{}',
  add column if not exists auto_advance boolean not null default false;

-- p2p_family_worship_queue — provider references only (provider +
-- external_id), never downloaded/rehosted media, same principle as the
-- Shared Media player itself (migration 119).
create table if not exists p2p_family_worship_queue (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  media_provider text not null,
  media_id       text not null,
  title          text,
  thumbnail_url  text,
  added_by       uuid not null references auth.users(id) on delete cascade,
  position       integer not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_p2p_family_worship_queue_session on p2p_family_worship_queue(session_id, position);

alter table p2p_family_worship_queue enable row level security;

-- Read-only RLS — every write goes through familyWorship.ts's service-role
-- client with its own permission-tier check (guide_only/trusted/everyone),
-- which is dynamic (depends on the session row) and therefore lives in
-- application code, not a static RLS policy. Same division of
-- responsibility already used for every other worship table's writes.
drop policy if exists "active participants read the queue" on p2p_family_worship_queue;
create policy "active participants read the queue" on p2p_family_worship_queue
  for select using (
    exists (
      select 1 from p2p_family_worship_participants p
      where p.session_id = p2p_family_worship_queue.session_id and p.user_id = auth.uid() and p.left_at is null
    )
  );