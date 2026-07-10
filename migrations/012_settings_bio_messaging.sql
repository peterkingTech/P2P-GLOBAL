-- ── Avatar storage bucket ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_write" ON storage.objects;
CREATE POLICY "avatars_owner_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Settings + Bio ──────────────────────────────────────────────────────────
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS notify_prayer boolean NOT NULL DEFAULT true;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS notify_messages boolean NOT NULL DEFAULT true;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS notify_groups boolean NOT NULL DEFAULT true;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'peers'
  CHECK (profile_visibility IN ('public', 'peers', 'private'));
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS app_language text NOT NULL DEFAULT 'en';
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS content_language text NOT NULL DEFAULT 'en';

-- ── Messaging ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  name text,
  group_id uuid REFERENCES public.p2p_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.p2p_conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.p2p_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.p2p_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.p2p_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  body text,
  media_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p2p_messages_conversation ON public.p2p_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_p2p_conversation_members_user ON public.p2p_conversation_members(user_id);

-- SECURITY DEFINER helper (same pattern as 011, avoids RLS self-recursion)
CREATE OR REPLACE FUNCTION p2p_is_conversation_member(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = p_user_id
  );
$$;
REVOKE ALL ON FUNCTION p2p_is_conversation_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_is_conversation_member(uuid, uuid) TO authenticated;

ALTER TABLE public.p2p_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_select" ON public.p2p_conversations;
CREATE POLICY "conversations_select" ON public.p2p_conversations FOR SELECT TO authenticated
  USING (p2p_is_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS "conversations_insert" ON public.p2p_conversations;
CREATE POLICY "conversations_insert" ON public.p2p_conversations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "conversation_members_select" ON public.p2p_conversation_members;
CREATE POLICY "conversation_members_select" ON public.p2p_conversation_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR p2p_is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "conversation_members_insert" ON public.p2p_conversation_members;
CREATE POLICY "conversation_members_insert" ON public.p2p_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR p2p_is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "conversation_members_update" ON public.p2p_conversation_members;
CREATE POLICY "conversation_members_update" ON public.p2p_conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "messages_select" ON public.p2p_messages;
CREATE POLICY "messages_select" ON public.p2p_messages FOR SELECT TO authenticated
  USING (p2p_is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "messages_insert" ON public.p2p_messages;
CREATE POLICY "messages_insert" ON public.p2p_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND p2p_is_conversation_member(conversation_id, auth.uid())
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_messages;

-- Server-side gatekeeper for starting a DM: only allowed between users who
-- share a group, or between an admin/moderator and a help-request submitter
-- they are responding to. This is the real enforcement point (not just RLS),
-- so the client can never create a DM with an arbitrary stranger.
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

-- Auto-create/maintain a group conversation whenever a group gets its first members,
-- and keep membership in sync as people join/leave.
CREATE OR REPLACE FUNCTION p2p_sync_group_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM p2p_conversations WHERE group_id = COALESCE(NEW.group_id, OLD.group_id);
  IF conv_id IS NULL THEN
    INSERT INTO p2p_conversations (type, group_id, name)
    SELECT 'group', g.id, g.name FROM p2p_groups g WHERE g.id = COALESCE(NEW.group_id, OLD.group_id)
    RETURNING id INTO conv_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO p2p_conversation_members (conversation_id, user_id)
    VALUES (conv_id, NEW.user_id)
    ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM p2p_conversation_members WHERE conversation_id = conv_id AND user_id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS p2p_group_members_sync_conversation ON public.p2p_group_members;
CREATE TRIGGER p2p_group_members_sync_conversation
AFTER INSERT OR DELETE ON public.p2p_group_members
FOR EACH ROW EXECUTE FUNCTION p2p_sync_group_conversation();

-- ── Role-based data access hierarchy ────────────────────────────────────────
-- church_id/region did not exist yet — add them so scope checks below are valid.
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS church_id uuid;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS region text;

-- Helper: current user's role, bypassing RLS (avoids recursive lookups on p2p_profiles itself)
CREATE OR REPLACE FUNCTION p2p_current_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role::text FROM p2p_profiles WHERE id = auth.uid();
$$;
REVOKE ALL ON FUNCTION p2p_current_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_current_role() TO authenticated;

-- Helper: current user's church id (if the profiles table tracks one) — falls back to null.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'p2p_profiles' AND column_name = 'church_id'
  ) THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION p2p_current_church_id()
      RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS
      $body$ SELECT church_id FROM p2p_profiles WHERE id = auth.uid(); $body$;
    $f$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'p2p_profiles' AND column_name = 'region'
  ) THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION p2p_current_region()
      RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS
      $body$ SELECT region FROM p2p_profiles WHERE id = auth.uid(); $body$;
    $f$;
  END IF;
END $$;

REVOKE ALL ON FUNCTION p2p_current_church_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_current_church_id() TO authenticated;
REVOKE ALL ON FUNCTION p2p_current_region() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_current_region() TO authenticated;

-- p2p_profiles: replace broad "any admin role can read all" policies with scoped ones.
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.p2p_profiles;
DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.p2p_profiles;

CREATE POLICY "profiles_select_scoped" ON public.p2p_profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR p2p_current_role() = 'super_admin'
  OR (
    p2p_current_role() IN ('church_leader', 'regional_admin')
    AND role = 'student'
    AND (
      (p2p_current_role() = 'church_leader' AND church_id IS NOT NULL AND church_id = p2p_current_church_id())
      OR (p2p_current_role() = 'regional_admin' AND region IS NOT NULL AND region = p2p_current_region())
    )
  )
);

-- p2p_registration_profiles: same scoping — moderator excluded (not part of their job).
DROP POLICY IF EXISTS "Admins can view all registrations" ON public.p2p_registration_profiles;
DROP POLICY IF EXISTS "admins_select_all_registrations" ON public.p2p_registration_profiles;

CREATE POLICY "registrations_select_scoped" ON public.p2p_registration_profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR p2p_current_role() = 'super_admin'
  OR (
    p2p_current_role() IN ('church_leader', 'regional_admin')
    AND EXISTS (
      SELECT 1 FROM p2p_profiles target
      WHERE target.id = p2p_registration_profiles.user_id
        AND target.role = 'student'
        AND (
          (p2p_current_role() = 'church_leader' AND target.church_id IS NOT NULL AND target.church_id = p2p_current_church_id())
          OR (p2p_current_role() = 'regional_admin' AND target.region IS NOT NULL AND target.region = p2p_current_region())
        )
    )
  )
);
