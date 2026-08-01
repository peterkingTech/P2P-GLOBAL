-- 044: Peer Circles — group learning with 3-8 members going through a plan
-- or Core Curriculum module together, with a consensus-based evaluation gate
-- instead of the one-on-one p2p_lesson_evaluations flow.
--
-- Renumbered from the Prompt 4 spec's 043 — 043 was already used for
-- p2p_user_goals/p2p_plan_enrollments (Prompt 3).

-- ── p2p_peer_circles ──────────────────────────────────────────────────────────
create table if not exists p2p_peer_circles (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  plan_id             uuid,          -- if circle is for a specific plan
  curriculum_id       uuid,          -- if circle is for Core Curriculum
  module_id           uuid,          -- specific module if applicable
  circle_type         text not null default 'open',    -- 'open'|'closed'|'church'|'couple'
  leader_id           uuid not null references auth.users(id) on delete cascade,
  max_members         integer not null default 8,
  min_members         integer not null default 3,
  current_lesson_id   uuid,
  language_code       text not null default 'en',
  timezone            text,
  meeting_preference  text,          -- 'in_app'|'whatsapp'|'zoom'|'flexible'
  status              text not null default 'forming', -- 'forming'|'active'|'completed'|'archived'
  church_id           uuid,          -- if church circle
  is_featured         boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists idx_p2p_peer_circles_status on p2p_peer_circles(status);
create index if not exists idx_p2p_peer_circles_plan on p2p_peer_circles(plan_id);
create index if not exists idx_p2p_peer_circles_leader on p2p_peer_circles(leader_id);

-- ── p2p_peer_circle_members ───────────────────────────────────────────────────
create table if not exists p2p_peer_circle_members (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references p2p_peer_circles(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',   -- 'leader'|'member'
  joined_at   timestamptz not null default now(),
  status      text not null default 'active',   -- 'active'|'inactive'|'left'
  unique(circle_id, user_id)
);

create index if not exists idx_p2p_peer_circle_members_user on p2p_peer_circle_members(user_id);
create index if not exists idx_p2p_peer_circle_members_circle on p2p_peer_circle_members(circle_id, status);

-- ── p2p_peer_circle_sessions ──────────────────────────────────────────────────
create table if not exists p2p_peer_circle_sessions (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references p2p_peer_circles(id) on delete cascade,
  lesson_id     uuid not null,
  scheduled_at  timestamptz,
  completed_at  timestamptz,
  notes         text,
  session_status text not null default 'scheduled', -- 'scheduled'|'completed'|'missed'
  created_by    uuid references auth.users(id)
);

create index if not exists idx_p2p_peer_circle_sessions_circle on p2p_peer_circle_sessions(circle_id);

-- ── p2p_peer_circle_evaluations ───────────────────────────────────────────────
create table if not exists p2p_peer_circle_evaluations (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references p2p_peer_circles(id) on delete cascade,
  submission_id uuid not null,       -- p2p_submissions.id being evaluated
  evaluator_id  uuid not null references auth.users(id) on delete cascade,
  submitter_id  uuid not null references auth.users(id) on delete cascade,
  lesson_id     uuid not null,
  decision      text,                -- 'approved'|'needs_revision'
  feedback      text,
  evaluated_at  timestamptz not null default now(),
  unique(submission_id, evaluator_id)
);

create index if not exists idx_p2p_peer_circle_evaluations_submission on p2p_peer_circle_evaluations(submission_id);
create index if not exists idx_p2p_peer_circle_evaluations_submitter on p2p_peer_circle_evaluations(submitter_id);
create index if not exists idx_p2p_peer_circle_evaluations_evaluator on p2p_peer_circle_evaluations(evaluator_id);

-- ── p2p_peer_circle_join_requests ─────────────────────────────────────────────
create table if not exists p2p_peer_circle_join_requests (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references p2p_peer_circles(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  message       text,
  status        text not null default 'pending', -- 'pending'|'approved'|'declined'
  requested_at  timestamptz not null default now(),
  responded_at  timestamptz,
  responded_by  uuid references auth.users(id),
  unique(circle_id, user_id)
);

create index if not exists idx_p2p_peer_circle_join_requests_circle on p2p_peer_circle_join_requests(circle_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_peer_circles enable row level security;
alter table p2p_peer_circle_members enable row level security;
alter table p2p_peer_circle_sessions enable row level security;
alter table p2p_peer_circle_evaluations enable row level security;
alter table p2p_peer_circle_join_requests enable row level security;

drop policy if exists "Anyone can view circles" on p2p_peer_circles;
create policy "Anyone can view circles" on p2p_peer_circles for select using (true);
drop policy if exists "Leaders manage their circle" on p2p_peer_circles;
create policy "Leaders manage their circle" on p2p_peer_circles
  for all using (auth.uid() = leader_id) with check (auth.uid() = leader_id);
drop policy if exists "Authenticated users can create circles" on p2p_peer_circles;
create policy "Authenticated users can create circles" on p2p_peer_circles
  for insert with check (auth.uid() = leader_id);

drop policy if exists "Members can view their circle roster" on p2p_peer_circle_members;
create policy "Members can view their circle roster" on p2p_peer_circle_members
  for select using (
    auth.uid() = user_id
    or exists (select 1 from p2p_peer_circle_members m2 where m2.circle_id = p2p_peer_circle_members.circle_id and m2.user_id = auth.uid())
  );
drop policy if exists "Users manage their own membership" on p2p_peer_circle_members;
create policy "Users manage their own membership" on p2p_peer_circle_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Leaders manage circle roster" on p2p_peer_circle_members;
create policy "Leaders manage circle roster" on p2p_peer_circle_members
  for all using (exists (select 1 from p2p_peer_circles c where c.id = circle_id and c.leader_id = auth.uid()));

drop policy if exists "Circle members view sessions" on p2p_peer_circle_sessions;
create policy "Circle members view sessions" on p2p_peer_circle_sessions
  for select using (exists (select 1 from p2p_peer_circle_members m where m.circle_id = p2p_peer_circle_sessions.circle_id and m.user_id = auth.uid()));
drop policy if exists "Leaders manage sessions" on p2p_peer_circle_sessions;
create policy "Leaders manage sessions" on p2p_peer_circle_sessions
  for all using (exists (select 1 from p2p_peer_circles c where c.id = circle_id and c.leader_id = auth.uid()));

drop policy if exists "Participants view relevant evaluations" on p2p_peer_circle_evaluations;
create policy "Participants view relevant evaluations" on p2p_peer_circle_evaluations
  for select using (
    auth.uid() = evaluator_id or auth.uid() = submitter_id
    or exists (select 1 from p2p_peer_circles c where c.id = circle_id and c.leader_id = auth.uid())
  );
drop policy if exists "Circle members submit evaluations" on p2p_peer_circle_evaluations;
create policy "Circle members submit evaluations" on p2p_peer_circle_evaluations
  for insert with check (
    auth.uid() = evaluator_id
    and exists (select 1 from p2p_peer_circle_members m where m.circle_id = p2p_peer_circle_evaluations.circle_id and m.user_id = auth.uid() and m.status = 'active')
  );

drop policy if exists "Users manage their own join requests" on p2p_peer_circle_join_requests;
create policy "Users manage their own join requests" on p2p_peer_circle_join_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Leaders manage join requests" on p2p_peer_circle_join_requests;
create policy "Leaders manage join requests" on p2p_peer_circle_join_requests
  for all using (exists (select 1 from p2p_peer_circles c where c.id = circle_id and c.leader_id = auth.uid()));

-- ── Circle evaluation consensus ──────────────────────────────────────────────
-- Rules (see PROMPT 4 spec):
--   - Both of the first 2 evaluators approve -> approved
--   - Both request revision -> needs_revision
--   - Split decision -> wait for the Circle Leader to break the tie
--   - The Circle Leader's own evaluation is always final, whenever cast
--   - No single non-leader member can block another's progress alone
create or replace function p2p_process_circle_evaluation(p_submission_id uuid, p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leader_id uuid;
  v_leader_decision text;
  v_lesson_id uuid;
  v_submitter_id uuid;
  v_final_decision text;
  v_first_two record;
  v_approve_count integer;
  v_revision_count integer;
  v_module_id uuid;
  v_curriculum_id uuid;
  v_plan_complete boolean;
  v_multi_country boolean;
  v_member_id uuid;
  v_deciding_evaluator uuid;
begin
  select leader_id into v_leader_id from p2p_peer_circles where id = p_circle_id;

  select lesson_id, submitter_id into v_lesson_id, v_submitter_id
  from p2p_peer_circle_evaluations
  where submission_id = p_submission_id
  limit 1;

  if v_lesson_id is null then
    return;
  end if;

  -- Leader's word is always final, whenever cast.
  select decision into v_leader_decision
  from p2p_peer_circle_evaluations
  where submission_id = p_submission_id and evaluator_id = v_leader_id;

  if v_leader_decision is not null then
    v_final_decision := v_leader_decision;
    v_deciding_evaluator := v_leader_id;
  else
    -- Otherwise, only the first two non-leader evaluations decide anything.
    select count(*) filter (where decision = 'approved'),
           count(*) filter (where decision = 'needs_revision')
    into v_approve_count, v_revision_count
    from (
      select decision
      from p2p_peer_circle_evaluations
      where submission_id = p_submission_id and evaluator_id <> v_leader_id
      order by evaluated_at asc
      limit 2
    ) first_two;

    if v_approve_count = 2 then
      v_final_decision := 'approved';
      select evaluator_id into v_deciding_evaluator
      from p2p_peer_circle_evaluations
      where submission_id = p_submission_id and evaluator_id <> v_leader_id and decision = 'approved'
      order by evaluated_at asc limit 1;
    elsif v_revision_count = 2 then
      v_final_decision := 'needs_revision';
    else
      -- Split (or fewer than 2 votes so far) — wait for the leader.
      return;
    end if;
  end if;

  if v_final_decision = 'approved' then
    -- p2p_lesson_progress_recompute (migration 031) only ever looks at
    -- p2p_lesson_evaluations to decide whether a submission is approved —
    -- it has no idea p2p_peer_circle_evaluations exists. Record the
    -- circle's consensus there too (already resolved, attributed to
    -- whoever cast the deciding vote) so the shared recompute/wisdom-point/
    -- notification logic just works, instead of duplicating it here.
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, feedback, assigned_at, resolved_at)
    values (p_submission_id, v_lesson_id, v_submitter_id, coalesce(v_deciding_evaluator, v_leader_id), 'approved', 'Approved by circle consensus.', now(), now())
    on conflict do nothing;

    perform p2p_lesson_progress_recompute(v_submitter_id, v_lesson_id);
    insert into p2p_notifications (user_id, title, message)
    values (v_submitter_id, 'Your circle approved your submission', 'Your peer circle approved your lesson submission. Keep going!');

    -- ── Fruits for Circles (PROMPT 4 Step 7) — reuse the existing central
    -- p2p_award_fruit function; no new fruit-catalog rows needed. ──
    select module_id into v_module_id from p2p_lessons where id = v_lesson_id;
    if v_module_id is not null and p2p_module_fully_completed(v_submitter_id, v_module_id) then
      -- Circle Leader earns The Shepherd Fruit whenever any member completes a module.
      perform p2p_award_fruit(
        v_leader_id, 'shepherd_fruit', 'circle_member_module_complete', 'peer_action', p_circle_id,
        jsonb_build_object('summary', 'A member of your circle completed a module.')
      );

      select curriculum_id into v_curriculum_id from p2p_modules where id = v_module_id;
      if v_curriculum_id is not null then
        select bool_and(p2p_module_fully_completed(v_submitter_id, m.id)) into v_plan_complete
        from p2p_modules m where m.curriculum_id = v_curriculum_id;

        if coalesce(v_plan_complete, false) then
          -- The member who just finished the whole plan earns The Fellowship Fruit.
          perform p2p_award_fruit(
            v_submitter_id, 'fellowship_fruit', 'circle_plan_complete', 'peer_action', p_circle_id,
            jsonb_build_object('summary', 'Completed a plan through a peer circle.')
          );

          -- If the circle spans more than one country, every active member
          -- earns The Unity Fruit (p2p_award_fruit itself no-ops for anyone
          -- who already holds it, so this is safe to run every time).
          select count(distinct pr.country) > 1 into v_multi_country
          from p2p_peer_circle_members m
          join p2p_profiles pr on pr.id = m.user_id
          where m.circle_id = p_circle_id and m.status = 'active' and pr.country is not null;

          if coalesce(v_multi_country, false) then
            for v_member_id in
              select user_id from p2p_peer_circle_members where circle_id = p_circle_id and status = 'active'
            loop
              perform p2p_award_fruit(
                v_member_id, 'unity_fruit', 'circle_plan_complete_multinational', 'peer_action', p_circle_id,
                jsonb_build_object('summary', 'A circle spanning multiple nations completed a plan together.')
              );
            end loop;
          end if;
        end if;
      end if;
    end if;
  else
    insert into p2p_notifications (user_id, title, message)
    values (v_submitter_id, 'Your circle asked for a revision', 'Your peer circle asked you to revise your submission before moving on.');
  end if;
end;
$$;

-- ── Integration with the existing one-on-one evaluator-assignment trigger ────
-- Submissions from a member currently in an active circle for that exact
-- lesson are gated by circle consensus (above), not the random one-on-one
-- evaluator pool from migration 031 — otherwise every circle submission
-- would ALSO get a stray solo evaluator assigned, double-gating progress.
create or replace function p2p_assign_evaluator_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluator uuid;
  v_in_active_circle boolean;
begin
  -- Reflection-only submissions don't gate lesson completion.
  if new.assignment_id is null then
    return new;
  end if;

  select exists (
    select 1
    from p2p_peer_circle_members m
    join p2p_peer_circles c on c.id = m.circle_id
    where m.user_id = new.user_id
      and m.status = 'active'
      and c.status = 'active'
      and c.current_lesson_id = new.lesson_id
  ) into v_in_active_circle;

  if v_in_active_circle then
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
