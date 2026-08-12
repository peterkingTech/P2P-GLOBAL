-- GPS location verification (Prompt: Real Location Verification).
-- p2p_profiles already has city/country (migration 048) for the freeform,
-- user-typed location shown on profile — these new columns are specifically
-- the device-GPS-derived, reverse-geocoded, verified counterpart:
--   country_code        — ISO country code from reverse geocoding, used for
--                          exact matching in peer-guide search (country is
--                          free text and can't be matched reliably).
--   latitude/longitude   — raw GPS coordinates at time of verification.
--   location_verified    — true only when set via LocationVerifier's GPS
--                          flow, never by manually typing a city/country.
--   location_verified_at — shown to the user as "Verified 3 months ago".

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS country_code text;

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS latitude numeric;

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS longitude numeric;

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS location_verified boolean DEFAULT false;

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS location_verified_at timestamptz;