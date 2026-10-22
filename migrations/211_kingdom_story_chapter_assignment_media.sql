-- 211: Kingdom Stories — chapter Assignment field and chapter images.
--
-- Additive only. Nothing existing is rewritten, dropped or re-hashed:
--   • Chapters (210) gain an optional Assignment: assignment_title (e.g.
--     "Practise honesty in an agreement") and assignment (the task itself),
--     alongside the existing 5 Kingdom Lessons and 5 Peer Reflection
--     Questions. Optional — it never blocks publishing.
--   • Media (152) gain an optional chapter_id so an image can sit inside the
--     chapter it illustrates (same story enforced by a composite foreign key,
--     exactly like a source's chapter in 210). Media without a chapter stay
--     story-level (cover / gallery) as before.
--   • Publishing Studio (188/210): both are part of the approved fingerprint,
--     but only when present, so every existing story — with or without
--     chapters — hashes exactly as before and no approval goes stale. A live
--     story's chapters and media are already frozen by 188/210's triggers.
--
-- New columns inherit the tables' existing grants and RLS policies.

alter table public.p2p_kingdom_story_chapters add column if not exists assignment_title text;
alter table public.p2p_kingdom_story_chapters add column if not exists assignment text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_story_chapters_assignment_len') then
    alter table public.p2p_kingdom_story_chapters
      add constraint p2p_kingdom_story_chapters_assignment_len
      check ((assignment_title is null or char_length(assignment_title) <= 200) and (assignment is null or char_length(assignment) <= 10000));
  end if;
end $$;

alter table public.p2p_kingdom_story_media add column if not exists chapter_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_story_media_chapter_fk') then
    alter table public.p2p_kingdom_story_media
      add constraint p2p_kingdom_story_media_chapter_fk foreign key (chapter_id, story_id)
      references public.p2p_kingdom_story_chapters (id, story_id) on delete cascade;
  end if;
end $$;
create index if not exists idx_p2p_kingdom_story_media_chapter on public.p2p_kingdom_story_media (chapter_id) where chapter_id is not null;

-- 210's fingerprint plus: a media item's chapter id, and a chapter's
-- assignment — each appended only when present (so unchanged for existing rows).
create or replace function public.p2p_kingdom_story_fingerprint(s public.p2p_kingdom_stories)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to((jsonb_build_object(
    'title', s.title, 'subtitle', s.subtitle, 'category_id', s.category_id, 'content_type', s.content_type,
    'body', s.body, 'historical_period', s.historical_period, 'start_year', s.start_year, 'end_year', s.end_year,
    'location', s.location, 'people', s.people, 'learning_section', s.learning_section, 'reflection', s.reflection,
    'scripture_reference_id', s.scripture_reference_id,
    'related_mission_field_id', s.related_mission_field_id, 'related_mission_story_id', s.related_mission_story_id,
    'related_curriculum_id', s.related_curriculum_id, 'related_kingdom_win_id', s.related_kingdom_win_id,
    'related_story_id', s.related_story_id,
    'media', coalesce((select jsonb_agg(jsonb_build_array(m.id, m.media_type, m.media_path, m.caption, m.display_order, m.is_cover, m.duration_seconds)
                                        || case when m.chapter_id is null then '[]'::jsonb else jsonb_build_array(m.chapter_id) end order by m.id)
                       from p2p_kingdom_story_media m where m.story_id = s.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_array(x.id, x.title, x.publisher, x.url, x.citation, x.source_type, x.display_order)
                                          || case when x.chapter_id is null then '[]'::jsonb else jsonb_build_array(x.chapter_id) end order by x.id)
                         from p2p_kingdom_story_sources x where x.story_id = s.id), '[]'::jsonb)
  ) || coalesce((select jsonb_build_object('chapters', jsonb_agg(jsonb_build_array(
         c.id, c.chapter_number, c.title, c.narrative, c.people, c.places, c.dates, c.scripture_refs,
         c.evidence_documented, c.evidence_testimony, c.evidence_tradition, c.evidence_disputed,
         to_jsonb(c.lessons), to_jsonb(c.reflections))
         || case when c.assignment_title is null and c.assignment is null then '[]'::jsonb
                 else jsonb_build_array(jsonb_build_object('assignment_title', c.assignment_title, 'assignment', c.assignment)) end
         order by c.chapter_number, c.id))
       from p2p_kingdom_story_chapters c where c.story_id = s.id having count(*) > 0), '{}'::jsonb))::text, 'UTF8')), 'hex');
$$;
revoke all on function public.p2p_kingdom_story_fingerprint(public.p2p_kingdom_stories) from public, anon, authenticated, service_role;

-- Rollback (only if no chapter has an assignment and no media has a chapter):
--   restore 210's p2p_kingdom_story_fingerprint;
--   drop index if exists idx_p2p_kingdom_story_media_chapter;
--   alter table public.p2p_kingdom_story_media drop constraint if exists p2p_kingdom_story_media_chapter_fk;
--   alter table public.p2p_kingdom_story_media drop column if exists chapter_id;
--   alter table public.p2p_kingdom_story_chapters drop constraint if exists p2p_kingdom_story_chapters_assignment_len;
--   alter table public.p2p_kingdom_story_chapters drop column if exists assignment, drop column if exists assignment_title;
