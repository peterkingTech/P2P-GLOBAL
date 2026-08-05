-- 049: Elijah Protocol + Dormant Seed pastoral care automation.
-- Renumbered from the spec's 048 — 048 was already used for the
-- AuthContext.tsx column fix (city/mission/calling/occupation columns).

CREATE TABLE IF NOT EXISTS p2p_pastoral_care_log (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  care_type             text not null check (care_type in ('dormant_seed_message', 'elijah_protocol', 'peer_guide_alert')),
  message_sent          text,
  sent_at               timestamptz not null default now(),
  user_response         text check (user_response in ('taking_break', 'needs_support', 'restarting')),
  responded_at          timestamptz,
  peer_guide_notified   boolean not null default false,
  peer_guide_notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pastoral_care_log_user ON p2p_pastoral_care_log(user_id, care_type, sent_at DESC);

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS elijah_protocol_sent_at timestamptz;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS dormant_seed_opt_in boolean DEFAULT true;
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
-- Backs the "I need a break but I am okay" response — no further pastoral
-- care messages fire while this is in the future (see pastoralCare.ts).
ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS elijah_rest_until timestamptz;

-- Backfill: last_active_at is a brand-new column, so every existing user
-- currently reads as NULL. detectInactiveUsers() filters on
-- "last_active_at < 14 days ago" — NULL fails that comparison in Postgres,
-- so without this backfill nobody would ever be detected until they log in
-- once post-migration (harmless, but slow to notice if something's wrong).
-- More importantly, backfilling to now() (not to some old date) avoids a
-- "everyone is instantly 14+ days dormant the moment this ships" false alarm
-- for the entire existing user base — same reasoning as migration 046's
-- onboarding_journey_completed_at backfill.
UPDATE p2p_profiles SET last_active_at = now() WHERE last_active_at IS NULL;

ALTER TABLE p2p_pastoral_care_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own pastoral care log" ON p2p_pastoral_care_log;
CREATE POLICY "Users can view their own pastoral care log" ON p2p_pastoral_care_log
  FOR SELECT USING (auth.uid() = user_id);

-- No client-facing INSERT policy — every row is created server-side via the
-- service-role client in pastoralCare.ts (the cron job) or the
-- /pastoral-care/respond endpoint, same reasoning as p2p_notifications.
DROP POLICY IF EXISTS "Admins can manage the pastoral care log" ON p2p_pastoral_care_log;
CREATE POLICY "Admins can manage the pastoral care log" ON p2p_pastoral_care_log
  FOR ALL USING (p2p_is_admin()) WITH CHECK (p2p_is_admin());