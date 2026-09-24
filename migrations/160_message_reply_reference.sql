-- Adds a reply-to reference for chat messages (swipe-to-reply), plus a
-- same-conversation guard so a reply can never point at a message from a
-- different conversation the sender may not even have access to.
--
-- NOTE: the WITH CHECK clause below has a known bug fixed in migration 162
-- (an unqualified reply_to_message_id reference inside the EXISTS subquery
-- resolves to the subquery's own alias, not the row being inserted, so it
-- silently rejected every reply). Kept here unmodified for an accurate
-- history; 162 supersedes this policy.

ALTER TABLE public.p2p_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.p2p_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_p2p_messages_reply_to ON public.p2p_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Same sender/membership checks as 012's original messages_insert — only
-- the reply-target validation is new.
DROP POLICY IF EXISTS "messages_insert" ON public.p2p_messages;
CREATE POLICY "messages_insert" ON public.p2p_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND p2p_is_conversation_member(conversation_id, auth.uid())
    AND (
      reply_to_message_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.p2p_messages m
        WHERE m.id = reply_to_message_id
          AND m.conversation_id = p2p_messages.conversation_id
      )
    )
  );
