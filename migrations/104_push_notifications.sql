-- Push Notification Implementation — the missing DEVICE DELIVERY layer on
-- top of the existing p2p_notifications application-event system. Nothing
-- about p2p_notifications itself changes semantically; this adds:
--   1. A device-token table so a user's notification can be fanned out to
--      their registered devices.
--   2. One idempotency column so the dispatcher (api-server, polling) can
--      tell which notification rows it has already attempted to push,
--      without ever needing a second "push log" row per notification.
--   3. A trigger that creates the ONE missing application-event source:
--      regular p2p_messages inserts never created a p2p_notifications row
--      at all (peer/group/circle messaging relies entirely on Realtime +
--      unread counts) -- "new messages" is explicitly one of the important
--      types this feature must support, so this closes that gap the same
--      way every other event source in this codebase already does: one
--      insert into p2p_notifications, nothing else.

-- ── 1. Device tokens ─────────────────────────────────────────────────────
create table if not exists public.p2p_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  device_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_p2p_push_tokens_user_active on public.p2p_push_tokens(user_id) where is_active = true;

alter table public.p2p_push_tokens enable row level security;

-- Ownership is the whole security model here: a user may only see/manage
-- their OWN device rows. The token column itself is never selectable by
-- any route/query outside this table's own owner (no other table joins
-- against it), so there is no separate "hide the token value" concern the
-- way sent_by_admin_id needed column-level revokes.
drop policy if exists "push_tokens_own_select" on public.p2p_push_tokens;
create policy "push_tokens_own_select" on public.p2p_push_tokens
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "push_tokens_own_insert" on public.p2p_push_tokens;
create policy "push_tokens_own_insert" on public.p2p_push_tokens
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "push_tokens_own_update" on public.p2p_push_tokens;
create policy "push_tokens_own_update" on public.p2p_push_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "push_tokens_own_delete" on public.p2p_push_tokens;
create policy "push_tokens_own_delete" on public.p2p_push_tokens
  for delete to authenticated using (auth.uid() = user_id);

-- The real registration/unregistration path is the api-server (service-role,
-- identity from verifyCaller) so that re-registering the same physical
-- device's token under a NEW user (logout/login, section 12) can reassign
-- ownership -- something a direct client-side RLS upsert could never do
-- safely (auth.uid() on the pre-image would still be the OLD owner). RLS
-- above is defense-in-depth against a direct PostgREST call, not the
-- primary path.

-- ── 2. Dispatcher idempotency marker ────────────────────────────────────
alter table public.p2p_notifications add column if not exists pushed_at timestamptz;
create index if not exists idx_p2p_notifications_pending_push on public.p2p_notifications (created_at) where pushed_at is null;

-- ── 3. New-message notifications (the one event source that didn't exist) ─
-- Skips: official-identity sends (officialMessages.ts already inserts its
-- own official_message_received notification for the same message --
-- sent_by_admin_id is only ever set on that path), call-summary bubbles (no
-- push needed for a call-ended message), and muted conversations (respects
-- the existing per-user p2p_conversation_settings.is_muted the same way the
-- pin/favourite settings already do).
create or replace function public.p2p_notify_on_new_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sender_name text;
  v_is_group boolean;
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
    case when v_is_group then 'sent a message' else 'sent you a message' end,
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

drop trigger if exists p2p_messages_notify_new_message on public.p2p_messages;
create trigger p2p_messages_notify_new_message
  after insert on public.p2p_messages
  for each row execute function public.p2p_notify_on_new_message();