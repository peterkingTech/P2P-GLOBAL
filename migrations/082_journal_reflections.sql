-- My Discipleship Journal — longitudinal reflections.
-- root_id lets "the whole chain, oldest first" be a single indexed lookup
-- instead of a recursive parent walk: self for an original, the original's
-- own id for every update in that chain.
create table if not exists p2p_journal_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references p2p_profiles(id) on delete cascade,
  root_id uuid not null,
  parent_id uuid references p2p_journal_reflections(id) on delete cascade,
  prompt text,
  content text not null,
  linked_lesson_id uuid references p2p_lessons(id) on delete set null,
  linked_scripture_reference text,
  linked_session_id uuid references p2p_sessions(id) on delete set null,
  linked_relationship_id uuid references p2p_discipleship_links(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists p2p_journal_reflections_user_id_idx on p2p_journal_reflections(user_id);
create index if not exists p2p_journal_reflections_root_id_idx on p2p_journal_reflections(root_id);

alter table p2p_journal_reflections enable row level security;

-- Same owner-only ALL policy as p2p_prayer_journal (migration 045) — the
-- other private Journal-adjacent table already using this exact pattern.
create policy "Users manage their own reflections" on p2p_journal_reflections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);