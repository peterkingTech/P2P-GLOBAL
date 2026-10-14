-- 179: Message delivery and read receipts (WhatsApp-style ticks).
--
-- DRAFT — NOT APPLIED. Apply only after review and a staging run of
-- scripts/test_179_message_receipts (see the receipts report). Additive only:
-- no existing policy, grant, trigger, function, column or row is changed or
-- removed, so every installed app build keeps working unchanged. Builds
-- without the receipts feature simply never acknowledge, so messages sent to
-- people on those builds stay at "Sent" (never falsely Delivered/Read).
--
-- Why a new table instead of p2p_conversation_members.last_read_at:
-- last_read_at is one client-written timestamp per member (device clock,
-- freely updatable, can move backwards, no delivered state, not published to
-- realtime). Receipts need per-message, per-recipient, server-timestamped,
-- monotonic state. last_read_at keeps driving unread counts exactly as today.
--
-- Why not columns on p2p_messages: authenticated holds UPDATE on every
-- p2p_messages column, and in every non-group conversation both members pass
-- messages_update_pin (p2p_can_pin_message), so either party could rewrite
-- receipt columns on the other's message. Receipt rows here are writable
-- only through the SECURITY DEFINER functions below.
--
-- Model
--   A row exists once the recipient's device acknowledged the message:
--     row exists            => Delivered (delivered_at)
--     read_at is not null   => Read      (read_at)
--   No row                  => Sent only (never inferred from push, insert
--                              or conversation open).
--   Both timestamps are server time (now()), set once, never cleared or
--   moved: delivered_at is written only on INSERT; read_at only goes from
--   NULL to a value. Duplicate / retried / out-of-order acknowledgements are
--   therefore no-ops, and Read can never regress to Delivered.
--
-- Who is a recipient of message M
--   A member of M's conversation, other than M's sender, whose membership
--   began at or before M was sent (joined_at <= created_at). People who join
--   later can read the history but never generate receipts for it; people
--   who leave keep the receipts they already produced. Call-summary rows,
--   messages deleted for everyone and sender-less rows are not acknowledged.
--
-- Read-receipt privacy
--   p2p_profiles.send_read_receipts (default true). When false, the
--   acknowledgement function records delivery but never read_at. Turning it
--   off does not delete or alter receipts already recorded; turning it back
--   on affects only acknowledgements made afterwards. It does not affect the
--   receipts the user sees for their own messages. Read and written only
--   through p2p_get_my_read_receipts / p2p_set_my_read_receipts (it is
--   deliberately NOT added to migration 174's client UPDATE column list, and
--   needs no change to the still-unapplied migration 178).

begin;

-- ── 1. Preference ───────────────────────────────────────────────────────────
alter table public.p2p_profiles
  add column if not exists send_read_receipts boolean not null default true;

-- ── 2. Receipts table ───────────────────────────────────────────────────────
create table if not exists public.p2p_message_receipts (
  message_id      uuid        not null references public.p2p_messages(id)      on delete cascade,
  user_id         uuid        not null references public.p2p_profiles(id)      on delete cascade,
  -- Copied from the message by the acknowledgement function (never from the
  -- client) so realtime subscriptions can filter by conversation.
  conversation_id uuid        not null references public.p2p_conversations(id) on delete cascade,
  delivered_at    timestamptz not null default now(),
  read_at         timestamptz,
  primary key (message_id, user_id),
  constraint p2p_message_receipts_read_after_delivered
    check (read_at is null or read_at >= delivered_at)
);

create index if not exists idx_p2p_message_receipts_conversation
  on public.p2p_message_receipts (conversation_id);
create index if not exists idx_p2p_message_receipts_user
  on public.p2p_message_receipts (user_id);

-- ── 3. Helper (SECURITY DEFINER, same pattern as p2p_is_conversation_member)
create or replace function public.p2p_is_message_sender(p_message_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from p2p_messages where id = p_message_id and sender_id = p_user_id
  );
$$;

-- ── 4. Row-level security ───────────────────────────────────────────────────
-- Readable by the recipient it belongs to, and by the message's sender —
-- in both cases only while they are still a member of the conversation.
-- Other group members never see each other's receipts. No INSERT, UPDATE or
-- DELETE policy: clients cannot write receipts directly at all.
alter table public.p2p_message_receipts enable row level security;

drop policy if exists "message_receipts_select" on public.p2p_message_receipts;
create policy "message_receipts_select" on public.p2p_message_receipts
  for select to authenticated
  using (
    (user_id = (select auth.uid()) or p2p_is_message_sender(message_id, (select auth.uid())))
    and p2p_is_conversation_member(conversation_id, (select auth.uid()))
  );

revoke all on table public.p2p_message_receipts from public, anon, authenticated;
grant select on table public.p2p_message_receipts to authenticated;

-- ── 5. Acknowledgement ──────────────────────────────────────────────────────
-- The ONLY write path. The recipient is always auth.uid(); the client
-- supplies message ids only (no recipient id, no timestamps). Ineligible ids
-- (not a member, own message, joined after it was sent, deleted, call
-- summary, unknown) are silently skipped. Returns the caller's resulting
-- receipt for each eligible id so the client can reconcile.
create or replace function public.p2p_acknowledge_messages(p_message_ids uuid[], p_read boolean)
returns table (message_id uuid, delivered_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_record_read boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return;
  end if;
  if cardinality(p_message_ids) > 200 then
    raise exception 'At most 200 messages per acknowledgement' using errcode = '22023';
  end if;

  v_record_read := coalesce(p_read, false)
    and coalesce((select pr.send_read_receipts from p2p_profiles pr where pr.id = v_uid), true);

  insert into p2p_message_receipts as r (message_id, user_id, conversation_id, delivered_at, read_at)
  select m.id, v_uid, m.conversation_id, now(), case when v_record_read then now() end
  from p2p_messages m
  join p2p_conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = v_uid
  where m.id = any (p_message_ids)
    and m.sender_id is not null
    and m.sender_id <> v_uid
    and m.deleted_at is null
    and m.message_type <> 'call_summary'
    and m.created_at >= cm.joined_at
  on conflict on constraint p2p_message_receipts_pkey do update
    set read_at = excluded.read_at
    where r.read_at is null and excluded.read_at is not null;

  return query
    select r.message_id, r.delivered_at, r.read_at
    from p2p_message_receipts r
    where r.user_id = v_uid and r.message_id = any (p_message_ids);
end;
$$;

-- ── 6. Message info (sender only) ───────────────────────────────────────────
-- One row per recipient of the message: everyone eligible at send time who
-- is still a member, plus anyone who left after acknowledging it.
create or replace function public.p2p_message_receipt_details(p_message_id uuid)
returns table (
  user_id uuid, full_name text, username text, photo_url text,
  delivered_at timestamptz, read_at timestamptz, is_current_member boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_sender uuid;
  v_conversation uuid;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select m.sender_id, m.conversation_id, m.created_at
    into v_sender, v_conversation, v_created
  from p2p_messages m where m.id = p_message_id;
  if v_sender is null or v_sender <> v_uid
     or not p2p_is_conversation_member(v_conversation, v_uid) then
    raise exception 'Message info is only available to its sender' using errcode = '42501';
  end if;

  return query
    with recipients as (
      select cm.user_id as rid, true as current_member
      from p2p_conversation_members cm
      where cm.conversation_id = v_conversation
        and cm.user_id <> v_uid
        and cm.joined_at <= v_created
      union
      select r.user_id, false
      from p2p_message_receipts r
      where r.message_id = p_message_id
        and not exists (
          select 1 from p2p_conversation_members cm2
          where cm2.conversation_id = v_conversation and cm2.user_id = r.user_id
        )
    )
    select rc.rid, p.full_name, p.username, p.photo_url,
           r.delivered_at, r.read_at, rc.current_member
    from recipients rc
    join p2p_profiles p on p.id = rc.rid
    left join p2p_message_receipts r on r.message_id = p_message_id and r.user_id = rc.rid
    order by p.full_name nulls last, rc.rid;
end;
$$;

-- ── 7. Preference access ────────────────────────────────────────────────────
create or replace function public.p2p_get_my_read_receipts()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select send_read_receipts from p2p_profiles where id = auth.uid()), true);
$$;

create or replace function public.p2p_set_my_read_receipts(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'A value is required' using errcode = '22004';
  end if;
  update p2p_profiles set send_read_receipts = p_enabled where id = v_uid;
  return p_enabled;
end;
$$;

revoke all on function public.p2p_is_message_sender(uuid, uuid) from public, anon;
revoke all on function public.p2p_acknowledge_messages(uuid[], boolean) from public, anon;
revoke all on function public.p2p_message_receipt_details(uuid) from public, anon;
revoke all on function public.p2p_get_my_read_receipts() from public, anon;
revoke all on function public.p2p_set_my_read_receipts(boolean) from public, anon;
grant execute on function public.p2p_is_message_sender(uuid, uuid) to authenticated;
grant execute on function public.p2p_acknowledge_messages(uuid[], boolean) to authenticated;
grant execute on function public.p2p_message_receipt_details(uuid) to authenticated;
grant execute on function public.p2p_get_my_read_receipts() to authenticated;
grant execute on function public.p2p_set_my_read_receipts(boolean) to authenticated;

-- ── 8. Realtime ─────────────────────────────────────────────────────────────
-- Realtime applies the SELECT policy above per subscriber, so a sender is
-- streamed only the receipts for their own messages.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'p2p_message_receipts'
  ) then
    alter publication supabase_realtime add table public.p2p_message_receipts;
  end if;
end;
$$;

commit;

-- Rollback (manual, only if never used in production):
--   begin;
--   alter publication supabase_realtime drop table public.p2p_message_receipts;
--   drop function if exists public.p2p_set_my_read_receipts(boolean);
--   drop function if exists public.p2p_get_my_read_receipts();
--   drop function if exists public.p2p_message_receipt_details(uuid);
--   drop function if exists public.p2p_acknowledge_messages(uuid[], boolean);
--   drop table if exists public.p2p_message_receipts;
--   drop function if exists public.p2p_is_message_sender(uuid, uuid);
--   alter table public.p2p_profiles drop column if exists send_read_receipts;
--   commit;
