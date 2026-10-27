-- Study Together — shared (asynchronous) study of a Kingdom Story or a
-- Kingdom School lesson, alone or with a peer / Family Circle / Church /
-- Circle / Group.
--
-- WHY NEW TABLES (and not p2p_study_sessions, migration 084): that table is
-- the LIVE in-call study — every row belongs to a call (call_log_id NOT NULL),
-- one active per call, leader moves the section in real time. A shared study
-- here outlives any call: people read at different times, answer prompts
-- when they can, and may never call at all. Loosening 084's NOT NULLs would
-- change the contract the live overlay depends on, so the live system stays
-- exactly as it is and this sits beside it. The two meet through the
-- existing call/messaging shortcuts on the shared-study screen.
--
-- Privacy:
--   * Nothing here reads or copies anyone's private progress, answers,
--     journal or reflections. Each person keeps their own reading position
--     and completion in the existing per-user tables.
--   * p2p_shared_study_responses holds ONLY what a participant explicitly
--     posts to the study, and they can remove it.
-- Access: RLS on, no client policies — every read and write goes through the
-- API (service role), which verifies the caller from their token and checks
-- invitation / group membership / leadership / blocks on every request.
-- Additive only: new tables, no change to existing rows.

create table if not exists public.p2p_shared_studies (
  id                 uuid primary key default gen_random_uuid(),
  content_type       text not null check (content_type in ('kingdom_story', 'lesson')),
  content_id         uuid not null,
  title              text not null default '' check (char_length(title) <= 300),
  host_id            uuid not null references public.p2p_profiles(id) on delete cascade,
  destination_type   text not null check (destination_type in ('peer', 'family', 'church', 'circle', 'group')),
  -- The family / church / circle / group id; null for a peer study.
  destination_id     uuid,
  -- Shared reading position (a chapter of the story); null = not set.
  current_section_id uuid,
  status             text not null default 'active' check (status in ('active', 'concluded')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  concluded_at       timestamptz,
  check ((destination_type = 'peer') = (destination_id is null))
);
-- One active group study of the same content per group: a second leader
-- starting it opens the existing one instead of a duplicate.
create unique index if not exists p2p_shared_studies_one_active_group
  on public.p2p_shared_studies (destination_type, destination_id, content_type, content_id)
  where status = 'active' and destination_id is not null;
create index if not exists p2p_shared_studies_host_idx on public.p2p_shared_studies (host_id, status);
create index if not exists p2p_shared_studies_dest_idx on public.p2p_shared_studies (destination_type, destination_id, status);

create table if not exists public.p2p_shared_study_members (
  id            uuid primary key default gen_random_uuid(),
  study_id      uuid not null references public.p2p_shared_studies(id) on delete cascade,
  user_id       uuid not null references public.p2p_profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('host', 'member')),
  -- Peer invitations: pending → accepted / declined / cancelled / expired.
  -- Group members join by opening the study (accepted). Anyone may leave.
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'left')),
  invited_by    uuid references public.p2p_profiles(id) on delete set null,
  invited_at    timestamptz not null default now(),
  responded_at  timestamptz,
  expires_at    timestamptz,
  last_opened_at timestamptz,
  unique (study_id, user_id)
);
create index if not exists p2p_shared_study_members_user_idx on public.p2p_shared_study_members (user_id, status);

-- Discussion prompts a host / leader adds (the chapter's own reflection
-- questions are shown alongside, read from the chapter — not copied here).
create table if not exists public.p2p_shared_study_prompts (
  id          uuid primary key default gen_random_uuid(),
  study_id    uuid not null references public.p2p_shared_studies(id) on delete cascade,
  section_id  uuid,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_by  uuid references public.p2p_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists p2p_shared_study_prompts_study_idx on public.p2p_shared_study_prompts (study_id, created_at);

-- Shared responses: only what a participant chooses to post to the group.
create table if not exists public.p2p_shared_study_responses (
  id          uuid primary key default gen_random_uuid(),
  study_id    uuid not null references public.p2p_shared_studies(id) on delete cascade,
  prompt_id   uuid references public.p2p_shared_study_prompts(id) on delete cascade,
  -- A chapter reflection question is identified by chapter + its position.
  section_id  uuid,
  question_index smallint check (question_index is null or question_index between 0 and 20),
  user_id     uuid not null references public.p2p_profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists p2p_shared_study_responses_study_idx on public.p2p_shared_study_responses (study_id, created_at);

alter table public.p2p_shared_studies enable row level security;
alter table public.p2p_shared_study_members enable row level security;
alter table public.p2p_shared_study_prompts enable row level security;
alter table public.p2p_shared_study_responses enable row level security;

revoke all on public.p2p_shared_studies, public.p2p_shared_study_members,
  public.p2p_shared_study_prompts, public.p2p_shared_study_responses from anon, authenticated;
grant all on public.p2p_shared_studies, public.p2p_shared_study_members,
  public.p2p_shared_study_prompts, public.p2p_shared_study_responses to service_role;
