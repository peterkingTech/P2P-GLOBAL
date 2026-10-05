-- 172: Native call system (Android Telecom / iOS CallKit) push tokens.
--
-- Additive only — no existing row or value changes meaning.
--
-- 1. platform 'ios_voip': an iOS PushKit VoIP token. These are sent straight
--    to Apple (lib/apnsVoip.ts), never through Expo, and are what lets an
--    incoming call ring through CallKit while the app is closed. The
--    device_id column ties one to the same device's Expo token.
-- 2. call_system: set by app builds that handle calls natively (Android
--    Telecom / iOS CallKit). The server only sends silent call-state pushes
--    ("this call stopped ringing") to these tokens — an older build would
--    otherwise show them as an empty notification.

do $$
declare
  c record;
begin
  -- The inline check from migration 104 has a generated name; drop whichever
  -- check constraint restricts platform, then add the widened one.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.p2p_push_tokens'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%platform%'
  loop
    execute format('alter table public.p2p_push_tokens drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.p2p_push_tokens
  add constraint p2p_push_tokens_platform_check
  check (platform in ('ios', 'android', 'ios_voip'));

alter table public.p2p_push_tokens
  add column if not exists call_system boolean not null default false;
