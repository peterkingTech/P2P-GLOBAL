-- 261 — P2P Voices: let the voice catalogue remember the Nigerian-language providers too (2026-11-26).
-- PROPOSED — NOT APPLIED. Needs the owner's approval (guarded apply + backup, as usual).
--
-- Why: 254 created p2p_voice_catalogue with a check that only allows the first four providers. 9jaLingo, Naija Speech
-- and now Giggy (owner 2026-11-26: Naija Pidgin, Igbo and Twi in the general P2P Voices) therefore cannot be saved,
-- so the API keeps their voice list in memory only and fetches it again after every restart (Giggy: ~250 catalogue
-- pages). Nothing breaks without this migration — it only makes restarts cheaper and lists survive a provider outage.
--
-- Change: the check is widened (nothing is removed; existing rows all satisfy the new check). Additive and reversible.
-- Rollback: re-create the 254 check (only possible after deleting rows for the new providers — a cache, safe to drop).

begin;

alter table public.p2p_voice_catalogue drop constraint if exists p2p_voice_catalogue_provider_check;
alter table public.p2p_voice_catalogue add constraint p2p_voice_catalogue_provider_check
  check (provider in ('azure', 'google', 'elevenlabs', 'spitch', 'naijalingo', 'naijaspeech', 'giggy'));

commit;
