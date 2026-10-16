-- 195: Fourth message-preview level — "Name, reveal message on hold".
--
-- DRAFT — NOT APPLIED to production. Needs migration 194.
--
-- p2p_profiles.notify_message_preview gains 'hold':
--   'full' Name and message — the banner shows the message text.
--   'hold' Name, reveal message on hold — the banner shows only who it's from
--          ("Grace · sent you a message"); on iPhone, pressing and holding the
--          notification reveals the text / voice note (fetched with the same
--          short-lived token as 'full'; never sent through Expo/APNs).
--   'name' Name only (default) — no content anywhere.
--   'none' Nothing — no name, photo or preview.
--
-- Nobody is moved: existing values are untouched; 'hold' is opt-in only.
-- 194's sync trigger already treats every level other than 'none' as
-- "names shown" (old switch = level <> 'none'), so 'hold' needs no trigger
-- change. Only the CHECK constraint is widened. Re-runnable.
-- Rollback (manual; only if no row uses 'hold'):
--   update public.p2p_profiles set notify_message_preview = 'name' where notify_message_preview = 'hold';
--   alter table public.p2p_profiles drop constraint if exists p2p_profiles_notify_message_preview_check;
--   alter table public.p2p_profiles add constraint p2p_profiles_notify_message_preview_check check (notify_message_preview in ('full', 'name', 'none'));

alter table public.p2p_profiles drop constraint if exists p2p_profiles_notify_message_preview_check;
alter table public.p2p_profiles
  add constraint p2p_profiles_notify_message_preview_check check (notify_message_preview in ('full', 'hold', 'name', 'none'));
