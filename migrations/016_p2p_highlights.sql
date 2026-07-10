-- Extend p2p_user_highlights so lesson reader can attach highlights to a
-- specific lesson section and text range, not just a free-text reference.
ALTER TABLE p2p_user_highlights
  ADD COLUMN IF NOT EXISTS lesson_id uuid REFERENCES p2p_lessons(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES p2p_lesson_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS start_offset integer,
  ADD COLUMN IF NOT EXISTS end_offset integer,
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'yellow';

CREATE INDEX IF NOT EXISTS idx_p2p_user_highlights_user ON p2p_user_highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_user_highlights_section ON p2p_user_highlights(section_id);
