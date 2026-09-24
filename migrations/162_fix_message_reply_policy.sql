-- Fixes a variable-shadowing bug in 160's messages_insert policy: the
-- reply-target check's EXISTS subquery aliased p2p_messages as "m", which
-- caused the unqualified "reply_to_message_id" reference to resolve to
-- m.reply_to_message_id (the candidate row) instead of the new row being
-- inserted -- a self-comparison that's never true, so every reply insert
-- was silently rejected by RLS. Explicitly qualifying it with the target
-- table name (same style already used correctly for conversation_id in
-- the same clause) fixes it.

DROP POLICY IF EXISTS "messages_insert" ON public.p2p_messages;
CREATE POLICY "messages_insert" ON public.p2p_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND p2p_is_conversation_member(conversation_id, auth.uid())
    AND (
      reply_to_message_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.p2p_messages m
        WHERE m.id = p2p_messages.reply_to_message_id
          AND m.conversation_id = p2p_messages.conversation_id
      )
    )
  );
