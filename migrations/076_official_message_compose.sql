-- Admin Compose — P2P Global proactively messaging a user. Extends the
-- existing p2p_messages/p2p_conversations + official-account system
-- (migration 068), same as the send-official-message feature built on top
-- of it: no new messaging system, just enough columns to carry the
-- category/subject metadata Compose needs (and that Contact P2P Global's
-- own p2p_contact_messages table already has, for the same reason) so the
-- admin Sent view can list recipient/department/subject/preview/date
-- without a second table. All three columns are nullable and only ever
-- populated on official-account-sent Compose messages — every existing
-- peer message row is unaffected. No RLS changes needed: p2p_messages RLS
-- is row-scoped via sender_id/conversation_id, not column-scoped, so it
-- already covers these.

ALTER TABLE public.p2p_messages
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS department text
    CHECK (department IS NULL OR department IN (
      'support_help', 'crisis_safeguarding', 'account_security',
      'report_user', 'feedback_suggestions', 'general_contact'
    )),
  ADD COLUMN IF NOT EXISTS sent_by_admin_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_p2p_messages_sent_by_admin ON public.p2p_messages(sent_by_admin_id) WHERE sent_by_admin_id IS NOT NULL;