-- Fix: p2p_profiles had RLS enabled with only a SELECT policy, so the
-- INSERT/UPSERT that runs right after supabase.auth.signUp() was silently
-- blocked (and additionally used column names that don't exist on the real
-- table, e.g. display_name/growth_level/gifts/is_praying/language_code
-- instead of full_name/language). No p2p_profiles row ever got created for
-- new signups. The registration intake form's insert into
-- p2p_registration_profiles then failed with "violates foreign key
-- constraint p2p_registration_profiles_user_id_fkey" because it referenced
-- a p2p_profiles.id that never existed.

-- 1. Allow users to create and update their own profile row.
CREATE POLICY "Users can insert own profile"
  ON public.p2p_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.p2p_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2. Add columns the app UI actively depends on (spiritual gifts picker,
--    growth level display, prayer status) that were never added to the
--    real p2p_profiles table.
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS growth_level integer NOT NULL DEFAULT 0;
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS gifts text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.p2p_profiles ADD COLUMN IF NOT EXISTS is_praying boolean NOT NULL DEFAULT false;

-- 3. Backfill: create profile rows for any existing auth.users that signed
--    up while the INSERT policy was missing and never got a p2p_profiles row.
INSERT INTO public.p2p_profiles (id, email, full_name, created_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  u.created_at
FROM auth.users u
LEFT JOIN public.p2p_profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
