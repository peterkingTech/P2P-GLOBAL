-- 181: New peer-group conversations get conversation_type 'peer_group'.
--
-- DRAFT — NOT APPLIED to production. Validate on staging first.
--
-- Bug: p2p_sync_group_conversation (migration 012) creates a peer group's
-- conversation with INSERT (type, group_id, name) — it predates the
-- conversation_type column added in migration 068, so every group conversation
-- created since 068 took the column default 'direct'. Consequences:
--   * p2p_can_pin_message treats them as non-group, so ANY member can pin
--     (the peer-guide-only rule applies to 'peer_group'/'circle' only);
--   * the inbox "Peer Groups" tab (conversationType === 'peer_group') never
--     shows them.
-- Migration 068 reclassified the group conversations that existed at the time
-- (type = 'group' AND group_id IS NOT NULL AND conversation_type = 'direct'),
-- and its circle sync (p2p_sync_circle_conversation) already sets 'circle'
-- explicitly; only the group sync was never updated.
--
-- Fix 1 — the sync function: identical to the live definition (verified on the
-- production-identical staging copy) except that the conversation INSERT now
-- sets conversation_type = 'peer_group'. CREATE OR REPLACE keeps the function's
-- owner, privileges, SECURITY DEFINER, search_path and its two triggers.
--
-- Fix 2 — one-time backfill, using the SAME authoritative criterion as 068:
--   type = 'group'                       (a group conversation, never a 1:1)
--   AND group_id IS NOT NULL             (linked to a peer group …)
--   AND EXISTS p2p_groups row             (… that really exists — group_id is
--                                          a foreign key to p2p_groups)
--   AND circle_id IS NULL                (not a circle conversation)
--   AND conversation_type = 'direct'     (only the mis-defaulted value)
-- Nothing is inferred from a 'direct' type or participant count alone; genuine
-- direct conversations (type 'direct', no group_id) and every other type are
-- untouched. Re-running updates 0 rows.
--
-- Not changed: messages, memberships, receipts (179), privileges/policies
-- (180), p2p_can_pin_message, the circle sync, any table definition.

begin;

create or replace function public.p2p_sync_group_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  conv_id uuid;
BEGIN
  SELECT id INTO conv_id FROM p2p_conversations WHERE group_id = COALESCE(NEW.group_id, OLD.group_id);
  IF conv_id IS NULL THEN
    INSERT INTO p2p_conversations (type, group_id, conversation_type, name)
    SELECT 'group', g.id, 'peer_group', g.name FROM p2p_groups g WHERE g.id = COALESCE(NEW.group_id, OLD.group_id)
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
$function$;

do $$
declare
  v_count integer;
begin
  update public.p2p_conversations c
     set conversation_type = 'peer_group'
   where c.type = 'group'
     and c.group_id is not null
     and c.circle_id is null
     and c.conversation_type = 'direct'
     and exists (select 1 from public.p2p_groups g where g.id = c.group_id);
  get diagnostics v_count = row_count;
  raise notice 'migration 181: % peer-group conversation(s) reclassified from direct to peer_group', v_count;
end;
$$;

commit;

-- Rollback (manual):
--   The function can be restored to its previous body by re-running the same
--   CREATE OR REPLACE with the INSERT changed back to
--     INSERT INTO p2p_conversations (type, group_id, name)
--     SELECT 'group', g.id, g.name FROM p2p_groups g WHERE ...
--   Reverting the backfilled rows is NOT recommended: it would restore the
--   misclassification (any member can pin; wrong inbox tab). The rows changed
--   are exactly those matching the criterion above at apply time; their count
--   is printed by the NOTICE when the migration runs.
