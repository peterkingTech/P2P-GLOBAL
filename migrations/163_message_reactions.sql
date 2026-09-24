-- One reaction per user per message (WhatsApp/Instagram-style: picking a
-- new emoji replaces your previous reaction, tapping your own again clears
-- it) rather than one row per (user, emoji) pair — PRIMARY KEY enforces
-- "at most one reaction per user per message" at the database level.

CREATE TABLE IF NOT EXISTS public.p2p_message_reactions (
  message_id uuid NOT NULL REFERENCES public.p2p_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_p2p_message_reactions_message ON public.p2p_message_reactions(message_id);

ALTER TABLE public.p2p_message_reactions ENABLE ROW LEVEL SECURITY;

-- Any conversation member can see reactions on messages in that conversation.
DROP POLICY IF EXISTS "message_reactions_select" ON public.p2p_message_reactions;
CREATE POLICY "message_reactions_select" ON public.p2p_message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.p2p_messages m
      WHERE m.id = message_id AND p2p_is_conversation_member(m.conversation_id, auth.uid())
    )
  );

-- Can only ever write your own reaction, and only on a message in a
-- conversation you're actually a member of.
DROP POLICY IF EXISTS "message_reactions_insert" ON public.p2p_message_reactions;
CREATE POLICY "message_reactions_insert" ON public.p2p_message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.p2p_messages m
      WHERE m.id = message_id AND p2p_is_conversation_member(m.conversation_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "message_reactions_update" ON public.p2p_message_reactions;
CREATE POLICY "message_reactions_update" ON public.p2p_message_reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Only your own reaction can be removed -- never another user's.
DROP POLICY IF EXISTS "message_reactions_delete" ON public.p2p_message_reactions;
CREATE POLICY "message_reactions_delete" ON public.p2p_message_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_message_reactions;
