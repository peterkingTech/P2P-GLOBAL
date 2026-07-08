-- 007: Peer evaluation reciprocity system
-- Adds submissions, evaluations, reassignment log, profile stat columns, and the
-- triggers/functions that wire assignment -> notification -> resolution -> credit -> reassignment.

-- ── Profile stat columns ─────────────────────────────────────────────────────
alter table p2p_profiles
  add column if not exists servant_score integer not null default 0,
  add column if not exists wisdom_points integer not null default 0,
  add column if not exists evaluations_completed integer not null default 0;

-- ── p2p_assignment_submissions ───────────────────────────────────────────────
create table if not exists p2p_assignment_submissions (
  id uuid primary key default uuid_generate_v4(),
  assignment_id uuid not null references p2p_assignments(id) on delete cascade,
  lesson_id uuid not null references p2p_lessons(id) on delete cascade,
  user_id uuid not null references p2p_profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_p2p_assignment_submissions_user on p2p_assignment_submissions(user_id);
create index if not exists idx_p2p_assignment_submissions_lesson on p2p_assignment_submissions(lesson_id);

-- ── p2p_lesson_evaluations ────────────────────────────────────────────────────
create table if not exists p2p_lesson_evaluations (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references p2p_assignment_submissions(id) on delete cascade,
  lesson_id uuid not null references p2p_lessons(id) on delete cascade,
  submitter_id uuid not null references p2p_profiles(id) on delete cascade,
  evaluator_id uuid not null references p2p_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revision_requested')),
  feedback text,
  reassigned_from uuid references p2p_profiles(id),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_p2p_lesson_evaluations_evaluator on p2p_lesson_evaluations(evaluator_id, status);
create index if not exists idx_p2p_lesson_evaluations_submitter on p2p_lesson_evaluations(submitter_id);
create index if not exists idx_p2p_lesson_evaluations_stale on p2p_lesson_evaluations(status, assigned_at);

-- ── p2p_evaluation_reassignments (log) ────────────────────────────────────────
create table if not exists p2p_evaluation_reassignments (
  id uuid primary key default uuid_generate_v4(),
  evaluation_id uuid not null references p2p_lesson_evaluations(id) on delete cascade,
  previous_evaluator_id uuid not null references p2p_profiles(id),
  new_evaluator_id uuid references p2p_profiles(id),
  reason text not null default '72h_no_action',
  created_at timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_assignment_submissions enable row level security;
alter table p2p_lesson_evaluations enable row level security;
alter table p2p_evaluation_reassignments enable row level security;

drop policy if exists "Users can view own submissions" on p2p_assignment_submissions;
create policy "Users can view own submissions" on p2p_assignment_submissions
  for select using (auth.uid() = user_id or p2p_is_admin());

drop policy if exists "Users can insert own submissions" on p2p_assignment_submissions;
create policy "Users can insert own submissions" on p2p_assignment_submissions
  for insert with check (auth.uid() = user_id);

-- Evaluators need to be able to read the submission they were assigned to review.
drop policy if exists "Evaluators can view assigned submissions" on p2p_assignment_submissions;
create policy "Evaluators can view assigned submissions" on p2p_assignment_submissions
  for select using (
    exists (
      select 1 from p2p_lesson_evaluations e
      where e.submission_id = p2p_assignment_submissions.id
        and e.evaluator_id = auth.uid()
    )
  );

drop policy if exists "Participants can view own evaluations" on p2p_lesson_evaluations;
create policy "Participants can view own evaluations" on p2p_lesson_evaluations
  for select using (auth.uid() = submitter_id or auth.uid() = evaluator_id or p2p_is_admin());

drop policy if exists "Evaluators can resolve assigned evaluations" on p2p_lesson_evaluations;
create policy "Evaluators can resolve assigned evaluations" on p2p_lesson_evaluations
  for update using (auth.uid() = evaluator_id)
  with check (auth.uid() = evaluator_id);

drop policy if exists "Admins can view reassignment log" on p2p_evaluation_reassignments;
create policy "Admins can view reassignment log" on p2p_evaluation_reassignments
  for select using (p2p_is_admin());

-- p2p_notifications had zero policies (silent-block bug pattern) — add self access.
alter table p2p_notifications enable row level security;
drop policy if exists "Users can view own notifications" on p2p_notifications;
create policy "Users can view own notifications" on p2p_notifications
  for select using (auth.uid() = user_id);
drop policy if exists "Users can update own notifications" on p2p_notifications;
create policy "Users can update own notifications" on p2p_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Evaluator selection ───────────────────────────────────────────────────────
-- Eligible = completed the lesson, not in the exclude list. Least-recently-assigned first
-- (fewest current evaluator assignments, tie-broken by oldest last assignment).
create or replace function p2p_pick_evaluator(p_lesson_id uuid, p_exclude uuid[])
returns uuid
language sql
security definer
set search_path = public
as $$
  select lp.user_id
  from p2p_lesson_progress lp
  left join (
    select evaluator_id, count(*) as assigned_count, max(assigned_at) as last_assigned
    from p2p_lesson_evaluations
    group by evaluator_id
  ) load on load.evaluator_id = lp.user_id
  where lp.lesson_id = p_lesson_id
    and lp.completed = true
    and not (lp.user_id = any(p_exclude))
  order by coalesce(load.assigned_count, 0) asc, coalesce(load.last_assigned, 'epoch'::timestamptz) asc
  limit 1
$$;

-- ── Assign an evaluator whenever a submission is created ─────────────────────
create or replace function p2p_assign_evaluator_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluator uuid;
begin
  v_evaluator := p2p_pick_evaluator(new.lesson_id, array[new.user_id]);
  if v_evaluator is not null then
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at)
    values (new.id, new.lesson_id, new.user_id, v_evaluator, 'pending', now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_evaluator_on_submission on p2p_assignment_submissions;
create trigger trg_assign_evaluator_on_submission
  after insert on p2p_assignment_submissions
  for each row execute function p2p_assign_evaluator_on_submission();

-- ── Notify evaluator on assignment (insert) and on reassignment (evaluator_id change) ─
create or replace function p2p_notify_evaluator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into p2p_notifications (user_id, title, message)
  values (
    new.evaluator_id,
    'You have a lesson evaluation waiting',
    'A fellow disciple submitted work for review. Please evaluate it when you can.'
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_evaluator_on_insert on p2p_lesson_evaluations;
create trigger trg_notify_evaluator_on_insert
  after insert on p2p_lesson_evaluations
  for each row execute function p2p_notify_evaluator();

drop trigger if exists trg_notify_evaluator_on_reassign on p2p_lesson_evaluations;
create trigger trg_notify_evaluator_on_reassign
  after update of evaluator_id on p2p_lesson_evaluations
  for each row
  when (old.evaluator_id is distinct from new.evaluator_id)
  execute function p2p_notify_evaluator();

-- ── Award credit when an evaluation is resolved ───────────────────────────────
create or replace function p2p_award_evaluation_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'revision_requested') then
    new.resolved_at := now();
    update p2p_profiles
      set servant_score = servant_score + 10,
          evaluations_completed = evaluations_completed + 1
      where id = new.evaluator_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_award_evaluation_credit on p2p_lesson_evaluations;
create trigger trg_award_evaluation_credit
  before update of status on p2p_lesson_evaluations
  for each row execute function p2p_award_evaluation_credit();

-- ── 72h reliability safety net: reassign stale pending evaluations ───────────
create or replace function p2p_reassign_stale_evaluations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_new_evaluator uuid;
  v_count integer := 0;
begin
  for v_row in
    select id, lesson_id, submitter_id, evaluator_id
    from p2p_lesson_evaluations
    where status = 'pending'
      and assigned_at < now() - interval '72 hours'
  loop
    v_new_evaluator := p2p_pick_evaluator(v_row.lesson_id, array[v_row.submitter_id, v_row.evaluator_id]);
    if v_new_evaluator is not null then
      insert into p2p_evaluation_reassignments (evaluation_id, previous_evaluator_id, new_evaluator_id, reason)
      values (v_row.id, v_row.evaluator_id, v_new_evaluator, '72h_no_action');

      update p2p_lesson_evaluations
        set evaluator_id = v_new_evaluator,
            reassigned_from = v_row.evaluator_id,
            assigned_at = now()
        where id = v_row.id;

      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Schedule hourly via pg_cron (confirmed available on this project).
select cron.schedule(
  'p2p-reassign-stale-evaluations',
  '0 * * * *',
  $$select p2p_reassign_stale_evaluations();$$
) where not exists (
  select 1 from cron.job where jobname = 'p2p-reassign-stale-evaluations'
);
