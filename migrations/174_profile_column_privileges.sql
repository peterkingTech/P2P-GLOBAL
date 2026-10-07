-- 174: Close the p2p_profiles self-update privilege escalation.
--
-- Proven on production with a throwaway account (not assumed): the
-- "Users can update own profile" / "Users can insert own profile" policies
-- only check the row (id = auth.uid()), and `authenticated` (and `anon`)
-- held INSERT and UPDATE on all 103 columns. A normal user could therefore
-- set their own role = 'super_admin' (then: 40 instead of 32 profiles
-- visible via RLS, and HTTP 200 instead of 403 from the admin API, whose
-- requireAdmin middleware trusts p2p_profiles.role), is_official_account,
-- is_verified / verification_*, admin_*, region, church_id, username,
-- email, scores — or create their profile row with role = 'super_admin'.
--
-- Fix (security-only, same per-column privilege mechanism as migration 168):
--   1. Clients lose blanket INSERT/UPDATE on p2p_profiles.
--   2. `authenticated` gets INSERT on exactly the columns the app's signup
--      writes, and UPDATE on exactly the columns the app edits as the user.
--      Everything else (role, verification, official/admin fields, region,
--      church_id, scores, …) becomes writable only by the service role and
--      SECURITY DEFINER functions, which is how the server and the scoring
--      triggers already write them. New columns added later are NOT
--      client-writable until deliberately granted (safe by default).
--   3. Signup uses an upsert, and Postgres requires UPDATE privilege on every
--      column an upsert names (id, email, username, username_changed_at,
--      created_at). Those identity columns are granted for that reason only;
--      a trigger rejects any client UPDATE that actually changes them
--      (username changes keep going through the API's /profiles/username).
--
-- Not changed: RLS policies, SELECT/DELETE privileges, the service role,
-- SECURITY DEFINER functions, any data. No row is modified.

-- 1. Remove blanket client write privileges (also removes the matching
--    per-column privileges). anon has no INSERT/UPDATE policy anyway.
revoke insert, update on public.p2p_profiles from anon;
revoke insert, update on public.p2p_profiles from authenticated;

-- 2a. Signup (AuthContext.signUp): the only columns a client may insert.
--     Every other column takes its default (role = 'student', etc.).
grant insert (
  id, email, full_name, date_of_birth, username, username_changed_at, created_at,
  app_language, city, country, country_code, latitude, longitude,
  location_verified, location_verified_at
) on public.p2p_profiles to authenticated;

-- 2b. Fields the app edits as the user (AuthContext.updateProfile, journey,
--     living-tree, ThemeContext, DataContext, sign-in activity), plus the
--     signup upsert's identity columns (guarded by the trigger below).
grant update (
  -- personal profile
  full_name, photo_url, bio, date_of_birth, mission, calling, occupation,
  gifts, skills, ministry_role, ministry_role_updated_at,
  greeting_to_peer_guide, story_answers, tree_name,
  -- location
  city, country, country_code, latitude, longitude, location_verified, location_verified_at,
  -- language / display
  app_language, content_language, date_format,
  app_style_id, app_style_mode, app_style_illustration_level, app_style_favorites,
  tree_environment_preference,
  -- privacy / notification preferences
  profile_visibility, show_country_on_profile, show_progress_publicly, show_real_name_publicly,
  visible_to_church_leadership, analytics_opt_out,
  notifications_enabled, notify_prayer, notify_messages, notify_groups, notify_break_rooms,
  notify_session_reminders, notify_peer_guide_alerts, notify_fruit_awards,
  notify_weekly_encouragement, notify_elijah_checkins,
  morning_confession_enabled, morning_confession_time, prayer_journal_reminder_enabled,
  preferred_session_length, reminder_day, is_praying,
  -- journey state the current app writes itself (see report: follow-up)
  onboarding_journey_completed_at, curriculum_completed_at, growth_level,
  is_peer_guide_eligible, last_active_at,
  -- signup upsert only; changes rejected by the trigger
  id, email, username, username_changed_at, created_at
) on public.p2p_profiles to authenticated;

-- 3. Identity columns: a client UPDATE may name them (upsert) but not change
--    them. Runs only for client roles; the service role and SECURITY DEFINER
--    functions (current_user = owner) are unaffected.
create or replace function public.p2p_guard_profile_identity_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.username is distinct from old.username
    or new.username_changed_at is distinct from old.username_changed_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'These profile fields can only be changed through P2P'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.p2p_guard_profile_identity_columns() from public;

drop trigger if exists p2p_guard_profile_identity_columns_trg on public.p2p_profiles;
create trigger p2p_guard_profile_identity_columns_trg
  before update of id, email, username, username_changed_at, created_at
  on public.p2p_profiles
  for each row
  execute function public.p2p_guard_profile_identity_columns();
