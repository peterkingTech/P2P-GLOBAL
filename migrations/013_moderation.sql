-- ── Moderation: content flags, minimal-identity lookup, and escalation ────────
-- Moderator scope (confirmed with product owner): moderators see flagged content
-- + reporter + a MINIMAL identity view of the poster (name, avatar, their own
-- past flag counts/outcomes). They must NOT see registration answers, growth
-- metrics, gifts/skills, or any other profile data. Anything needing deeper
-- context is escalated to church_leader/regional_admin/super_admin via the
-- existing p2p_help_requests queue (reused rather than building a new inbox).

CREATE TABLE IF NOT EXISTS public.p2p_content_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('prayer_post', 'prayer_comment')),
  content_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  reason text,
  content_snapshot text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'warned', 'removed', 'escalated')),
  resolved_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  escalation_help_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p2p_content_flags_status ON public.p2p_content_flags(status, created_at);
CREATE INDEX IF NOT EXISTS idx_p2p_content_flags_author ON public.p2p_content_flags(author_id);

ALTER TABLE public.p2p_content_flags ENABLE ROW LEVEL SECURITY;

-- Only moderator+ roles may read the queue directly (content_snapshot/reason only —
-- no join to profiles here; identity is served separately through a narrow function).
DROP POLICY IF EXISTS "content_flags_select_moderation" ON public.p2p_content_flags;
CREATE POLICY "content_flags_select_moderation" ON public.p2p_content_flags FOR SELECT TO authenticated
USING (
  reporter_id = auth.uid()
  OR p2p_current_role() IN ('moderator', 'church_leader', 'regional_admin', 'super_admin')
);

-- Reporting and all moderation actions go through SECURITY DEFINER functions below,
-- so no direct INSERT/UPDATE policy is granted to regular clients.

-- ── Report content (any authenticated user) ───────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_report_content(p_content_type text, p_content_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  v_author_id uuid;
  v_snapshot text;
  v_flag_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_content_type NOT IN ('prayer_post', 'prayer_comment') THEN
    RAISE EXCEPTION 'invalid content type';
  END IF;

  IF p_content_type = 'prayer_post' THEN
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_posts WHERE id = p_content_id;
  ELSE
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_comments WHERE id = p_content_id;
  END IF;

  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'content not found';
  END IF;

  INSERT INTO p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
  VALUES (p_content_type, p_content_id, v_author_id, me, p_reason, v_snapshot)
  RETURNING id INTO v_flag_id;

  RETURN v_flag_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_report_content(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_report_content(text, uuid, text) TO authenticated;

-- ── Minimal poster identity + own flag history (moderator+ only) ──────────────
-- Deliberately returns ONLY name, avatar, and this user's flag outcome counts —
-- never registration answers, growth/tree data, or gifts/skills.
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
    p.avatar_url,
    COUNT(f.id) AS total_flags,
    COUNT(f.id) FILTER (WHERE f.status = 'dismissed') AS dismissed_count,
    COUNT(f.id) FILTER (WHERE f.status = 'warned') AS warned_count,
    COUNT(f.id) FILTER (WHERE f.status = 'removed') AS removed_count,
    COUNT(f.id) FILTER (WHERE f.status = 'escalated') AS escalated_count
  FROM p2p_profiles p
  LEFT JOIN p2p_content_flags f ON f.author_id = p.id
  WHERE p.id = p_user_id
  GROUP BY p.id, p.full_name, p.avatar_url;
END;
$$;
REVOKE ALL ON FUNCTION p2p_flag_poster_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_flag_poster_identity(uuid) TO authenticated;

-- ── Take a moderation action on a flag ─────────────────────────────────────────
-- action: 'dismiss' | 'warn' | 'remove' | 'escalate'
-- 'remove' deletes the underlying content. 'escalate' routes to the existing
-- p2p_help_requests queue that church_leader/regional_admin/super_admin already see.
CREATE OR REPLACE FUNCTION p2p_moderate_flag(p_flag_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag p2p_content_flags%ROWTYPE;
  v_help_request_id uuid;
  v_new_status text;
BEGIN
  IF p2p_current_role() NOT IN ('moderator', 'church_leader', 'regional_admin', 'super_admin') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_action NOT IN ('dismiss', 'warn', 'remove', 'escalate') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  SELECT * INTO v_flag FROM p2p_content_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'flag not found';
  END IF;

  IF p_action = 'remove' THEN
    IF v_flag.content_type = 'prayer_post' THEN
      DELETE FROM p2p_prayer_wall_posts WHERE id = v_flag.content_id;
    ELSE
      DELETE FROM p2p_prayer_wall_comments WHERE id = v_flag.content_id;
    END IF;
    v_new_status := 'removed';
  ELSIF p_action = 'escalate' THEN
    INSERT INTO p2p_help_requests (user_id, tier, category, note, status)
    VALUES (
      v_flag.author_id,
      'struggling',
      'Moderation Escalation',
      COALESCE(p_note, 'Escalated from content flag: ' || COALESCE(v_flag.content_snapshot, '')),
      'open'
    )
    RETURNING id INTO v_help_request_id;
    v_new_status := 'escalated';
  ELSIF p_action = 'warn' THEN
    v_new_status := 'warned';
  ELSE
    v_new_status := 'dismissed';
  END IF;

  UPDATE p2p_content_flags
  SET status = v_new_status,
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_note = p_note,
      escalation_help_request_id = v_help_request_id
  WHERE id = p_flag_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_moderate_flag(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_moderate_flag(uuid, text, text) TO authenticated;
