-- Ministry role — captured at registration so the church-portal UI can
-- distinguish "has church-leadership intent/identity" (ministry_role) from
-- "holds a leadership role in a specific joined church" (p2p_church_members
-- .role, already covered by p2p_is_church_leadership/p2p_is_church_pastor
-- from migration 072). These are related but distinct: a pastor's
-- ministry_role marks identity even before they've joined or registered any
-- church at all.
ALTER TABLE public.p2p_profiles
  ADD COLUMN IF NOT EXISTS ministry_role text NOT NULL DEFAULT 'believer',
  ADD COLUMN IF NOT EXISTS ministry_role_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_profiles_ministry_role_check') THEN
    ALTER TABLE public.p2p_profiles ADD CONSTRAINT p2p_profiles_ministry_role_check
      CHECK (ministry_role IN ('new_believer', 'believer', 'small_group_leader', 'pastor', 'bible_teacher', 'missionary'));
  END IF;
END $$;

-- Mirrors the client-side isMinistryLeader computation so any future
-- server-side check doesn't drift from what the UI treats as "a leader."
CREATE OR REPLACE FUNCTION p2p_is_ministry_leader(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_profiles
    WHERE id = p_user_id
      AND ministry_role IN ('pastor', 'small_group_leader', 'bible_teacher', 'missionary')
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_ministry_leader(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_ministry_leader(uuid) TO authenticated;