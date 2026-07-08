-- 008: Peer-evaluation gate for lesson completion
-- Renames 'revision_requested' -> 'needs_revision', adds self-approval flag for the
-- "first person through a lesson" case, and wires evaluation approval to actually
-- flip p2p_lesson_progress.completed (submission no longer completes the lesson by itself).

-- ── Rename status value 'revision_requested' -> 'needs_revision' ────────────────
alter table p2p_lesson_evaluations drop constraint if exists p2p_lesson_evaluations_status_check;
update p2p_lesson_evaluations set status = 'needs_revision' where status = 'revision_requested';
alter table p2p_lesson_evaluations
  add constraint p2p_lesson_evaluations_status_check
  check (status in ('pending', 'approved', 'needs_revision'));

-- ── Self-approval flag (first learner through a lesson, no eligible evaluator yet) ─
alter table p2p_lesson_evaluations
  add column if not exists self_approved boolean not null default false;

-- ── Evaluator assignment: self-approve when no eligible evaluator exists ─────────
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
  else
    -- No one has completed this lesson yet — don't block the first learner forever.
    insert into p2p_lesson_evaluations (
      submission_id, lesson_id, submitter_id, evaluator_id, status,
      self_approved, feedback, assigned_at, resolved_at
    )
    values (
      new.id, new.lesson_id, new.user_id, new.user_id, 'approved',
      true, 'First through this lesson — unevaluated, auto-approved.', now(), now()
    );
  end if;
  return new;
end;
$$;

-- ── Notify evaluator only when there's a real pending review to do ───────────────
create or replace function p2p_notify_evaluator()
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
      'You have a lesson evaluation waiting',
      'A fellow disciple submitted work for review. Please evaluate it when you can.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_evaluator_on_insert on p2p_lesson_evaluations;
create trigger trg_notify_evaluator_on_insert
  after insert on p2p_lesson_evaluations
  for each row execute function p2p_notify_evaluator();

-- (trg_notify_evaluator_on_reassign is unaffected — reassignment always sets status='pending')

-- ── Credit uses the renamed status value ─────────────────────────────────────────
create or replace function p2p_award_evaluation_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'needs_revision') then
    new.resolved_at := now();
    update p2p_profiles
      set servant_score = servant_score + 10,
          evaluations_completed = evaluations_completed + 1
      where id = new.evaluator_id;
  end if;
  return new;
end;
$$;

-- ── Gate: only an 'approved' evaluation flips lesson_progress.completed ──────────
create or replace function p2p_apply_evaluation_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into p2p_lesson_progress (user_id, lesson_id, completed, progress_percent, updated_at)
    values (new.submitter_id, new.lesson_id, true, 100, now())
    on conflict (user_id, lesson_id)
    do update set completed = true, progress_percent = 100, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_evaluation_outcome on p2p_lesson_evaluations;
create trigger trg_apply_evaluation_outcome
  after insert or update of status on p2p_lesson_evaluations
  for each row execute function p2p_apply_evaluation_outcome();

-- ── RLS: explicit admin read/write override on evaluation tables ────────────────
drop policy if exists "Admins can manage submissions" on p2p_assignment_submissions;
create policy "Admins can manage submissions" on p2p_assignment_submissions
  for all using (p2p_is_admin()) with check (p2p_is_admin());

drop policy if exists "Admins can manage evaluations" on p2p_lesson_evaluations;
create policy "Admins can manage evaluations" on p2p_lesson_evaluations
  for all using (p2p_is_admin()) with check (p2p_is_admin());
