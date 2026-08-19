-- Contact P2P Global — internal email/contact system. Peers message
-- departments, admins triage/reply/forward/close. Self-contained: replies
-- live in their own thread tables/screens (not the real p2p_messages/
-- p2p_conversations system) — no official-account impersonation, no
-- dependency on the existing conversation_type-stamping trigger. FK
-- convention matches every recent migration: public.p2p_profiles(id), not
-- auth.users directly.

CREATE SEQUENCE IF NOT EXISTS p2p_contact_message_seq START 1000;

CREATE OR REPLACE FUNCTION p2p_generate_contact_reference()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'MSG-' || TO_CHAR(NOW(), 'YYYY-MM-DD') || '-' || LPAD(NEXTVAL('p2p_contact_message_seq')::text, 4, '0')
$$;

CREATE TABLE IF NOT EXISTS public.p2p_contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text UNIQUE NOT NULL DEFAULT p2p_generate_contact_reference(),
  from_user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  to_department text NOT NULL CHECK (to_department IN ('help_request', 'crisis_response', 'p2p_support', 'marketing')),
  subject text NOT NULL,
  body text NOT NULL,
  attachment_url text,
  attachment_type text CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'pdf')),
  status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied', 'forwarded', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  assigned_to uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  forwarded_from uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  forwarded_note text,
  original_department text,
  feedback_requested boolean NOT NULL DEFAULT false,
  feedback_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_contact_messages_from_user ON public.p2p_contact_messages(from_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_p2p_contact_messages_department ON public.p2p_contact_messages(to_department, status, priority);

CREATE TABLE IF NOT EXISTS public.p2p_contact_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.p2p_contact_messages(id) ON DELETE CASCADE,
  from_admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  from_department text NOT NULL,
  body text NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_contact_replies_message ON public.p2p_contact_replies(message_id, created_at);

CREATE TABLE IF NOT EXISTS public.p2p_contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.p2p_contact_messages(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_contact_notes_message ON public.p2p_contact_notes(message_id, created_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Backstop, not the primary gate — all real reads/writes go through
-- contact.ts's service-role client, same as every other route file this
-- session. Scoped to the real role set: super_admin sees everything,
-- admin_help owns help_request/crisis_response/p2p_support, admin_marketing
-- owns marketing. admin_supervisor is a real role elsewhere in the app but
-- has no defined stake in contact-message routing — deliberately excluded
-- rather than granted speculative access.
ALTER TABLE public.p2p_contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_contact_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_messages_select_own" ON public.p2p_contact_messages;
CREATE POLICY "contact_messages_select_own" ON public.p2p_contact_messages FOR SELECT TO authenticated
  USING (auth.uid() = from_user_id);

DROP POLICY IF EXISTS "contact_messages_insert_own" ON public.p2p_contact_messages;
CREATE POLICY "contact_messages_insert_own" ON public.p2p_contact_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = from_user_id);

DROP POLICY IF EXISTS "contact_messages_select_admin" ON public.p2p_contact_messages;
CREATE POLICY "contact_messages_select_admin" ON public.p2p_contact_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM p2p_profiles
      WHERE id = auth.uid()
        AND (
          role = 'super_admin'
          OR (role = 'admin_help' AND to_department IN ('help_request', 'crisis_response', 'p2p_support'))
          OR (role = 'admin_marketing' AND to_department = 'marketing')
        )
    )
  );

DROP POLICY IF EXISTS "contact_messages_update_admin" ON public.p2p_contact_messages;
CREATE POLICY "contact_messages_update_admin" ON public.p2p_contact_messages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM p2p_profiles
      WHERE id = auth.uid()
        AND (
          role = 'super_admin'
          OR (role = 'admin_help' AND to_department IN ('help_request', 'crisis_response', 'p2p_support'))
          OR (role = 'admin_marketing' AND to_department = 'marketing')
        )
    )
  );

DROP POLICY IF EXISTS "contact_replies_select_own_non_internal" ON public.p2p_contact_replies;
CREATE POLICY "contact_replies_select_own_non_internal" ON public.p2p_contact_replies FOR SELECT TO authenticated
  USING (
    is_internal_note = false
    AND EXISTS (SELECT 1 FROM p2p_contact_messages m WHERE m.id = message_id AND m.from_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "contact_replies_select_admin" ON public.p2p_contact_replies;
CREATE POLICY "contact_replies_select_admin" ON public.p2p_contact_replies FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM p2p_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin_help', 'admin_marketing')));

DROP POLICY IF EXISTS "contact_replies_insert_admin" ON public.p2p_contact_replies;
CREATE POLICY "contact_replies_insert_admin" ON public.p2p_contact_replies FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM p2p_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin_help', 'admin_marketing')));

DROP POLICY IF EXISTS "contact_notes_manage_admin" ON public.p2p_contact_notes;
CREATE POLICY "contact_notes_manage_admin" ON public.p2p_contact_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM p2p_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin_help', 'admin_marketing')))
  WITH CHECK (EXISTS (SELECT 1 FROM p2p_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin_help', 'admin_marketing')));