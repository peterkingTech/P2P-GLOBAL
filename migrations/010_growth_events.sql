-- 010_growth_events.sql
-- Growth-events log + module-completion celebration triggers.
-- Idempotent: safe to run multiple times.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists p2p_growth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references p2p_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('lesson_completed', 'module_completed', 'disciple_gained')),
  label text not null,
  score_before integer not null default 0,
  score_after integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_p2p_growth_events_user_created
  on p2p_growth_events (user_id, created_at desc);

alter table p2p_growth_events enable row level security;

drop policy if exists "Users view own growth events" on p2p_growth_events;
create policy "Users view own growth events"
  on p2p_growth_events for select
  using (auth.uid() = user_id);

drop policy if exists "Admins view all growth events" on p2p_growth_events;
create policy "Admins view all growth events"
  on p2p_growth_events for select
  using (
    exists (
      select 1 from p2p_profiles
      where id = auth.uid() and role in ('regional_admin', 'super_admin')
    )
  );

-- Inserts happen only via SECURITY DEFINER trigger functions below, so no
-- general INSERT policy is granted to regular users.

-- ── Growth score calculation ────────────────────────────────────────────────
-- Real formula built from actual activity, not a placeholder:
--   1 point per completed lesson
--   1 point per 10 servant_score (peer evaluations performed)
--   5 points per active disciple gained (mentoring another user)
-- This scale lines up with the client's existing STAGES.unlockPoints ladder
-- (0, 4, 12, 28, 60, 110) used for the Living Tree stages.
create or replace function p2p_calculate_growth_score(p_user_id uuid)
returns integer as $$
declare
  v_lessons_completed integer;
  v_servant_score integer;
  v_disciples_gained integer;
begin
  select count(*) into v_lessons_completed
  from p2p_lesson_progress
  where user_id = p_user_id and completed = true;

  select coalesce(servant_score, 0) into v_servant_score
  from p2p_profiles
  where id = p_user_id;

  select count(*) into v_disciples_gained
  from p2p_discipleship_links
  where mentor_id = p_user_id and active = true;

  return v_lessons_completed
    + floor(coalesce(v_servant_score, 0) / 10.0)::integer
    + (v_disciples_gained * 5);
end;
$$ language plpgsql stable;

-- ── Lesson completion → growth event, and module completion check ──────────
create or replace function p2p_log_growth_on_lesson_complete()
returns trigger as $$
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

        update p2p_profiles
        set growth_level = greatest(growth_level, v_score_after)
        where id = new.user_id;
      end if;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_log_growth_on_lesson_complete on p2p_lesson_progress;
create trigger trg_log_growth_on_lesson_complete
  after insert or update of completed on p2p_lesson_progress
  for each row
  execute function p2p_log_growth_on_lesson_complete();

-- ── Discipleship link formed → growth event for the mentor ─────────────────
create or replace function p2p_log_growth_on_discipleship()
returns trigger as $$
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
    update p2p_profiles
    set growth_level = greatest(growth_level, v_score_after)
    where id = new.mentor_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_log_growth_on_discipleship on p2p_discipleship_links;
create trigger trg_log_growth_on_discipleship
  after insert on p2p_discipleship_links
  for each row
  execute function p2p_log_growth_on_discipleship();
