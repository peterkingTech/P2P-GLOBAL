-- 197: A permanent group conversation for every Family Circle and Church.
--
-- Until now a family's or church's only chat was per live session (Gathering
-- chat, migration 122; church call messages, 131). This gives each one a
-- lasting conversation in Messages, built exactly like the Peer Circle
-- conversation (migration 068, p2p_sync_circle_conversation as live in
-- production): a trigger keeps p2p_conversation_members in step with the
-- group's ACTIVE members. Messaging itself is unchanged — access is
-- conversation membership (p2p_is_conversation_member), so messages, voice
-- notes, read receipts and push notifications (p2p_notify_on_new_message,
-- which already handles group conversations and per-user mute) work as-is.
-- Gathering chat stays for live sessions.
--
-- Membership rules:
--   Family: p2p_family_members.status = 'active' (invited / left = no access).
--   Church: p2p_church_members.is_active = true.
-- A member who becomes inactive or is removed loses access to the
-- conversation (their already-sent messages stay, as in circles).
--
-- Additive: new nullable columns, two conversation_type values, partial
-- unique indexes (one conversation per family/church), triggers, backfill.
-- No existing row changes except new memberships being added. Re-runnable.

alter table public.p2p_conversations
  add column if not exists family_id uuid references public.p2p_families(id) on delete cascade,
  add column if not exists church_id uuid references public.p2p_churches(id) on delete cascade;

create unique index if not exists p2p_conversations_family_id_key on public.p2p_conversations(family_id) where family_id is not null;
create unique index if not exists p2p_conversations_church_id_key on public.p2p_conversations(church_id) where church_id is not null;

alter table public.p2p_conversations drop constraint if exists p2p_conversations_conversation_type_check;
alter table public.p2p_conversations add constraint p2p_conversations_conversation_type_check
  check (conversation_type = any (array['direct', 'crisis_response', 'help_request', 'pastoral', 'support', 'peer_group', 'circle', 'family', 'church']));

-- ── Family ──────────────────────────────────────────────────────────────────
create or replace function public.p2p_sync_family_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  v_family uuid := coalesce(new.family_id, old.family_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_now_active boolean := tg_op <> 'DELETE' and new.status = 'active';
begin
  select id into conv_id from p2p_conversations where family_id = v_family;
  if v_now_active then
    if conv_id is null then
      insert into p2p_conversations (type, family_id, conversation_type, name)
      select 'group', f.id, 'family', f.name from p2p_families f where f.id = v_family
      on conflict do nothing
      returning id into conv_id;
      if conv_id is null then
        select id into conv_id from p2p_conversations where family_id = v_family;
      end if;
    end if;
    insert into p2p_conversation_members (conversation_id, user_id)
    values (conv_id, v_user)
    on conflict do nothing;
  elsif conv_id is not null then
    delete from p2p_conversation_members
    where conversation_id = conv_id and user_id = v_user
      and not exists (
        select 1 from p2p_family_members fm
        where fm.family_id = v_family and fm.user_id = v_user and fm.status = 'active'
          and fm.id is distinct from coalesce(new.id, old.id)
      );
  end if;
  return null;
end;
$$;

drop trigger if exists p2p_family_members_sync_conversation on public.p2p_family_members;
create trigger p2p_family_members_sync_conversation
after insert or update of status, user_id, family_id or delete on public.p2p_family_members
for each row execute function public.p2p_sync_family_conversation();

-- Renaming a family renames its conversation.
create or replace function public.p2p_sync_family_conversation_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update p2p_conversations set name = new.name where family_id = new.id and name is distinct from new.name;
  return null;
end;
$$;

drop trigger if exists p2p_families_sync_conversation_name on public.p2p_families;
create trigger p2p_families_sync_conversation_name
after update of name on public.p2p_families
for each row execute function public.p2p_sync_family_conversation_name();

-- ── Church ──────────────────────────────────────────────────────────────────
create or replace function public.p2p_sync_church_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  v_church uuid := coalesce(new.church_id, old.church_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_now_active boolean := tg_op <> 'DELETE' and new.is_active;
begin
  select id into conv_id from p2p_conversations where church_id = v_church;
  if v_now_active then
    if conv_id is null then
      insert into p2p_conversations (type, church_id, conversation_type, name)
      select 'group', c.id, 'church', c.name from p2p_churches c where c.id = v_church
      on conflict do nothing
      returning id into conv_id;
      if conv_id is null then
        select id into conv_id from p2p_conversations where church_id = v_church;
      end if;
    end if;
    insert into p2p_conversation_members (conversation_id, user_id)
    values (conv_id, v_user)
    on conflict do nothing;
  elsif conv_id is not null then
    delete from p2p_conversation_members
    where conversation_id = conv_id and user_id = v_user
      and not exists (
        select 1 from p2p_church_members cm
        where cm.church_id = v_church and cm.user_id = v_user and cm.is_active
          and cm.id is distinct from coalesce(new.id, old.id)
      );
  end if;
  return null;
end;
$$;

drop trigger if exists p2p_church_members_sync_conversation on public.p2p_church_members;
create trigger p2p_church_members_sync_conversation
after insert or update of is_active, user_id, church_id or delete on public.p2p_church_members
for each row execute function public.p2p_sync_church_conversation();

create or replace function public.p2p_sync_church_conversation_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update p2p_conversations set name = new.name where church_id = new.id and name is distinct from new.name;
  return null;
end;
$$;

drop trigger if exists p2p_churches_sync_conversation_name on public.p2p_churches;
create trigger p2p_churches_sync_conversation_name
after update of name on public.p2p_churches
for each row execute function public.p2p_sync_church_conversation_name();

-- Trigger functions are not callable as RPCs.
revoke all on function public.p2p_sync_family_conversation() from public, anon, authenticated;
revoke all on function public.p2p_sync_family_conversation_name() from public, anon, authenticated;
revoke all on function public.p2p_sync_church_conversation() from public, anon, authenticated;
revoke all on function public.p2p_sync_church_conversation_name() from public, anon, authenticated;

-- ── Backfill existing active members ──────────────────────────────────────
insert into public.p2p_conversations (type, family_id, conversation_type, name)
select 'group', f.id, 'family', f.name
from public.p2p_families f
where exists (select 1 from public.p2p_family_members m where m.family_id = f.id and m.status = 'active')
  and not exists (select 1 from public.p2p_conversations c where c.family_id = f.id);

insert into public.p2p_conversation_members (conversation_id, user_id)
select c.id, m.user_id
from public.p2p_family_members m
join public.p2p_conversations c on c.family_id = m.family_id
where m.status = 'active'
on conflict do nothing;

insert into public.p2p_conversations (type, church_id, conversation_type, name)
select 'group', ch.id, 'church', ch.name
from public.p2p_churches ch
where exists (select 1 from public.p2p_church_members m where m.church_id = ch.id and m.is_active)
  and not exists (select 1 from public.p2p_conversations c where c.church_id = ch.id);

insert into public.p2p_conversation_members (conversation_id, user_id)
select c.id, m.user_id
from public.p2p_church_members m
join public.p2p_conversations c on c.church_id = m.church_id
where m.is_active
on conflict do nothing;

-- Rollback (only if needed; drops the conversations and their messages):
--   drop trigger if exists p2p_family_members_sync_conversation on public.p2p_family_members;
--   drop trigger if exists p2p_families_sync_conversation_name on public.p2p_families;
--   drop trigger if exists p2p_church_members_sync_conversation on public.p2p_church_members;
--   drop trigger if exists p2p_churches_sync_conversation_name on public.p2p_churches;
--   delete from public.p2p_conversations where family_id is not null or church_id is not null;
--   alter table public.p2p_conversations drop constraint p2p_conversations_conversation_type_check;
--   alter table public.p2p_conversations add constraint p2p_conversations_conversation_type_check
--     check (conversation_type = any (array['direct', 'crisis_response', 'help_request', 'pastoral', 'support', 'peer_group', 'circle']));
--   drop index if exists public.p2p_conversations_family_id_key;
--   drop index if exists public.p2p_conversations_church_id_key;
--   alter table public.p2p_conversations drop column if exists family_id, drop column if exists church_id;
