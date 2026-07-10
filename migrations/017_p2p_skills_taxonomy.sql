-- Skills taxonomy for the Kingdom Service Network: a curated, searchable list
-- of practical/vocational/ministry skills, plus the profile-level selection.
CREATE TABLE IF NOT EXISTS p2p_skills (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  created_at timestamp without time zone DEFAULT now()
);

ALTER TABLE p2p_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read p2p_skills" ON p2p_skills;
CREATE POLICY "Authenticated users can read p2p_skills" ON p2p_skills
  FOR SELECT TO authenticated USING (true);

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_p2p_profiles_skills ON p2p_profiles USING gin(skills);

INSERT INTO p2p_skills (key, label, category) VALUES
  ('teaching_bible', 'Bible Teaching', 'Ministry'),
  ('preaching', 'Preaching', 'Ministry'),
  ('worship_leading', 'Worship Leading', 'Ministry'),
  ('childrens_ministry', 'Children''s Ministry', 'Ministry'),
  ('youth_ministry', 'Youth Ministry', 'Ministry'),
  ('counseling', 'Biblical Counseling', 'Ministry'),
  ('discipleship_coaching', 'Discipleship Coaching', 'Ministry'),
  ('evangelism_outreach', 'Evangelism & Outreach', 'Ministry'),
  ('prayer_ministry', 'Prayer Ministry', 'Ministry'),
  ('church_planting', 'Church Planting', 'Ministry'),
  ('translation', 'Bible Translation', 'Language'),
  ('interpretation', 'Live Interpretation', 'Language'),
  ('language_teaching', 'Language Teaching', 'Language'),
  ('writing_editing', 'Writing & Editing', 'Language'),
  ('medical_care', 'Medical Care', 'Medical'),
  ('nursing', 'Nursing', 'Medical'),
  ('mental_health', 'Mental Health Support', 'Medical'),
  ('first_aid', 'First Aid & Emergency Response', 'Medical'),
  ('nutrition', 'Nutrition & Public Health', 'Medical'),
  ('carpentry', 'Carpentry', 'Trades'),
  ('plumbing', 'Plumbing', 'Trades'),
  ('electrical', 'Electrical Work', 'Trades'),
  ('construction', 'Construction', 'Trades'),
  ('mechanics', 'Auto/Mechanical Repair', 'Trades'),
  ('agriculture', 'Agriculture & Farming', 'Trades'),
  ('sewing_textiles', 'Sewing & Textiles', 'Trades'),
  ('cooking_catering', 'Cooking & Catering', 'Trades'),
  ('web_development', 'Web Development', 'Technical'),
  ('graphic_design', 'Graphic Design', 'Technical'),
  ('video_production', 'Video Production', 'Technical'),
  ('photography', 'Photography', 'Technical'),
  ('audio_engineering', 'Audio Engineering', 'Technical'),
  ('social_media', 'Social Media & Marketing', 'Technical'),
  ('data_analysis', 'Data Analysis', 'Technical'),
  ('it_support', 'IT Support', 'Technical'),
  ('accounting', 'Accounting & Bookkeeping', 'Business'),
  ('legal', 'Legal Advice', 'Business'),
  ('fundraising', 'Fundraising & Grant Writing', 'Business'),
  ('project_management', 'Project Management', 'Business'),
  ('entrepreneurship', 'Entrepreneurship & Microenterprise', 'Business'),
  ('logistics', 'Logistics & Supply Chain', 'Business'),
  ('event_planning', 'Event Planning', 'Business'),
  ('teaching_general', 'General Education/Tutoring', 'Education'),
  ('curriculum_development', 'Curriculum Development', 'Education'),
  ('music_instruction', 'Music Instruction', 'Education'),
  ('sports_recreation', 'Sports & Recreation', 'Education'),
  ('crisis_response', 'Crisis & Disaster Response', 'Humanitarian'),
  ('refugee_support', 'Refugee & Migrant Support', 'Humanitarian'),
  ('water_sanitation', 'Water & Sanitation', 'Humanitarian'),
  ('housing_construction', 'Housing & Shelter Building', 'Humanitarian')
ON CONFLICT (key) DO NOTHING;
