-- 208: identify the PHYSICAL phone behind a push token.
--
-- Why: a phone can hold several Expo push tokens over time — every reinstall
-- (new install id) and every build from a different EAS project mints a new
-- one — and the older ones keep delivering to the same phone. When the
-- phone was signed in as someone else before, their old token stays active
-- and the phone keeps receiving THEIR notifications, which shows up as
-- "I get notified about my own group message" (production, 2026-10-21:
-- 0 notifications were ever addressed to their own sender, but 19 active
-- tokens predate per-install tracking and some accounts hold 9 tokens).
--
-- The phone's native APNs/FCM token is stable across those changes. The app
-- now sends it on registration; the API stores only its SHA-256 here and
-- retires every other active token with the same hash (any account), so a
-- phone keeps exactly one active token per platform.
--
-- Additive only: one nullable column + one partial index. No data changes.
-- Clients never read this table directly (service-role API only).

alter table public.p2p_push_tokens add column if not exists native_token_hash text;

create index if not exists idx_p2p_push_tokens_native_hash
  on public.p2p_push_tokens (native_token_hash, platform)
  where native_token_hash is not null and is_active;

-- Rollback:
--   drop index if exists public.idx_p2p_push_tokens_native_hash;
--   alter table public.p2p_push_tokens drop column if exists native_token_hash;
