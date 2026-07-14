-- ── Age gate: date_of_birth on registration + adult/minor DM blocking ─────────
-- p2p_profiles is the authoritative identity table (p2p_registration_profiles
-- is just the one-time intake survey, FK'd to it) — role, messaging eligibility,
-- and moderation all already read from p2p_profiles, so that's where this lives.
--
-- date_of_birth is nullable at the schema level because every existing account
-- predates this column and we have no real birthdate to backfill. "Required at
-- signup" is enforced by the app (signUp always supplies it) and by the CHECK
-- below (minimum age 16 for anyone who does have a value). Unknown-age accounts
-- are handled explicitly in p2p_start_direct_conversation() below: per product
-- decision, unknown age BLOCKS new 1:1s (rather than silently allowing them),
-- because allowing it would make this whole feature a no-op for 100% of today's
-- existing users.
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS date_of_birth date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'p2p_profiles' AND con.conname = 'p2p_profiles_min_age_check'
  ) THEN
    ALTER TABLE public.p2p_profiles
      ADD CONSTRAINT p2p_profiles_min_age_check
      CHECK (date_of_birth IS NULL OR date_of_birth <= (current_date - interval '16 years'));
  END IF;
END $$;

-- ── p2p_start_direct_conversation(): add the age gate ─────────────────────────
-- Applies to every eligibility path (shared group, reverse shared group,
-- church_leader/regional_admin/moderator responding to a help request) EXCEPT
-- super_admin, which keeps its existing full bypass — that's the platform's
-- admin/safety-response escape hatch, not a stranger-to-stranger path.
--
-- Two distinct, client-distinguishable failure reasons (not just "not
-- permitted"), per product decision — the age-verification one is actionable
-- by the user themselves (go add your DOB in settings), so it must be
-- distinguishable from a flat refusal.
--
-- Adult/minor line is 18, separate from the 16-year-old minimum signup age —
-- a 16-17 year old account is still a minor for this purpose; it can message
-- other minors, just not 18+ accounts (and vice versa).
--
-- Note: this only gates the *creation* of a new conversation, same as the
-- existing stranger-block above it — it does not retroactively re-evaluate or
-- close any conversation that already exists (including one already in the
-- "already have a DM? reuse it" fast path just above). Auditing/handling
-- already-existing adult-minor conversations is a separate decision, not
-- covered here.
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

  IF my_role != 'super_admin' THEN
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

  IF my_role = 'super_admin' THEN
    eligible := true;
  ELSIF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = me AND gm2.user_id = target_id
  ) THEN
    eligible := true;
  ELSIF my_role IN ('church_leader', 'regional_admin', 'moderator') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = target_id
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

  INSERT INTO p2p_conversations (type) VALUES ('direct') RETURNING id INTO new_id;
  INSERT INTO p2p_conversation_members (conversation_id, user_id) VALUES (new_id, me), (new_id, target_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_start_direct_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_start_direct_conversation(uuid) TO authenticated;
