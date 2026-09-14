-- 143: "Pray the Word" Stage 3 — Prayer Paths.
--
-- A Prayer Path is a curated, ORDERED sequence of existing
-- p2p_scripture_references rows (142) — never a duplicate copy of a
-- Scripture, never Bible-replacement "courses", never AI-generated. Each
-- step optionally carries its own reflect/pray/respond prompt override;
-- when absent, the UI falls back to the generic Pray the Word prompts
-- ("What does this Scripture reveal about God?" / etc.) rather than
-- requiring every step to repeat the same boilerplate text.
--
-- Personal progress is ONE row per (user, path) — updated in place as the
-- user advances, never inserted per step and never per keystroke, per the
-- "avoid per-tap database writes, no gamified streak system" instruction.
-- "Completed" means "reached the end of the path," nothing more — there is
-- deliberately no points/streak/badge field anywhere in this table.

create table if not exists p2p_prayer_paths (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  title               text not null,
  description         text,
  topic_id            uuid references p2p_prayer_topics(id) on delete set null,
  estimated_minutes   integer check (estimated_minutes is null or estimated_minutes > 0),
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  display_order       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_p2p_prayer_paths_published on p2p_prayer_paths(status, display_order) where status = 'published';
create index if not exists idx_p2p_prayer_paths_topic on p2p_prayer_paths(topic_id) where topic_id is not null;

-- No "on delete cascade" from scripture_id: deleting a Scripture reference
-- that is actively used by a published path step is blocked (default NO
-- ACTION), forcing an explicit editorial decision rather than silently
-- breaking a path.
create table if not exists p2p_prayer_path_steps (
  id                uuid primary key default gen_random_uuid(),
  path_id           uuid not null references p2p_prayer_paths(id) on delete cascade,
  scripture_id      uuid not null references p2p_scripture_references(id),
  step_order        integer not null,
  reflect_prompt    text,
  pray_prompt       text,
  respond_prompt    text,
  created_at        timestamptz not null default now(),
  unique (path_id, step_order)
);

create index if not exists idx_p2p_prayer_path_steps_path on p2p_prayer_path_steps(path_id, step_order);

-- One row per (user, path). status='completed' means the user reached the
-- final step — not that the prayer was "answered" and not an achievement.
create table if not exists p2p_prayer_path_progress (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  path_id             uuid not null references p2p_prayer_paths(id) on delete cascade,
  status              text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  current_step_order  integer not null default 1,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  unique (user_id, path_id)
);

create index if not exists idx_p2p_prayer_path_progress_user on p2p_prayer_path_progress(user_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table p2p_prayer_paths enable row level security;
alter table p2p_prayer_path_steps enable row level security;
alter table p2p_prayer_path_progress enable row level security;

drop policy if exists "Published paths are public, drafts are admin-only" on p2p_prayer_paths;
create policy "Published paths are public, drafts are admin-only" on p2p_prayer_paths
  for select using (status = 'published' or p2p_is_admin());
drop policy if exists "Admins create paths" on p2p_prayer_paths;
create policy "Admins create paths" on p2p_prayer_paths
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update paths" on p2p_prayer_paths;
create policy "Admins update paths" on p2p_prayer_paths
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete paths" on p2p_prayer_paths;
create policy "Admins delete paths" on p2p_prayer_paths
  for delete using (p2p_is_admin());

drop policy if exists "Path steps follow path visibility" on p2p_prayer_path_steps;
create policy "Path steps follow path visibility" on p2p_prayer_path_steps
  for select using (
    p2p_is_admin()
    or exists (select 1 from p2p_prayer_paths p where p.id = path_id and p.status = 'published')
  );
drop policy if exists "Admins manage path steps" on p2p_prayer_path_steps;
create policy "Admins manage path steps" on p2p_prayer_path_steps
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update path steps" on p2p_prayer_path_steps;
create policy "Admins update path steps" on p2p_prayer_path_steps
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete path steps" on p2p_prayer_path_steps;
create policy "Admins delete path steps" on p2p_prayer_path_steps
  for delete using (p2p_is_admin());

drop policy if exists "Users manage their own path progress" on p2p_prayer_path_progress;
create policy "Users manage their own path progress" on p2p_prayer_path_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
