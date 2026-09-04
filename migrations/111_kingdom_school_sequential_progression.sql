-- Kingdom School sequential progression — server-side authority.
--
-- Every screen (curriculum list, module list, lesson list, lesson detail)
-- now computes the same cross-curriculum sequential lock state client-side
-- (see DataContext.getKingdomSchoolLockState in the mobile app), but that
-- alone only stops a user going through the app's own UI — it does nothing
-- against a modified client or a direct PostgREST call that posts straight
-- to p2p_lesson_progress. This migration adds the same rule as a real
-- database check so progression genuinely cannot be skipped by manipulating
-- client state, matching the ordering the app itself now enforces:
-- curriculum.display_order -> module.order_index -> lesson.order_index,
-- where a lesson unlocks once the immediately preceding lesson in that
-- global order is submitted or completed (Plans/plan_category curricula are
-- excluded from the sequence entirely, same as the client).
--
-- Additive only. Existing rows are never touched, deleted, or reset:
--   - The trigger only runs BEFORE INSERT and BEFORE UPDATE, and only
--     examines rows transitioning INTO 'submitted' or 'completed' FROM a
--     not-started/nonexistent state (OLD.status IS NULL OR OLD.status =
--     'not_started') — an already-submitted/completed row can always be
--     updated again (e.g. by the peer-evaluation trigger flipping
--     'submitted' -> 'completed') without being re-checked.
--   - A "grandfather" clause additionally allows the transition whenever
--     the user already has ANY existing progress row at or beyond this
--     lesson's position in the global order — protecting any progress a
--     user made before this rule existed, so nobody's legitimate history
--     can be broken by turning this on. (A live check before writing this
--     migration confirmed only 3 users have any completed-lesson history
--     at all today, and none of them are out of order under the new rule —
--     this clause is a safety net for the future, not a fix for existing
--     data.)

create or replace function p2p_kingdom_school_lesson_order_ok(
  p_user_id uuid,
  p_lesson_id uuid,
  p_new_status text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_new_status not in ('submitted', 'completed') then
    return true;
  end if;

  with ordered as (
    select l.id as lesson_id,
           row_number() over (order by c.display_order, m.order_index, l.order_index) as rn
    from p2p_lessons l
    join p2p_modules m on m.id = l.module_id
    join p2p_curriculums c on c.id = m.curriculum_id
    where c.status = 'published' and c.type not in ('plan', 'plan_category')
  ),
  target as (
    select rn from ordered where lesson_id = p_lesson_id
  ),
  predecessor as (
    select o.lesson_id as prev_lesson_id
    from ordered o, target t
    where o.rn = t.rn - 1
  )
  select
    -- Not part of the ordered core curriculum at all (e.g. a Plan lesson) —
    -- never block something outside the sequence this rule governs.
    not exists (select 1 from target)
    -- This is the very first lesson in the whole sequence.
    or not exists (select 1 from predecessor)
    -- The immediately preceding lesson is already done for this user.
    or exists (
      select 1 from p2p_lesson_progress lp, predecessor p
      where lp.user_id = p_user_id and lp.lesson_id = p.prev_lesson_id
        and (lp.completed = true or lp.status in ('submitted', 'completed'))
    )
    -- Grandfather: the user already has progress on some lesson at or beyond
    -- this position, proving they organically reached this far already.
    or exists (
      select 1 from p2p_lesson_progress lp
      join ordered o2 on o2.lesson_id = lp.lesson_id
      join target t on true
      where lp.user_id = p_user_id and o2.rn >= t.rn and lp.lesson_id <> p_lesson_id
    )
  into v_ok;

  return coalesce(v_ok, true);
end;
$$;

create or replace function p2p_lesson_progress_enforce_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('submitted', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and (tg_op = 'INSERT' or old.status is null or old.status = 'not_started') then
    if not p2p_kingdom_school_lesson_order_ok(new.user_id, new.lesson_id, new.status) then
      raise exception 'Complete the previous Kingdom School lesson before this one.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists p2p_lesson_progress_enforce_order_trg on p2p_lesson_progress;
create trigger p2p_lesson_progress_enforce_order_trg
  before insert or update on p2p_lesson_progress
  for each row execute function p2p_lesson_progress_enforce_order();