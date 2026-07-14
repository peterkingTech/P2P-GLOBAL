-- ── Fix pre-existing bug: p2p_flag_poster_identity referenced a column that ──
-- ── doesn't exist ──────────────────────────────────────────────────────────
-- Migration 013 selected p.avatar_url, but p2p_profiles' actual photo column
-- is photo_url (avatar_url only exists on p2p_registration_profiles). This
-- broke the moderator identity lookup for every flag type, not just the new
-- message/profile ones added in 018 — discovered via an end-to-end test that
-- actually called the function rather than just checking the schema exists.
-- The returned column is kept named avatar_url so the client (which already
-- reads idRow.avatar_url) doesn't need to change.
CREATE OR REPLACE FUNCTION p2p_flag_poster_identity(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  total_flags bigint,
  dismissed_count bigint,
  warned_count bigint,
  removed_count bigint,
  escalated_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF p2p_current_role() NOT IN ('moderator', 'church_leader', 'regional_admin', 'super_admin') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.photo_url,
    COUNT(f.id) AS total_flags,
    COUNT(f.id) FILTER (WHERE f.status = 'dismissed') AS dismissed_count,
    COUNT(f.id) FILTER (WHERE f.status = 'warned') AS warned_count,
    COUNT(f.id) FILTER (WHERE f.status = 'removed') AS removed_count,
    COUNT(f.id) FILTER (WHERE f.status = 'escalated') AS escalated_count
  FROM p2p_profiles p
  LEFT JOIN p2p_content_flags f ON f.author_id = p.id
  WHERE p.id = p_user_id
  GROUP BY p.id, p.full_name, p.photo_url;
END;
$$;
REVOKE ALL ON FUNCTION p2p_flag_poster_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_flag_poster_identity(uuid) TO authenticated;
