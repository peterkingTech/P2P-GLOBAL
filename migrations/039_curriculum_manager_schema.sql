-- 039: Curriculum Manager schema — rich, block-based lesson content.
--
-- Architecture note (same correction made twice already this session, for
-- the Fruit System and Peer Confirmation System): the mobile admin screen
-- (artifacts/mobile/app/admin/curriculum.tsx) reads/writes p2p_curriculums,
-- p2p_modules, p2p_lessons and their content tables via direct Supabase
-- calls — confirmed by reading the file. artifacts/api-server/src/routes/
-- admin.ts has a parallel set of module/lesson CRUD routes, but the mobile
-- app never calls them (confirmed: no fetch()/apiUrl usage in
-- curriculum.tsx besides the Bible API, which IS real and used). Building
-- 15 new Express endpoints for blocks would be unreachable dead code, same
-- as admin.ts's existing routes already are. This migration and the block
-- editor rebuilt in this commit both follow the pattern that's actually
-- live: direct Supabase + RLS, matching this exact file's own established
-- convention, not a parallel unused API surface.
--
-- Table names use the real p2p_ prefix (the spec said "lessons"/"modules"
-- generically; this app's actual tables are p2p_lessons/p2p_modules).

-- ── p2p_lessons: rich metadata ────────────────────────────────────────────────
ALTER TABLE p2p_lessons
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Existing status check (migration 001) only allowed draft/published/archived
-- — widen to include 'review' per the block editor's 3-way status toggle.
ALTER TABLE p2p_lessons DROP CONSTRAINT IF EXISTS p2p_lessons_status_check;
ALTER TABLE p2p_lessons ADD CONSTRAINT p2p_lessons_status_check
  CHECK (status IN ('draft', 'review', 'published', 'archived'));

-- ── p2p_modules: rich metadata ────────────────────────────────────────────────
ALTER TABLE p2p_modules
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS color_theme text NOT NULL DEFAULT '#1D9E75',
  ADD COLUMN IF NOT EXISTS estimated_weeks integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now();

-- ── p2p_lesson_blocks — ordered, typed content blocks (the Notion-style unit) ──
-- An empty, ad-hoc p2p_lesson_blocks table already existed on the live DB
-- (id, lesson_id, type, content, order_index, created_at — no block_type
-- CHECK, no is_required/is_submittable/updated_at/created_by). Confirmed
-- zero rows before dropping — same collision pattern as p2p_user_fruits
-- earlier this session.
DROP TABLE IF EXISTS p2p_lesson_blocks CASCADE;

CREATE TABLE p2p_lesson_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES p2p_lessons(id) ON DELETE CASCADE,
  block_type text NOT NULL CHECK (block_type IN (
    'heading', 'paragraph', 'scripture', 'memory_verse', 'reflection_question',
    'assignment', 'checkpoint', 'image', 'video_link', 'audio_link',
    'divider', 'callout', 'quote', 'key_point', 'glossary_term'
  )),
  content jsonb NOT NULL DEFAULT '{}',
  order_index integer NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  is_submittable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_blocks_lesson_id ON p2p_lesson_blocks(lesson_id, order_index);

CREATE OR REPLACE FUNCTION p2p_touch_lesson_block()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_lesson_block ON p2p_lesson_blocks;
CREATE TRIGGER trg_touch_lesson_block
  BEFORE UPDATE ON p2p_lesson_blocks
  FOR EACH ROW EXECUTE FUNCTION p2p_touch_lesson_block();

-- ── RLS: admin-only read/write on p2p_lesson_blocks ──────────────────────────
ALTER TABLE p2p_lesson_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage lesson blocks" ON p2p_lesson_blocks;
CREATE POLICY "Admins manage lesson blocks" ON p2p_lesson_blocks
  FOR ALL USING (p2p_is_admin()) WITH CHECK (p2p_is_admin());

-- ── Status change audit log (modules + lessons) ──────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_content_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('module', 'lesson')),
  entity_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_status_log_entity ON p2p_content_status_log(entity_type, entity_id, changed_at DESC);

ALTER TABLE p2p_content_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read status log" ON p2p_content_status_log;
CREATE POLICY "Admins read status log" ON p2p_content_status_log
  FOR SELECT USING (p2p_is_admin());
DROP POLICY IF EXISTS "Admins write status log" ON p2p_content_status_log;
CREATE POLICY "Admins write status log" ON p2p_content_status_log
  FOR INSERT WITH CHECK (p2p_is_admin());

CREATE OR REPLACE FUNCTION p2p_log_lesson_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO p2p_content_status_log (entity_type, entity_id, old_status, new_status, changed_by)
    VALUES ('lesson', NEW.id, OLD.status, NEW.status, auth.uid());
    NEW.last_edited_at := now();
    NEW.last_edited_by := auth.uid();
    NEW.version := COALESCE(OLD.version, 1) + 1;
    IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
      NEW.published_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lesson_status_change ON p2p_lessons;
CREATE TRIGGER trg_log_lesson_status_change
  BEFORE UPDATE OF status ON p2p_lessons
  FOR EACH ROW EXECUTE FUNCTION p2p_log_lesson_status_change();

CREATE OR REPLACE FUNCTION p2p_log_module_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO p2p_content_status_log (entity_type, entity_id, old_status, new_status, changed_by)
    VALUES ('module', NEW.id, OLD.status, NEW.status, auth.uid());
    NEW.last_edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_module_status_change ON p2p_modules;
CREATE TRIGGER trg_log_module_status_change
  BEFORE UPDATE OF status ON p2p_modules
  FOR EACH ROW EXECUTE FUNCTION p2p_log_module_status_change();

-- ── Publish safety net (Step 9) — enforced at the DB layer, not just the UI ──
-- A lesson cannot be published unless it has at least one paragraph,
-- one memory_verse (with real content), one reflection_question, and one
-- assignment block.
CREATE OR REPLACE FUNCTION p2p_check_lesson_publishable(p_lesson_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM p2p_lesson_blocks WHERE lesson_id = p_lesson_id AND block_type = 'paragraph')
    AND EXISTS (
      SELECT 1 FROM p2p_lesson_blocks
      WHERE lesson_id = p_lesson_id AND block_type = 'memory_verse'
        AND COALESCE(content->>'text', '') <> ''
    )
    AND EXISTS (SELECT 1 FROM p2p_lesson_blocks WHERE lesson_id = p_lesson_id AND block_type = 'reflection_question')
    AND EXISTS (SELECT 1 FROM p2p_lesson_blocks WHERE lesson_id = p_lesson_id AND block_type = 'assignment');
$$;

GRANT EXECUTE ON FUNCTION p2p_check_lesson_publishable(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION p2p_enforce_lesson_publish_requirements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    IF NOT p2p_check_lesson_publishable(NEW.id) THEN
      RAISE EXCEPTION 'Cannot publish lesson: needs at least one paragraph, memory verse, reflection question, and assignment block.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_lesson_publish ON p2p_lessons;
CREATE TRIGGER trg_enforce_lesson_publish
  BEFORE UPDATE OF status ON p2p_lessons
  FOR EACH ROW EXECUTE FUNCTION p2p_enforce_lesson_publish_requirements();

-- A module cannot be published unless every one of its lessons is published.
CREATE OR REPLACE FUNCTION p2p_enforce_module_publish_requirements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unpublished_count int;
  v_total_count int;
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    SELECT count(*), count(*) FILTER (WHERE status <> 'published')
      INTO v_total_count, v_unpublished_count
    FROM p2p_lessons WHERE module_id = NEW.id;

    IF v_total_count = 0 OR v_unpublished_count > 0 THEN
      RAISE EXCEPTION 'Cannot publish module: all % lesson(s) must be published first (% not yet published).', v_total_count, v_unpublished_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_module_publish ON p2p_modules;
CREATE TRIGGER trg_enforce_module_publish
  BEFORE UPDATE OF status ON p2p_modules
  FOR EACH ROW EXECUTE FUNCTION p2p_enforce_module_publish_requirements();

-- ── Storage bucket for curriculum media (images, audio) ──────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'curriculum-media', 'curriculum-media', true, 52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/wav','audio/x-m4a','audio/aac']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read curriculum media" ON storage.objects;
CREATE POLICY "Public read curriculum media" ON storage.objects
  FOR SELECT USING (bucket_id = 'curriculum-media');

DROP POLICY IF EXISTS "Admins manage curriculum media" ON storage.objects;
CREATE POLICY "Admins manage curriculum media" ON storage.objects
  FOR ALL USING (bucket_id = 'curriculum-media' AND p2p_is_admin())
  WITH CHECK (bucket_id = 'curriculum-media' AND p2p_is_admin());
