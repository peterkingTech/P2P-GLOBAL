-- 014: fix leftover infinite-recursion policy on p2p_group_members, close a
-- role-scoping leak on p2p_profiles / p2p_registration_profiles caused by
-- old permissive policies that were never dropped, and let peers create
-- groups + add other peers as members.

-- ── 1. Drop stale, recursive policies on p2p_group_members ─────────────────
-- These predate migration 011's SECURITY DEFINER fix and were never removed
-- (011's DROP list used different names), so they stayed active and caused
-- 42P17 "infinite recursion detected in policy" because they select from
-- p2p_group_members from within a policy on p2p_group_members itself.
DROP POLICY IF EXISTS "p2p_group_members_select" ON public.p2p_group_members;
DROP POLICY IF EXISTS "p2p_group_members_insert_self" ON public.p2p_group_members;
DROP POLICY IF EXISTS "p2p_group_members_delete_self" ON public.p2p_group_members;

-- ── 2. Close the profile-scoping leak ───────────────────────────────────────
-- "Authenticated users can view all profiles" was left in place after the
-- role-based rewrite (012) added "profiles_select_scoped". Since Postgres
-- OR's multiple permissive policies together, the old blanket policy
-- silently let every user see every profile regardless of role/region/church.
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.p2p_profiles;

-- Same issue on registration profiles: the old admin-blanket and
-- self-view policies co-exist with "registrations_select_scoped" and widen
-- access beyond the intended role scoping.
DROP POLICY IF EXISTS "Admins can view all registration profiles" ON public.p2p_registration_profiles;
DROP POLICY IF EXISTS "Users can view their own registration profile" ON public.p2p_registration_profiles;

-- ── 3. Allow peers to create groups ─────────────────────────────────────────
-- Previously only p2p_is_admin() could INSERT into p2p_groups. Any
-- authenticated peer may now create a group, provided they set themselves
-- as peer_guide_id (the creator/owner of the group).
DROP POLICY IF EXISTS "p2p_groups_peer_write" ON public.p2p_groups;
CREATE POLICY "p2p_groups_peer_write" ON public.p2p_groups
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND peer_guide_id = auth.uid());

-- Let the creator update/delete their own group in addition to admins.
DROP POLICY IF EXISTS "p2p_groups_owner_update" ON public.p2p_groups;
CREATE POLICY "p2p_groups_owner_update" ON public.p2p_groups
  FOR UPDATE
  USING (peer_guide_id = auth.uid() OR p2p_is_admin())
  WITH CHECK (peer_guide_id = auth.uid() OR p2p_is_admin());

DROP POLICY IF EXISTS "p2p_groups_owner_delete" ON public.p2p_groups;
CREATE POLICY "p2p_groups_owner_delete" ON public.p2p_groups
  FOR DELETE
  USING (peer_guide_id = auth.uid() OR p2p_is_admin());

-- ── 4. Allow group creators/members to add other peers ─────────────────────
-- The existing group_members_insert policy only allows self-join
-- (user_id = auth.uid()). Extend it so the group's creator or any existing
-- member can also add other people (invite flow), while still allowing
-- self-join.
DROP POLICY IF EXISTS "group_members_insert" ON public.p2p_group_members;
CREATE POLICY "group_members_insert" ON public.p2p_group_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR p2p_is_group_member(group_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.p2p_groups g
      WHERE g.id = group_id AND g.peer_guide_id = auth.uid()
    )
    OR p2p_is_admin()
  );

-- Allow the group creator to remove members too (moderation of their own group).
DROP POLICY IF EXISTS "group_members_delete" ON public.p2p_group_members;
CREATE POLICY "group_members_delete" ON public.p2p_group_members
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.p2p_groups g
      WHERE g.id = group_id AND g.peer_guide_id = auth.uid()
    )
    OR p2p_is_admin()
  );
