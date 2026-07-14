-- 018: Plans content schema
-- Additive — does NOT touch p2p_curriculums / p2p_modules / p2p_lessons or any
-- existing core curriculum tables. Introduces a separate Plans content shape with
-- inline lesson content and a mirrored peer-evaluation gate.

-- ── p2p_plans ────────────────────────────────────────────────────────────────
create table if not exists p2p_plans (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  tagline      text,
  overview     text,
  has_submodules boolean not null default true,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  created_by   uuid references p2p_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── p2p_plan_source_teachers ──────────────────────────────────────────────────
create table if not exists p2p_plan_source_teachers (
  id                  uuid primary key default uuid_generate_v4(),
  plan_id             uuid not null references p2p_plans(id) on delete cascade,
  name                text not null,
  ministry_or_church  text,
  location            text,
  youtube_handle      text,
  instagram_handle    text,
  other_social_handle text
);

-- ── p2p_plan_modules ──────────────────────────────────────────────────────────
create table if not exists p2p_plan_modules (
  id            uuid primary key default uuid_generate_v4(),
  plan_id       uuid not null references p2p_plans(id) on delete cascade,
  module_number integer not null default 1,
  module_title  text not null,
  order_index   integer not null default 0
);

-- ── p2p_plan_lessons ──────────────────────────────────────────────────────────
create table if not exists p2p_plan_lessons (
  id                   uuid primary key default uuid_generate_v4(),
  plan_id              uuid not null references p2p_plans(id) on delete cascade,
  module_id            uuid references p2p_plan_modules(id) on delete set null,
  lesson_code          text,
  title                text not null,
  order_index          integer not null default 0,
  memory_verse_reference text,
  memory_verse_text    text,
  definition_title     text,
  what_is_it           text,
  why_heading          text,
  why_text             text,
  to_whom              text,
  notes                text
);

create index if not exists idx_p2p_plan_lessons_plan   on p2p_plan_lessons(plan_id);
create index if not exists idx_p2p_plan_lessons_module on p2p_plan_lessons(module_id);

-- ── p2p_plan_lesson_progress ──────────────────────────────────────────────────
create table if not exists p2p_plan_lesson_progress (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references p2p_profiles(id) on delete cascade,
  lesson_id    uuid not null references p2p_plan_lessons(id) on delete cascade,
  completed    boolean not null default false,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  constraint p2p_plan_lesson_progress_uniq unique(user_id, lesson_id)
);

create index if not exists idx_p2p_plan_lesson_progress_user on p2p_plan_lesson_progress(user_id);

-- ── p2p_plan_teaching_outlines ────────────────────────────────────────────────
create table if not exists p2p_plan_teaching_outlines (
  id                          uuid primary key default uuid_generate_v4(),
  plan_id                     uuid not null references p2p_plans(id) on delete cascade unique,
  opening_illustration_title  text,
  opening_illustration_text   text
);

-- ── p2p_plan_teaching_sessions ────────────────────────────────────────────────
create table if not exists p2p_plan_teaching_sessions (
  id            uuid primary key default uuid_generate_v4(),
  outline_id    uuid not null references p2p_plan_teaching_outlines(id) on delete cascade,
  session_label text not null,
  summary       text,
  order_index   integer not null default 0
);

-- ── p2p_plan_discussion_questions ─────────────────────────────────────────────
create table if not exists p2p_plan_discussion_questions (
  id              uuid primary key default uuid_generate_v4(),
  plan_id         uuid not null references p2p_plans(id) on delete cascade,
  question_number integer,
  topic           text,
  question_text   text not null,
  order_index     integer not null default 0
);

-- ── p2p_plan_reflection_questions ─────────────────────────────────────────────
create table if not exists p2p_plan_reflection_questions (
  id            uuid primary key default uuid_generate_v4(),
  lesson_id     uuid not null references p2p_plan_lessons(id) on delete cascade,
  question_text text not null,
  order_index   integer not null default 0
);

-- ── p2p_plan_assignment_questions ─────────────────────────────────────────────
create table if not exists p2p_plan_assignment_questions (
  id            uuid primary key default uuid_generate_v4(),
  lesson_id     uuid not null references p2p_plan_lessons(id) on delete cascade,
  question_text text not null,
  order_index   integer not null default 0
);

-- ── Peer evaluation gate tables ───────────────────────────────────────────────
-- Mirrors p2p_assignment_submissions / p2p_lesson_evaluations exactly so the
-- same UI pattern works for plan lessons. Separate tables keep the data model
-- clean and avoid coupling to the core curriculum schema.

create table if not exists p2p_plan_assignment_submissions (
  id         uuid primary key default uuid_generate_v4(),
  lesson_id  uuid not null references p2p_plan_lessons(id) on delete cascade,
  user_id    uuid not null references p2p_profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_p2p_plan_asub_user   on p2p_plan_assignment_submissions(user_id);
create index if not exists idx_p2p_plan_asub_lesson on p2p_plan_assignment_submissions(lesson_id);

create table if not exists p2p_plan_lesson_evaluations (
  id               uuid primary key default uuid_generate_v4(),
  submission_id    uuid not null references p2p_plan_assignment_submissions(id) on delete cascade,
  lesson_id        uuid not null references p2p_plan_lessons(id) on delete cascade,
  submitter_id     uuid not null references p2p_profiles(id) on delete cascade,
  evaluator_id     uuid not null references p2p_profiles(id) on delete cascade,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'needs_revision')),
  feedback         text,
  self_approved    boolean not null default false,
  reassigned_from  uuid references p2p_profiles(id),
  assigned_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

create index if not exists idx_p2p_plan_eval_evaluator on p2p_plan_lesson_evaluations(evaluator_id, status);
create index if not exists idx_p2p_plan_eval_submitter on p2p_plan_lesson_evaluations(submitter_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Content tables: authenticated users can read (all published content); admins
-- get full write access.  Matches the pattern in 004_content_rls_policies.sql.

do $$ declare t text; plan_content_tables text[] := array[
  'p2p_plans',
  'p2p_plan_source_teachers',
  'p2p_plan_modules',
  'p2p_plan_lessons',
  'p2p_plan_teaching_outlines',
  'p2p_plan_teaching_sessions',
  'p2p_plan_discussion_questions',
  'p2p_plan_reflection_questions',
  'p2p_plan_assignment_questions'
]; begin
  foreach t in array plan_content_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Authenticated users can read %1$s" on %1$s', t);
    execute format('drop policy if exists "Admins can insert %1$s" on %1$s', t);
    execute format('drop policy if exists "Admins can update %1$s" on %1$s', t);
    execute format('drop policy if exists "Admins can delete %1$s" on %1$s', t);
    execute format(
      'create policy "Authenticated users can read %1$s" on %1$s for select to authenticated using (true)', t);
    execute format(
      'create policy "Admins can insert %1$s" on %1$s for insert to authenticated with check (p2p_is_admin())', t);
    execute format(
      'create policy "Admins can update %1$s" on %1$s for update to authenticated using (p2p_is_admin()) with check (p2p_is_admin())', t);
    execute format(
      'create policy "Admins can delete %1$s" on %1$s for delete to authenticated using (p2p_is_admin())', t);
  end loop;
end $$;

-- Progress table — users own their rows; triggers run as security definer so
-- they can upsert progress even when the user is not the updater.
alter table p2p_plan_lesson_progress enable row level security;

drop policy if exists "Users can view own plan progress"   on p2p_plan_lesson_progress;
drop policy if exists "Users can upsert own plan progress" on p2p_plan_lesson_progress;
drop policy if exists "Admins manage plan progress"        on p2p_plan_lesson_progress;

create policy "Users can view own plan progress" on p2p_plan_lesson_progress
  for select using (auth.uid() = user_id or p2p_is_admin());

create policy "Users can upsert own plan progress" on p2p_plan_lesson_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Admins manage plan progress" on p2p_plan_lesson_progress
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- Submissions: users can view and insert their own.
alter table p2p_plan_assignment_submissions enable row level security;

drop policy if exists "Users can view own plan submissions"   on p2p_plan_assignment_submissions;
drop policy if exists "Users can insert own plan submissions" on p2p_plan_assignment_submissions;
drop policy if exists "Evaluators can view assigned plan submissions" on p2p_plan_assignment_submissions;
drop policy if exists "Admins manage plan submissions"         on p2p_plan_assignment_submissions;

create policy "Users can view own plan submissions" on p2p_plan_assignment_submissions
  for select using (auth.uid() = user_id or p2p_is_admin());

create policy "Users can insert own plan submissions" on p2p_plan_assignment_submissions
  for insert with check (auth.uid() = user_id);

create policy "Evaluators can view assigned plan submissions" on p2p_plan_assignment_submissions
  for select using (
    exists (
      select 1 from p2p_plan_lesson_evaluations e
      where e.submission_id = p2p_plan_assignment_submissions.id
        and e.evaluator_id = auth.uid()
    )
  );

create policy "Admins manage plan submissions" on p2p_plan_assignment_submissions
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- Evaluations: participants and admins can see/update their own.
alter table p2p_plan_lesson_evaluations enable row level security;

drop policy if exists "Participants can view own plan evaluations"  on p2p_plan_lesson_evaluations;
drop policy if exists "Evaluators can resolve plan evaluations"      on p2p_plan_lesson_evaluations;
drop policy if exists "Admins manage plan evaluations"               on p2p_plan_lesson_evaluations;

create policy "Participants can view own plan evaluations" on p2p_plan_lesson_evaluations
  for select using (auth.uid() = submitter_id or auth.uid() = evaluator_id or p2p_is_admin());

create policy "Evaluators can resolve plan evaluations" on p2p_plan_lesson_evaluations
  for update using (auth.uid() = evaluator_id) with check (auth.uid() = evaluator_id);

create policy "Admins manage plan evaluations" on p2p_plan_lesson_evaluations
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- ── Peer-evaluation gate — functions ─────────────────────────────────────────

create or replace function p2p_plan_pick_evaluator(p_lesson_id uuid, p_exclude uuid[])
returns uuid
language sql
security definer
set search_path = public
as $$
  select pp.user_id
  from p2p_plan_lesson_progress pp
  left join (
    select evaluator_id, count(*) as assigned_count, max(assigned_at) as last_assigned
    from p2p_plan_lesson_evaluations
    group by evaluator_id
  ) load on load.evaluator_id = pp.user_id
  where pp.lesson_id = p_lesson_id
    and pp.completed = true
    and not (pp.user_id = any(p_exclude))
  order by coalesce(load.assigned_count, 0) asc,
           coalesce(load.last_assigned, 'epoch'::timestamptz) asc
  limit 1
$$;

create or replace function p2p_plan_assign_evaluator_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluator uuid;
begin
  v_evaluator := p2p_plan_pick_evaluator(new.lesson_id, array[new.user_id]);
  if v_evaluator is not null then
    insert into p2p_plan_lesson_evaluations
      (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at)
    values
      (new.id, new.lesson_id, new.user_id, v_evaluator, 'pending', now());
  else
    -- First learner through this lesson — auto-approve immediately.
    insert into p2p_plan_lesson_evaluations
      (submission_id, lesson_id, submitter_id, evaluator_id, status,
       self_approved, feedback, assigned_at, resolved_at)
    values
      (new.id, new.lesson_id, new.user_id, new.user_id, 'approved',
       true, 'First through this lesson — auto-approved.', now(), now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_p2p_plan_assign_evaluator on p2p_plan_assignment_submissions;
create trigger trg_p2p_plan_assign_evaluator
  after insert on p2p_plan_assignment_submissions
  for each row execute function p2p_plan_assign_evaluator_on_submission();

create or replace function p2p_plan_notify_evaluator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into p2p_notifications (user_id, title, message)
    values (
      new.evaluator_id,
      'You have a plan lesson evaluation waiting',
      'A fellow disciple submitted plan work for review. Please evaluate it when you can.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_p2p_plan_notify_evaluator on p2p_plan_lesson_evaluations;
create trigger trg_p2p_plan_notify_evaluator
  after insert on p2p_plan_lesson_evaluations
  for each row execute function p2p_plan_notify_evaluator();

create or replace function p2p_plan_award_evaluation_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'needs_revision') then
    new.resolved_at := now();
    update p2p_profiles
      set servant_score          = servant_score + 10,
          evaluations_completed  = evaluations_completed + 1
      where id = new.evaluator_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_p2p_plan_award_credit on p2p_plan_lesson_evaluations;
create trigger trg_p2p_plan_award_credit
  before update of status on p2p_plan_lesson_evaluations
  for each row execute function p2p_plan_award_evaluation_credit();

create or replace function p2p_plan_apply_evaluation_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into p2p_plan_lesson_progress
      (user_id, lesson_id, completed, completed_at, updated_at)
    values
      (new.submitter_id, new.lesson_id, true, now(), now())
    on conflict (user_id, lesson_id)
    do update set completed = true, completed_at = now(), updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_p2p_plan_apply_outcome on p2p_plan_lesson_evaluations;
create trigger trg_p2p_plan_apply_outcome
  after insert or update of status on p2p_plan_lesson_evaluations
  for each row execute function p2p_plan_apply_evaluation_outcome();
