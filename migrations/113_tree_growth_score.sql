-- My Tree redesign — a dedicated, granular growth score.
--
-- Deliberately NOT reusing p2p_profiles.growth_level: that column already
-- drives a different, unrelated 6-stage ladder (constants/stages.ts) used
-- by the home badge and the admin Grove Dashboard, and only increments in
-- big jumps (module completion, gaining a disciple). Overloading it with
-- this feature's much more granular, 8-stage tree progression would risk
-- regressing those existing screens. This is purely additive: a new score
-- column, two new preference columns, and trigger logic that only ever
-- increases the new column — nothing existing is read, written, or
-- reinterpreted differently.
--
-- Growth comes from real, already-existing discipleship activity, in small
-- increments per the feature spec ("every meaningful completed action
-- should contribute... do not create an artificial points=giant-tree
-- system"). The exact increment sizes below are a tunable starting point,
-- not a hard requirement — they can be adjusted later without a migration
-- (see p2p_tree_growth_increment_lesson_progress()'s inline constants).

alter table public.p2p_profiles
  add column if not exists tree_growth_score numeric not null default 0,
  add column if not exists tree_environment_preference text,
  add column if not exists tree_reduced_motion boolean not null default false;

comment on column public.p2p_profiles.tree_growth_score is 'My Tree''s own granular, monotonically-increasing growth score — independent of growth_level. Drives constants/treeStages.ts''s 8-stage ladder.';
comment on column public.p2p_profiles.tree_environment_preference is 'User-selected My Tree backdrop (garden/mountain/countryside/forest/riverside) — null means auto-detect from hemisphere/season. Cosmetic only, never affects tree_growth_score or fruit.';
comment on column public.p2p_profiles.tree_reduced_motion is 'Opt-in override to disable My Tree''s sway/parallax/weather animation loops, on top of the OS-level reduced-motion setting already honored client-side.';

-- ── Reflection / assignment answers → tiny growth ───────────────────────────
-- Fires once per genuinely NEW answer to a given (user, lesson, question) —
-- guarded against resubmission/edit farming by checking no earlier row
-- already exists for that same question.
create or replace function p2p_tree_growth_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_increment numeric;
  v_already_counted boolean;
begin
  if new.reflection_question_id is null and new.assignment_question_id is null then
    return new;
  end if;

  select exists (
    select 1 from p2p_submissions s
    where s.user_id = new.user_id and s.lesson_id = new.lesson_id
      and s.reflection_question_id is not distinct from new.reflection_question_id
      and s.assignment_question_id is not distinct from new.assignment_question_id
      and s.id <> new.id
  ) into v_already_counted;

  if v_already_counted then
    return new;
  end if;

  v_increment := case
    when new.assignment_question_id is not null then 2  -- tiny-medium
    else 1                                               -- tiny
  end;

  update p2p_profiles set tree_growth_score = tree_growth_score + v_increment where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists p2p_tree_growth_on_submission_trg on p2p_submissions;
create trigger p2p_tree_growth_on_submission_trg
  after insert on p2p_submissions
  for each row execute function p2p_tree_growth_on_submission();

-- ── Lesson / module / category completion → small to significant growth ────
-- Fires only on a genuinely NEW transition into 'completed' (never on an
-- update that doesn't change status, so re-evaluation/re-approval events
-- can't double-award). Module and category bonuses are awarded the moment
-- this lesson's completion is what makes them newly fully-complete — safe
-- to compute this way because lesson_progress.status never regresses in
-- this app (no "uncomplete" action exists), so a module/category can only
-- transition incomplete -> complete once, at the moment its last
-- outstanding lesson completes.
create or replace function p2p_tree_growth_on_lesson_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_curriculum_id uuid;
  v_category_complete boolean;
begin
  if new.status <> 'completed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'completed' then
    return new;
  end if;

  update p2p_profiles set tree_growth_score = tree_growth_score + 3 where id = new.user_id; -- tiny: lesson

  select m.id, m.curriculum_id into v_module_id, v_curriculum_id
  from p2p_lessons l join p2p_modules m on m.id = l.module_id
  where l.id = new.lesson_id;

  if v_module_id is not null and p2p_module_fully_completed(new.user_id, v_module_id) then
    update p2p_profiles set tree_growth_score = tree_growth_score + 15 where id = new.user_id; -- module milestone

    select not exists (
      select 1 from p2p_modules m
      where m.curriculum_id = v_curriculum_id
        and not p2p_module_fully_completed(new.user_id, m.id)
    ) into v_category_complete;

    if v_category_complete then
      update p2p_profiles set tree_growth_score = tree_growth_score + 50 where id = new.user_id; -- category milestone
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists p2p_tree_growth_on_lesson_progress_trg on p2p_lesson_progress;
create trigger p2p_tree_growth_on_lesson_progress_trg
  after insert or update on p2p_lesson_progress
  for each row execute function p2p_tree_growth_on_lesson_progress();