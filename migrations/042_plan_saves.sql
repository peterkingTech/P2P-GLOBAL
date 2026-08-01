-- 042: Bookmarked ("saved") plans.
--
-- Pulled forward from the Prompt 3 spec ("PROMPT 3 — Pre-Plan Goal Setting +
-- Recommendation Engine", migration 042_goals_and_preferences.sql), because
-- Prompt 2 ("Plans Page Full Restructure") needs POST/DELETE
-- /plans/:planId/save and GET /plans/saved/:userId working now, and those
-- genuinely require persistent storage — no existing table tracks bookmarks.
-- p2p_user_goals and p2p_plan_enrollments (the other two tables in that
-- prompt's original migration file) are NOT created here — they land in
-- Prompt 3's actual migration, renumbered to 043 to avoid colliding with
-- this file. This table's schema is copied verbatim from that spec, so
-- Prompt 3's migration does not need to touch it again.
--
-- "Active"/"completed" plans (also asked for in Prompt 2) don't need a new
-- table at all — they're derived from existing p2p_lesson_progress rows via
-- the same percent-complete logic GET /plans/:planId/progress/:userId
-- already uses, so those two read-only endpoints are implemented directly
-- against existing tables.

create table if not exists p2p_plan_saves (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_id    uuid not null,
  saved_at   timestamptz not null default now(),
  unique(user_id, plan_id)
);

create index if not exists idx_p2p_plan_saves_user on p2p_plan_saves(user_id);

alter table p2p_plan_saves enable row level security;

drop policy if exists "Users manage their own saved plans" on p2p_plan_saves;
create policy "Users manage their own saved plans"
  on p2p_plan_saves
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
