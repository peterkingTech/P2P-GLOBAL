-- 238 (Phase 5a — administrative identity, approved by the owner 2026-11-04;
-- restore-tested; applied only with the guarded production procedure).
-- ADDITIVE: four API-only tables + one helper. Nobody's access changes here:
-- today's admins keep signing in exactly as now. The API accepts the new
-- admin session alongside the current role check, and only requires it once
-- the owner switches ADMIN_SESSIONS_REQUIRED on (environment, not this file).
--
--   • p2p_admin_accounts: the administrative identity, separate from the peer
--     profile. A person may have both, as two separate identities; nothing
--     merges them because an email matches. Today's 8 admins are recorded as
--     'legacy_shared' (their admin access still rides on their peer account)
--     until each moves to an 'admin_only' login of their own (5b);
--   • p2p_admin_sessions: server-side admin sessions — started only right
--     after a fresh sign-in, expiring (idle and absolute), revocable, ended on
--     logout. The token is stored only as a hash;
--   • p2p_admin_role_permissions: least privilege — each admin role gets an
--     explicit list of permissions (super_admin: all);
--   • p2p_admin_audit: one append-only record of sensitive admin actions
--     (who, which role, what, when, on what, why). It can never be edited or
--     deleted, by anyone. The older p2p_admin_activity_log (6 rows) and
--     p2p_audit_logs (0 rows) are kept untouched.
-- MFA: required for admin_only identities (Supabase Auth's own second factor,
-- checked as "aal2" in the session token). Not yet required for the 8 legacy
-- accounts — none has a second factor enrolled, so requiring it would lock
-- them out (owner decision, after enrolment).

begin;

create table if not exists public.p2p_admin_accounts (
  auth_user_id   uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null,
  roles          text[] not null check (cardinality(roles) >= 1),
  status         text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  identity_kind  text not null default 'admin_only' check (identity_kind in ('admin_only', 'legacy_shared')),
  mfa_required   boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  status_reason  text,
  status_changed_by uuid references auth.users(id) on delete set null,
  last_session_at timestamptz
);

create table if not exists public.p2p_admin_sessions (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references public.p2p_admin_accounts(auth_user_id) on delete cascade,
  token_hash    text not null unique,
  aal           text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '12 hours',
  idle_minutes  integer not null default 120 check (idle_minutes between 5 and 720),
  ended_at      timestamptz,
  end_reason    text,
  ended_by      uuid references auth.users(id) on delete set null,
  user_agent    text
);
create index if not exists idx_p2p_admin_sessions_user on public.p2p_admin_sessions (auth_user_id, created_at desc);

create table if not exists public.p2p_admin_role_permissions (
  role       text not null,
  permission text not null,
  primary key (role, permission)
);

create table if not exists public.p2p_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  admin_user_id uuid,
  admin_role    text,
  session_id    uuid,
  action        text not null,
  target_type   text,
  target_id     text,
  reason        text,
  detail        jsonb not null default '{}'::jsonb
);
create index if not exists idx_p2p_admin_audit_at on public.p2p_admin_audit (at desc);
create index if not exists idx_p2p_admin_audit_admin on public.p2p_admin_audit (admin_user_id, at desc);

-- Append-only, for everyone (the service role included).
create or replace function public.p2p_admin_audit_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'P2P_AUDIT: the admin audit record can''t be changed or deleted' using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_admin_audit_append_only on public.p2p_admin_audit;
create trigger trg_p2p_admin_audit_append_only before update or delete on public.p2p_admin_audit
  for each row execute function public.p2p_admin_audit_append_only();
revoke truncate on public.p2p_admin_audit from public, anon, authenticated, service_role;

-- ── Least privilege: explicit permissions per role ──────────────────────────
insert into public.p2p_admin_role_permissions (role, permission)
select r, p from (values
  ('admin_supervisor', array['dashboard.view','people.view','communities.view','discipleship.view','genealogy.aggregate','growth.view','learning.view','evaluations.oversee','content.view','moderation.manage','help.manage','admins.view','audit.view','platform.health']),
  ('regional_admin',   array['dashboard.view','people.view','communities.view','discipleship.view','genealogy.aggregate','growth.view','learning.view','content.manage','moderation.manage','help.manage','registrations.manage','verification.manage','usernames.manage','translations.manage']),
  ('church_leader',    array['dashboard.view','communities.view','content.manage','moderation.manage','help.manage','registrations.manage','verification.manage','usernames.manage','translations.manage']),
  ('moderator',        array['dashboard.view','moderation.manage','help.manage','verification.manage','usernames.manage']),
  ('peer_guide',       array['dashboard.view','content.manage','help.manage','translations.manage']),
  ('admin_content',    array['dashboard.view','content.view','content.manage','content.publish','learning.view']),
  ('admin_translation',array['dashboard.view','translations.manage']),
  ('admin_moderation', array['dashboard.view','moderation.manage']),
  ('admin_verification', array['dashboard.view','verification.manage']),
  ('admin_help',       array['dashboard.view','help.manage','mail.send']),
  ('admin_username',   array['dashboard.view','usernames.manage']),
  ('admin_marketing',  array['dashboard.view','mail.send','content.view']),
  ('admin_church',     array['dashboard.view','communities.view','registrations.manage']),
  ('admin_zone',       array['dashboard.view','people.view','communities.view','discipleship.view','genealogy.aggregate']),
  ('admin_national',   array['dashboard.view','people.view','communities.view','discipleship.view','genealogy.aggregate']),
  ('admin_finance',    array['dashboard.view'])
) v(r, ps), unnest(ps) p
on conflict do nothing;
-- super_admin: every permission there is (kept complete by p2p_admin_permissions_for below).

create or replace function public.p2p_admin_permissions_for(p_user uuid) returns text[]
  language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from p2p_admin_accounts a where a.auth_user_id = p_user and a.status = 'active') then array[]::text[]
    when exists (select 1 from p2p_admin_accounts a where a.auth_user_id = p_user and a.status = 'active' and 'super_admin' = any(a.roles))
      then (select array_agg(distinct permission order by permission) from (
              select permission from p2p_admin_role_permissions
              union select unnest(array['admins.manage','permissions.manage','audit.view','growth.approve_matrix','growth.correct','genealogy.correct','genealogy.view_named','platform.settings','platform.health','people.manage'])) all_p)
    else coalesce((select array_agg(distinct rp.permission order by rp.permission)
                     from p2p_admin_accounts a join p2p_admin_role_permissions rp on rp.role = any(a.roles)
                    where a.auth_user_id = p_user and a.status = 'active'), array[]::text[])
  end;
$$;

-- ── Today's admins, recorded as legacy shared identities (access unchanged) ──
insert into public.p2p_admin_accounts (auth_user_id, display_name, roles, status, identity_kind, mfa_required, created_at)
select p.id, coalesce(nullif(trim(p.full_name), ''), p.username, 'Administrator'), array[p.role::text], 'active', 'legacy_shared', false, now()
  from public.p2p_profiles p
 where p.role::text in ('super_admin', 'admin_supervisor', 'admin_zone', 'admin_national', 'admin_content', 'admin_translation', 'admin_moderation',
                        'admin_verification', 'admin_help', 'admin_username', 'admin_finance', 'admin_marketing', 'admin_church',
                        'regional_admin', 'moderator', 'church_leader')
   and exists (select 1 from auth.users u where u.id = p.id)
on conflict (auth_user_id) do nothing;

insert into public.p2p_admin_audit (action, target_type, reason, detail)
select 'admin_identity.legacy_recorded', 'admin_accounts', 'Migration 238: existing administrators recorded as legacy shared identities (access unchanged)',
       jsonb_build_object('accounts', (select count(*) from public.p2p_admin_accounts where identity_kind = 'legacy_shared'))
 where not exists (select 1 from public.p2p_admin_audit where action = 'admin_identity.legacy_recorded');

-- ── API-only ────────────────────────────────────────────────────────────────
alter table public.p2p_admin_accounts enable row level security;
alter table public.p2p_admin_sessions enable row level security;
alter table public.p2p_admin_role_permissions enable row level security;
alter table public.p2p_admin_audit enable row level security;
revoke all on public.p2p_admin_accounts, public.p2p_admin_sessions, public.p2p_admin_role_permissions, public.p2p_admin_audit from anon, authenticated;
grant select, insert, update on public.p2p_admin_accounts, public.p2p_admin_sessions to service_role;
grant select, insert, update, delete on public.p2p_admin_role_permissions to service_role;
grant select, insert on public.p2p_admin_audit to service_role;
revoke execute on function public.p2p_admin_permissions_for(uuid), public.p2p_admin_audit_append_only() from public, anon, authenticated;
grant execute on function public.p2p_admin_permissions_for(uuid) to service_role;

commit;

-- Rollback (nothing else depends on these until the API uses them):
--   drop table p2p_admin_sessions, p2p_admin_role_permissions, p2p_admin_accounts; drop function p2p_admin_permissions_for(uuid);
--   p2p_admin_audit is kept (append-only by design).
