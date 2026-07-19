-- 030: RPC for the Peer Review "To Review" submitter-context panel.
--
-- The evaluator needs enough of the submitter's profile to evaluate their
-- work fairly (name, avatar, growth stage, streak, in-curriculum/plan
-- position) — but p2p_profiles RLS ("profiles_select_scoped", see 015) only
-- lets a user read another profile if they share a group, are the same
-- person, or are an admin/leader over that person's church/region. A peer
-- evaluator who doesn't happen to share a group with the submitter can't
-- read their profile row directly, even when genuinely assigned to review
-- their work — confirmed live: without this function, real evaluations
-- fall back to the existing "A fellow disciple" placeholder name.
--
-- Rather than widen general profile visibility, this opens exactly one
-- path: a SECURITY DEFINER lookup gated on a real p2p_lesson_evaluations /
-- p2p_plan_lesson_evaluations row proving the caller is the assigned
-- evaluator for that specific submission. Returns only the narrow field
-- set the review UI needs — never full_name/email/bio/etc. beyond what's
-- listed, and never registration/spiritual-background intake
-- (p2p_registration_profiles), other submissions, or help-request history.

create or replace function p2p_get_submitter_evaluation_context(
  p_evaluation_id uuid,
  p_source text default 'core'
)
returns table (
  submitter_id uuid,
  full_name text,
  photo_url text,
  growth_level integer,
  streak_days integer,
  context_label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submitter_id uuid;
  v_lesson_id uuid;
  v_module_id uuid;
  v_plan_id uuid;
  v_module_title text;
  v_module_number int;
  v_lesson_pos int;
  v_lesson_total int;
  v_context_label text;
begin
  if p_source = 'plan' then
    select e.submitter_id, e.lesson_id into v_submitter_id, v_lesson_id
    from p2p_plan_lesson_evaluations e
    where e.id = p_evaluation_id and e.evaluator_id = auth.uid();
  else
    select e.submitter_id, e.lesson_id into v_submitter_id, v_lesson_id
    from p2p_lesson_evaluations e
    where e.id = p_evaluation_id and e.evaluator_id = auth.uid();
  end if;

  -- Not the assigned evaluator for this evaluation — no row, no context,
  -- no leak. Zero rows returned, same shape as any other empty result.
  if v_submitter_id is null then
    return;
  end if;

  if p_source = 'plan' then
    select l.module_id, l.plan_id into v_module_id, v_plan_id
    from p2p_plan_lessons l where l.id = v_lesson_id;

    if v_module_id is not null then
      select m.module_number, m.module_title into v_module_number, v_module_title
      from p2p_plan_modules m where m.id = v_module_id;

      select count(*),
             count(*) filter (where l.order_index < (select order_index from p2p_plan_lessons where id = v_lesson_id))
        into v_lesson_total, v_lesson_pos
      from p2p_plan_lessons l where l.module_id = v_module_id;
      v_lesson_pos := coalesce(v_lesson_pos, 0) + 1;

      v_context_label := format('Module %s: %s — Lesson %s of %s', v_module_number, v_module_title, v_lesson_pos, v_lesson_total);
    else
      -- Flat plan (has_submodules = false) — no module tier, just position within the plan.
      select count(*),
             count(*) filter (where l.order_index < (select order_index from p2p_plan_lessons where id = v_lesson_id))
        into v_lesson_total, v_lesson_pos
      from p2p_plan_lessons l where l.plan_id = v_plan_id;
      v_lesson_pos := coalesce(v_lesson_pos, 0) + 1;

      v_context_label := format('Lesson %s of %s', v_lesson_pos, v_lesson_total);
    end if;
  else
    select l.module_id into v_module_id from p2p_lessons l where l.id = v_lesson_id;

    if v_module_id is not null then
      select m.title into v_module_title
      from p2p_modules m where m.id = v_module_id;

      select count(*),
             count(*) filter (where l.order_index < (select order_index from p2p_lessons where id = v_lesson_id))
        into v_lesson_total, v_lesson_pos
      from p2p_lessons l where l.module_id = v_module_id;
      v_lesson_pos := coalesce(v_lesson_pos, 0) + 1;

      -- Core curriculum module titles already bake in "Module N:" (e.g.
      -- "Module 0: PEER-TO-PEER ORIENTATION") — unlike Plans' module_title,
      -- which is just the bare name. Don't prepend a second "Module N:" or
      -- the label reads "Module 1: Module 0: ...".
      v_context_label := format('%s — Lesson %s of %s', v_module_title, v_lesson_pos, v_lesson_total);
    end if;
  end if;

  return query
  select p.id, p.full_name, p.photo_url, p.growth_level, p.streak_days, coalesce(v_context_label, '')
  from p2p_profiles p
  where p.id = v_submitter_id;
end;
$$;

grant execute on function p2p_get_submitter_evaluation_context(uuid, text) to authenticated;
