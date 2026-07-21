-- 031: Two-layer lesson progress gate — 'submitted' (all assignment questions
-- answered) vs 'completed' (all of those answers peer-approved).
--
-- Bug this fixes: p2p_apply_evaluation_outcome (008/009) flips
-- p2p_lesson_progress.completed = true the moment ANY ONE assignment-question
-- evaluation for a lesson resolves to 'approved' — even when a lesson has
-- several assignment questions and only one has been reviewed so far. That
-- also means: the "next lesson unlocked" signal (loadCurriculum's
-- passedForUnlock) and the wisdom-points/growth-event award both fire too
-- early, and there was no signal at all for "learner submitted everything,
-- now waiting on review" distinct from "not started".
--
-- Fix: p2p_lesson_progress gets a real `status` column
-- ('not_started' | 'submitted' | 'completed'). A single SECURITY DEFINER
-- function recomputes it against the true source of truth — every
-- p2p_assignment_questions row for the lesson's assignment, matched against
-- this learner's submissions and their most recent evaluation — and is
-- called from both the submission-insert path (submitted gate) and the
-- evaluation-resolution path (completed gate), so a resubmission after
-- 'needs_revision' is judged by its own latest evaluation, not a stale one.

-- ── New column ────────────────────────────────────────────────────────────────
alter table p2p_lesson_progress
  add column if not exists status text not null default 'not_started'
  check (status in ('not_started', 'submitted', 'completed'));

update p2p_lesson_progress
  set status = case when completed then 'completed' else 'not_started' end
  where status = 'not_started';

-- ── Shared recompute function ────────────────────────────────────────────────
-- Only acts on lessons that actually have an assignment with questions —
-- reflection-only lessons and the simple "Mark Complete" lessons (no
-- assignment at all) are untouched and keep using markLessonComplete().
create or replace function p2p_lesson_progress_recompute(p_user_id uuid, p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_total_questions integer;
  v_submitted_questions integer;
  v_approved_questions integer;
  v_current_status text;
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

  -- Approved = this question's MOST RECENT submission (by created_at) has an
  -- evaluation resolved to 'approved' — so an old 'needs_revision' evaluation
  -- tied to a since-superseded submission never counts against the learner.
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

  if v_approved_questions >= v_total_questions then
    if v_current_status is distinct from 'completed' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'completed', true, 100, now())
      on conflict (user_id, lesson_id)
      do update set status = 'completed', completed = true, progress_percent = 100, updated_at = now();

      update p2p_profiles set wisdom_points = wisdom_points + 10 where id = p_user_id;

      insert into p2p_notifications (user_id, title, message)
      values (
        p_user_id,
        'Lesson completed!',
        'Every answer for this lesson has been peer-approved. Great work!'
      );
    end if;
  elsif v_submitted_questions >= v_total_questions then
    if v_current_status = 'not_started' then
      insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent, updated_at)
      values (p_user_id, p_lesson_id, 'submitted', false, 50, now())
      on conflict (user_id, lesson_id)
      do update set status = 'submitted', updated_at = now();

      insert into p2p_notifications (user_id, title, message)
      values (
        p_user_id,
        'Lesson submitted',
        'Lesson submitted — your peer guide will review your answers.'
      );
    end if;
  end if;
end;
$$;

-- ── Wire submission insert → 'submitted' gate ────────────────────────────────
create or replace function p2p_assign_evaluator_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluator uuid;
begin
  -- Reflection-only submissions don't gate lesson completion.
  if new.assignment_id is null then
    return new;
  end if;

  v_evaluator := p2p_pick_evaluator(new.lesson_id, array[new.user_id]);
  if v_evaluator is not null then
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at)
    values (new.id, new.lesson_id, new.user_id, v_evaluator, 'pending', now());
  else
    insert into p2p_lesson_evaluations (
      submission_id, lesson_id, submitter_id, evaluator_id, status,
      self_approved, feedback, assigned_at, resolved_at
    )
    values (
      new.id, new.lesson_id, new.user_id, new.user_id, 'approved',
      true, 'First through this lesson — unevaluated, auto-approved.', now(), now()
    );
  end if;

  perform p2p_lesson_progress_recompute(new.user_id, new.lesson_id);
  return new;
end;
$$;

-- ── Wire evaluation resolution → 'completed' gate ────────────────────────────
create or replace function p2p_apply_evaluation_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform p2p_lesson_progress_recompute(new.submitter_id, new.lesson_id);
  end if;
  return new;
end;
$$;
