-- 194: Message-preview privacy level (three levels) for iPhone long-press
-- previews.
--
-- DRAFT — NOT APPLIED to production. Needs migration 193 (notify_show_sender_name).
--
-- p2p_profiles.notify_message_preview:
--   'full' — Name and message: sender identity plus, for recipients who opt in,
--            the message text / voice preview, fetched by the iPhone
--            notification extension with a short-lived token (never sent
--            through Expo/APNs; see api-server lib/previewToken.ts).
--   'name' — Name only (DEFAULT): sender identity, generic wording
--            ("sent you a message"), no content. Today's behaviour.
--   'none' — Nothing: "P2P Global — New message", no name, photo or preview.
--
-- Existing users keep exactly the privacy they have now — nobody is switched
-- to 'full':
--   notify_show_sender_name = true  (everyone by default) -> 'name'
--   notify_show_sender_name = false (hid name + photo)    -> 'none'
--
-- Compatibility with 193's switch, both directions, in one BEFORE UPDATE
-- trigger (so an app build that only knows the old switch stays coherent):
--   * the old switch changes, the level isn't set in the same update:
--       false -> level 'none';  true -> 'name' only if the level was 'none'
--       ('full' stays 'full' — turning names back on never lowers it).
--   * the level changes: old switch = (level <> 'none').
--
-- Grants follow 174/185/193: owner reads/updates this column; RLS unchanged
-- (a user can only update their own row). Additive and re-runnable.
-- Rollback (manual):
--   drop trigger if exists p2p_profiles_sync_message_preview on public.p2p_profiles;
--   drop function if exists public.p2p_sync_message_preview();
--   alter table public.p2p_profiles drop column if exists notify_message_preview;

alter table public.p2p_profiles
  add column if not exists notify_message_preview text not null default 'name';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_profiles_notify_message_preview_check') then
    alter table public.p2p_profiles
      add constraint p2p_profiles_notify_message_preview_check check (notify_message_preview in ('full', 'name', 'none'));
  end if;
end $$;

-- One-time carry-over of 193's choice (re-runnable: only rows still at the
-- default and whose old switch is off).
update public.p2p_profiles
   set notify_message_preview = 'none'
 where notify_show_sender_name = false and notify_message_preview = 'name';

create or replace function public.p2p_sync_message_preview()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.notify_message_preview is distinct from old.notify_message_preview then
    new.notify_show_sender_name := (new.notify_message_preview <> 'none');
  elsif new.notify_show_sender_name is distinct from old.notify_show_sender_name then
    if new.notify_show_sender_name = false then
      new.notify_message_preview := 'none';
    elsif old.notify_message_preview = 'none' then
      new.notify_message_preview := 'name';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.p2p_sync_message_preview() from public, anon, authenticated;

drop trigger if exists p2p_profiles_sync_message_preview on public.p2p_profiles;
create trigger p2p_profiles_sync_message_preview
  before update of notify_message_preview, notify_show_sender_name on public.p2p_profiles
  for each row execute function public.p2p_sync_message_preview();

grant select (notify_message_preview) on public.p2p_profiles to authenticated;
grant update (notify_message_preview) on public.p2p_profiles to authenticated;
