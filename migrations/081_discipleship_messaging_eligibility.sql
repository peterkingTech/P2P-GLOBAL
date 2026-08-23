-- Fix: p2p_start_direct_conversation()'s eligibility check never recognized
-- an active discipleship relationship (p2p_discipleship_links) as a valid
-- reason to allow messaging — only super_admin, help-request-response roles,
-- and shared p2p_group_members group membership. Discovered live-testing My
-- Discipleship Phase 1's Disciple Detail screen: a real, correctly-formed
-- mentor/disciple relationship (created via the normal Peer Guide request/
-- accept flow, migrations 047/079) does NOT itself add both parties to a
-- shared group, so Message/Call/Study Together all failed with "not
-- permitted to message this user" for any pair who didn't happen to also
-- share a Peer Group/Circle by coincidence — i.e. this broke the core
-- mentor-disciple communication path for the majority of real relationships,
-- not an edge case.
--
-- Fix: add an eligibility branch for an ACTIVE p2p_discipleship_links row
-- between the two users, in either direction (mentor->disciple or
-- disciple->mentor — either party may initiate). Not exempted from the
-- below age-gate check (unlike the help-request-response branch, which
-- exists for crisis-response urgency) — a discipleship relationship still
-- respects the normal adult/minor messaging restriction, same as the
-- existing shared-group-membership path.
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