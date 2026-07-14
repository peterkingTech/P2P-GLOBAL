-- ── Extend moderation reporting to direct messages and profiles ──────────────
-- Previously only prayer_post/prayer_comment could be flagged. Strangers are
-- now reachable via DMs (012) and browsable via discovery/smart-match, so both
-- surfaces need the same report path. Reuses the existing queue/identity/action
-- functions from 013 rather than building anything new.

-- content_type CHECK is dropped/recreated by name lookup rather than a hardcoded
-- constraint name, since the name Postgres assigned it in 013 isn't guaranteed.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'p2p_content_flags'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%content_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.p2p_content_flags DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.p2p_content_flags
  ADD CONSTRAINT p2p_content_flags_content_type_check
  CHECK (content_type IN ('prayer_post', 'prayer_comment', 'message', 'profile'));

-- ── Report content: add 'message' and 'profile' branches ─────────────────────
-- 'message': content_id is the p2p_messages row; author is the sender.
-- 'profile': content_id IS the reported user's own profile id; author_id is
-- that same id (there's no separate "content" to look up). Snapshot is the
-- bio so moderators have something to review beyond the name/avatar they
-- already get from p2p_flag_poster_identity.
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
  v_conversation_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_content_type NOT IN ('prayer_post', 'prayer_comment', 'message', 'profile') THEN
    RAISE EXCEPTION 'invalid content type';
  END IF;

  IF p_content_type = 'prayer_post' THEN
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_posts WHERE id = p_content_id;
  ELSIF p_content_type = 'prayer_comment' THEN
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_comments WHERE id = p_content_id;
  ELSIF p_content_type = 'message' THEN
    SELECT sender_id, body, conversation_id INTO v_author_id, v_snapshot, v_conversation_id
      FROM p2p_messages WHERE id = p_content_id;
    IF v_author_id IS NOT NULL AND NOT p2p_is_conversation_member(v_conversation_id, me) THEN
      RAISE EXCEPTION 'not permitted to report this message';
    END IF;
  ELSE -- 'profile'
    IF p_content_id = me THEN
      RAISE EXCEPTION 'cannot report your own profile';
    END IF;
    SELECT id, bio INTO v_author_id, v_snapshot FROM p2p_profiles WHERE id = p_content_id;
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

-- ── Moderation action: add 'message' and 'profile' handling to 'remove' ───────
-- 'message' remove: delete the offending row, same as prayer content.
-- 'profile' remove: there's no separate "content" row to delete — removing a
-- whole account is a much heavier, distinct action (out of scope here). The
-- equivalent "take down the offending content" action for a profile report is
-- clearing the fields that could actually contain the reported material
-- (avatar photo, bio), not deleting the account.
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
    ELSIF v_flag.content_type = 'prayer_comment' THEN
      DELETE FROM p2p_prayer_wall_comments WHERE id = v_flag.content_id;
    ELSIF v_flag.content_type = 'message' THEN
      DELETE FROM p2p_messages WHERE id = v_flag.content_id;
    ELSE -- 'profile'
      UPDATE p2p_profiles SET avatar_url = NULL, bio = NULL WHERE id = v_flag.content_id;
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
