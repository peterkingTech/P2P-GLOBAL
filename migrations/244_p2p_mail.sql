-- 244 — P2P Mail: internal official correspondence, separate from chat. Written 2026-11-10.
-- NOT APPLIED. Additive: new tables only; no existing table, row or policy is changed.
--
-- P2P Mail is P2P Global's own correspondence system (not e-mail): threads with a subject, an inbox,
-- sent items, drafts and an archive. It is a separate data model from chat — nothing here is a
-- p2p_messages row, and nothing in chat becomes mail.
--
--   p2p_mail_threads       one correspondence: subject, who started it, whether it is OFFICIAL and in
--                          whose name (P2P Global, a Church, a Family) — official_scope/_id.
--   p2p_mail_messages      the letters of a thread (original, replies, forwards). Immutable once sent.
--   p2p_mail_participants  each person's mailbox entry for a thread: read up to, archived, removed.
--                          Access to a thread = a row here (the API checks it on every request).
--   p2p_mail_drafts        unsent mail, visible only to its author.
--   p2p_mail_events        append-only audit (sent, read, archived, forwarded …) without mail bodies.
--
-- Security: API-ONLY. Row level security is on with NO client policies and no client grants — the
-- phone app can't read or write these tables directly (no guessing ids, no forged senders); the API
-- (service role) checks the caller is a participant / the draft's author / authorised to send
-- officially in that scope on every request. Rollback: drop the five tables (no other object uses them).

create table if not exists public.p2p_mail_threads (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  is_official boolean not null default false,
  official_scope text check (official_scope in ('p2p', 'church', 'family')),
  official_scope_id uuid,
  constraint p2p_mail_official_scope check (
    (is_official and official_scope is not null and (official_scope = 'p2p' or official_scope_id is not null))
    or (not is_official and official_scope is null and official_scope_id is null))
);

create table if not exists public.p2p_mail_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.p2p_mail_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 20000),
  kind text not null default 'original' check (kind in ('original', 'reply', 'forward')),
  reply_to_id uuid references public.p2p_mail_messages(id) on delete set null,
  forwarded_from_id uuid references public.p2p_mail_messages(id) on delete set null,
  is_official boolean not null default false,
  -- Attachments already stored by the existing secure upload flow (paths only, never public URLs).
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  sent_at timestamptz not null default now()
);
create index if not exists idx_p2p_mail_messages_thread on public.p2p_mail_messages (thread_id, sent_at);

create table if not exists public.p2p_mail_participants (
  thread_id uuid not null references public.p2p_mail_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('sender', 'recipient')),
  added_at timestamptz not null default now(),
  last_read_at timestamptz,
  archived_at timestamptz,
  removed_at timestamptz,
  primary key (thread_id, user_id)
);
create index if not exists idx_p2p_mail_participants_user on public.p2p_mail_participants (user_id, archived_at);

create table if not exists public.p2p_mail_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.p2p_mail_threads(id) on delete cascade,
  to_user_ids uuid[] not null default '{}',
  subject text not null default '' check (length(subject) <= 200),
  body text not null default '' check (length(body) <= 20000),
  reply_to_id uuid references public.p2p_mail_messages(id) on delete set null,
  forwarded_from_id uuid references public.p2p_mail_messages(id) on delete set null,
  official_scope text check (official_scope in ('p2p', 'church', 'family')),
  official_scope_id uuid,
  updated_at timestamptz not null default now()
);
create index if not exists idx_p2p_mail_drafts_owner on public.p2p_mail_drafts (owner_id, updated_at desc);

create table if not exists public.p2p_mail_events (
  id bigint generated always as identity primary key,
  thread_id uuid references public.p2p_mail_threads(id) on delete cascade,
  message_id uuid references public.p2p_mail_messages(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event text not null check (event in ('sent', 'replied', 'forwarded', 'read', 'archived', 'unarchived', 'removed', 'official_sent')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_p2p_mail_events_thread on public.p2p_mail_events (thread_id, created_at);

-- Letters are immutable once sent; the audit log is append-only.
create or replace function public.p2p_mail_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'P2P Mail % cannot be changed or deleted once written', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_mail_messages_immutable on public.p2p_mail_messages;
create trigger trg_p2p_mail_messages_immutable before update or delete on public.p2p_mail_messages
  for each row when (pg_trigger_depth() = 0) execute function public.p2p_mail_immutable();
drop trigger if exists trg_p2p_mail_events_append_only on public.p2p_mail_events;
create trigger trg_p2p_mail_events_append_only before update or delete on public.p2p_mail_events
  for each row execute function public.p2p_mail_immutable();
-- (A thread's own deletion cascades to its letters — only the service role could do that.)

alter table public.p2p_mail_threads enable row level security;
alter table public.p2p_mail_messages enable row level security;
alter table public.p2p_mail_participants enable row level security;
alter table public.p2p_mail_drafts enable row level security;
alter table public.p2p_mail_events enable row level security;
revoke all on public.p2p_mail_threads, public.p2p_mail_messages, public.p2p_mail_participants, public.p2p_mail_drafts, public.p2p_mail_events from anon, authenticated;
revoke all on function public.p2p_mail_immutable() from public, anon, authenticated;
grant select, insert, update, delete on public.p2p_mail_threads, public.p2p_mail_messages, public.p2p_mail_participants, public.p2p_mail_drafts, public.p2p_mail_events to service_role;

do $$ begin raise notice 'P2P_MAIL_244: P2P Mail tables ready (API-only)'; end $$;
