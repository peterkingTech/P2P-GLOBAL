-- 213: Answer drafts that follow the person across devices, and Kingdom
-- Stories wording for chapter progress notifications.
--
-- 1. p2p_answer_drafts — unsent writing in an answer box (lesson and Kingdom
--    Stories reflections and Comprehensive Checks, Family/Church lesson work),
--    one row per person per answer box ("scope" = the app's draft key without
--    the user id). PRIVATE: only the writer can read or change their drafts —
--    no leader, reviewer, editor or admin policy. A draft is deleted when the
--    answer is submitted. Drafts are not submissions: nothing here is
--    reviewed, counted or shared.
-- 2. p2p_lesson_progress_recompute — production's current definition,
--    unchanged except that a Kingdom Stories chapter (migration 212) gets
--    chapter wording ("Chapter 2 of “Joshua…” is complete") instead of
--    "Lesson completed!/Lesson submitted". Notification types, progress
--    rules, wisdom points and fruit awards are exactly as before; every
--    ordinary lesson keeps its existing words.
--
-- Additive (one new table, one function replaced with the same behaviour).

create table if not exists public.p2p_answer_drafts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  scope      text not null check (char_length(scope) between 1 and 300),
  body       text not null check (char_length(body) <= 60000),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.p2p_answer_drafts enable row level security;
revoke all on public.p2p_answer_drafts from anon;
grant select, insert, update, delete on public.p2p_answer_drafts to authenticated;
grant all on public.p2p_answer_drafts to service_role;
drop policy if exists "Answer drafts: only the writer" on public.p2p_answer_drafts;
create policy "Answer drafts: only the writer" on public.p2p_answer_drafts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.p2p_lesson_progress_recompute(p_user_id uuid, p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_assignment_id uuid;
  v_total_questions integer;
  v_submitted_questions integer;
  v_approved_questions integer;
  v_current_status text;
  -- Kingdom Stories (212): the chapter this lesson is, if any.
  v_chapter integer;
  v_story text;
begin
  select id into v_assignment_id from p2p_assignments where lesson_id = p_lesson_id limit 1;
  if v_assignment_id is null then
    return;
  end if;

  select count(*) into v_total_questions
  from p2p_assignment_questions where assignment_id = v_assignment_id;

  if v_total_questions = 0 then
    return;
  end if;

  select count(distinct assignment_question_id) into v_submitted_questions
  from p2p_submissions
  where user_id = p_user_id and lesson_id = p_lesson_id and assignment_question_id is not null;

  select count(*) into v_approved_questions
  from (
    select distinct on (s.assignment_question_id)
      s.assignment_question_id, e.status
    from p2p_submissions s
    left join p2p_lesson_evaluations e on e.submission_id = s.id
    where s.user_id = p_user_id and s.lesson_id = p_lesson_id and s.assignment_question_id is not null
    order by s.assignment_question_id, s.created_at desc
  ) latest
  where latest.status = 'approved';

  select status into v_current_status
  from p2p_lesson_progress where user_id = p_user_id and lesson_id = p_lesson_id;
  v_current_status := coalesce(v_current_status, 'not_started');

  if to_regclass('public.p2p_kingdom_story_chapters') is not null then
    select c.chapter_number, s.title into v_chapter, v_story
    from p2p_kingdom_story_chapters c join p2p_kingdom_stories s on s.id = c.story_id
    where c.lesson_id = p_lesson_id;
  end if;

  if v_approved_questions >= v_total_questions then
    if v_current_status is distinct from 'completed' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'completed', true, 100, now())
      on conflict (user_id, lesson_id)
      do update set status = 'completed', completed = true, progress_percent = 100, updated_at = now();

      update p2p_profiles set wisdom_points = wisdom_points + 10 where id = p_user_id;

      insert into p2p_notifications (user_id, title, message, notification_type)
      values (
        p_user_id,
        case when v_chapter is not null then 'Chapter completed!' else 'Lesson completed!' end,
        case when v_chapter is not null
          then 'Chapter ' || v_chapter || ' of “' || v_story || '” is complete — your Comprehensive Check was accepted. Great work!'
          else 'Every answer for this lesson has been peer-approved. Great work!' end,
        'lesson_completed'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_completed', p_lesson_id);
    end if;
  elsif v_submitted_questions >= v_total_questions then
    if v_current_status = 'not_started' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'submitted', false, 50, now())
      on conflict (user_id, lesson_id)
      do update set status = 'submitted', updated_at = now();

      insert into p2p_notifications (user_id, title, message, notification_type)
      values (
        p_user_id,
        case when v_chapter is not null then 'Chapter submitted' else 'Lesson submitted' end,
        case when v_chapter is not null
          then 'Your Comprehensive Check for Chapter ' || v_chapter || ' of “' || v_story || '” is with a fellow peer for review — you can keep reading.'
          else 'Lesson submitted — your peer guide will review your answers.' end,
        'lesson_submitted'
      );

      perform p2p_check_fruit_eligibility(p_user_id, 'lesson_submitted', p_lesson_id);
    end if;
  end if;
end;
$$;

-- Rollback:
--   restore production's previous p2p_lesson_progress_recompute (identical
--   to the function above without the v_chapter / v_story lines and CASEs);
--   drop table if exists public.p2p_answer_drafts;   -- drafts only, no submissions
