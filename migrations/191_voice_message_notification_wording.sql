-- 191: "sent you a voice message" for voice messages.
--
-- Migration 104's new-message notification says "sent you a message" for
-- every message type, so a voice note reads the same as text. This replaces
-- only that wording: voice messages (p2p_messages.message_type = 'voice',
-- written by app/messages/[id].tsx) now say "sent you a voice message"
-- ("sent a voice message" in groups). Everything else is unchanged from 104:
-- same skips (no sender, official sends, call summaries, muted
-- conversations), same recipients, same data payload, and still never any
-- message content.
--
-- Additive and re-runnable: CREATE OR REPLACE of one function; the trigger
-- from 104 keeps pointing at it. No table, grant or policy changes.

create or replace function public.p2p_notify_on_new_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sender_name text;
  v_is_group boolean;
  v_is_voice boolean := (new.message_type = 'voice');
begin
  if new.sender_id is null then return new; end if;
  if new.sent_by_admin_id is not null then return new; end if;
  if new.message_type = 'call_summary' then return new; end if;

  select full_name into v_sender_name from p2p_profiles where id = new.sender_id;
  select (type <> 'direct') into v_is_group from p2p_conversations where id = new.conversation_id;

  insert into p2p_notifications (user_id, title, message, notification_type, data)
  select
    cm.user_id,
    coalesce(v_sender_name, 'Someone'),
    case
      when v_is_voice and v_is_group then 'sent a voice message'
      when v_is_voice then 'sent you a voice message'
      when v_is_group then 'sent a message'
      else 'sent you a message'
    end,
    'new_message',
    jsonb_build_object('conversationId', new.conversation_id, 'messageId', new.id, 'senderId', new.sender_id)
  from p2p_conversation_members cm
  left join p2p_conversation_settings cs
    on cs.conversation_id = new.conversation_id and cs.user_id = cm.user_id
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
    and coalesce(cs.is_muted, false) = false;

  return new;
end;
$$;
