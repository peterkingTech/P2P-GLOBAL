-- Admin hierarchy: adds a new tier of specialized admin_* roles ON TOP OF the
-- existing six roles (student/peer_guide/church_leader/regional_admin/
-- moderator/super_admin) — purely additive, per explicit product decision.
--
-- p2p_profiles.role is a real Postgres ENUM (`user_role`, see migration 003),
-- not a text+CHECK column — new values are added with ALTER TYPE ... ADD
-- VALUE, the same mechanism migration 003 used to add 'moderator'. Each is
-- run as its own statement (not wrapped together with anything that USES the
-- new value) since a newly-added enum value cannot be referenced in the same
-- transaction that creates it.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_supervisor';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_zone';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_national';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_content';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_translation';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_moderation';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_verification';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_help';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_username';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_finance';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_marketing';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_church';

-- ── Admin profile extensions ──────────────────────────────────────────────────
ALTER TABLE public.p2p_profiles
  ADD COLUMN IF NOT EXISTS admin_zone text
    CHECK (admin_zone IS NULL OR admin_zone IN ('europe', 'africa', 'asia', 'americas', 'oceania', 'middle_east')),
  ADD COLUMN IF NOT EXISTS admin_country text,
  ADD COLUMN IF NOT EXISTS admin_appointed_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_appointed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_appointment_reason text,
  ADD COLUMN IF NOT EXISTS admin_is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_last_active_at timestamptz;

-- ── Admin activity log — every admin action logged ────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  admin_role text NOT NULL,
  action_type text NOT NULL,
  target_user_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  target_resource_id uuid,
  target_resource_type text,
  action_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_admin_activity_log_admin ON public.p2p_admin_activity_log(admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_p2p_admin_activity_log_created ON public.p2p_admin_activity_log(created_at);

-- ── Admin reports ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_admin_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  admin_role text NOT NULL,
  report_period text NOT NULL CHECK (report_period IN ('weekly', 'monthly', 'annual')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_notes text,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_admin_reports_admin ON public.p2p_admin_reports(admin_id, period_start);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- p2p_current_role() (migration 012) is reused here rather than an inline
-- EXISTS-on-p2p_profiles subquery, since that helper is already the
-- established SECURITY DEFINER pattern this codebase uses to read the
-- caller's own role inside an RLS policy without recursing into
-- p2p_profiles' own RLS.
ALTER TABLE public.p2p_admin_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_admin_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_activity_log_select" ON public.p2p_admin_activity_log;
CREATE POLICY "admin_activity_log_select" ON public.p2p_admin_activity_log FOR SELECT TO authenticated
  USING (
    auth.uid() = admin_id
    OR p2p_current_role() IN ('super_admin', 'admin_supervisor')
  );

DROP POLICY IF EXISTS "admin_reports_select" ON public.p2p_admin_reports;
CREATE POLICY "admin_reports_select" ON public.p2p_admin_reports FOR SELECT TO authenticated
  USING (
    auth.uid() = admin_id
    OR p2p_current_role() IN ('super_admin', 'admin_supervisor', 'admin_zone')
  );

DROP POLICY IF EXISTS "admin_reports_insert_own" ON public.p2p_admin_reports;
CREATE POLICY "admin_reports_insert_own" ON public.p2p_admin_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = admin_id);

DROP POLICY IF EXISTS "admin_reports_update_own" ON public.p2p_admin_reports;
CREATE POLICY "admin_reports_update_own" ON public.p2p_admin_reports FOR UPDATE TO authenticated
  USING (auth.uid() = admin_id) WITH CHECK (auth.uid() = admin_id);