-- Message deletion: "delete for everyone" (sender-only tombstone — content
-- is actually cleared, not just flagged, so it can't still be read via a
-- raw SELECT) and "delete for me" (per-viewer hide, never affects what
-- others see). Both go through SECURITY DEFINER RPCs, matching this
-- codebase's existing p2p_can_pin_message / p2p_start_direct_conversation
-- pattern, rather than a raw client-side UPDATE/DELETE policy that could be
-- misused to edit a message instead of deleting it.

ALTER TABLE public.p2p_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.p2p_message_deletions (
  message_id uuid NOT NULL REFERENCES public.p2p_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.p2p_profiles(id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
ALTER TABLE public.p2p_message_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_deletions_own" ON public.p2p_message_deletions;
CREATE POLICY "message_deletions_own" ON public.p2p_message_deletions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Sender-only. Clears actual content (not just a flag) on delete-for-everyone.
CREATE OR REPLACE FUNCTION p2p_delete_message_for_everyone(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender uuid;
BEGIN
  SELECT sender_id INTO v_sender FROM p2p_messages WHERE id = p_message_id;
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;
  IF v_sender IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the sender can delete this message for everyone';
  END IF;
  UPDATE p2p_messages
  SET body = NULL,
      media_url = NULL,
      media_duration_seconds = NULL,
      deleted_at = now(),
      deleted_by = auth.uid()
  WHERE id = p_message_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_delete_message_for_everyone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_delete_message_for_everyone(uuid) TO authenticated;

-- Any conversation member may hide a message for themselves only — does not
-- require being the sender, and never touches the shared row other members see.
CREATE OR REPLACE FUNCTION p2p_delete_message_for_me(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  SELECT conversation_id INTO v_conversation_id FROM p2p_messages WHERE id = p_message_id;
  IF v_conversation_id IS NULL OR NOT p2p_is_conversation_member(v_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to hide this message';
  END IF;
  INSERT INTO p2p_message_deletions (message_id, user_id)
  VALUES (p_message_id, auth.uid())
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION p2p_delete_message_for_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_delete_message_for_me(uuid) TO authenticated;
