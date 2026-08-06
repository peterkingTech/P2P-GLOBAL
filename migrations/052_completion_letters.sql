-- 052: The Completion Moment — peer guide letter system + curriculum
-- completion tracking on the profile.
--
-- Note: Step 5 asks to "Award The Harvest Fruit" alongside the Maturity
-- Fruit, but no such fruit exists anywhere in the 52-fruit catalog seeded in
-- migration 032 (confirmed by reading the full seed list) — same
-- aspirational-reference pattern already found and flagged several times
-- this session (the Integration and Onboarding Journey, Live Prayer Rooms,
-- Mega Harvest). Since the catalog is explicitly designed to be
-- data-driven/extensible (migration 032's own header), this migration adds
-- a new 'harvest_fruit' entry rather than silently dropping the requirement
-- or fabricating an award call against a nonexistent key — themed around
-- Matthew 9:37-38, distinct from Maturity Fruit (which marks the curriculum
-- itself being finished) by marking readiness to go and gather others.

CREATE TABLE IF NOT EXISTS p2p_completion_letters (
  id             uuid primary key default gen_random_uuid(),
  learner_id     uuid references auth.users(id) not null unique,
  peer_guide_id  uuid references auth.users(id) not null,
  letter_text    text,
  written_at     timestamptz,
  is_draft       boolean default true,
  created_at     timestamptz default now()
);

ALTER TABLE p2p_profiles ADD COLUMN IF NOT EXISTS curriculum_completed_at timestamptz;

ALTER TABLE p2p_completion_letters ENABLE ROW LEVEL SECURITY;

-- Learner only ever sees a SENT letter — a draft-in-progress stays private
-- to the peer guide until they choose to send it. Absence of a visible row
-- (whether no row exists yet, or one exists but is still a draft) is exactly
-- the "your peer guide is preparing something" state the completion screen
-- shows either way.
DROP POLICY IF EXISTS "Learner can read their sent letter" ON p2p_completion_letters;
CREATE POLICY "Learner can read their sent letter" ON p2p_completion_letters
  FOR SELECT USING (auth.uid() = learner_id AND is_draft = false);

DROP POLICY IF EXISTS "Peer guide can read their own letters" ON p2p_completion_letters;
CREATE POLICY "Peer guide can read their own letters" ON p2p_completion_letters
  FOR SELECT USING (auth.uid() = peer_guide_id);

DROP POLICY IF EXISTS "Peer guide can create letters" ON p2p_completion_letters;
CREATE POLICY "Peer guide can create letters" ON p2p_completion_letters
  FOR INSERT WITH CHECK (auth.uid() = peer_guide_id);

-- Once sent (is_draft = false), this policy's USING clause can no longer
-- match, so no further UPDATE — including trying to flip is_draft back to
-- true — is possible. This is the actual enforcement of "once sent, cannot
-- be edited," not just a client-side warning.
DROP POLICY IF EXISTS "Peer guide can update their own draft" ON p2p_completion_letters;
CREATE POLICY "Peer guide can update their own draft" ON p2p_completion_letters
  FOR UPDATE USING (auth.uid() = peer_guide_id AND is_draft = true) WITH CHECK (auth.uid() = peer_guide_id);

-- ── New fruit: The Harvest Fruit (see note above) ────────────────────────────
INSERT INTO p2p_fruits_catalog (
  fruit_key, name, description, category, verification_level, rarity, icon,
  theme_verse, theme_verse_text, biblical_meaning,
  unlock_condition_description, unlock_condition_rules,
  xp_value, is_hidden, display_order
) VALUES (
  'harvest_fruit', 'The Harvest Fruit',
  'Awarded at the completion of your Core Curriculum journey — the moment you become ready to gather others in.',
  'special', 'system', 'epic', '🌾',
  'Matthew 9:37-38', 'The harvest is plentiful but the workers are few. Ask the Lord of the harvest, therefore, to send out workers into his harvest field.',
  'Finishing the Core Curriculum was never meant to be the end of the story — it is the moment a disciple becomes a worker Jesus himself asked the Father to send. This fruit marks that turn, distinct from Maturity (which marks the curriculum itself being finished): Maturity is the fruit of your own growth, Harvest is the readiness to go gather others.',
  'Complete the entire 12-module Core Curriculum (awarded alongside the Maturity Fruit).',
  '{"type":"all_modules_complete","module_order_indexes":[1,2,3,4,5,6,7,8,9,10,11,12]}'::jsonb,
  50, false, 53
)
ON CONFLICT (fruit_key) DO NOTHING;