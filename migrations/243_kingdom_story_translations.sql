-- 243 — Kingdom Stories in the shared translation store. Written 2026-11-07. REQUIRES 029, 152.
-- NOT APPLIED. Additive; nothing is deleted; no existing translation changes.
--
-- p2p_content_translations is the one place translated content lives (draft → approved review,
-- the Translations admin screen). Kingdom Stories are now translated too — the first is
-- Creation (topic 1) in German, with its studio narration — so the readers' content language
-- can show every part of a story in that language. This widens the allowed content types by
-- exactly two, keeping every existing one:
--   kingdom_story          a story's title, subtitle and introduction;
--   kingdom_story_chapter  a chapter's title, story text, Story Lessons, Personal Reflections and
--                          Comprehensive Check, part by part in metadata.parts (the same parts the
--                          Listen player reads, so text and narration line up).
-- Nothing else about the table (columns, status check, uniqueness, grants, RLS) changes.

do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
  where conrelid = 'public.p2p_content_translations'::regclass and conname = 'p2p_content_translations_content_type_check';
  if def is not null and def like '%kingdom_story_chapter%' then
    raise notice 'P2P_TRANSLATIONS_243: Kingdom Stories content types already allowed — nothing to do';
    return;
  end if;
  alter table public.p2p_content_translations drop constraint if exists p2p_content_translations_content_type_check;
  alter table public.p2p_content_translations add constraint p2p_content_translations_content_type_check
    check (content_type = any (array[
      'curriculum', 'module', 'lesson', 'section', 'scripture', 'question',
      'assignment', 'quiz', 'devotional', 'journal',
      'plan', 'plan_module', 'plan_lesson',
      'kingdom_story', 'kingdom_story_chapter'
    ]));
  raise notice 'P2P_TRANSLATIONS_243: Kingdom Stories content types allowed (% existing translations kept)',
    (select count(*) from public.p2p_content_translations);
end $$;
