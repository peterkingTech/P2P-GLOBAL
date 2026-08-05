-- 048: AuthContext.tsx has real, built Settings/Profile/Intake UI (Mission,
-- Calling, Occupation, Location with GPS auto-detect) that reads/writes
-- city, mission, calling, occupation on p2p_profiles — none of these four
-- columns ever existed on the real table. Because updateProfile() bundles
-- every changed field into ONE UPDATE statement, any user who filled in any
-- of these four fields got their ENTIRE "Save Profile" action rejected by
-- Postgres (not just these fields silently ignored) — same root-cause
-- pattern as migration 002's original city/growth_level/gifts/is_praying gap.
--
-- mentor_id (also read in AuthContext.tsx) is NOT added here — mentor
-- relationships are correctly modeled by p2p_discipleship_links, and nothing
-- outside AuthContext.tsx itself ever read profile.mentorId, so that field is
-- being removed from the app code instead (see the AuthContext.tsx fix in
-- this same commit), not backed by a new column.

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS mission text;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS calling text;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS occupation text;