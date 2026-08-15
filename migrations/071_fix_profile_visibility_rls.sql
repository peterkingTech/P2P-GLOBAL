-- Fix: profiles_select_scoped (migration 046) has no clause honoring
-- p2p_profiles.profile_visibility ('public' | 'peers' | 'private', added in
-- migration 012) — the Settings toggle for it has existed this whole time
-- but was never actually wired into RLS, so it had zero effect. Concretely:
-- Discover (DataContext.getDiscoverablePeers) and Smart Match
-- (getSmartMatch) query arbitrary other users with no shared-group/mentor
-- relationship, which the existing policy doesn't cover — Postgres RLS
-- silently strips those rows (no error), so full_name/photo_url/etc. for
-- anyone you're not already connected to comes back empty and the UI falls
-- back to initial-letter avatars. Same silent-RLS-block pattern already
-- documented and fixed twice before in this exact policy (migrations 015,
-- 046) — this is the third occurrence of the same class of bug.
--
-- Fix: a profile with visibility 'public' or 'peers' (the column's default —
-- i.e. everyone except those who explicitly chose 'private') is readable by
-- any authenticated user. 'private' still requires one of the existing
-- relationship clauses.
DROP POLICY IF EXISTS "profiles_select_scoped" ON p2p_profiles;
CREATE POLICY "profiles_select_scoped" ON p2p_profiles
FOR SELECT
USING (
  id = auth.uid()
  OR p2p_current_role() = 'super_admin'
  OR profile_visibility IN ('public', 'peers')
  OR (
    p2p_current_role() IN ('church_leader', 'regional_admin')
    AND role = 'student'
    AND (
      (p2p_current_role() = 'church_leader' AND church_id IS NOT NULL AND church_id = p2p_current_church_id())
      OR (p2p_current_role() = 'regional_admin' AND region IS NOT NULL AND region = p2p_current_region())
    )
  )
  OR p2p_shares_group_with(id)
  OR EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND (
        (dl.mentor_id = auth.uid() AND dl.disciple_id = p2p_profiles.id)
        OR (dl.disciple_id = auth.uid() AND dl.mentor_id = p2p_profiles.id)
      )
  )
);