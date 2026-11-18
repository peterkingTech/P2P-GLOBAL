-- 255 — Admin Centre notifications (all modules).
-- Written 2026-11-18. APPLIED TO PRODUCTION 2026-11-18 (owner approval; guarded apply: in-transaction checks + postcheck PASS).
-- ADDITIVE ONLY: four new tables; no existing table, row or policy changes. Until applied, the API keeps
-- notifications in memory (they are rebuilt from the modules' own records every minute; read state is lost on restart
-- and the Admin Centre says so).
--
--   p2p_admin_notifications        one row per event/state (unique dedupe_key = module:type:record:state), updated in
--                                  place (counts, reminders), resolved when the underlying item is handled. Titles and
--                                  descriptions never contain message bodies, prayer requests or crisis details.
--   p2p_admin_notification_reads   each administrator's own read / action-taken / archived state (reading never
--                                  resolves the underlying item).
--   p2p_admin_notification_prefs   each administrator's categories and sound (security + crisis are mandatory: the
--                                  API always keeps them on).
--   p2p_admin_notification_signals realtime signal only (notification id, module, time — NO text). The Admin Centre
--                                  listens to inserts and then refetches through the permission-checked API.
--
-- Security: the first three are API-only (RLS on, no client policies, no anon/authenticated grants). The signals
-- table is readable by ACTIVE administrators only (RLS), insert by the API only; it carries no content.

begin;

create table if not exists public.p2p_admin_notifications (
  id                 uuid primary key,
  dedupe_key         text not null unique,
  module             text not null,
  type               text not null,
  record_type        text not null,
  record_id          text not null,
  state              text not null,
  priority           text not null check (priority in ('critical', 'high', 'normal', 'info')),
  category           text not null check (category in ('new_submissions', 'reviews', 'assigned', 'overdue', 'system', 'security', 'crisis')),
  action_required    boolean not null default true,
  title              text not null,
  description        text not null default '',
  route              text not null,
  params             jsonb not null default '{}'::jsonb,
  actor_label        text,
  assigned_to        uuid references auth.users(id) on delete set null,
  occurred_at        timestamptz not null,
  due_at             timestamptz,
  item_count         integer,
  remind_every_hours integer,
  status             text not null default 'open' check (status in ('open', 'resolved', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  reminded_at        timestamptz,
  reminder_count     integer not null default 0
);
create index if not exists p2p_admin_notifications_open on public.p2p_admin_notifications (status, module, occurred_at desc);
create index if not exists p2p_admin_notifications_assigned on public.p2p_admin_notifications (assigned_to) where assigned_to is not null;

create table if not exists public.p2p_admin_notification_reads (
  notification_id  uuid not null references public.p2p_admin_notifications(id) on delete cascade,
  admin_user_id    uuid not null references auth.users(id) on delete cascade,
  read_at          timestamptz,
  action_at        timestamptz,
  archived_at      timestamptz,
  primary key (notification_id, admin_user_id)
);
create index if not exists p2p_admin_notification_reads_admin on public.p2p_admin_notification_reads (admin_user_id);

create table if not exists public.p2p_admin_notification_prefs (
  admin_user_id  uuid primary key references auth.users(id) on delete cascade,
  prefs          jsonb not null default '{}'::jsonb check (pg_column_size(prefs) < 8192),
  updated_at     timestamptz not null default now()
);

create table if not exists public.p2p_admin_notification_signals (
  id               bigint generated always as identity primary key,
  notification_id  uuid not null,
  module           text not null,
  created_at       timestamptz not null default now()
);
create index if not exists p2p_admin_notification_signals_time on public.p2p_admin_notification_signals (created_at);

alter table public.p2p_admin_notifications enable row level security;
alter table public.p2p_admin_notification_reads enable row level security;
alter table public.p2p_admin_notification_prefs enable row level security;
alter table public.p2p_admin_notification_signals enable row level security;
do $$ declare t text; begin
  foreach t in array array['p2p_admin_notifications', 'p2p_admin_notification_reads', 'p2p_admin_notification_prefs', 'p2p_admin_notification_signals'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant select, insert, update, delete on public.%I to service_role', t); end if;
  end loop;
end $$;
-- Signals: readable by active administrators only (no content in them).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant select on public.p2p_admin_notification_signals to authenticated'; end if;
end $$;
drop policy if exists p2p_admin_notification_signals_admins on public.p2p_admin_notification_signals;
create policy p2p_admin_notification_signals_admins on public.p2p_admin_notification_signals for select to authenticated
  using (exists (select 1 from public.p2p_admin_accounts a where a.auth_user_id = auth.uid() and a.status = 'active')
      or exists (select 1 from public.p2p_profiles p where p.id = auth.uid() and p.role in ('peer_guide', 'church_leader', 'regional_admin', 'moderator', 'super_admin',
        'admin_supervisor', 'admin_zone', 'admin_national', 'admin_content', 'admin_translation', 'admin_moderation', 'admin_verification', 'admin_help', 'admin_username',
        'admin_finance', 'admin_marketing', 'admin_church')));
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'p2p_admin_notification_signals') then
    execute 'alter publication supabase_realtime add table public.p2p_admin_notification_signals';
  end if;
end $$;

commit;
