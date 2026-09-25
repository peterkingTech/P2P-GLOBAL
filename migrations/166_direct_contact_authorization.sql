-- Extracts p2p_start_direct_conversation's existing eligibility check (six
-- branches: super_admin, admin-responding-to-help-request, shared peer
-- group, active discipleship link, accepted P2P connection, shared active
-- family) into a standalone, reusable, read-only function, with ONE
-- genuine addition found during this forensic pass: neither that RPC nor
-- POST /connections/request ever checked p2p_user_blocks at all -- a
-- blocked user could still message, call, or send a P2P connection
-- request to the person who blocked them. Every other branch is copied
-- verbatim from the live function (confirmed via pg_get_functiondef
-- before writing this migration, not from stale migration history) --
-- this is a refactor plus one closed gap, not a behavior change to the
-- six existing branches. p2p_start_direct_conversation is then rewritten
-- to call this function instead of inlining the same checks, and
-- /calls/start (artifacts/api-server/src/routes/calls.ts) is updated to
-- call it too -- today that endpoint has NO relationship check at all
-- beyond the existing admin/official separation, so any authenticated user
-- can call any other non-admin user directly regardless of any
-- relationship. This closes that gap using the exact same authorization
-- boundary messaging already enforces, rather than inventing a second,
-- potentially-diverging one.

CREATE OR REPLACE FUNCTION p2p_can_contact_directly(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  role_a text;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_user_blocks b
    WHERE (b.blocker_id = p_user_a AND b.blocked_id = p_user_b)
       OR (b.blocker_id = p_user_b AND b.blocked_id = p_user_a)
  ) THEN
    RETURN false;
  END IF;

  SELECT role INTO role_a FROM p2p_profiles WHERE id = p_user_a;

  IF role_a = 'super_admin' THEN
    RETURN true;
  END IF;

  IF role_a IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = p_user_a AND gm2.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND ((dl.mentor_id = p_user_a AND dl.disciple_id = p_user_b)
        OR (dl.mentor_id = p_user_b AND dl.disciple_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_connection_requests cr
    WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
      AND ((cr.from_user_id = p_user_a AND cr.to_user_id = p_user_b)
        OR (cr.from_user_id = p_user_b AND cr.to_user_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_family_members fm1
    JOIN p2p_family_members fm2 ON fm1.family_id = fm2.family_id
    WHERE fm1.user_id = p_user_a AND fm1.status = 'active'
      AND fm2.user_id = p_user_b AND fm2.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION p2p_can_contact_directly(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_can_contact_directly(uuid, uuid) TO authenticated;

-- Rewritten to call p2p_can_contact_directly instead of inlining the same
-- six branches. Reuse-existing-DM logic, age-gate check, and insert logic
-- are byte-identical to the live function -- only the eligibility check
-- itself is now delegated.
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

  IF my_role IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = target_id
  ) THEN
    via_help_request := true;
  END IF;

  IF NOT p2p_can_contact_directly(me, target_id) THEN
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
