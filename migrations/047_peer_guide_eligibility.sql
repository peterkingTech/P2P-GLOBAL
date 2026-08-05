-- 047: Peer Guide specific matching — eligibility signals on p2p_profiles,
-- and a real pending/active/declined/expired lifecycle on
-- p2p_discipleship_links so a "Connect" request can be proposed, accepted,
-- declined, or time out, instead of every link being created already-active.

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS is_peer_guide_eligible boolean DEFAULT false;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS max_mentees integer DEFAULT 3;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS accepting_mentees boolean DEFAULT true;
-- Referenced by the matching endpoint's scoring (Section 2: "same continent",
-- "timezone within 4 hours") and background_sensitivity matching — none of
-- these columns previously existed on p2p_profiles.
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS background_sensitivity text;

-- p2p_discipleship_links currently has no status lifecycle at all (just a
-- boolean `active`, always created true — see discipleship.ts POST /). Adding
-- `status` alongside `active` rather than replacing it: every existing
-- SQL function and query in this codebase (fruit awarding, forest BFS,
-- p2p_get_growth_dashboard, etc.) filters on `active = true` to mean "this is
-- a real, current mentoring relationship" — that must keep meaning exactly
-- that. `status` governs the NEW pending/declined/expired states a Connect
-- request can be in before it ever becomes a real (active=true) link.
ALTER TABLE p2p_discipleship_links
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'p2p_discipleship_links_status_check'
  ) THEN
    ALTER TABLE p2p_discipleship_links
      ADD CONSTRAINT p2p_discipleship_links_status_check
      CHECK (status IN ('pending', 'active', 'declined', 'expired'));
  END IF;
END $$;
ALTER TABLE p2p_discipleship_links
  ADD COLUMN IF NOT EXISTS requested_at timestamptz;
ALTER TABLE p2p_discipleship_links
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE p2p_discipleship_links
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- Every row that exists today predates this lifecycle and is a real,
-- already-working mentor relationship — default 'active' above already
-- covers this, this UPDATE is just belt-and-suspenders for rows where
-- active=false (ended relationships) so they don't read as "pending".
UPDATE p2p_discipleship_links SET status = 'declined' WHERE active = false AND status = 'active';

-- ── Auto-expire stale pending requests (72 hours, no response) ──────────────
CREATE OR REPLACE FUNCTION p2p_expire_stale_peer_guide_requests()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE p2p_discipleship_links
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT cron.schedule(
  'p2p-expire-stale-peer-guide-requests',
  '0 * * * *',
  $$select p2p_expire_stale_peer_guide_requests();$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'p2p-expire-stale-peer-guide-requests'
);