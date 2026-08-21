-- P2P Official Mail — Drafts, Starred, Archived. Reframes the existing
-- Contact P2P Global admin inbox (p2p_contact_messages) + Compose
-- (officialMessages.ts, p2p_messages) as one "P2P Official Mail" surface,
-- per the explicit decision to keep Help Requests (p2p_help_requests)
-- separate — it triggers a real personal conversation/call for crisis
-- cases, not an official-branded reply, and folding it in would change
-- that behavior.
--
-- Archived is shared (any admin in the department can archive/unarchive,
-- same as the existing status/priority/forward actions) — matches how
-- every other state change on this table already works. Starred is
-- deliberately PER-ADMIN (a personal bookmark inside a shared inbox), so
-- it's a join table, not a column, so one admin starring a message doesn't
-- affect what another admin sees.

ALTER TABLE public.p2p_contact_messages
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_p2p_contact_messages_archived ON public.p2p_contact_messages(is_archived);

CREATE TABLE IF NOT EXISTS public.p2p_contact_message_stars (
  message_id uuid NOT NULL REFERENCES public.p2p_contact_messages(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, admin_id)
);

-- Drafts for Compose (officialMessages.ts) — private to the admin who
-- wrote them, per the spec's explicit "drafts are private to the
-- administrator" instruction. target_user_id is nullable because a draft
-- can be started before a recipient is picked; target_username_cache is a
-- denormalized display copy so the Drafts list doesn't need to re-join
-- profiles for a user who may later rename themselves or (rarely) be
-- removed.
CREATE TABLE IF NOT EXISTS public.p2p_official_mail_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  target_username_cache text,
  department text,
  subject text,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_official_mail_drafts_admin ON public.p2p_official_mail_drafts(admin_id, updated_at DESC);

-- RLS is a backstop here, same as every other table this session — real
-- reads/writes go through contact.ts/officialMessages.ts's service-role
-- client with inline requesterId checks.
ALTER TABLE public.p2p_contact_message_stars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contact_message_stars_own" ON public.p2p_contact_message_stars;
CREATE POLICY "contact_message_stars_own" ON public.p2p_contact_message_stars FOR ALL TO authenticated
  USING (auth.uid() = admin_id) WITH CHECK (auth.uid() = admin_id);

ALTER TABLE public.p2p_official_mail_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "official_mail_drafts_own" ON public.p2p_official_mail_drafts;
CREATE POLICY "official_mail_drafts_own" ON public.p2p_official_mail_drafts FOR ALL TO authenticated
  USING (auth.uid() = admin_id) WITH CHECK (auth.uid() = admin_id);