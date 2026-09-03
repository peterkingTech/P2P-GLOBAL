-- App Style personalization system — adds the columns needed to sync a
-- user's chosen style/mode/illustration-level/favorites across devices.
-- Purely a user preference, additive and nullable: existing rows are
-- unaffected, no existing column is touched, and nothing here is read by
-- any permission check, RLS policy, or role-derivation function (App
-- Style must never gate functionality — see the feature's own security
-- rule). Writes are covered by the existing "users update own profile"
-- policy on p2p_profiles, since these are just more columns on that same
-- row a user can already update.

alter table public.p2p_profiles
  add column if not exists app_style_id text,
  add column if not exists app_style_mode text default 'system',
  add column if not exists app_style_illustration_level text default 'balanced',
  add column if not exists app_style_favorites text[] default '{}';

comment on column public.p2p_profiles.app_style_id is 'Selected App Style id (see artifacts/mobile/constants/appStyles.ts) — null until the user has chosen one; ThemeContext migrates any pre-existing local theme preference into this on first load.';
comment on column public.p2p_profiles.app_style_mode is 'light | dark | system — independent of app_style_id.';
comment on column public.p2p_profiles.app_style_illustration_level is 'minimal | balanced | expressive.';
comment on column public.p2p_profiles.app_style_favorites is 'Array of favorited App Style ids.';