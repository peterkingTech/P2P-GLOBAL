-- 232 (Phase 0 security fixes, approved by the owner 2026-11-04; restore-
-- tested; applied only with the guarded production procedure): PRIVILEGES ONLY.
--
-- growth_level (the six growth stages) could be changed by the person
-- themselves: migration 174 left it in the columns a signed-in user may
-- update, because the app of that time wrote it. No current app code writes
-- it (the last path, AuthContext.updateProfile's growthLevel, is removed), so
-- anyone could still set themselves to any stage with a direct request.
--
-- Now only P2P's own growth calculation changes it: the SECURITY DEFINER
-- triggers p2p_log_growth_on_lesson_complete / p2p_log_growth_on_discipleship
-- (migration 010/088) run as the function owner and are unaffected.
-- Reading growth_level is unchanged (178). No data changes. Idempotent.

revoke update (growth_level) on public.p2p_profiles from authenticated;
revoke update (growth_level) on public.p2p_profiles from anon;

-- Rollback (restores the 174 behaviour — not recommended):
--   grant update (growth_level) on public.p2p_profiles to authenticated;
