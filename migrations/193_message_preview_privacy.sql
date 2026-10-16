-- 193: Message-preview privacy — hide the sender's name on message pushes.
--
-- Message notifications already never contain message content (104/191);
-- the push reads "<sender> sent you a message". This adds one preference so
-- a person can keep even the sender's name off their lock screen. When it
-- is off, the API's push sender (lib/notificationPrivacy.ts) sends
-- "P2P Global — New message" to that person's devices. Calls, the in-app
-- Notification Center and everyone else's notifications are unchanged.
--
-- Default true = today's behaviour for every existing user.
--
-- Grants follow the per-column model of 174 (owner writes listed columns)
-- and 185 (signed-in users read listed columns): the app saves this through
-- AuthContext.updateProfile like the other notify_* switches, and loads it
-- with the rest of the profile. Row-level policies are unchanged, so a user
-- can still only update their own row. Additive and re-runnable.

alter table public.p2p_profiles
  add column if not exists notify_show_sender_name boolean not null default true;

grant select (notify_show_sender_name) on public.p2p_profiles to authenticated;
grant update (notify_show_sender_name) on public.p2p_profiles to authenticated;
