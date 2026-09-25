-- p2p_connection_requests' UPDATE policy allowed the SENDER to also update
-- their own outgoing request (auth.uid() = to_user_id OR from_user_id).
-- The API layer (artifacts/api-server/src/routes/connections.ts) already
-- enforces recipient-only accept/decline, but this RLS policy did not --
-- a client bypassing the API via a direct Supabase call could self-accept
-- their own outgoing connection request. No cancel-by-sender feature
-- exists today (the API never exposed one), so tightening this to
-- recipient-only is not a functional regression.

DROP POLICY IF EXISTS "Recipients update connection requests" ON p2p_connection_requests;
CREATE POLICY "Recipients update connection requests" ON p2p_connection_requests
  FOR UPDATE USING (auth.uid() = to_user_id) WITH CHECK (auth.uid() = to_user_id);
