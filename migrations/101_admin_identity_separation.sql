-- Admin Identity Separation.
--
-- Two real gaps found by audit, both closed at the RLS layer (not just the
-- API layer already patched in calls.ts and officialMessages.ts) since the
-- UI/API is not the security boundary here — a direct PostgREST/
-- supabase-js call must be blocked too:
--
-- 1. p2p_incoming_calls' INSERT policy had no constraint on recipient_id at
--    all, so a client could ring an admin's personal account or a "P2P
--    Official" identity by inserting a row directly, bypassing
--    /calls/start's application-layer check entirely.
-- 2. p2p_profiles' profiles_select_scoped policy grants visibility to any
--    row with profile_visibility IN ('public','peers') (the column
--    default) with no exclusion for admin/official rows — so any
--    authenticated user's direct query (exactly what Discover Peers
--    already does) can enumerate every admin and official account.
--
-- p2p_is_admin_or_official() below deliberately excludes peer_guide and
-- church_leader — those are legitimate, normal discovery/calling targets
-- (a disciple calling their own peer guide; Church Portal is documented as
-- a separate permission domain) and must not be swept up by "hide admins"
-- logic. This mirrors artifacts/api-server/src/routes/calls.ts's
-- P2P_ADMIN_ROLES set exactly — keep the two in sync if either changes.

CREATE OR REPLACE FUNCTION public.p2p_is_admin_or_official(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_official_account
       OR role IN (
         'super_admin', 'regional_admin', 'moderator',
         'admin_supervisor', 'admin_zone', 'admin_national', 'admin_content',
         'admin_translation', 'admin_moderation', 'admin_verification',
         'admin_help', 'admin_username', 'admin_finance', 'admin_marketing', 'admin_church'
       )
     FROM p2p_profiles WHERE id = p_user_id),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.p2p_is_admin_or_official(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p2p_is_admin_or_official(uuid) TO authenticated;

-- ── 1. Calling: tighten p2p_incoming_calls INSERT ───────────────────────────
-- A normal user may not initiate a call TO an admin/official account; an
-- admin/official caller may call anyone. Mirrors calls.ts's /calls/start
-- check so the API and the database agree.
DROP POLICY IF EXISTS "Users create outgoing calls" ON p2p_incoming_calls;
CREATE POLICY "Users create outgoing calls" ON p2p_incoming_calls
  FOR INSERT WITH CHECK (
    auth.uid() = caller_id
    AND (
      NOT p2p_is_admin_or_official(recipient_id)
      OR p2p_is_admin_or_official(caller_id)
    )
  );

-- ── 2. Discover Peers / general enumeration: carve admins/officials out of
--       the blanket "peers" visibility branch, then add back the two narrow,
--       legitimate contexts where a user still needs to read that profile ──
CREATE OR REPLACE FUNCTION public.p2p_shares_conversation_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM p2p_conversation_members m1
    JOIN p2p_conversation_members m2 ON m1.conversation_id = m2.conversation_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = p_user_id
  );
$$;
REVOKE ALL ON FUNCTION public.p2p_shares_conversation_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p2p_shares_conversation_with(uuid) TO authenticated;

DROP POLICY IF EXISTS "profiles_select_scoped" ON p2p_profiles;
CREATE POLICY "profiles_select_scoped" ON p2p_profiles
FOR SELECT
USING (
  id = auth.uid()
  OR p2p_current_role() = 'super_admin'
  OR (
    profile_visibility IN ('public', 'peers')
    AND NOT p2p_is_admin_or_official(id)
  )
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
  -- Legitimate context 1: you're in a conversation with this official
  -- account (e.g. a Compose/official thread) — you still need to read its
  -- name/photo/badge fields to render the thread.
  OR (is_official_account = true AND p2p_shares_conversation_with(id))
  -- Legitimate context 2: this admin called you — you still need to read
  -- their name to render the incoming-call screen.
  OR (
    p2p_is_admin_or_official(id)
    AND EXISTS (
      SELECT 1 FROM p2p_incoming_calls ic
      WHERE ic.caller_id = p2p_profiles.id AND ic.recipient_id = auth.uid()
    )
  )
);