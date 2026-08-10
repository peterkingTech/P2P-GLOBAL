-- 053: Phone-style nested Settings screens (FIX 5) surface several toggles
-- and preferences that have no backing column on p2p_profiles today —
-- notifications were previously one generic on/off plus 3 category flags
-- (notify_prayer/notify_messages/notify_groups from migration 012), none of
-- which map to the 5 categories the new Notifications sub-screen asks for
-- (Session Reminders, Peer Guide Alerts, Fruit Awards, Weekly Encouragement,
-- Elijah Protocol Check-ins). Rather than overload the old 3 flags with new
-- meanings, this adds the 5 new columns explicitly, alongside new Privacy,
-- Language/Region, Kingdom School, and Prayer preference columns.
--
-- Note: "Preferred learning format" (solo / peer guide / group circle) is
-- NOT duplicated here — it already exists as p2p_user_goals.learning_format
-- (see settings.tsx's LEARNING_FORMAT_OPTIONS) and the new
-- settings/kingdom-school.tsx screen reuses that existing column instead of
-- creating a second source of truth.
--
-- The old 3-way profile_visibility enum (public/peers/private, migration
-- 012) is left untouched — it was never enforced by any RLS policy or
-- backend route (confirmed by search), and the new Privacy screen replaces
-- it in the UI with the 3 toggles below. The column and its data are not
-- dropped, just no longer surfaced by this screen.

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS notify_session_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS notify_peer_guide_alerts boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS notify_fruit_awards boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS notify_weekly_encouragement boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS notify_elijah_checkins boolean NOT NULL DEFAULT true;

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS visible_to_church_leadership boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS show_country_on_profile boolean NOT NULL DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS analytics_opt_out boolean NOT NULL DEFAULT false;

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'DD.MM.YYYY';
ALTER TABLE p2p_profiles DROP CONSTRAINT IF EXISTS p2p_profiles_date_format_check;
ALTER TABLE p2p_profiles ADD CONSTRAINT p2p_profiles_date_format_check CHECK (date_format IN ('DD.MM.YYYY', 'MM/DD/YYYY'));

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS preferred_session_length text;
ALTER TABLE p2p_profiles DROP CONSTRAINT IF EXISTS p2p_profiles_session_length_check;
ALTER TABLE p2p_profiles ADD CONSTRAINT p2p_profiles_session_length_check CHECK (preferred_session_length IS NULL OR preferred_session_length IN ('15min', '45min', 'flexible'));
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS reminder_day text;
ALTER TABLE p2p_profiles DROP CONSTRAINT IF EXISTS p2p_profiles_reminder_day_check;
ALTER TABLE p2p_profiles ADD CONSTRAINT p2p_profiles_reminder_day_check CHECK (reminder_day IS NULL OR reminder_day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday'));

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS morning_confession_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS morning_confession_time text NOT NULL DEFAULT '07:00';
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS prayer_journal_reminder_enabled boolean NOT NULL DEFAULT false;