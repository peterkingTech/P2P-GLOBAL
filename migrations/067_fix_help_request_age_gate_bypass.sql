-- Fix: p2p_start_direct_conversation()'s age gate (added in migration 021) runs
-- for every non-super_admin caller BEFORE eligibility is determined, and blocks
-- the call whenever either party's date_of_birth is NULL. That silently broke
-- the "Message them" button on the admin Help Requests screen: help requests
-- can be submitted by any authenticated user regardless of DOB (see
-- HelpButton.tsx), and church_leader/regional_admin/moderator accounts are
-- frequently provisioned outside the normal signup flow and often lack a DOB
-- too — so a missing DOB on either side made every crisis-response message
-- attempt fail with "age verification required", even though migration 021's
-- own comment describes this exact path (church_leader/regional_admin/
-- moderator responding to a help request) as sharing the super_admin
-- "admin/safety-response escape hatch" that should NOT be age-gated.
--
-- Fix: determine eligibility (and specifically whether it came via the
-- help-request response path) first, then only apply the age gate to the
-- ordinary shared-group messaging paths — not to super_admin (already
-- exempt) and not to the help-request response path (now also exempt).
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
  ELSIF my_role IN ('church_leader', 'regional_admin', 'moderator') AND EXISTS (
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