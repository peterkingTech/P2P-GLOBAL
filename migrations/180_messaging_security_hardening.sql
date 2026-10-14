-- 180: Messaging security hardening.
--
-- DRAFT — NOT APPLIED. Test on staging first (scripts/messaging-hardening-db-test
-- locally, then the staging suite). Independent of migration 179 (receipts):
-- touches no receipt object and none of the call/Agora stack.
--
-- Closes three paths found in the read-only messaging audit (2026-10-11),
-- all via privileges the client roles held on whole tables:
--
--  1. Self-join. authenticated could INSERT its own row into any
--     conversation (conversation_members_insert: user_id = auth.uid() OR ...)
--     and UPDATE its own membership row's conversation_id (UPDATE granted on
--     every column, policy only checks user_id). Either gave read access to
--     that conversation's messages.
--     Fix: no client INSERT/DELETE on p2p_conversation_members; client UPDATE
--     only on last_read_at (the one column the app writes — app/messages/[id].tsx).
--     Legitimate membership is created only by SECURITY DEFINER code, which is
--     unaffected: p2p_start_direct_conversation (166), the group/circle sync
--     triggers (012/068), and the API server (service role).
--
--  2. Editing other people's messages. authenticated held UPDATE on every
--     p2p_messages column; the only UPDATE policy (messages_update_pin,
--     p2p_can_pin_message) lets BOTH members of any non-group conversation
--     update ANY column of ANY message in it — body, sender_id, deleted_at…
--     Fix: client UPDATE only on the four pin columns the app writes
--     (contexts/DataContext.tsx pinMessage/unpinMessage); pinned_by/pinned_at
--     are set by the server (cannot be attributed to someone else). Deletion
--     keeps working through p2p_delete_message_for_everyone (161, DEFINER).
--     Installed app builds keep pinning: same columns, same policy.
--
--  3. Backdating. authenticated could INSERT its own created_at.
--     Fix: client INSERT only on the columns the app sends, which excludes
--     created_at, and a trigger that stamps created_at = now() for client
--     inserts as a second line of defence.
--     Allowed insert columns = exactly what current and installed builds send:
--       text:  id, conversation_id, sender_id, body, reply_to_message_id
--       voice: conversation_id, sender_id, message_type, media_url,
--              media_duration_seconds, reply_to_message_id
--     Columns set by triggers (flagged_self_harm, is_official_response,
--     crisis_context) still work: trigger assignments are not privilege-checked.
--
-- Not changed: SELECT privileges/policies, messages_insert, messages_select,
-- messages_update_pin, reactions, deletions, receipts (179), service_role,
-- function definitions from earlier migrations, any data. Additive triggers
-- only; no row is modified.

begin;

-- ── 1. Conversation membership ──────────────────────────────────────────────
-- Table-level revoke, then explicitly clear any column-level INSERT/UPDATE
-- privileges, then grant back only what the app needs.
revoke insert, update, delete, truncate on table public.p2p_conversation_members from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_conversation_members';
  execute format('revoke insert (%s), update (%s) on table public.p2p_conversation_members from anon, authenticated', cols, cols);
end $$;
grant update (last_read_at) on table public.p2p_conversation_members to authenticated;

-- The self-insert policy no longer has any use (no client INSERT privilege).
drop policy if exists "conversation_members_insert" on public.p2p_conversation_members;

-- ── 2. Message updates: pin columns only ────────────────────────────────────
revoke update, delete, truncate on table public.p2p_messages from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_messages';
  execute format('revoke update (%s) on table public.p2p_messages from anon, authenticated', cols);
end $$;
grant update (is_pinned, pinned_by, pinned_at, pinned_label) on table public.p2p_messages to authenticated;

-- Pin attribution is the server's: a client pin is always by auth.uid() at now().
create or replace function public.p2p_stamp_message_pin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_pinned then
      new.pinned_by := auth.uid();
      new.pinned_at := case when old.is_pinned then old.pinned_at else now() end;
    else
      new.pinned_by := null;
      new.pinned_at := null;
      new.pinned_label := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_messages_stamp_pin on public.p2p_messages;
create trigger p2p_messages_stamp_pin
  before update of is_pinned, pinned_by, pinned_at, pinned_label on public.p2p_messages
  for each row execute function public.p2p_stamp_message_pin();

-- ── 3. Message inserts: known columns only, server timestamp ────────────────
revoke insert on table public.p2p_messages from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_messages';
  execute format('revoke insert (%s) on table public.p2p_messages from anon, authenticated', cols);
end $$;
grant insert (id, conversation_id, sender_id, body, media_url, message_type, media_duration_seconds, reply_to_message_id)
  on table public.p2p_messages to authenticated;

create or replace function public.p2p_stamp_message_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_messages_00_server_timestamp on public.p2p_messages;
create trigger p2p_messages_00_server_timestamp
  before insert on public.p2p_messages
  for each row execute function public.p2p_stamp_message_created_at();

revoke all on function public.p2p_stamp_message_pin() from public, anon, authenticated;
revoke all on function public.p2p_stamp_message_created_at() from public, anon, authenticated;

commit;

-- Rollback (manual; restores the previous, vulnerable privileges):
--   begin;
--   drop trigger if exists p2p_messages_00_server_timestamp on public.p2p_messages;
--   drop trigger if exists p2p_messages_stamp_pin on public.p2p_messages;
--   drop function if exists public.p2p_stamp_message_created_at();
--   drop function if exists public.p2p_stamp_message_pin();
--   grant insert, update, delete, truncate on table public.p2p_messages to anon, authenticated;
--   grant insert, update, delete, truncate on table public.p2p_conversation_members to anon, authenticated;
--   create policy "conversation_members_insert" on public.p2p_conversation_members for insert to authenticated
--     with check ((user_id = (select auth.uid())) or p2p_is_conversation_member(conversation_id, (select auth.uid())));
--   commit;
