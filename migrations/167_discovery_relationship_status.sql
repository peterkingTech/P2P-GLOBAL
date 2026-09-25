-- Batched relationship-status lookup for the Discovery Search list —
-- avoids one RPC round trip per displayed peer (Discovery can show up to
-- 50 people per page). Reuses p2p_can_contact_directly (migration 166)
-- and the same p2p_connection_requests reads the profile screen's
-- resolveConnectionStatus (profiles.ts) already performs — no new
-- relationship concept, just a batched read of the existing one.

CREATE OR REPLACE FUNCTION p2p_discovery_relationship_status(p_target_ids uuid[])
RETURNS TABLE(target_id uuid, can_contact boolean, connection_status text, connection_request_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    p2p_can_contact_directly(me, t.id),
    COALESCE(
      (SELECT 'connected' FROM p2p_connection_requests cr
        WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
          AND ((cr.from_user_id = me AND cr.to_user_id = t.id) OR (cr.from_user_id = t.id AND cr.to_user_id = me))
        LIMIT 1),
      (SELECT 'pending_received' FROM p2p_connection_requests cr
        WHERE cr.status = 'pending' AND cr.request_type = 'connect'
          AND cr.from_user_id = t.id AND cr.to_user_id = me
        LIMIT 1),
      (SELECT 'pending_sent' FROM p2p_connection_requests cr
        WHERE cr.status = 'pending' AND cr.request_type = 'connect'
          AND cr.from_user_id = me AND cr.to_user_id = t.id
        LIMIT 1),
      'none'
    ),
    (SELECT cr.id FROM p2p_connection_requests cr
      WHERE cr.request_type = 'connect'
        AND ((cr.from_user_id = me AND cr.to_user_id = t.id) OR (cr.from_user_id = t.id AND cr.to_user_id = me))
      ORDER BY (cr.status = 'accepted') DESC, cr.created_at DESC
      LIMIT 1)
  FROM unnest(p_target_ids) AS t(id);
END;
$$;
REVOKE ALL ON FUNCTION p2p_discovery_relationship_status(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_discovery_relationship_status(uuid[]) TO authenticated;
