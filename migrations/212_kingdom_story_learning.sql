-- 212: Kingdom Stories storybook learning — chapters use the Core Curriculum
-- learning engine (reflections, Comprehensive Checks, peer review, progress).
--
-- Design (reuse, not a second system):
--   • One SYSTEM curriculum (type 'kingdom_story', always status 'draft') owns
--     one module per story and one lesson per chapter. Every learner-facing
--     curriculum list — including already-installed app builds — shows only
--     status = 'published' curricula, so these never appear in Kingdom
--     School, Plans, pickers or search. A guard keeps it 'draft' forever and
--     stops it (or its modules/lessons) being deleted, which would cascade
--     away learners' submissions.
--   • A chapter's reflection questions become p2p_reflection_questions and its
--     Comprehensive Check (the 211 assignment field) becomes a p2p_assignments
--     row with one question. Submissions, peer evaluation (a fellow peer who
--     completed the SAME chapter; first-through self-approval so nobody is
--     ever blocked), p2p_lesson_progress, notifications and growth credit are
--     the existing Core Curriculum triggers, unchanged.
--   • p2p_kingdom_story_sync_learning(story) creates/updates those rows from
--     the chapter content (stable ids: questions are updated in place by
--     position, never re-created; removed chapters' lessons are archived, not
--     deleted). Called by the API when a story is published or an editor asks.
--   • Sequential chapters: chapter N opens once chapter N-1 is submitted or
--     completed (the Kingdom School/Plans rule — waiting for a peer review
--     never blocks). Enforced in the database on p2p_submissions and
--     p2p_lesson_progress, and only for published stories.
--   • Chapter text is read by readers only through the API (which withholds
--     locked chapters); direct table reads become editors-only. No client
--     reads chapters directly, and no story is published yet.
--   • Media gain optional accessibility/attribution fields (alt text, source,
--     licence note, kind of image) — fingerprinted only when present.
--
-- Additive; existing curricula, lessons, submissions, progress and stories
-- are not changed. Re-runnable.

-- ── Links ────────────────────────────────────────────────────────────────
alter table public.p2p_kingdom_stories add column if not exists module_id uuid;
alter table public.p2p_kingdom_story_chapters add column if not exists lesson_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_stories_module_fk') then
    alter table public.p2p_kingdom_stories add constraint p2p_kingdom_stories_module_fk
      foreign key (module_id) references public.p2p_modules(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_story_chapters_lesson_fk') then
    alter table public.p2p_kingdom_story_chapters add constraint p2p_kingdom_story_chapters_lesson_fk
      foreign key (lesson_id) references public.p2p_lessons(id) on delete set null;
  end if;
end $$;
create unique index if not exists idx_p2p_kingdom_stories_module on public.p2p_kingdom_stories (module_id) where module_id is not null;
create unique index if not exists idx_p2p_kingdom_story_chapters_lesson on public.p2p_kingdom_story_chapters (lesson_id) where lesson_id is not null;

-- ── Media: accessibility + attribution ────────────────────────────────────
alter table public.p2p_kingdom_story_media add column if not exists alt_text text;
alter table public.p2p_kingdom_story_media add column if not exists source_url text;
alter table public.p2p_kingdom_story_media add column if not exists license_note text;
alter table public.p2p_kingdom_story_media add column if not exists image_kind text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_story_media_attribution_check') then
    alter table public.p2p_kingdom_story_media add constraint p2p_kingdom_story_media_attribution_check check (
      (alt_text is null or char_length(alt_text) <= 1000)
      and (source_url is null or char_length(source_url) <= 2000)
      and (license_note is null or char_length(license_note) <= 1000)
      and (image_kind is null or image_kind in ('artistic_illustration', 'historical_photograph', 'artefact', 'manuscript', 'location_photograph', 'ai_generated', 'other')));
  end if;
end $$;

-- ── The system curriculum ─────────────────────────────────────────────────
create unique index if not exists idx_p2p_curriculums_one_kingdom_story on public.p2p_curriculums (type) where type = 'kingdom_story';
insert into public.p2p_curriculums (title, description, status, type, is_visible, admin_notes)
select 'Kingdom Stories (system)',
       'Learning activities of Kingdom Stories chapters. Managed automatically from Kingdom Stories — do not edit here.',
       'draft', 'kingdom_story', false,
       'System curriculum (migration 212). Never publish or delete: it holds learners'' Kingdom Stories submissions and progress.'
where not exists (select 1 from public.p2p_curriculums where type = 'kingdom_story');

create or replace function public.p2p_kingdom_story_curriculum_id()
returns uuid language sql stable set search_path = public, pg_temp
as $$ select id from p2p_curriculums where type = 'kingdom_story' limit 1 $$;
revoke all on function public.p2p_kingdom_story_curriculum_id() from public, anon;
grant execute on function public.p2p_kingdom_story_curriculum_id() to authenticated, service_role;

-- Never published, never retyped, never deleted.
create or replace function public.p2p_kingdom_story_curriculum_guard()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.type = 'kingdom_story' then
      raise exception 'kingdom_story_system_curriculum' using errcode = 'P0001',
        hint = 'The Kingdom Stories system curriculum holds learners'' progress and cannot be deleted.';
    end if;
    return old;
  end if;
  if (tg_op = 'UPDATE' and old.type = 'kingdom_story' and new.type is distinct from 'kingdom_story')
     or (new.type = 'kingdom_story' and new.status <> 'draft') then
    raise exception 'kingdom_story_system_curriculum' using errcode = 'P0001',
      hint = 'The Kingdom Stories system curriculum stays a hidden draft; publish stories from Kingdom Stories instead.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_p2p_kingdom_story_curriculum_guard on public.p2p_curriculums;
create trigger trg_p2p_kingdom_story_curriculum_guard
  before insert or update or delete on public.p2p_curriculums
  for each row execute function public.p2p_kingdom_story_curriculum_guard();

-- Its modules and lessons are archived, never deleted (deleting would cascade
-- away submissions, evaluations and progress).
create or replace function public.p2p_kingdom_story_learning_delete_guard()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare v_cur uuid := p2p_kingdom_story_curriculum_id();
begin
  if v_cur is not null and (
       (tg_table_name = 'p2p_modules' and old.curriculum_id = v_cur)
    or (tg_table_name = 'p2p_lessons' and exists (select 1 from p2p_modules m where m.id = old.module_id and m.curriculum_id = v_cur))) then
    raise exception 'kingdom_story_learning_kept' using errcode = 'P0001',
      hint = 'Kingdom Stories learning rows hold learners'' work; they are archived, not deleted.';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_p2p_kingdom_story_module_delete_guard on public.p2p_modules;
create trigger trg_p2p_kingdom_story_module_delete_guard before delete on public.p2p_modules
  for each row execute function public.p2p_kingdom_story_learning_delete_guard();
drop trigger if exists trg_p2p_kingdom_story_lesson_delete_guard on public.p2p_lessons;
create trigger trg_p2p_kingdom_story_lesson_delete_guard before delete on public.p2p_lessons
  for each row execute function public.p2p_kingdom_story_learning_delete_guard();

-- ── Sync: chapter content → learning rows ─────────────────────────────────
-- Core: works on a story row as given (so the publish trigger can use NEW);
-- never updates the story row itself — it returns the module id.
create or replace function public.p2p_kingdom_story_sync_learning_core(v_story public.p2p_kingdom_stories)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_cur uuid := p2p_kingdom_story_curriculum_id();
  v_module uuid;
  v_lesson uuid;
  v_assignment uuid;
  v_aq uuid;
  ch record;
  q record;
  i int;
  n_lessons int := 0; n_reflections int := 0; n_checks int := 0; n_archived int := 0;
begin
  if v_cur is null then raise exception 'kingdom_story_system_curriculum_missing'; end if;
  v_module := v_story.module_id;
  if v_module is null or not exists (select 1 from p2p_modules where id = v_module) then
    insert into p2p_modules (curriculum_id, title, description, order_index, status)
    values (v_cur, v_story.title, 'Kingdom Story', 0, 'published') returning id into v_module;
  else
    update p2p_modules set title = v_story.title where id = v_module and title is distinct from v_story.title;
  end if;

  for ch in select * from p2p_kingdom_story_chapters where story_id = v_story.id order by chapter_number loop
    v_lesson := ch.lesson_id;
    if v_lesson is null or not exists (select 1 from p2p_lessons where id = v_lesson and status <> 'archived') then
      insert into p2p_lessons (module_id, title, order_index, status)
      values (v_module, coalesce(nullif(btrim(ch.title), ''), 'Chapter ' || ch.chapter_number), ch.chapter_number, 'published')
      returning id into v_lesson;
      update p2p_kingdom_story_chapters set lesson_id = v_lesson where id = ch.id;
    else
      update p2p_lessons set title = coalesce(nullif(btrim(ch.title), ''), 'Chapter ' || ch.chapter_number), order_index = ch.chapter_number
       where id = v_lesson and (title, order_index) is distinct from (coalesce(nullif(btrim(ch.title), ''), 'Chapter ' || ch.chapter_number), ch.chapter_number);
    end if;
    n_lessons := n_lessons + 1;

    -- Reflection questions, updated in place by position (stable ids).
    for i in 1 .. coalesce(cardinality(ch.reflections), 0) loop
      select id into q from p2p_reflection_questions where lesson_id = v_lesson and display_order = i - 1 limit 1;
      if found then
        update p2p_reflection_questions set question = ch.reflections[i] where id = q.id and question is distinct from ch.reflections[i];
      else
        insert into p2p_reflection_questions (lesson_id, question, display_order) values (v_lesson, ch.reflections[i], i - 1);
      end if;
      n_reflections := n_reflections + 1;
    end loop;
    -- Questions beyond the chapter's list: removed (their submissions keep their text; the link is set null).
    delete from p2p_reflection_questions where lesson_id = v_lesson and display_order >= coalesce(cardinality(ch.reflections), 0);

    -- Comprehensive Check: one assignment with one question (the task).
    select id into v_assignment from p2p_assignments where lesson_id = v_lesson limit 1;
    if nullif(btrim(coalesce(ch.assignment, '')), '') is not null then
      if v_assignment is null then
        insert into p2p_assignments (lesson_id, title) values (v_lesson, coalesce(nullif(btrim(ch.assignment_title), ''), 'Comprehensive Check'))
        returning id into v_assignment;
      else
        update p2p_assignments set title = coalesce(nullif(btrim(ch.assignment_title), ''), 'Comprehensive Check')
         where id = v_assignment and title is distinct from coalesce(nullif(btrim(ch.assignment_title), ''), 'Comprehensive Check');
      end if;
      select id into v_aq from p2p_assignment_questions where assignment_id = v_assignment order by display_order limit 1;
      if v_aq is null then
        insert into p2p_assignment_questions (assignment_id, question, display_order) values (v_assignment, btrim(ch.assignment), 0);
      else
        update p2p_assignment_questions set question = btrim(ch.assignment) where id = v_aq and question is distinct from btrim(ch.assignment);
      end if;
      n_checks := n_checks + 1;
    elsif v_assignment is not null and not exists (select 1 from p2p_submissions where assignment_id = v_assignment) then
      delete from p2p_assignments where id = v_assignment;
    end if;
  end loop;

  -- Lessons of chapters that no longer exist: archived (learners' work kept).
  update p2p_lessons l set status = 'archived'
   where l.module_id = v_module and l.status <> 'archived'
     and not exists (select 1 from p2p_kingdom_story_chapters c where c.story_id = v_story.id and c.lesson_id = l.id);
  get diagnostics n_archived = row_count;

  return jsonb_build_object('module_id', v_module, 'lessons', n_lessons, 'reflection_questions', n_reflections,
                            'comprehensive_checks', n_checks, 'archived_lessons', n_archived);
end;
$$;
revoke all on function public.p2p_kingdom_story_sync_learning_core(public.p2p_kingdom_stories) from public, anon, authenticated, service_role;

-- On demand (an editor previewing a draft's activities): lock, sync, link the module.
create or replace function public.p2p_kingdom_story_sync_learning(p_story_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_story p2p_kingdom_stories; v_r jsonb;
begin
  select * into v_story from p2p_kingdom_stories where id = p_story_id for update;
  if not found then raise exception 'story_not_found' using errcode = 'P0002'; end if;
  if v_story.status = 'published' then
    raise exception 'studio_live_edit_blocked' using errcode = 'S0423',
      hint = 'A live story''s activities were prepared when it was published; unpublish it to change them.';
  end if;
  v_r := p2p_kingdom_story_sync_learning_core(v_story);
  update p2p_kingdom_stories set module_id = (v_r->>'module_id')::uuid
   where id = p_story_id and module_id is distinct from (v_r->>'module_id')::uuid;
  return v_r;
end;
$$;
revoke all on function public.p2p_kingdom_story_sync_learning(uuid) from public, anon, authenticated;
grant execute on function public.p2p_kingdom_story_sync_learning(uuid) to service_role;

-- Every publish path (story editor, Publishing Studio, any future one) is a
-- status change to 'published': the learning rows are brought in line with
-- the chapters in that same statement, before the chapters freeze. Runs
-- before trg_p2p_kingdom_story_publication_gate (trigger name order), touches
-- no fingerprinted field, and is rolled back with the publish if the gate refuses.
create or replace function public.p2p_kingdom_story_learning_on_publish()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_r jsonb;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    v_r := p2p_kingdom_story_sync_learning_core(new);
    new.module_id := (v_r->>'module_id')::uuid;
  end if;
  return new;
end;
$$;
revoke all on function public.p2p_kingdom_story_learning_on_publish() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_story_learning_on_publish on public.p2p_kingdom_stories;
create trigger trg_p2p_kingdom_story_learning_on_publish
  before update of status on public.p2p_kingdom_stories
  for each row execute function public.p2p_kingdom_story_learning_on_publish();

-- ── Sequential chapters ───────────────────────────────────────────────────
-- true = this lesson is not a Kingdom Stories chapter, or the chapter is open
-- to this user (published story; first chapter, or the previous chapter is
-- submitted/completed).
create or replace function public.p2p_kingdom_story_chapter_open(p_user_id uuid, p_lesson_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_ch p2p_kingdom_story_chapters;
  v_status text;
  v_prev_lesson uuid;
  v_is_story_lesson boolean;
begin
  select exists (select 1 from p2p_lessons l join p2p_modules m on m.id = l.module_id
                  where l.id = p_lesson_id and m.curriculum_id = p2p_kingdom_story_curriculum_id())
    into v_is_story_lesson;
  if not v_is_story_lesson then return true; end if;
  select * into v_ch from p2p_kingdom_story_chapters where lesson_id = p_lesson_id;
  if not found then return false; end if;                         -- archived chapter lesson
  select status into v_status from p2p_kingdom_stories where id = v_ch.story_id;
  if v_status is distinct from 'published' then return false; end if;
  select lesson_id into v_prev_lesson from p2p_kingdom_story_chapters
   where story_id = v_ch.story_id and chapter_number < v_ch.chapter_number
   order by chapter_number desc limit 1;
  if not found then return true; end if;                          -- first chapter
  return exists (select 1 from p2p_lesson_progress lp where lp.user_id = p_user_id and lp.lesson_id = v_prev_lesson
                   and (lp.completed = true or lp.status in ('submitted', 'completed')));
end;
$$;
revoke all on function public.p2p_kingdom_story_chapter_open(uuid, uuid) from public, anon;
grant execute on function public.p2p_kingdom_story_chapter_open(uuid, uuid) to authenticated, service_role;

create or replace function public.p2p_kingdom_story_submission_gate()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not p2p_kingdom_story_chapter_open(new.user_id, new.lesson_id) then
    raise exception 'Complete the previous chapter first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_p2p_kingdom_story_submission_gate on public.p2p_submissions;
create trigger trg_p2p_kingdom_story_submission_gate before insert on public.p2p_submissions
  for each row execute function public.p2p_kingdom_story_submission_gate();

create or replace function public.p2p_kingdom_story_progress_gate()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status in ('submitted', 'completed')
     and (tg_op = 'INSERT' or old.status is null or old.status = 'not_started')
     and not p2p_kingdom_story_chapter_open(new.user_id, new.lesson_id) then
    raise exception 'Complete the previous chapter first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_p2p_kingdom_story_progress_gate on public.p2p_lesson_progress;
create trigger trg_p2p_kingdom_story_progress_gate before insert or update on public.p2p_lesson_progress
  for each row execute function public.p2p_kingdom_story_progress_gate();

-- ── Chapter text: editors read directly; readers through the API ──────────
drop policy if exists "Kingdom story chapters visible with their story" on public.p2p_kingdom_story_chapters;
drop policy if exists "Kingdom story chapters: editors read" on public.p2p_kingdom_story_chapters;
create policy "Kingdom story chapters: editors read" on public.p2p_kingdom_story_chapters
  for select to authenticated using (public.p2p_is_kingdom_stories_editor());

-- ── Fingerprint: 211 + media attribution fields, only when present ────────
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
                                        || case when m.chapter_id is null then '[]'::jsonb else jsonb_build_array(m.chapter_id) end
                                        || case when m.alt_text is null and m.source_url is null and m.license_note is null and m.image_kind is null then '[]'::jsonb
                                                else jsonb_build_array(jsonb_build_object('alt', m.alt_text, 'src', m.source_url, 'lic', m.license_note, 'kind', m.image_kind)) end
                                        order by m.id)
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

-- Rollback (only before any story is published with learning rows):
--   restore 211's p2p_kingdom_story_fingerprint and 210's chapter select policy;
--   drop trigger if exists trg_p2p_kingdom_story_learning_on_publish on public.p2p_kingdom_stories;
--   drop trigger if exists trg_p2p_kingdom_story_progress_gate on public.p2p_lesson_progress;
--   drop trigger if exists trg_p2p_kingdom_story_submission_gate on public.p2p_submissions;
--   drop trigger if exists trg_p2p_kingdom_story_lesson_delete_guard on public.p2p_lessons;
--   drop trigger if exists trg_p2p_kingdom_story_module_delete_guard on public.p2p_modules;
--   drop trigger if exists trg_p2p_kingdom_story_curriculum_guard on public.p2p_curriculums;
--   drop function if exists public.p2p_kingdom_story_progress_gate(), public.p2p_kingdom_story_submission_gate(), public.p2p_kingdom_story_chapter_open(uuid, uuid), public.p2p_kingdom_story_sync_learning(uuid), public.p2p_kingdom_story_learning_on_publish(), public.p2p_kingdom_story_sync_learning_core(public.p2p_kingdom_stories), public.p2p_kingdom_story_learning_delete_guard(), public.p2p_kingdom_story_curriculum_guard();
--   (the system curriculum, its modules/lessons and the new nullable columns can stay; they are inert without the functions)
