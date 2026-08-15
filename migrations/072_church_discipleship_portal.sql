-- Church Discipleship Portal — completely free for every church, no tiers,
-- no payment. FK convention matches the rest of this codebase's table
-- family: user-referencing columns point at public.p2p_profiles(id), not
-- auth.users directly (p2p_profiles.id IS auth.users.id 1:1; every existing
-- join/embed in this app goes through p2p_profiles).
--
-- p2p_profiles.church_id and p2p_groups.church_id already existed (migration
-- 012) as bare, unconstrained uuid columns used only for church_leader-role
-- RLS scoping (p2p_current_church_id()) — no real churches table backed them
-- until now. Per explicit product decision, this migration wires both to
-- really point at p2p_churches.id, so the pre-existing scoping mechanism and
-- this new portal describe the same church rather than two disconnected
-- concepts.

-- ── Churches ──────────────────────────────────────────────────────────────────
-- p2p_churches already existed — an empty, orphaned table (id, name, country,
-- city, leader_id, created_at; confirmed 0 rows and zero references anywhere
-- in the codebase) that predates this session with no code ever wired to it.
-- Extending it in place rather than CREATE TABLE (which would have silently
-- no-op'd against the incompatible existing schema — exactly what happened
-- on the first attempt at this migration). leader_id is renamed to
-- created_by, a straightforward 1:1 semantic match to what this feature
-- actually needs (already an FK to p2p_profiles, just needed the name and
-- NOT NULL to match).
ALTER TABLE public.p2p_churches RENAME COLUMN leader_id TO created_by;
ALTER TABLE public.p2p_churches ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE public.p2p_churches ALTER COLUMN country SET NOT NULL;
ALTER TABLE public.p2p_churches
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS denomination text,
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS invite_code text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL;

-- invite_code needs to be unique + not-null, but ADD COLUMN ... UNIQUE NOT
-- NULL in one step has no way to backfill (table is empty, so this is safe,
-- but split out for clarity and to match the ADD COLUMN IF NOT EXISTS
-- idempotency of everything else above).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_churches_invite_code_key') THEN
    ALTER TABLE public.p2p_churches ALTER COLUMN invite_code SET NOT NULL;
    ALTER TABLE public.p2p_churches ADD CONSTRAINT p2p_churches_invite_code_key UNIQUE (invite_code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_churches_status_check') THEN
    ALTER TABLE public.p2p_churches ADD CONSTRAINT p2p_churches_status_check CHECK (status IN ('active', 'suspended', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_p2p_churches_country ON public.p2p_churches(country);
CREATE INDEX IF NOT EXISTS idx_p2p_churches_status ON public.p2p_churches(status);

-- Now that a real churches table exists, wire the two pre-existing scoping
-- columns to actually reference it (both confirmed empty — safe to add).
ALTER TABLE public.p2p_profiles
  ADD CONSTRAINT p2p_profiles_church_id_fkey FOREIGN KEY (church_id) REFERENCES public.p2p_churches(id) ON DELETE SET NULL;
ALTER TABLE public.p2p_groups
  ADD CONSTRAINT p2p_groups_church_id_fkey FOREIGN KEY (church_id) REFERENCES public.p2p_churches(id) ON DELETE SET NULL;

-- ── Church members ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_church_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.p2p_churches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('senior_pastor', 'discipleship_pastor', 'small_group_leader', 'peer_guide', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  profile_visible_to_leadership boolean NOT NULL DEFAULT true,
  admin_notes text,
  UNIQUE (church_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_members_church ON public.p2p_church_members(church_id, is_active);
CREATE INDEX IF NOT EXISTS idx_p2p_church_members_user ON public.p2p_church_members(user_id);

-- SECURITY DEFINER helper (same pattern as p2p_is_conversation_member,
-- migration 012) — a raw self-referencing EXISTS subquery on
-- p2p_church_members inside that table's own RLS policy is the exact RLS
-- self-recursion trap this codebase has hit and fixed repeatedly before.
CREATE OR REPLACE FUNCTION p2p_is_church_leadership(p_church_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_church_members
    WHERE church_id = p_church_id AND user_id = p_user_id
      AND role IN ('senior_pastor', 'discipleship_pastor', 'small_group_leader')
      AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_church_leadership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_church_leadership(uuid, uuid) TO authenticated;

-- Senior/discipleship pastor only (small_group_leader can read but not
-- manage cohorts, matching the spec's cohort-management policy scope).
CREATE OR REPLACE FUNCTION p2p_is_church_pastor(p_church_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_church_members
    WHERE church_id = p_church_id AND user_id = p_user_id
      AND role IN ('senior_pastor', 'discipleship_pastor')
      AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_church_pastor(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_church_pastor(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION p2p_is_church_member(p_church_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_church_members
    WHERE church_id = p_church_id AND user_id = p_user_id AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_church_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_church_member(uuid, uuid) TO authenticated;

-- ── Church cohorts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_church_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.p2p_churches(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  curriculum_id uuid REFERENCES public.p2p_curriculums(id) ON DELETE SET NULL,
  module_id uuid REFERENCES public.p2p_modules(id) ON DELETE SET NULL,
  leader_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  target_start_date date,
  target_end_date date,
  max_members integer,
  status text NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_cohorts_church ON public.p2p_church_cohorts(church_id);

CREATE TABLE IF NOT EXISTS public.p2p_church_cohort_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.p2p_church_cohorts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  peer_guide_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  UNIQUE (cohort_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_cohort_members_cohort ON public.p2p_church_cohort_members(cohort_id);

-- ── Church announcements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_church_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.p2p_churches(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_announcements_church ON public.p2p_church_announcements(church_id, is_pinned, created_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- All privileged reads/writes (grove stats, member lists, role changes,
-- cohort/announcement management) go through churches.ts's service-role
-- client, same as admin.ts and every other cross-user endpoint in this API —
-- these policies are the correct, complete backstop for direct-client access
-- (e.g. a member's own "my church" check), not the primary access path for
-- leadership-only data.
ALTER TABLE public.p2p_churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_church_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_church_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_church_cohort_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_church_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "churches_select_active" ON public.p2p_churches;
CREATE POLICY "churches_select_active" ON public.p2p_churches FOR SELECT TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "churches_insert_any_authenticated" ON public.p2p_churches;
CREATE POLICY "churches_insert_any_authenticated" ON public.p2p_churches FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "churches_update_senior_pastor" ON public.p2p_churches;
CREATE POLICY "churches_update_senior_pastor" ON public.p2p_churches FOR UPDATE TO authenticated
  USING (p2p_is_church_pastor(id, auth.uid()));

DROP POLICY IF EXISTS "church_members_select_own" ON public.p2p_church_members;
CREATE POLICY "church_members_select_own" ON public.p2p_church_members FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR p2p_is_church_leadership(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_members_insert_self" ON public.p2p_church_members;
CREATE POLICY "church_members_insert_self" ON public.p2p_church_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'member');

DROP POLICY IF EXISTS "church_members_update_own_or_leadership" ON public.p2p_church_members;
CREATE POLICY "church_members_update_own_or_leadership" ON public.p2p_church_members FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR p2p_is_church_pastor(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_cohorts_select_members" ON public.p2p_church_cohorts;
CREATE POLICY "church_cohorts_select_members" ON public.p2p_church_cohorts FOR SELECT TO authenticated
  USING (p2p_is_church_member(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_cohorts_manage_pastors" ON public.p2p_church_cohorts;
CREATE POLICY "church_cohorts_manage_pastors" ON public.p2p_church_cohorts FOR ALL TO authenticated
  USING (p2p_is_church_pastor(church_id, auth.uid()))
  WITH CHECK (p2p_is_church_pastor(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_cohort_members_select" ON public.p2p_church_cohort_members;
CREATE POLICY "church_cohort_members_select" ON public.p2p_church_cohort_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM p2p_church_cohorts c WHERE c.id = cohort_id AND p2p_is_church_leadership(c.church_id, auth.uid()))
  );

DROP POLICY IF EXISTS "church_cohort_members_manage_pastors" ON public.p2p_church_cohort_members;
CREATE POLICY "church_cohort_members_manage_pastors" ON public.p2p_church_cohort_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM p2p_church_cohorts c WHERE c.id = cohort_id AND p2p_is_church_pastor(c.church_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM p2p_church_cohorts c WHERE c.id = cohort_id AND p2p_is_church_pastor(c.church_id, auth.uid())));

DROP POLICY IF EXISTS "church_announcements_select_members" ON public.p2p_church_announcements;
CREATE POLICY "church_announcements_select_members" ON public.p2p_church_announcements FOR SELECT TO authenticated
  USING (p2p_is_church_member(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_announcements_manage_leadership" ON public.p2p_church_announcements;
CREATE POLICY "church_announcements_manage_leadership" ON public.p2p_church_announcements FOR ALL TO authenticated
  USING (p2p_is_church_leadership(church_id, auth.uid()))
  WITH CHECK (p2p_is_church_leadership(church_id, auth.uid()) AND author_id = auth.uid());