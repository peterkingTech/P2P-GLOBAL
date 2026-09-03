-- Fix a real, pre-existing gap: the admin curriculum editor's module-photo
-- upload feature (ModuleEditor.pickAndUploadImage in
-- artifacts/mobile/app/admin/curriculum.tsx) has always uploaded to the
-- "Module Title Pictures" Supabase Storage bucket, but that bucket has never
-- had a single RLS policy on storage.objects — so no one, including real
-- admins, has ever been able to write to it through the app. The 18 existing
-- p2p_modules.image_url values pointing into this bucket were populated
-- directly (service-role/dashboard), bypassing RLS entirely, which is why
-- they display fine (the bucket is public, so reads bypass RLS) while writes
-- have silently been impossible.
--
-- This mirrors the exact working pattern already used for the
-- "curriculum-media" bucket (migration history) — same p2p_is_admin() gate,
-- same ALL-command admin policy, same public-read policy for symmetry. No
-- change to p2p_modules, p2p_lessons, progress, or any other table.

create policy "Admins manage module media"
  on storage.objects for all
  using (bucket_id = 'Module Title Pictures' and p2p_is_admin())
  with check (bucket_id = 'Module Title Pictures' and p2p_is_admin());

create policy "Public read module media"
  on storage.objects for select
  using (bucket_id = 'Module Title Pictures');