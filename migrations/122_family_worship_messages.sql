-- 122: Together chat for Family Worship — messages belong to the active
-- Gathering (session-scoped, not family-scoped), reusing existing
-- verifyCaller() identity and the same active-participant authorization
-- boundary already established for p2p_family_worship_sessions/
-- participants/prayer_requests. No new identity system.
--
-- `context` is an unused, nullable placeholder — the explicit "leave room
-- for future contextual references (media timestamp / Scripture reference
-- / prayer request), do not implement those features yet" requirement.
-- No code reads or writes it today.
create table if not exists p2p_family_worship_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  context     jsonb, -- reserved for future contextual references; unused today
  created_at  timestamptz not null default now()
);

create index if not exists idx_p2p_family_worship_messages_session on p2p_family_worship_messages(session_id, created_at);

alter table p2p_family_worship_messages enable row level security;

drop policy if exists "active participants read session messages" on p2p_family_worship_messages;
create policy "active participants read session messages" on p2p_family_worship_messages
  for select using (
    exists (
      select 1 from p2p_family_worship_participants p
      where p.session_id = p2p_family_worship_messages.session_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

drop policy if exists "active participants send their own messages" on p2p_family_worship_messages;
create policy "active participants send their own messages" on p2p_family_worship_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from p2p_family_worship_participants p
      where p.session_id = p2p_family_worship_messages.session_id and p.user_id = auth.uid() and p.left_at is null
    )
  );