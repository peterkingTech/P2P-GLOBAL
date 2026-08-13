-- 066: Grain invitation system — invite someone, they register with your
-- link, you earn 1 Grain. That's the whole feature.
--
-- Deviations from the original spec, and why:
--   * No separate `invite_code` random-suffix generation, and no "standing,
--     unbound" p2p_invitations row created ahead of time — a user's invite
--     code IS their @username, which migration 064 already guarantees is
--     unique (unique index on lower(username)). The spec's own redeem step
--     ("insert a NEW row" on every registration, never updating the standing
--     one) already makes that pre-created row pure dead weight: nothing
--     ever reads or updates it. Computing the link/code live from the
--     CURRENT username at request time, instead of persisting it, also
--     sidesteps a real staleness bug — usernames can change every 90 days
--     (migration 064), so a stored invite_link would silently start
--     pointing at someone's old handle.
--   * No `invite_link` column — same reasoning; the API builds it on
--     request from the current username.
--   * No `status` column — every row in this simplified table IS a
--     completed registration by construction, so there's no 'pending'
--     state left to track.
--   * `invited_user_id` is NOT NULL with a UNIQUE constraint — one
--     redemption per new user, enforced at the DB level (defense in depth
--     behind the app-level check in POST /profiles/invite/redeem).
--   * No client-facing INSERT policy — same reasoning as
--     p2p_username_history in migration 064: redemption is a server
--     decision (grain is real currency-like state), not something a client
--     should be able to forge via a direct PostgREST insert.

alter table p2p_profiles
  add column if not exists grain_count integer not null default 0;

create table if not exists p2p_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null, -- inviter's username at redemption time, kept for audit
  registered_at timestamptz not null default now(),
  unique (invited_user_id),
  constraint no_self_referral check (inviter_id != invited_user_id)
);

create index if not exists idx_invitations_inviter on p2p_invitations(inviter_id);

alter table p2p_invitations enable row level security;

drop policy if exists "Users see own invitations sent" on p2p_invitations;
create policy "Users see own invitations sent" on p2p_invitations
  for select using (auth.uid() = inviter_id);