-- 236 (Phase 2 — growth engine, approved by the owner 2026-11-04; restore-
-- tested; applied only with the guarded production procedure).
-- FUNCTIONS + TRIGGERS + two scheduled jobs. Additive; the two old growth
-- triggers keep their behaviour until promotions are switched on.
--
-- One authoritative, server-side calculation (no phone can call it):
--   p2p_growth_facts(user)      — evidence from real, dated records only
--                                 (counts and dates, never the content of a
--                                 reflection, journal or evaluation);
--   p2p_growth_evaluate(user)   — the checklist for every stage across the
--                                 four dimensions; a stage is met only when
--                                 ALL its requirements are, and a stage is
--                                 eligible only when every stage below it is
--                                 too (no dimension compensates for another);
--   p2p_growth_recalculate(user)— records the checklist; when promotions are
--                                 ON, moves the person up (never down), adds
--                                 one history row per stage reached (unique),
--                                 one notification and one celebration;
--   queue + worker              — events queue a recalculation (and the
--                                 person's current mentors, whose "disciple
--                                 is growing" may change); a worker runs every
--                                 5 minutes; a nightly reconciliation queues
--                                 everyone, so missed events are recovered;
--                                 failures are retried with the error kept.
-- growth_level becomes a mirror of the official stage for older app builds
-- (0 · 4 · 12 · 28 · 60 — never Forest of Nations) once promotions are on;
-- until then the old triggers keep writing it exactly as before.

begin;

-- ── Small helpers ───────────────────────────────────────────────────────────
create or replace function public.p2p_growth_engine_active() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select promotions_enabled from p2p_growth_settings), false);
$$;

-- The old six-stage ladder's points for a personal stage (constants/stages.ts) — what older builds read.
create or replace function public.p2p_growth_stage_points(p_stage int) returns int
  language sql immutable set search_path = public as $$
  select (array[0, 4, 12, 28, 60])[greatest(1, least(p_stage, 5))];
$$;

-- ── Evidence ────────────────────────────────────────────────────────────────
create or replace function public.p2p_growth_facts(p_user uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_first timestamptz;
  v_weeks int := 0;
  v_months int := 0;
  v_onboarding boolean;
  v_lessons int := 0;
  v_modules int := 0;
  v_core int := 0;
  v_core_curriculum uuid := p2p_active_curriculum_id();
  v_sp_days int := 0;
  v_apply int := 0;
  v_evals int := 0;
  v_fruits int := 0;
  v_sustained int := 0;
begin
  -- Dated, meaningful activity (not sign-ins or screen views).
  with acts(at) as (
    select created_at from p2p_submissions where user_id = p_user
    union all select created_at from p2p_growth_events where user_id = p_user and event_type in ('lesson_completed', 'module_completed')
    union all select resolved_at from p2p_lesson_evaluations
      where evaluator_id = p_user and status in ('approved', 'needs_revision', 'revision_requested') and resolved_at is not null and not coalesce(self_approved, false)
    union all select created_at from p2p_journal_reflections where user_id = p_user
    union all select created_at from p2p_user_activity_events where user_id = p_user
  )
  select min(at), count(distinct date_trunc('week', at)), count(distinct date_trunc('month', at))
    into v_first, v_weeks, v_months
    from acts where at is not null and at <= now();

  select onboarding_journey_completed_at is not null into v_onboarding from p2p_profiles where id = p_user;

  select count(*) into v_lessons from p2p_lesson_progress where user_id = p_user and completed is true;

  -- Whole modules: only those where the person has completed at least one lesson.
  with mine as (
    select distinct l.module_id from p2p_lesson_progress lp join p2p_lessons l on l.id = lp.lesson_id
     where lp.user_id = p_user and lp.completed is true
  ), done as (
    select m.module_id, md.curriculum_id from mine m join p2p_modules md on md.id = m.module_id
     where p2p_module_fully_completed(p_user, m.module_id)
  )
  select count(*), count(*) filter (where curriculum_id = v_core_curriculum) into v_modules, v_core from done;

  -- Scripture and prayer: the number of different days (never what was written).
  with d(at) as (
    select created_at from p2p_submissions where user_id = p_user and reflection_question_id is not null
    union all select created_at from p2p_journal_reflections where user_id = p_user
    union all select created_at from p2p_user_activity_events where user_id = p_user and (event_type like 'prayer%' or event_type like 'scripture%')
  )
  select count(distinct (at at time zone 'UTC')::date) into v_sp_days from d where at <= now();

  -- Applying learning: different assignment questions answered (answering the same one again doesn't count twice).
  select count(distinct assignment_question_id) into v_apply from p2p_submissions where user_id = p_user and assignment_question_id is not null;

  -- Service to others.
  select count(*) into v_evals from p2p_lesson_evaluations
   where evaluator_id = p_user and evaluator_id is distinct from submitter_id
     and status in ('approved', 'needs_revision', 'revision_requested') and not coalesce(self_approved, false);
  select count(*) into v_fruits from p2p_user_fruits where user_id = p_user and coalesce(is_visible, true);

  -- Genuine, sustained discipleship: active for 90+ days, and the disciple has
  -- kept learning since it began (3+ dated answers or lesson completions).
  select count(*) into v_sustained
    from p2p_discipleship_links l
   where l.mentor_id = p_user and l.status = 'active' and l.started_at <= now() - interval '90 days'
     and ((select count(*) from p2p_submissions s where s.user_id = l.disciple_id and s.created_at >= l.started_at)
        + (select count(*) from p2p_growth_events g where g.user_id = l.disciple_id and g.event_type = 'lesson_completed' and g.created_at >= l.started_at)) >= 3;

  return jsonb_build_object(
    'onboarding_done', case when coalesce(v_onboarding, false) then 1 else 0 end,
    'first_activity_at', v_first,
    'journey_days', case when v_first is null then 0 else floor(extract(epoch from (now() - v_first)) / 86400)::int end,
    'active_weeks', v_weeks,
    'active_months', v_months,
    'lessons_completed', v_lessons,
    'modules_completed', v_modules,
    'core_modules_completed', v_core,
    'scripture_prayer_days', v_sp_days,
    'application_answers', v_apply,
    'evaluations_given', v_evals,
    'fruits_earned', v_fruits,
    'service_evidence', v_evals + v_fruits,
    'sustained_disciples', v_sustained
  );
end $$;

-- ── Checklist ───────────────────────────────────────────────────────────────
create or replace function public.p2p_growth_evaluate(p_user uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_facts jsonb := p2p_growth_facts(p_user);
  v_stages jsonb := '[]'::jsonb;
  v_items jsonb;
  v_met boolean;
  v_any boolean;
  v_chain boolean := true;
  v_eligible int := 1;
  v_have numeric;
  r record;
  s int;
begin
  for s in 2..5 loop
    v_items := '[]'::jsonb; v_met := true; v_any := false;
    for r in select * from p2p_growth_requirements where stage = s order by display_order, fact_key loop
      v_any := true;
      v_have := coalesce((v_facts ->> r.fact_key)::numeric, 0);   -- missing evidence never counts
      v_items := v_items || jsonb_build_object('key', r.fact_key, 'dimension', r.dimension, 'label', r.label,
                                               'have', v_have, 'need', r.min_value, 'met', v_have >= r.min_value);
      if v_have < r.min_value then v_met := false; end if;
    end loop;
    if not v_any then v_met := false; end if;   -- a stage with no requirements is never "met" by accident
    v_stages := v_stages || jsonb_build_object('stage', s, 'met', v_met, 'requirements', v_items);
    if v_chain and v_met then v_eligible := s; else v_chain := false; end if;
  end loop;
  return jsonb_build_object('facts', v_facts, 'eligible_stage', v_eligible, 'stages', v_stages,
                            'calc_version', (select calc_version from p2p_growth_settings), 'thresholds', (select thresholds_status from p2p_growth_settings));
end $$;

-- ── Recalculate one person (idempotent) ─────────────────────────────────────
create or replace function public.p2p_growth_recalculate(p_user uuid, p_source text default 'event') returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_eval jsonb;
  v_set record;
  v_cur record;
  v_eligible int;
  v_new int;
  v_legacy int;
  s int;
  v_names constant text[] := array['Dormant Seed', 'Sprout', 'Young Tree', 'Fruitful Tree', 'Forest Builder'];
  v_verses constant text[] := array[
    'Unless a seed falls to the ground and dies… — John 12:24',
    'He is like a tree planted by streams of water. — Psalm 1:3',
    'Rooted and built up in Him. — Colossians 2:7',
    'By their fruit you will recognize them. — Matthew 7:20',
    'Go and make disciples of all nations. — Matthew 28:19'];
begin
  if not exists (select 1 from p2p_profiles where id = p_user and not coalesce(is_official_account, false)) then return null; end if;
  insert into p2p_growth_status (user_id, stage_since) values (p_user, now()) on conflict (user_id) do nothing;
  select * into v_cur from p2p_growth_status where user_id = p_user for update;   -- one recalculation per person at a time
  select * into v_set from p2p_growth_settings;
  v_eval := p2p_growth_evaluate(p_user);
  v_eligible := (v_eval ->> 'eligible_stage')::int;
  v_new := v_cur.stage;

  if v_set.promotions_enabled and v_eligible > v_cur.stage then
    for s in (v_cur.stage + 1)..v_eligible loop
      insert into p2p_growth_history (user_id, from_stage, to_stage, kind, criteria, calc_version, source)
      values (p_user, s - 1, s, 'automatic', v_eval -> 'stages' -> (s - 2), v_set.calc_version, left(p_source, 80))
      on conflict (user_id, to_stage) do nothing;
    end loop;
    v_new := v_eligible;
    insert into p2p_notifications (user_id, title, message, notification_type, data)
    values (p_user, 'You have grown into a ' || v_names[v_new] || '!',
            v_verses[v_new], 'growth_stage_reached', jsonb_build_object('stage', v_new, 'stageName', v_names[v_new]));
    insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
    values (p_user, 'stage_reached', v_names[v_new], v_cur.stage, v_new);
    update p2p_profiles set growth_level = greatest(coalesce(growth_level, 0), p2p_growth_stage_points(v_new)) where id = p_user;
  elsif not v_set.promotions_enabled then
    -- Until promotions are on, the previous formula still raises growth_level; the one
    -- stage follows it upward (never down) as a recognised, not-yet-verified stage — quietly.
    select case when gl >= 60 then 5 when gl >= 28 then 4 when gl >= 12 then 3 when gl >= 4 then 2 else 1 end
      into v_legacy from (select coalesce(growth_level, 0) as gl from p2p_profiles where id = p_user) x;
    if v_legacy > v_cur.stage then
      insert into p2p_growth_history (user_id, from_stage, to_stage, kind, criteria, calc_version, source, reason)
      values (p_user, v_cur.stage, v_legacy, 'legacy_import', v_eval, v_set.calc_version, 'previous_growth_formula',
              'Recognised from the previous growth formula while the milestones are in draft')
      on conflict (user_id, to_stage) do nothing;
      v_new := v_legacy;
    end if;
  end if;

  update p2p_growth_status
     set stage = v_new,
         stage_since = case when v_new > v_cur.stage then now() else stage_since end,
         verification = case when v_eligible >= v_new then 'verified' when v_new > v_cur.stage then 'legacy_unverified' else verification end,
         legacy_note = case when v_eligible >= v_new then null
                            when v_new > v_cur.stage then 'Recognised from the previous growth formula; not yet confirmed by the milestones.'
                            else legacy_note end,
         eligible_stage = v_eligible, checklist = v_eval, calc_version = v_set.calc_version,
         evaluated_at = now(), updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('stage', v_new, 'eligible_stage', v_eligible, 'promoted', v_new > v_cur.stage);
end $$;

-- ── Queue ───────────────────────────────────────────────────────────────────
create or replace function public.p2p_growth_enqueue(p_user uuid, p_reason text, p_with_mentors boolean default true) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into p2p_growth_queue (user_id, reason) values (p_user, left(p_reason, 80))
  on conflict (user_id) do update set reason = excluded.reason, queued_at = now(), next_attempt_at = least(p2p_growth_queue.next_attempt_at, now());
  if p_with_mentors then
    -- Their mentors' "a disciple who is growing" may have changed.
    insert into p2p_growth_queue (user_id, reason)
    select l.mentor_id, 'disciple_progress' from p2p_discipleship_links l where l.disciple_id = p_user and l.status = 'active'
    on conflict (user_id) do update set queued_at = now(), next_attempt_at = least(p2p_growth_queue.next_attempt_at, now());
  end if;
end $$;

create or replace function public.p2p_growth_process_queue(p_limit int default 200) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in select user_id, reason, queued_at, attempts from p2p_growth_queue
            where next_attempt_at <= now() order by next_attempt_at limit greatest(p_limit, 1)
            for update skip locked loop
    begin
      perform p2p_growth_recalculate(r.user_id, coalesce(r.reason, 'queue'));
      -- Only remove it if nothing new was queued for this person meanwhile.
      delete from p2p_growth_queue where user_id = r.user_id and queued_at = r.queued_at;
    exception when others then
      update p2p_growth_queue
         set attempts = attempts + 1, last_error = left(sqlerrm, 300),
             next_attempt_at = now() + make_interval(mins => least(1440, 5 * power(2, least(attempts, 8))::int))
       where user_id = r.user_id;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.p2p_growth_reconcile_all() returns integer
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into p2p_growth_queue (user_id, reason)
  select p.id, 'nightly' from p2p_profiles p where not coalesce(p.is_official_account, false)
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Events queue a recalculation (never blocking what the person did) ───────
create or replace function public.p2p_growth_queue_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'p2p_lesson_evaluations' then
      perform p2p_growth_enqueue(new.evaluator_id, 'evaluation');
      perform p2p_growth_enqueue(new.submitter_id, 'evaluation');
    elsif tg_table_name = 'p2p_discipleship_links' then
      perform p2p_growth_enqueue(new.mentor_id, 'relationship', false);
      perform p2p_growth_enqueue(new.disciple_id, 'relationship', false);
    elsif tg_table_name = 'p2p_profiles' then
      perform p2p_growth_enqueue(new.id, 'welcome_journey');
    else
      perform p2p_growth_enqueue(new.user_id, tg_table_name);
    end if;
  exception when others then
    raise warning 'P2P_GROWTH: could not queue a recalculation (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_p2p_growth_queue on public.p2p_lesson_progress;
create trigger trg_p2p_growth_queue after insert or update of completed, status on public.p2p_lesson_progress
  for each row when (new.completed is true) execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_submissions;
create trigger trg_p2p_growth_queue after insert on public.p2p_submissions
  for each row execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_journal_reflections;
create trigger trg_p2p_growth_queue after insert on public.p2p_journal_reflections
  for each row execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_user_activity_events;
create trigger trg_p2p_growth_queue after insert on public.p2p_user_activity_events
  for each row execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_user_fruits;
create trigger trg_p2p_growth_queue after insert on public.p2p_user_fruits
  for each row execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_lesson_evaluations;
create trigger trg_p2p_growth_queue after update of status on public.p2p_lesson_evaluations
  for each row when (new.status is distinct from old.status) execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_discipleship_links;
create trigger trg_p2p_growth_queue after insert or update of status on public.p2p_discipleship_links
  for each row execute function public.p2p_growth_queue_trigger();
drop trigger if exists trg_p2p_growth_queue on public.p2p_profiles;
create trigger trg_p2p_growth_queue after update of onboarding_journey_completed_at on public.p2p_profiles
  for each row when (new.onboarding_journey_completed_at is distinct from old.onboarding_journey_completed_at) execute function public.p2p_growth_queue_trigger();

-- ── The old growth formula stops writing growth_level once promotions are on ─
CREATE OR REPLACE FUNCTION public.p2p_log_growth_on_lesson_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module_id uuid;
  v_module_title text;
  v_lesson_title text;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_score_before integer;
  v_score_after integer;
begin
  -- Only fire on the transition into completed=true
  if new.completed = true and (old.completed is distinct from true) then

    select l.module_id, l.title, m.title
      into v_module_id, v_lesson_title, v_module_title
    from p2p_lessons l
    left join p2p_modules m on m.id = l.module_id
    where l.id = new.lesson_id;

    v_score_before := p2p_calculate_growth_score(new.user_id);

    insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
    values (
      new.user_id,
      'lesson_completed',
      coalesce(v_lesson_title, 'A lesson') || ' completed',
      v_score_before,
      v_score_before
    );

    -- Check whether this completion finished the whole module
    if v_module_id is not null then
      select count(*) into v_total_lessons
      from p2p_lessons where module_id = v_module_id;

      select count(*) into v_completed_lessons
      from p2p_lessons l
      join p2p_lesson_progress lp
        on lp.lesson_id = l.id and lp.user_id = new.user_id and lp.completed = true
      where l.module_id = v_module_id;

      if v_total_lessons > 0 and v_completed_lessons = v_total_lessons then
        v_score_after := p2p_calculate_growth_score(new.user_id);

        insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
        values (
          new.user_id,
          'module_completed',
          coalesce(v_module_title, 'Module') || ' completed',
          v_score_before,
          v_score_after
        );

        if not public.p2p_growth_engine_active() then   -- the growth engine (236) owns growth_level once promotions are on

          update p2p_profiles

          set growth_level = greatest(growth_level, v_score_after)

          where id = new.user_id;

        end if;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_log_growth_on_discipleship()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_disciple_name text;
  v_score_before integer;
  v_score_after integer;
begin
  if new.active = true then
    select full_name into v_disciple_name from p2p_profiles where id = new.disciple_id;

    v_score_before := p2p_calculate_growth_score(new.mentor_id);

    insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
    values (
      new.mentor_id,
      'disciple_gained',
      'New disciple: ' || coalesce(v_disciple_name, 'a fellow believer'),
      v_score_before,
      v_score_before
    );

    v_score_after := p2p_calculate_growth_score(new.mentor_id);
    if not public.p2p_growth_engine_active() then   -- the growth engine (236) owns growth_level once promotions are on
      update p2p_profiles
      set growth_level = greatest(growth_level, v_score_after)
      where id = new.mentor_id;
    end if;
  end if;
  return new;
end;
$function$;

-- ── Access: the API (service role) only ─────────────────────────────────────
revoke execute on function public.p2p_growth_engine_active(), public.p2p_growth_facts(uuid), public.p2p_growth_evaluate(uuid),
  public.p2p_growth_recalculate(uuid, text), public.p2p_growth_enqueue(uuid, text, boolean), public.p2p_growth_process_queue(int),
  public.p2p_growth_reconcile_all(), public.p2p_growth_queue_trigger() from public, anon, authenticated;
grant execute on function public.p2p_growth_engine_active(), public.p2p_growth_facts(uuid), public.p2p_growth_evaluate(uuid),
  public.p2p_growth_recalculate(uuid, text), public.p2p_growth_enqueue(uuid, text, boolean), public.p2p_growth_process_queue(int),
  public.p2p_growth_reconcile_all() to service_role;

commit;

-- ── Scheduled work (pg_cron; reported, not fatal, if unavailable) ───────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('p2p-growth-queue', 'p2p-growth-reconcile');
    perform cron.schedule('p2p-growth-queue', '*/5 * * * *', 'select public.p2p_growth_process_queue(200);');
    perform cron.schedule('p2p-growth-reconcile', '30 2 * * *', 'select public.p2p_growth_reconcile_all();');
  else
    raise warning 'P2P_GROWTH_236: pg_cron is not installed — schedule p2p_growth_process_queue (every 5 min) and p2p_growth_reconcile_all (nightly) another way';
  end if;
end $$;

-- Rollback: unschedule the two jobs; drop the trg_p2p_growth_queue triggers and the p2p_growth_* functions;
--   re-run the 088 definitions of p2p_log_growth_on_lesson_complete / p2p_log_growth_on_discipleship.
