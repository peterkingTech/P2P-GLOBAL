-- Plan categories: 10 parent-level p2p_curriculums rows (type = 'plan_category')
-- that group the individual topic plans (type = 'plan') inside them. A topic
-- plan links to its category via parent_category_id; topic_number preserves
-- its position within that category ("Topic 1", "Topic 2", ...).
--
-- No dedicated `category` column exists (or is added here) — category slugs
-- continue to live in the existing freeform `tags` column, the same
-- no-dedicated-taxonomy-column convention already used everywhere else in
-- this schema (see curriculum.ts's getMountainForPlan/recommendation engine
-- comments). Both the new plan_category rows and the topic plans they group
-- use tags = [category_slug] for this.

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS parent_category_id uuid REFERENCES p2p_curriculums(id);

ALTER TABLE p2p_curriculums
  ADD COLUMN IF NOT EXISTS topic_number integer;
