-- Adds RLS policies for curriculum content tables.
-- Idempotent: drops policies before re-creating so this can be re-run safely.

CREATE OR REPLACE FUNCTION p2p_is_admin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM p2p_profiles
    WHERE id = auth.uid() AND role != 'student'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY[
    'p2p_curriculums',
    'p2p_modules',
    'p2p_lessons',
    'p2p_lesson_sections',
    'p2p_scriptures',
    'p2p_reflection_questions',
    'p2p_assignments',
    'p2p_languages',
    'p2p_lesson_translations',
    'p2p_lesson_section_translations',
    'p2p_scripture_translations',
    'p2p_reflection_question_translations',
    'p2p_curriculum_translations',
    'p2p_module_translations'
  ];
BEGIN
  FOREACH t IN ARRAY content_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can read %1$s" ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can insert %1$s" ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can update %1$s" ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete %1$s" ON %1$s', t);

    EXECUTE format(
      'CREATE POLICY "Authenticated users can read %1$s" ON %1$s FOR SELECT TO authenticated USING (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Admins can insert %1$s" ON %1$s FOR INSERT TO authenticated WITH CHECK (p2p_is_admin())',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Admins can update %1$s" ON %1$s FOR UPDATE TO authenticated USING (p2p_is_admin()) WITH CHECK (p2p_is_admin())',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Admins can delete %1$s" ON %1$s FOR DELETE TO authenticated USING (p2p_is_admin())',
      t
    );
  END LOOP;
END $$;
