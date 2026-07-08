-- ============================================================
-- P2P Schema Additions — run once in Supabase SQL Editor
-- ============================================================

-- 1. Languages table & seed
CREATE TABLE IF NOT EXISTS public.p2p_languages (
  code text PRIMARY KEY,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false
);

INSERT INTO public.p2p_languages (code, name, is_default) VALUES
  ('en', 'English', true),
  ('de', 'German', false),
  ('es', 'Spanish', false),
  ('fr', 'French', false),
  ('pt', 'Portuguese', false),
  ('sw', 'Swahili', false),
  ('ar', 'Arabic', false),
  ('hi', 'Hindi', false)
ON CONFLICT (code) DO NOTHING;

-- 2. Language columns on p2p_profiles
ALTER TABLE public.p2p_profiles
  ADD COLUMN IF NOT EXISTS app_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS content_language text NOT NULL DEFAULT 'en';

-- 3. status + subtitle on p2p_lessons
ALTER TABLE public.p2p_lessons
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived'));

-- 4. status on p2p_modules
ALTER TABLE public.p2p_modules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived'));

-- 5. status on p2p_curriculums
ALTER TABLE public.p2p_curriculums
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived'));

-- 6. Teaching content sections
CREATE TABLE IF NOT EXISTS public.p2p_lesson_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  title text,
  content text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Memory verses
CREATE TABLE IF NOT EXISTS public.p2p_scriptures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  verse_ref text NOT NULL,
  verse_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Discussion / reflection questions
CREATE TABLE IF NOT EXISTS public.p2p_reflection_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  question text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. Assignments
CREATE TABLE IF NOT EXISTS public.p2p_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Translation tables
CREATE TABLE IF NOT EXISTS public.p2p_curriculum_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES public.p2p_curriculums(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text,
  UNIQUE (curriculum_id, language_code)
);

CREATE TABLE IF NOT EXISTS public.p2p_module_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.p2p_modules(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text,
  UNIQUE (module_id, language_code)
);

CREATE TABLE IF NOT EXISTS public.p2p_lesson_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.p2p_lessons(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  title text NOT NULL DEFAULT '',
  subtitle text,
  UNIQUE (lesson_id, language_code)
);

CREATE TABLE IF NOT EXISTS public.p2p_lesson_section_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.p2p_lesson_sections(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  title text,
  content text NOT NULL DEFAULT '',
  UNIQUE (section_id, language_code)
);

CREATE TABLE IF NOT EXISTS public.p2p_scripture_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scripture_id uuid NOT NULL REFERENCES public.p2p_scriptures(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  verse text NOT NULL DEFAULT '',
  UNIQUE (scripture_id, language_code)
);

CREATE TABLE IF NOT EXISTS public.p2p_reflection_question_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.p2p_reflection_questions(id) ON DELETE CASCADE,
  language_code text NOT NULL,
  question text NOT NULL DEFAULT '',
  UNIQUE (question_id, language_code)
);

-- 11. Registration profiles
CREATE TABLE IF NOT EXISTS public.p2p_registration_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.p2p_profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  location_city text NOT NULL,
  location_country text NOT NULL,
  contact text,
  primary_language text NOT NULL DEFAULT 'en',
  other_languages text[] NOT NULL DEFAULT '{}',
  faith_journey_stage integer NOT NULL CHECK (faith_journey_stage BETWEEN 1 AND 5),
  born_again text NOT NULL CHECK (born_again IN ('yes', 'no', 'other')),
  born_again_other text,
  walking_with_christ_duration text NOT NULL
    CHECK (walking_with_christ_duration IN ('less_than_1_year','1_3_years','3_10_years','10_plus_years')),
  church_involvement text,
  follow_up_status text NOT NULL DEFAULT 'not_contacted'
    CHECK (follow_up_status IN ('not_contacted','contacted','in_progress','resolved')),
  admin_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful index for admin registration filtering
CREATE INDEX IF NOT EXISTS idx_reg_follow_up ON public.p2p_registration_profiles(follow_up_status);
CREATE INDEX IF NOT EXISTS idx_reg_user ON public.p2p_registration_profiles(user_id);
