-- 183: Messaging integrity follow-ups to migration 180.
--
-- DRAFT — NOT APPLIED to production. Validate on staging first. Apply after
-- 180 (independent of 181/182). Touches no receipt (179) object, no
-- call/Agora object and no data; additive privileges/triggers only.
--
-- Found while reviewing 180 against the live catalog (2026-10-12). Like 180,
-- each path comes from client roles holding whole-table privileges:
--
--  1. Conversations. authenticated may INSERT any p2p_conversations row
--     (conversations_insert: WITH CHECK (true)), with any type, name,
--     group_id, circle_id, help_request_id or crisis_type. The group/circle
--     sync triggers look a conversation up by group_id/circle_id, so a
--     pre-created row could become a group's or circle's chat with an
--     attacker-chosen name, and fake crisis/help-request rows pollute admin
--     queues. No app build since 2026-07-10 inserts conversations: they are
--     created only by SECURITY DEFINER code (p2p_start_direct_conversation,
--     p2p_sync_group_conversation, p2p_sync_circle_conversation) and the API
--     server (service role) — none affected.
--     Fix: no client INSERT/UPDATE/DELETE/TRUNCATE on p2p_conversations
--     (UPDATE/DELETE already had no policy); drop conversations_insert.
--
--  2. Reactions (defence in depth, low severity). message_reactions_update
--     only checks user_id and the client holds UPDATE on every column.
--     Moving a reaction into a conversation the user is NOT in is already
--     refused (the updated row must also pass message_reactions_select —
--     verified in the schema lab), but a client can still choose created_at
--     and re-point a reaction between messages of its own conversations.
--     The app's reaction upsert (app/messages/[id].tsx: upsert {message_id,
--     user_id, emoji} on conflict message_id,user_id) re-sends the same
--     message_id/user_id, so a guard that rejects CHANGING them keeps it
--     working. Fix: trigger rejects changes to message_id/user_id for client
--     roles and stamps created_at server-side, so the guarantee no longer
--     depends on the SELECT policy; anon loses write privileges (it has no
--     policy anyway); TRUNCATE revoked.
--
--  3. Message types. After 180 the client may still choose message_type, so
--     a member could post a fake 'call_summary' (or any other type) that the
--     app renders as a system call record. Apps only send 'text' (default)
--     and 'voice'; call summaries come from the API server (service role).
--     Fix: trigger rejects other types for client roles.
--
-- Not changed: SELECT privileges/policies, 180's grants/triggers, reactions
-- insert/delete/select policies, service_role, SECURITY DEFINER functions.

begin;

-- ── 1. Conversations: created only by trusted code ──────────────────────────
revoke insert, update, delete, truncate on table public.p2p_conversations from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_conversations';
  execute format('revoke insert (%s), update (%s) on table public.p2p_conversations from anon, authenticated', cols, cols);
end $$;
drop policy if exists "conversations_insert" on public.p2p_conversations;

-- ── 2. Reactions stay on their message and owner; server timestamp ──────────
revoke truncate on table public.p2p_message_reactions from anon, authenticated;
revoke insert, update, delete on table public.p2p_message_reactions from anon;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_message_reactions';
  execute format('revoke insert (%s), update (%s) on table public.p2p_message_reactions from anon', cols, cols);
end $$;

create or replace function public.p2p_guard_message_reaction()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' and (new.message_id is distinct from old.message_id
                             or new.user_id is distinct from old.user_id) then
      raise exception 'A reaction cannot be moved to another message or person' using errcode = '42501';
    end if;
    new.created_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_message_reactions_guard on public.p2p_message_reactions;
create trigger p2p_message_reactions_guard
  before insert or update on public.p2p_message_reactions
  for each row execute function public.p2p_guard_message_reaction();

-- ── 3. Client messages: only the types the app sends ────────────────────────
create or replace function public.p2p_guard_client_message_type()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(new.message_type, 'text') not in ('text', 'voice') then
    raise exception 'Unsupported message type' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_messages_00a_client_message_type on public.p2p_messages;
create trigger p2p_messages_00a_client_message_type
  before insert on public.p2p_messages
  for each row execute function public.p2p_guard_client_message_type();

revoke all on function public.p2p_guard_message_reaction() from public, anon, authenticated;
revoke all on function public.p2p_guard_client_message_type() from public, anon, authenticated;

commit;

-- Rollback (manual; restores the previous, broader privileges):
--   begin;
--   drop trigger if exists p2p_messages_00a_client_message_type on public.p2p_messages;
--   drop trigger if exists p2p_message_reactions_guard on public.p2p_message_reactions;
--   drop function if exists public.p2p_guard_client_message_type();
--   drop function if exists public.p2p_guard_message_reaction();
--   grant insert, update, delete, truncate on table public.p2p_message_reactions to anon, authenticated;
--   grant insert, update, delete, truncate on table public.p2p_conversations to anon, authenticated;
--   create policy "conversations_insert" on public.p2p_conversations for insert to authenticated with check (true);
--   commit;
