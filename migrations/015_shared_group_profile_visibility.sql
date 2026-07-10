-- Allow users to see basic profile info of peers they share a group with.
-- Without this, RLS on p2p_profiles hides group-mates' names/roles from
-- non-admin peers, breaking the group member list / add-peer UI.

CREATE OR REPLACE FUNCTION public.p2p_shares_group_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = auth.uid() AND gm2.user_id = p_user_id
  );
$$;

DROP POLICY IF EXISTS "profiles_select_scoped" ON p2p_profiles;

CREATE POLICY "profiles_select_scoped" ON p2p_profiles
FOR SELECT
USING (
  id = auth.uid()
  OR p2p_current_role() = 'super_admin'
  OR (
    p2p_current_role() IN ('church_leader', 'regional_admin')
    AND role = 'student'
    AND (
      (p2p_current_role() = 'church_leader' AND church_id IS NOT NULL AND church_id = p2p_current_church_id())
      OR (p2p_current_role() = 'regional_admin' AND region IS NOT NULL AND region = p2p_current_region())
    )
  )
  OR p2p_shares_group_with(id)
);
