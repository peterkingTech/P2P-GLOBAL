-- Messaging overhaul: official accounts, crisis/help-request threading,
-- per-user conversation settings (pin/favourite/mute), message pinning, and
-- peer feedback on admin interactions.
--
-- FK convention matches the rest of this file's table family (012): user-
-- referencing columns point at public.p2p_profiles(id), not auth.users —
-- p2p_profiles.id already IS auth.users.id 1:1, and every existing join in
-- this codebase (p2p_conversation_members, p2p_messages, etc.) embeds via
-- p2p_profiles, so new tables follow the same shape for consistency and so
-- PostgREST embedding (`.select("*, p2p_profiles(...)")`) works the same way.

-- ── Official accounts ────────────────────────────────────────────────────────
ALTER TABLE public.p2p_profiles
  ADD COLUMN IF NOT EXISTS is_official_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS official_account_type text
    CHECK (official_account_type IS NULL OR official_account_type IN ('crisis_response', 'announcement', 'support', 'general')),
  ADD COLUMN IF NOT EXISTS official_account_label text;

-- Seed official accounts if the reserved usernames already exist — a no-op
-- for any that haven't been created yet.
UPDATE public.p2p_profiles SET
  is_official_account = true, official_account_type = 'crisis_response',
  official_account_label = 'Official Crisis Response Team'
WHERE username = 'p2p_crises_response';

UPDATE public.p2p_profiles SET
  is_official_account = true, official_account_type = 'announcement',
  official_account_label = 'Official P2P Global Announcements'
WHERE username = 'p2pglobal_announcement';

UPDATE public.p2p_profiles SET
  is_official_account = true, official_account_type = 'support',
  official_account_label = 'Official P2P Global Support'
WHERE username = 'support';

UPDATE public.p2p_profiles SET
  is_official_account = true, official_account_type = 'general',
  official_account_label = 'Official P2P Global Account'
WHERE username = 'p2pglobal';

-- ── Conversation metadata ────────────────────────────────────────────────────
ALTER TABLE public.p2p_conversations
  ADD COLUMN IF NOT EXISTS conversation_type text NOT NULL DEFAULT 'direct'
    CHECK (conversation_type IN ('direct', 'crisis_response', 'help_request', 'pastoral', 'support', 'peer_group', 'circle')),
  ADD COLUMN IF NOT EXISTS help_request_id uuid REFERENCES public.p2p_help_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crisis_type text
    CHECK (crisis_type IS NULL OR crisis_type IN ('watchtower', 'help_request', 'pastoral_checkin')),
  ADD COLUMN IF NOT EXISTS crisis_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_pinned_by_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback_submitted boolean NOT NULL DEFAULT false,
  -- Circles (p2p_peer_circles) have no conversation of their own today —
  -- this is new, backing the Circles inbox tab (see the sync trigger below).
  ADD COLUMN IF NOT EXISTS circle_id uuid REFERENCES public.p2p_peer_circles(id) ON DELETE CASCADE;

-- Existing group_id-linked conversations (p2p_groups, auto-synced by
-- p2p_sync_group_conversation since migration 012) predate conversation_type
-- and all defaulted to 'direct' just now — reclassify them as peer groups so
-- they land in the right inbox tab. Anything genuinely circle-linked gets
-- corrected below once circle_id is backfilled.
UPDATE public.p2p_conversations SET conversation_type = 'peer_group'
WHERE type = 'group' AND group_id IS NOT NULL AND conversation_type = 'direct';

-- ── One conversation per Peer Circle, same auto-create/membership-sync
-- pattern as p2p_sync_group_conversation (migration 012) for p2p_groups ──────
CREATE OR REPLACE FUNCTION p2p_sync_circle_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM p2p_conversations WHERE circle_id = COALESCE(NEW.circle_id, OLD.circle_id);
  IF conv_id IS NULL THEN
    INSERT INTO p2p_conversations (type, circle_id, conversation_type, name)
    SELECT 'group', c.id, 'circle', c.name FROM p2p_peer_circles c WHERE c.id = COALESCE(NEW.circle_id, OLD.circle_id)
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

DROP TRIGGER IF EXISTS p2p_peer_circle_members_sync_conversation ON public.p2p_peer_circle_members;
CREATE TRIGGER p2p_peer_circle_members_sync_conversation
AFTER INSERT OR DELETE ON public.p2p_peer_circle_members
FOR EACH ROW EXECUTE FUNCTION p2p_sync_circle_conversation();

-- Backfill: create/join conversations for circle memberships that already
-- existed before this migration.
INSERT INTO public.p2p_conversations (type, circle_id, conversation_type, name)
SELECT 'group', c.id, 'circle', c.name
FROM public.p2p_peer_circles c
WHERE EXISTS (SELECT 1 FROM public.p2p_peer_circle_members m WHERE m.circle_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.p2p_conversations conv WHERE conv.circle_id = c.id);

INSERT INTO public.p2p_conversation_members (conversation_id, user_id)
SELECT conv.id, m.user_id
FROM public.p2p_peer_circle_members m
JOIN public.p2p_conversations conv ON conv.circle_id = m.circle_id
ON CONFLICT DO NOTHING;

-- ── Per-user conversation settings (pin/favourite/mute) ──────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_conversation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.p2p_conversations(id) ON DELETE CASCADE,
  is_pinned boolean NOT NULL DEFAULT false,
  is_favourite boolean NOT NULL DEFAULT false,
  is_muted boolean NOT NULL DEFAULT false,
  pinned_at timestamptz,
  favourited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_p2p_conversation_settings_user ON public.p2p_conversation_settings(user_id);

ALTER TABLE public.p2p_conversation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversation_settings_own" ON public.p2p_conversation_settings;
CREATE POLICY "conversation_settings_own" ON public.p2p_conversation_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Message pinning + official-response labelling ────────────────────────────
ALTER TABLE public.p2p_messages
  ADD COLUMN IF NOT EXISTS is_official_response boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crisis_context text,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_label text;
CREATE INDEX IF NOT EXISTS idx_p2p_messages_pinned ON public.p2p_messages(conversation_id) WHERE is_pinned;

-- Auto-stamp is_official_response + a default crisis_context whenever an
-- official account sends into a crisis/help_request/pastoral/support thread —
-- keeps the client from having to compute this itself on every send.
CREATE OR REPLACE FUNCTION p2p_stamp_official_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_official boolean;
  v_official_label text;
  v_conv_type text;
BEGIN
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_official_account, official_account_label INTO v_is_official, v_official_label
  FROM p2p_profiles WHERE id = NEW.sender_id;

  IF v_is_official THEN
    SELECT conversation_type INTO v_conv_type FROM p2p_conversations WHERE id = NEW.conversation_id;
    IF v_conv_type IN ('crisis_response', 'help_request', 'pastoral', 'support') THEN
      NEW.is_official_response := true;
      NEW.crisis_context := COALESCE(NEW.crisis_context, v_official_label);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2p_messages_stamp_official_response ON public.p2p_messages;
CREATE TRIGGER p2p_messages_stamp_official_response
BEFORE INSERT ON public.p2p_messages
FOR EACH ROW EXECUTE FUNCTION p2p_stamp_official_response();

-- Pinning a message — either DM party, or a circle/peer-group's leader/creator.
-- Reuses p2p_current_role()'s SECURITY DEFINER pattern to avoid RLS recursion.
CREATE OR REPLACE FUNCTION p2p_can_pin_message(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    p2p_is_conversation_member(p_conversation_id, p_user_id)
    AND (
      (SELECT conversation_type FROM p2p_conversations WHERE id = p_conversation_id) NOT IN ('peer_group', 'circle')
      OR EXISTS (
        SELECT 1 FROM p2p_conversations conv
        LEFT JOIN p2p_groups g ON g.id = conv.group_id
        LEFT JOIN p2p_peer_circles c ON c.id = conv.circle_id
        WHERE conv.id = p_conversation_id
          AND (g.peer_guide_id = p_user_id OR c.leader_id = p_user_id)
      )
    );
$$;
REVOKE ALL ON FUNCTION p2p_can_pin_message(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_can_pin_message(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "messages_update_pin" ON public.p2p_messages;
CREATE POLICY "messages_update_pin" ON public.p2p_messages FOR UPDATE TO authenticated
  USING (p2p_can_pin_message(conversation_id, auth.uid()))
  WITH CHECK (p2p_can_pin_message(conversation_id, auth.uid()));

-- ── Peer feedback on admin/crisis-response interactions ──────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_admin_interaction_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.p2p_conversations(id) ON DELETE CASCADE,
  help_request_id uuid REFERENCES public.p2p_help_requests(id) ON DELETE SET NULL,
  admin_user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  peer_user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  was_timely boolean,
  was_respectful boolean,
  was_helpful boolean,
  was_rude boolean,
  did_not_address_concern boolean,
  free_text text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  flagged_for_review boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_p2p_admin_feedback_admin ON public.p2p_admin_interaction_feedback(admin_user_id);

ALTER TABLE public.p2p_admin_interaction_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_feedback_insert_own" ON public.p2p_admin_interaction_feedback;
CREATE POLICY "admin_feedback_insert_own" ON public.p2p_admin_interaction_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = peer_user_id);

DROP POLICY IF EXISTS "admin_feedback_select" ON public.p2p_admin_interaction_feedback;
CREATE POLICY "admin_feedback_select" ON public.p2p_admin_interaction_feedback FOR SELECT TO authenticated
  USING (auth.uid() = peer_user_id OR auth.uid() = admin_user_id OR p2p_current_role() = 'super_admin');