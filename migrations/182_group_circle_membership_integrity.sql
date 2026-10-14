-- 182: Group / circle membership integrity.
--
-- DRAFT — NOT APPLIED to production. Validate on staging first.
-- Separate from 179 (receipts), 180 (messaging hardening) and 181 (peer-group
-- type); apply after 181. Touches no call/Agora object.
--
-- Group and circle conversation membership is derived from p2p_group_members /
-- p2p_peer_circle_members by the SECURITY DEFINER sync triggers, so whoever can
-- write those tables decides who reads the group/circle chat. Migration 180
-- closed direct writes to p2p_conversation_members; this closes the paths
-- through the source tables. Findings (staging = production copy, 2026-10-12):
--
-- Circles — the app never writes circle tables directly; every change goes
-- through the API (routes/circles.ts, service role): join requests, approval,
-- add-by-username, role change, removal (status='removed'), leadership
-- transfer. Yet two ALL policies let clients write p2p_peer_circle_members:
--   "Users manage their own membership"  (auth.uid() = user_id)
--      -> insert self into ANY circle (bypassing join requests), set own role
--         to 'leader', set own status back to 'active' after removal;
--   "Leaders manage circle roster"
--      -> add anyone to your circle without their consent.
-- Fix: drop both policies and all client write privileges. The roster read
-- policy "Members can view their circle roster" is rewritten to remove a
-- pre-existing infinite-recursion error (same intent; see section 1).
--
-- Circle sync ignored status: removal sets status='removed' (an UPDATE) but
-- the trigger fired only on INSERT/DELETE, so removed members kept reading the
-- circle conversation. Fix: status-aware sync on INSERT, UPDATE OF status and
-- DELETE — only 'active' members are conversation members. One-time cleanup of
-- existing removed members' conversation access, recorded in
-- p2p_membership_revocations_182 so it can be reversed exactly.
--
-- Groups — joining an open group is an app feature (connect/groups.tsx "Join",
-- DataContext.joinGroup inserts the user's own row), so self-insert stays.
-- But group_members_insert also allowed ANY group member to add ANY user
-- (p2p_is_group_member clause); the app only offers "Add peer" to the group's
-- creator (connect/group/[id].tsx isCreator). Fix: insert allowed for self,
-- the group's peer guide, or an admin. Delete policy unchanged.
--
-- Group sync created a conversation even on DELETE when none existed. Fix:
-- create only on INSERT. Keeps 181's conversation_type = 'peer_group'.
--
-- Not changed: SELECT policies, p2p_groups / p2p_peer_circles policies,
-- p2p_peer_circle_join_requests, conversations/messages/receipts privileges,
-- function owners/privileges (CREATE OR REPLACE preserves them).

begin;

-- ── 1. Circle membership: no client writes ──────────────────────────────────
drop policy if exists "Users manage their own membership" on public.p2p_peer_circle_members;
drop policy if exists "Leaders manage circle roster" on public.p2p_peer_circle_members;
revoke insert, update, delete, truncate on table public.p2p_peer_circle_members from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_peer_circle_members';
  execute format('revoke insert (%s), update (%s) on table public.p2p_peer_circle_members from anon, authenticated', cols, cols);
end $$;

-- IMPORTANT: this recursion fix must ship together with the write-policy
-- removal above (same transaction). Before 182, self-promotion to 'leader' and
-- self-reactivation were allowed by "Users manage their own membership" but
-- failed in practice only because every UPDATE also hit the recursive SELECT
-- policy. Fixing the recursion alone would have opened both (staging-verified).
--
-- Roster read policy: the original "Members can view their circle roster"
-- queried p2p_peer_circle_members from inside its own policy, which PostgreSQL
-- rejects for every client read ("infinite recursion detected", 42P17 —
-- verified on staging; the app reads rosters through the API, so it went
-- unnoticed). Same intent, via the existing SECURITY DEFINER helper
-- p2p_is_active_circle_member (migrations 091-093): own row, or the roster of
-- a circle you are an ACTIVE member of (removed members no longer see it).
drop policy if exists "Members can view their circle roster" on public.p2p_peer_circle_members;
create policy "Members can view their circle roster" on public.p2p_peer_circle_members
  for select to public
  using (
    (select auth.uid()) = user_id
    or p2p_is_active_circle_member(circle_id::text, (select auth.uid()))
  );

-- ── 2. Group membership: self-join, group creator or admin only ─────────────
drop policy if exists "group_members_insert" on public.p2p_group_members;
create policy "group_members_insert" on public.p2p_group_members
  for insert to public
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.p2p_groups g where g.id = p2p_group_members.group_id and g.peer_guide_id = (select auth.uid()))
    or p2p_is_admin()
  );

-- ── 3. Status-aware circle conversation sync ────────────────────────────────
create or replace function public.p2p_sync_circle_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  conv_id uuid;
  v_circle uuid := COALESCE(NEW.circle_id, OLD.circle_id);
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_now_active boolean := TG_OP <> 'DELETE' AND COALESCE(NEW.status, 'active') = 'active';
BEGIN
  SELECT id INTO conv_id FROM p2p_conversations WHERE circle_id = v_circle;
  IF v_now_active THEN
    IF conv_id IS NULL THEN
      INSERT INTO p2p_conversations (type, circle_id, conversation_type, name)
      SELECT 'group', c.id, 'circle', c.name FROM p2p_peer_circles c WHERE c.id = v_circle
      RETURNING id INTO conv_id;
    END IF;
    INSERT INTO p2p_conversation_members (conversation_id, user_id)
    VALUES (conv_id, v_user)
    ON CONFLICT DO NOTHING;
  ELSIF conv_id IS NOT NULL THEN
    -- Inactive (removed/pending/…) or deleted: no conversation access unless
    -- the user still has another active membership row for this circle.
    DELETE FROM p2p_conversation_members
    WHERE conversation_id = conv_id AND user_id = v_user
      AND NOT EXISTS (
        SELECT 1 FROM p2p_peer_circle_members pm
        WHERE pm.circle_id = v_circle AND pm.user_id = v_user
          AND COALESCE(pm.status, 'active') = 'active'
          AND pm.id IS DISTINCT FROM COALESCE(NEW.id, OLD.id)
      );
  END IF;
  RETURN NULL;
END;
$function$;

drop trigger if exists p2p_peer_circle_members_sync_conversation on public.p2p_peer_circle_members;
create trigger p2p_peer_circle_members_sync_conversation
  after insert or delete or update of status on public.p2p_peer_circle_members
  for each row execute function public.p2p_sync_circle_conversation();

-- ── 4. Group sync: never create a conversation on DELETE (keeps 181) ────────
create or replace function public.p2p_sync_group_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM p2p_conversations WHERE group_id = COALESCE(NEW.group_id, OLD.group_id);
  IF conv_id IS NULL AND TG_OP = 'INSERT' THEN
    INSERT INTO p2p_conversations (type, group_id, conversation_type, name)
    SELECT 'group', g.id, 'peer_group', g.name FROM p2p_groups g WHERE g.id = NEW.group_id
    RETURNING id INTO conv_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO p2p_conversation_members (conversation_id, user_id)
    VALUES (conv_id, NEW.user_id)
    ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'DELETE' AND conv_id IS NOT NULL THEN
    DELETE FROM p2p_conversation_members WHERE conversation_id = conv_id AND user_id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$function$;

-- ── 5. One-time: removed circle members lose circle-chat access (recorded) ──
create table if not exists public.p2p_membership_revocations_182 (
  conversation_id uuid not null,
  user_id uuid not null,
  reason text not null,
  revoked_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.p2p_membership_revocations_182 enable row level security;
revoke all on table public.p2p_membership_revocations_182 from public, anon, authenticated;

do $$
declare v_count integer;
begin
  with revoked as (
    delete from public.p2p_conversation_members cm
    using public.p2p_conversations c
    where c.id = cm.conversation_id
      and c.circle_id is not null
      -- evidence: the user HAS a circle membership row, and none is active
      and exists (select 1 from public.p2p_peer_circle_members pm where pm.circle_id = c.circle_id and pm.user_id = cm.user_id)
      and not exists (select 1 from public.p2p_peer_circle_members pm where pm.circle_id = c.circle_id and pm.user_id = cm.user_id
                      and coalesce(pm.status, 'active') = 'active')
    returning cm.conversation_id, cm.user_id
  )
  insert into public.p2p_membership_revocations_182 (conversation_id, user_id, reason)
  select conversation_id, user_id, 'circle membership not active' from revoked
  on conflict do nothing;
  get diagnostics v_count = row_count;
  raise notice 'migration 182: % circle-conversation membership(s) of inactive circle members revoked (recorded)', v_count;
end $$;

commit;

-- Rollback (manual):
--   begin;
--   -- restore revoked conversation access exactly:
--   insert into public.p2p_conversation_members (conversation_id, user_id)
--     select conversation_id, user_id from public.p2p_membership_revocations_182 on conflict do nothing;
--   -- previous circle sync (INSERT/DELETE only) and trigger:
--   --   re-run migration 068's p2p_sync_circle_conversation + its trigger definition
--   -- previous group sync: re-run migration 181's function body
--   drop policy if exists "group_members_insert" on public.p2p_group_members;
--   create policy "group_members_insert" on public.p2p_group_members for insert to public with check (
--     (user_id = (select auth.uid())) or p2p_is_group_member(group_id, (select auth.uid()))
--     or exists (select 1 from p2p_groups g where g.id = p2p_group_members.group_id and g.peer_guide_id = (select auth.uid()))
--     or p2p_is_admin());
--   drop policy if exists "Members can view their circle roster" on public.p2p_peer_circle_members;
--   create policy "Members can view their circle roster" on public.p2p_peer_circle_members for select to public
--     using ((auth.uid() = user_id) or (exists (select 1 from p2p_peer_circle_members m2
--       where m2.circle_id = p2p_peer_circle_members.circle_id and m2.user_id = auth.uid())));
--   grant insert, update, delete, truncate on table public.p2p_peer_circle_members to anon, authenticated;
--   create policy "Users manage their own membership" on public.p2p_peer_circle_members for all to public
--     using (auth.uid() = user_id) with check (auth.uid() = user_id);
--   create policy "Leaders manage circle roster" on public.p2p_peer_circle_members for all to public
--     using (exists (select 1 from p2p_peer_circles c where c.id = p2p_peer_circle_members.circle_id and c.leader_id = auth.uid()));
--   commit;
