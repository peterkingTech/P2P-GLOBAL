-- 043: User goals/preferences + per-plan enrollments.
--
-- This is Prompt 3's spec, renumbered from 042 to 043 — 042 was already used
-- for p2p_plan_saves (pulled forward during Prompt 2, which needed bookmark
-- persistence before this migration existed; see that file's header comment).
-- p2p_plan_saves is NOT recreated here.

create table if not exists p2p_user_goals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  goal_type           text not null default 'personal',   -- 'personal' | 'group'
  goals               jsonb not null default '[]',         -- array of selected goal strings
  success_vision      text,                                -- free text answer
  weekly_time         text,                                -- 'under_1h' | '1_2h' | '3_5h' | 'unlimited'
  learning_format     text,                                -- 'peer_guide' | 'group_circle' | 'solo' | 'unsure'
  potential_blockers  jsonb not null default '[]',          -- array of selected blockers
  age_range           text,                                -- optional: '13-17'|'18-24'|'25-34'|'35-44'|'45-54'|'55+'
  life_stage          text,                                -- 'new_believer'|'growing'|'mature'|'leader'
  life_situation      text,                                -- 'single'|'married'|'parent'|'student'|'professional'
  topic_interests     jsonb not null default '[]',          -- array of topic strings
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(user_id)
);

create table if not exists p2p_plan_enrollments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  plan_id       uuid not null,
  enrolled_at   timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  status        text not null default 'enrolled',  -- 'enrolled'|'in_progress'|'completed'|'paused'
  goal_answers  jsonb,                              -- answers from pre-plan questions for this specific plan
  unique(user_id, plan_id)
);

create index if not exists idx_p2p_plan_enrollments_user on p2p_plan_enrollments(user_id);
create index if not exists idx_p2p_plan_enrollments_plan on p2p_plan_enrollments(plan_id);

alter table p2p_user_goals enable row level security;
alter table p2p_plan_enrollments enable row level security;

drop policy if exists "Users manage their own goals" on p2p_user_goals;
create policy "Users manage their own goals"
  on p2p_user_goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own enrollments" on p2p_plan_enrollments;
create policy "Users manage their own enrollments"
  on p2p_plan_enrollments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
