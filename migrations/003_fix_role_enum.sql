-- Aligns the live p2p_profiles.role enum with the project blueprint's six roles:
-- Student, Peer Guide, Church Leader, Regional Admin, Moderator, Super Admin.
--
-- Pre-flight check (already run manually): 0 rows currently use 'regional_director'
-- or 'global_admin' out of 3 total rows (all 3 are 'student'). Safe to proceed.
-- Only p2p_profiles.role uses the user_role enum type (verified via pg_attribute) —
-- no other table will be affected.

-- Step 1: rename regional_director -> regional_admin, and add moderator.
-- (Run as its own transaction: a newly-added enum value cannot be referenced
-- in the same transaction that adds it, so this must commit before Step 2.)
BEGIN;
ALTER TYPE user_role RENAME VALUE 'regional_director' TO 'regional_admin';
ALTER TYPE user_role ADD VALUE 'moderator';
COMMIT;

-- Step 2: remove global_admin (Postgres has no DROP VALUE for enums, so the
-- type must be recreated). Existing 'global_admin' rows are moved to
-- 'super_admin' first (none currently exist, but this makes the migration
-- safe to re-run later if that changes before this runs).
BEGIN;

UPDATE public.p2p_profiles SET role = 'super_admin' WHERE role = 'global_admin';

CREATE TYPE user_role_new AS ENUM (
  'student',
  'peer_guide',
  'church_leader',
  'regional_admin',
  'moderator',
  'super_admin'
);

ALTER TABLE public.p2p_profiles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.p2p_profiles
  ALTER COLUMN role TYPE user_role_new
  USING role::text::user_role_new;
ALTER TABLE public.p2p_profiles ALTER COLUMN role SET DEFAULT 'student';

DROP TYPE user_role;
ALTER TYPE user_role_new RENAME TO user_role;

COMMIT;
