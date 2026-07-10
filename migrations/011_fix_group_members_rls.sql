-- Fixes "infinite recursion detected in policy for relation p2p_group_members"
-- Root cause: a SELECT/INSERT policy on p2p_group_members queried p2p_group_members
-- itself (e.g. "is the requester a member of this group") which re-triggers RLS on
-- the same table, causing Postgres to detect infinite recursion.
--
-- Fix: use a SECURITY DEFINER helper function to check membership. SECURITY DEFINER
-- functions bypass RLS for their internal query, so the check no longer recurses.

CREATE OR REPLACE FUNCTION p2p_is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION p2p_is_group_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_group_member(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "group_members_select" ON p2p_group_members;
DROP POLICY IF EXISTS "group_members_select_own_group" ON p2p_group_members;
DROP POLICY IF EXISTS "group_members_insert" ON p2p_group_members;
DROP POLICY IF EXISTS "group_members_delete" ON p2p_group_members;
DROP POLICY IF EXISTS "Users can view group members" ON p2p_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON p2p_group_members;
DROP POLICY IF EXISTS "Users can leave groups" ON p2p_group_members;

ALTER TABLE p2p_group_members ENABLE ROW LEVEL SECURITY;

-- A user can see membership rows for any group they themselves belong to
-- (uses the SECURITY DEFINER function instead of a direct self-referential subquery).
CREATE POLICY "group_members_select"
ON p2p_group_members FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR p2p_is_group_member(group_id, auth.uid())
);

-- A user can add themselves to a group (join).
CREATE POLICY "group_members_insert"
ON p2p_group_members FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- A user can remove themselves from a group (leave).
CREATE POLICY "group_members_delete"
ON p2p_group_members FOR DELETE
TO authenticated
USING (user_id = auth.uid());
