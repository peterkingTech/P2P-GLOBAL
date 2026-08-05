-- 046: Integration and Onboarding Journey — 5-step mandatory flow every new
-- user goes through after registration/profile-setup, before Module 1.
-- Anchored in Romans 15:7 ("Accept one another, just as Christ accepted you").

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS onboarding_journey_completed_at timestamptz;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS tree_name text;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS greeting_to_peer_guide text;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS story_answers jsonb;

-- Backfill: every profile that already existed before this migration is a
-- returning user, not a brand-new signup — the app's AuthGate treats a null
-- onboarding_journey_completed_at as "must complete the journey now," so
-- without this backfill every existing user (with real progress, real
-- accounts) would get force-routed into "Meet Your Peer Guide" / "Plant Your
-- Tree" on their next login. Only genuinely new signups (created after this
-- migration runs) should ever see the journey.
UPDATE p2p_profiles
SET onboarding_journey_completed_at = now()
WHERE onboarding_journey_completed_at IS NULL;

-- ── Fix: profiles_select_scoped has no clause for "my active mentor / my
-- active disciple" ────────────────────────────────────────────────────────
-- Discovered while building Journey Step 1 ("Meet Your Peer Guide"), which
-- needs a disciple to read their assigned mentor's full_name/photo_url/
-- country/bio. The policy from migration 015 only covers self, admins, and
-- shared-group members — a 1:1 mentor/disciple pair who don't share a group
-- fails this policy and the read silently returns nothing (the same
-- silent-RLS-block pattern documented repeatedly elsewhere in this project).
-- This almost certainly also explains why DataContext.loadForestNetwork's
-- disciple names have likely been silently falling back to "A disciple" for
-- any mentor/disciple pair without a shared group — this policy is the
-- actual fix for that too, not just journey.tsx.
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
  OR EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND (
        (dl.mentor_id = auth.uid() AND dl.disciple_id = p2p_profiles.id)
        OR (dl.disciple_id = auth.uid() AND dl.mentor_id = p2p_profiles.id)
      )
  )
);