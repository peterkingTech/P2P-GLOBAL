-- 065: Individual identity verification (blue tick) — selfie or video selfie
-- only, no government ID. Reviewed by admin staff; submissions are deleted
-- after a decision is made.
--
-- Deviations from the original spec, and why:
--   * Admin RLS checks `role in ('moderator','church_leader','regional_admin',
--     'super_admin')` via the existing p2p_current_role() helper (see
--     migrations/012_settings_bio_messaging.sql), not `role = 'admin'` — same
--     bug as migration 064 (`role = 'admin'` matches no real user; confirmed
--     live). This intentionally EXCLUDES peer_guide, unlike the broader
--     requireAdmin() Express middleware — reviewing a person's biometric
--     selfie/video is more sensitive than the moderation-adjacent admin
--     actions peer_guide already has access to (reserved usernames, content
--     flags), so it's scoped to the same moderator+ set p2p_content_flags
--     already uses (migrations/013_moderation.sql).
--   * No client-facing INSERT policy on p2p_verification_applications or
--     p2p_verification_history — the entire submit/review/decide flow goes
--     through Express endpoints using the service-role client (same
--     reasoning as p2p_username_history in migration 064: an admin decision
--     and a biometric upload are not something the client should be able to
--     forge by calling PostgREST directly). SELECT policies are still added
--     for own-row / admin visibility.
--   * No storage.objects RLS policies added for the 'verification-submissions'
--     bucket — unlike the 'submissions' bucket in migration 009 (which needs
--     direct client upload), every read/write here goes through Express with
--     the service-role key, which bypasses RLS entirely. The bucket stays
--     public=false as a defense-in-depth backstop, but no authenticated-role
--     policy is granted because no client should ever reach it directly.
--   * "No active moderation flags" (spec's `is_flagged` column) doesn't exist
--     anywhere in this schema — the real signal is an open/escalated row in
--     p2p_content_flags.author_id (migration 013). Checked in application
--     code at submission time; no new column needed.

alter table p2p_profiles
  add column if not exists is_verified boolean not null default false,
  add column if not exists verification_status text not null default 'unverified',
  -- 'unverified' | 'pending' | 'approved' | 'declined' | 'revoked'
  add column if not exists verification_method text,
  -- 'selfie_note' | 'video_selfie' | 'manual_grant'
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists verification_decline_reason text,
  add column if not exists verification_approved_at timestamptz,
  add column if not exists verification_badge_visible boolean not null default true,
  add column if not exists can_reapply_at timestamptz;

create index if not exists idx_profiles_verification_status on p2p_profiles(verification_status);

create table if not exists p2p_verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null, -- 'selfie_note' | 'video_selfie'
  submission_path text, -- storage object path, e.g. {userId}/{timestamp}_{filename}
  -- Nulled out once the file is deleted post-decision (see verificationCleanup.ts)
  profile_photo_url text, -- snapshot of profile photo at submission time
  status text not null default 'pending', -- 'pending' | 'approved' | 'declined'
  face_match_notes text, -- private admin reviewer notes
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  decline_reason text,
  submitted_at timestamptz not null default now(),
  submission_deleted_at timestamptz,
  delete_after timestamptz, -- when the cleanup job is allowed to delete the file
  attempt_number integer not null default 1
);

create index if not exists idx_verification_apps_status on p2p_verification_applications(status, submitted_at);
create index if not exists idx_verification_apps_user on p2p_verification_applications(user_id);
create index if not exists idx_verification_apps_delete_after on p2p_verification_applications(delete_after) where submission_path is not null;

create table if not exists p2p_verification_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null, -- 'submitted' | 'approved' | 'declined' | 'revoked' | 'reapplied' | 'withdrawn' | 'granted'
  action_by uuid references auth.users(id) on delete set null, -- null if by the user themself
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_verification_history_user on p2p_verification_history(user_id, created_at desc);

alter table p2p_verification_applications enable row level security;
alter table p2p_verification_history enable row level security;

drop policy if exists "Users see own verification application" on p2p_verification_applications;
create policy "Users see own verification application" on p2p_verification_applications
  for select using (auth.uid() = user_id);

drop policy if exists "Admins see all verification applications" on p2p_verification_applications;
create policy "Admins see all verification applications" on p2p_verification_applications
  for select using (p2p_current_role() in ('moderator', 'church_leader', 'regional_admin', 'super_admin'));

drop policy if exists "Users see own verification history" on p2p_verification_history;
create policy "Users see own verification history" on p2p_verification_history
  for select using (auth.uid() = user_id);

drop policy if exists "Admins see all verification history" on p2p_verification_history;
create policy "Admins see all verification history" on p2p_verification_history
  for select using (p2p_current_role() in ('moderator', 'church_leader', 'regional_admin', 'super_admin'));

-- Private storage bucket for verification selfies/videos — accessed only via
-- the service-role client in Express (upload on submit, signed URL for admin
-- review, delete after decision). See deviation note above.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-submissions', 'verification-submissions', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;
