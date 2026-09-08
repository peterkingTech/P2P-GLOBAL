-- Fix: p2p_start_direct_conversation()'s eligibility check has no branch
-- for an accepted plain "Connect" request (p2p_connection_requests,
-- request_type='connect'). Discovered during real two-device call testing
-- (forensic audit + live testing, 2026-09-08): two real accounts can send
-- and accept a Connect request via the app's own Discover tab (the most
-- common, most prominent way to connect with someone in this app) and
-- still get "not permitted to message this user" / "Can't message this
-- user" when they try to actually talk — the accepted request grants no
-- eligibility at all. The only working paths were super_admin, an active
-- peer-guide/discipleship link, or shared p2p_group_members membership (a
-- table nothing in the app ever writes to). This is not a hypothetical
-- edge case — it blocks the app's primary connect flow for every ordinary
-- user pair.
--
-- Fix: add an eligibility branch for an ACCEPTED p2p_connection_requests
-- row with request_type='connect', in either direction (either party may
-- have sent the original request) — the same either-direction pattern
-- migration 081 already established for discipleship links just below it.
-- Mirrors the existing branches exactly: additive only, no change to any
-- other eligibility path, no RLS bypass, no fake/manufactured row — this
-- only recognizes a request the two users themselves already, genuinely,
-- mutually accepted through the real UI.
CREATE OR REPLACE FUNCTION p2p_start_direct_conversation(target_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  my_role text := p2p_current_role();
  existing_id uuid;
  new_id uuid;
  eligible boolean := false;
  via_help_request boolean := false;
  v_my_dob date;
  v_target_dob date;
  v_adult_cutoff date := current_date - interval '18 years';
BEGIN
  IF me IS NULL OR target_id IS NULL OR me = target_id THEN
    RAISE EXCEPTION 'invalid participants';
  END IF;

  -- already have a DM? reuse it
  SELECT c.id INTO existing_id
  FROM p2p_conversations c
  WHERE c.type = 'direct'
    AND EXISTS (SELECT 1 FROM p2p_conversation_members m1 WHERE m1.conversation_id = c.id AND m1.user_id = me)
    AND EXISTS (SELECT 1 FROM p2p_conversation_members m2 WHERE m2.conversation_id = c.id AND m2.user_id = target_id)
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF my_role = 'super_admin' THEN
    eligible := true;
  ELSIF my_role IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = target_id
  ) THEN
    eligible := true;
    via_help_request := true;
  ELSIF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = me AND gm2.user_id = target_id
  ) THEN
    eligible := true;
  ELSIF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = target_id AND gm2.user_id = me
  ) THEN
    eligible := true;
  ELSIF EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND ((dl.mentor_id = me AND dl.disciple_id = target_id)
        OR (dl.mentor_id = target_id AND dl.disciple_id = me))
  ) THEN
    eligible := true;
  ELSIF EXISTS (
    SELECT 1 FROM p2p_connection_requests cr
    WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
      AND ((cr.from_user_id = me AND cr.to_user_id = target_id)
        OR (cr.from_user_id = target_id AND cr.to_user_id = me))
  ) THEN
    eligible := true;
  END IF;

  IF NOT eligible THEN
    RAISE EXCEPTION 'not permitted to message this user';
  END IF;

  IF my_role != 'super_admin' AND NOT via_help_request THEN
    SELECT date_of_birth INTO v_my_dob FROM p2p_profiles WHERE id = me;
    SELECT date_of_birth INTO v_target_dob FROM p2p_profiles WHERE id = target_id;

    IF v_my_dob IS NULL OR v_target_dob IS NULL THEN
      RAISE EXCEPTION 'age verification required: add your date of birth in settings before messaging';
    END IF;

    IF (v_my_dob <= v_adult_cutoff AND v_target_dob > v_adult_cutoff)
       OR (v_my_dob > v_adult_cutoff AND v_target_dob <= v_adult_cutoff) THEN
      RAISE EXCEPTION 'messaging between adult and minor accounts is not permitted';
    END IF;
  END IF;

  INSERT INTO p2p_conversations (type) VALUES ('direct') RETURNING id INTO new_id;
  INSERT INTO p2p_conversation_members (conversation_id, user_id) VALUES (new_id, me), (new_id, target_id);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION p2p_start_direct_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_start_direct_conversation(uuid) TO authenticated;
