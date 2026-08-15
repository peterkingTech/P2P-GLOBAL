-- Church Portal — Foundation Phase. Additive only; nothing from migration
-- 072 changes shape. Adds: church_type/slug/location_hidden on p2p_churches,
-- a true creator-only ownership gate (p2p_is_church_creator, distinct from
-- the existing role-based p2p_is_church_leadership/p2p_is_church_pastor —
-- ownership is "the person who created this specific church", independent
-- of role, since a senior_pastor assigned later is not the original owner),
-- structured social media accounts, richer announcements (media/scheduling/
-- status/featured), a new learning-goals system, and a church-media storage
-- bucket for logos and announcement attachments.

-- ── p2p_churches — new columns ─────────────────────────────────────────────────
ALTER TABLE public.p2p_churches
  ADD COLUMN IF NOT EXISTS church_type text,
  ADD COLUMN IF NOT EXISTS church_type_other text,
  ADD COLUMN IF NOT EXISTS location_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS church_slug text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_churches_church_slug_key') THEN
    ALTER TABLE public.p2p_churches ADD CONSTRAINT p2p_churches_church_slug_key UNIQUE (church_slug);
  END IF;
END $$;

-- ── Ownership gate ────────────────────────────────────────────────────────────
-- The creator of a church is its true owner for sensitive settings (branding,
-- name, description, social media, location visibility) — independent of
-- role. A senior_pastor appointed later, or one who inherits the role
-- without being the original creator, must NOT get these permissions.
CREATE OR REPLACE FUNCTION p2p_is_church_creator(p_church_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_churches WHERE id = p_church_id AND created_by = p_user_id
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_church_creator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_church_creator(uuid, uuid) TO authenticated;

-- Tighten the direct-client UPDATE policy on p2p_churches: previously any
-- pastor-role could update the row; now that ownership-only fields exist on
-- it, only the actual creator may (writes still primarily go through
-- churches.ts's service-role client — this is the RLS backstop).
DROP POLICY IF EXISTS "churches_update_senior_pastor" ON public.p2p_churches;
CREATE POLICY "churches_update_creator" ON public.p2p_churches FOR UPDATE TO authenticated
  USING (p2p_is_church_creator(id, auth.uid()));

-- ── Structured social media accounts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_church_social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.p2p_churches(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN (
    'facebook', 'instagram', 'youtube', 'tiktok', 'x_twitter', 'whatsapp', 'telegram', 'website', 'other'
  )),
  handle_or_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_social_accounts_church ON public.p2p_church_social_accounts(church_id, display_order);
ALTER TABLE public.p2p_church_social_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "church_social_accounts_select_members" ON public.p2p_church_social_accounts;
CREATE POLICY "church_social_accounts_select_members" ON public.p2p_church_social_accounts FOR SELECT TO authenticated
  USING (p2p_is_church_member(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_social_accounts_manage_creator" ON public.p2p_church_social_accounts;
CREATE POLICY "church_social_accounts_manage_creator" ON public.p2p_church_social_accounts FOR ALL TO authenticated
  USING (p2p_is_church_creator(church_id, auth.uid()))
  WITH CHECK (p2p_is_church_creator(church_id, auth.uid()));

-- ── Announcements — media, scheduling, status, featured ──────────────────────
-- DEFAULT 'published' on the new status column backfills every existing
-- announcement automatically — they keep behaving exactly as before.
ALTER TABLE public.p2p_church_announcements
  ADD COLUMN IF NOT EXISTS announcement_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS announcement_type_other text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'entire_church',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_church_announcements_type_check') THEN
    ALTER TABLE public.p2p_church_announcements ADD CONSTRAINT p2p_church_announcements_type_check
      CHECK (announcement_type IN ('general', 'bible_study', 'discipleship', 'prayer', 'learning_goal', 'study_plan', 'event', 'important', 'reminder', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_church_announcements_status_check') THEN
    ALTER TABLE public.p2p_church_announcements ADD CONSTRAINT p2p_church_announcements_status_check
      CHECK (status IN ('draft', 'scheduled', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p2p_church_announcements_audience_check') THEN
    ALTER TABLE public.p2p_church_announcements ADD CONSTRAINT p2p_church_announcements_audience_check
      CHECK (audience IN ('entire_church'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_p2p_church_announcements_status ON public.p2p_church_announcements(church_id, status, publish_at);

-- Members previously saw every row (only one visibility state existed).
-- Now that draft/scheduled/archived are real, split member visibility from
-- leadership's full visibility.
DROP POLICY IF EXISTS "church_announcements_select_members" ON public.p2p_church_announcements;
CREATE POLICY "church_announcements_select_members" ON public.p2p_church_announcements FOR SELECT TO authenticated
  USING (
    p2p_is_church_member(church_id, auth.uid())
    AND status = 'published'
    AND (publish_at IS NULL OR publish_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "church_announcements_select_leadership" ON public.p2p_church_announcements;
CREATE POLICY "church_announcements_select_leadership" ON public.p2p_church_announcements FOR SELECT TO authenticated
  USING (p2p_is_church_leadership(church_id, auth.uid()));

-- ── Learning goals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_church_learning_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.p2p_churches(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  goal_level text NOT NULL CHECK (goal_level IN ('lesson', 'module', 'curriculum')),
  lesson_id uuid REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  module_id uuid REFERENCES public.p2p_modules(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.p2p_curriculums(id) ON DELETE CASCADE,
  timeframe text NOT NULL CHECK (timeframe IN ('today', 'this_week', 'this_month', 'custom')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('percentage', 'member_count')),
  target_value numeric NOT NULL CHECK (target_value > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2p_church_learning_goals_level_match_check CHECK (
    (goal_level = 'lesson' AND lesson_id IS NOT NULL AND module_id IS NULL AND curriculum_id IS NULL) OR
    (goal_level = 'module' AND module_id IS NOT NULL AND lesson_id IS NULL AND curriculum_id IS NULL) OR
    (goal_level = 'curriculum' AND curriculum_id IS NOT NULL AND lesson_id IS NULL AND module_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_p2p_church_learning_goals_church ON public.p2p_church_learning_goals(church_id, status, ends_at);
ALTER TABLE public.p2p_church_learning_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "church_learning_goals_select_members" ON public.p2p_church_learning_goals;
CREATE POLICY "church_learning_goals_select_members" ON public.p2p_church_learning_goals FOR SELECT TO authenticated
  USING (p2p_is_church_member(church_id, auth.uid()));

DROP POLICY IF EXISTS "church_learning_goals_manage_leadership" ON public.p2p_church_learning_goals;
CREATE POLICY "church_learning_goals_manage_leadership" ON public.p2p_church_learning_goals FOR ALL TO authenticated
  USING (p2p_is_church_leadership(church_id, auth.uid()))
  WITH CHECK (p2p_is_church_leadership(church_id, auth.uid()));

-- ── Storage — church-media bucket ─────────────────────────────────────────────
-- Mirrors curriculum-media (migration 039): public read, capped size, image +
-- short-video mime types (25MB — well under submissions' 100MB video cap,
-- since this is branding/announcement media, not lesson-response recordings).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'church-media', 'church-media', true, 26214400,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read church media" ON storage.objects;
CREATE POLICY "Public read church media" ON storage.objects
  FOR SELECT USING (bucket_id = 'church-media');

-- Registration-time logo draft, before a church row exists yet — same
-- self-owned-folder shape as the avatars bucket (path: {userId}/church-logo-draft/...).
DROP POLICY IF EXISTS "Self manage draft church logo" ON storage.objects;
CREATE POLICY "Self manage draft church logo" ON storage.objects FOR ALL
  USING (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'church-logo-draft' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'church-logo-draft' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Post-creation logo edits (path: {churchId}/logo/...) — creator only. Since
-- this is client-side-direct storage access (not routed through the
-- service-role API), this RLS policy is the PRIMARY enforcement here, not a
-- backstop — unlike every DB write in churches.ts.
DROP POLICY IF EXISTS "Church creator manage logo" ON storage.objects;
CREATE POLICY "Church creator manage logo" ON storage.objects FOR ALL
  USING (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'logo' AND p2p_is_church_creator((storage.foldername(name))[1]::uuid, auth.uid()))
  WITH CHECK (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'logo' AND p2p_is_church_creator((storage.foldername(name))[1]::uuid, auth.uid()));

-- Announcement media (path: {churchId}/announcements/{announcementId}/...) — leadership.
DROP POLICY IF EXISTS "Church leadership manage announcement media" ON storage.objects;
CREATE POLICY "Church leadership manage announcement media" ON storage.objects FOR ALL
  USING (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'announcements' AND p2p_is_church_leadership((storage.foldername(name))[1]::uuid, auth.uid()))
  WITH CHECK (bucket_id = 'church-media' AND (storage.foldername(name))[2] = 'announcements' AND p2p_is_church_leadership((storage.foldername(name))[1]::uuid, auth.uid()));