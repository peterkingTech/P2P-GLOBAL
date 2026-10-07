-- 173: Account status — foundation for reversible deactivation ("take a
-- break") and, later, scheduled deletion.
--
-- Additive only: one new table. No existing table, row, policy or grant
-- changes. A user with no row here is "active", so every existing account
-- keeps behaving exactly as before.
--
-- Why a separate table and not columns on p2p_profiles: p2p_profiles'
-- "Users can update own profile" policy lets the app write any column of the
-- user's own row. Status there could be flipped from the client, skipping the
-- server's checks (active call, leadership). Here, users may only READ their
-- own row; every write goes through the API (service role) after
-- verifyCaller() and those checks.
--
-- Why not p2p_profiles.elijah_rest_until: that field is the pastoral-care
-- "rest" preference (pauses Elijah Protocol nudges only), it has no
-- "indefinitely" value, and overloading it would change what existing
-- pastoral-care code means by it.

create table if not exists public.p2p_account_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'deactivated', 'deletion_scheduled', 'deleted')),
  -- When the current break started; null unless status = 'deactivated'.
  deactivated_at timestamptz,
  -- End of a scheduled break; null = "until I reactivate" (indefinite).
  -- A break whose deactivated_until has passed is treated as active.
  deactivated_until timestamptz,
  reactivated_at timestamptz,
  -- Reserved for Stage 2 (scheduled deletion); unused in Stage 1.
  deletion_scheduled_for timestamptz,
  updated_at timestamptz not null default now(),
  constraint p2p_account_status_deactivated_has_start
    check (status <> 'deactivated' or deactivated_at is not null),
  constraint p2p_account_status_until_after_start
    check (deactivated_until is null or deactivated_at is null or deactivated_until > deactivated_at)
);

comment on table public.p2p_account_status is
  'Account lifecycle (active / deactivated / deletion_scheduled / deleted). No row = active. Written only by the API (service role).';

-- The push dispatcher and pastoral-care scan look up non-active users only.
create index if not exists p2p_account_status_not_active_idx
  on public.p2p_account_status (status)
  where status <> 'active';

alter table public.p2p_account_status enable row level security;

-- Read own status only. No insert/update/delete policy: with RLS enabled,
-- clients (anon/authenticated) cannot write; the service role (API) can.
drop policy if exists "Users can read own account status" on public.p2p_account_status;
create policy "Users can read own account status"
  on public.p2p_account_status
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Defence in depth on top of RLS: clients get read access only.
revoke all on public.p2p_account_status from anon;
revoke insert, update, delete, truncate, references, trigger on public.p2p_account_status from authenticated;
grant select on public.p2p_account_status to authenticated;
