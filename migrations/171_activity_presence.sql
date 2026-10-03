-- Activity presence ("Active now" / "Active yesterday") for peers.
--
-- Deliberately NOT columns on p2p_profiles: profiles_select_scoped lets any
-- authenticated user read the full row of any profile whose visibility is
-- 'public'/'peers', and authenticated holds table-wide SELECT, so a
-- last-seen column there would be readable by anyone. A separate table whose
-- only SELECT policy is "own row", with all cross-user reads going through
-- one SECURITY DEFINER function, keeps the exact timestamp server-side.
--
-- Also deliberately separate from p2p_profiles.last_active_at, which drives
-- pastoral care (Elijah Protocol / Dormant Seed). Opening the app must not
-- count as "active" for that.
--
-- Additive only: one new table, three new functions. No existing table,
-- policy, grant or function is changed.

CREATE TABLE IF NOT EXISTS p2p_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- "Online" = online_until in the future. Heartbeats push it ~90s ahead;
  -- going to background sets it to now(), so a user drops offline at once
  -- instead of lingering for the heartbeat window.
  online_until timestamptz NOT NULL DEFAULT now(),
  show_activity_status boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2p_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own presence" ON p2p_presence;
CREATE POLICY "Users read own presence" ON p2p_presence
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: every write goes through the functions
-- below, which always use the server clock.
REVOKE ALL ON p2p_presence FROM anon;
REVOKE INSERT, UPDATE, DELETE ON p2p_presence FROM authenticated;
GRANT SELECT ON p2p_presence TO authenticated;

-- Heartbeat. p_online = true while the app is in the foreground, false when
-- it goes to background (marks offline immediately, keeps last_seen_at).
CREATE OR REPLACE FUNCTION p2p_touch_presence(p_online boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO p2p_presence (user_id, last_seen_at, online_until, updated_at)
  VALUES (me, now(), CASE WHEN p_online THEN now() + interval '90 seconds' ELSE now() END, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = now(),
        online_until = CASE WHEN p_online THEN now() + interval '90 seconds' ELSE now() END,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION p2p_touch_presence(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_touch_presence(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION p2p_set_activity_visibility(p_visible boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO p2p_presence (user_id, show_activity_status, updated_at)
  VALUES (me, p_visible, now())
  ON CONFLICT (user_id) DO UPDATE
    SET show_activity_status = p_visible, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION p2p_set_activity_visibility(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_set_activity_visibility(boolean) TO authenticated;

-- Batched read for the people on screen. Returns a coarse bucket only —
-- never the timestamp — and only when:
--   * the relationship holds in BOTH directions (p2p_can_contact_directly is
--     one-directional for admin roles; requiring both directions stops an
--     admin role alone from exposing everyone's activity), and
--   * both the viewer and the target have activity status visible
--     (reciprocal, like WhatsApp: hide yours and you don't see others').
-- Buckets: 'online' | 'recent' (<1h) | 'today' (<24h) | 'yesterday' (<48h)
-- | 'week' (<7d). Rolling windows, not calendar days, so the wording is right
-- in every timezone (the server's calendar day is UTC). Older or hidden → no row.
CREATE OR REPLACE FUNCTION p2p_get_activity_status(p_target_ids uuid[])
RETURNS TABLE(target_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR p_target_ids IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM p2p_presence WHERE user_id = me AND show_activity_status = false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    CASE
      WHEN p.online_until > now() THEN 'online'
      WHEN p.last_seen_at > now() - interval '1 hour' THEN 'recent'
      WHEN p.last_seen_at > now() - interval '24 hours' THEN 'today'
      WHEN p.last_seen_at > now() - interval '48 hours' THEN 'yesterday'
      ELSE 'week'
    END
  FROM p2p_presence p
  WHERE p.user_id = ANY (p_target_ids[1:100])
    AND p.user_id <> me
    AND p.show_activity_status = true
    AND p.last_seen_at > now() - interval '7 days'
    AND p2p_can_contact_directly(me, p.user_id)
    AND p2p_can_contact_directly(p.user_id, me);
END;
$$;
REVOKE ALL ON FUNCTION p2p_get_activity_status(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_get_activity_status(uuid[]) TO authenticated;
