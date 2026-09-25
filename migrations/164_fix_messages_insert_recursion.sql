-- Fixes "infinite recursion detected in policy for relation p2p_messages"
-- (reported live in production, blocking ALL message sends -- even
-- non-reply messages, since Postgres must plan the WITH CHECK expression's
-- EXISTS subquery regardless of whether reply_to_message_id is actually
-- null at runtime).
--
-- Root cause (confirmed via live pg_policies inspection, not assumed):
-- 160/162's messages_insert WITH CHECK ran a direct
-- `SELECT ... FROM p2p_messages` subquery from WITHIN a policy defined ON
-- p2p_messages. Evaluating that subquery requires applying p2p_messages'
-- own SELECT policy while the INSERT policy's WITH CHECK for the very same
-- table is still being evaluated -- Postgres's row-security recursion
-- guard treats this as a cycle and refuses, exactly matching the reported
-- error.
--
-- Fix: move the same-conversation reply-target check into a SECURITY
-- DEFINER function, the same escape-hatch pattern already used by
-- p2p_is_conversation_member and p2p_can_pin_message elsewhere in this
-- schema -- a SECURITY DEFINER function's internal queries bypass RLS on
-- the tables it touches, so there is no nested policy evaluation to recurse.

CREATE OR REPLACE FUNCTION p2p_message_in_conversation(p_message_id uuid, p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_messages
    WHERE id = p_message_id AND conversation_id = p_conversation_id
  );
$$;
REVOKE ALL ON FUNCTION p2p_message_in_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_message_in_conversation(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "messages_insert" ON public.p2p_messages;
CREATE POLICY "messages_insert" ON public.p2p_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND p2p_is_conversation_member(conversation_id, auth.uid())
    AND (
      reply_to_message_id IS NULL
      OR p2p_message_in_conversation(reply_to_message_id, conversation_id)
    )
  );
