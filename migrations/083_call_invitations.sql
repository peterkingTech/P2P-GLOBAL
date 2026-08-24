-- Study Together C2 — Add People + Invitations.
create table if not exists p2p_call_invitations (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references p2p_call_logs(id) on delete cascade,
  inviter_id uuid not null references p2p_profiles(id) on delete cascade,
  invitee_id uuid not null references p2p_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index if not exists p2p_call_invitations_call_id_idx on p2p_call_invitations(call_id);
create index if not exists p2p_call_invitations_invitee_status_idx on p2p_call_invitations(invitee_id, status);

alter table p2p_call_invitations enable row level security;

create policy "Participants can read their own invitations" on p2p_call_invitations
  for select using (auth.uid() = invitee_id or auth.uid() = inviter_id);
-- No INSERT/UPDATE/DELETE policy — writes are service-role only, via the
-- Express endpoints and the two functions below, which independently
-- verify the caller's real identity from their Supabase access token
-- (never a client-supplied body param). Matches p2p_call_logs' existing
-- service-role-only write pattern (migration audit, C1).

-- Reuses the existing incoming-call delivery mechanism (p2p_incoming_calls
-- + its realtime subscription + call/incoming.tsx) instead of building a
-- second notification system — this column links a ringing row back to
-- the invitation that created it, nullable because ordinary 1:1 calls
-- never set it.
alter table p2p_incoming_calls add column if not exists invitation_id uuid references p2p_call_invitations(id) on delete set null;

-- Atomically creates a pending invitation. Locks the call row so two
-- concurrent invitations for the same call can't both authorize a slot
-- beyond the 6-participant cap — a pending invitation reserves a slot,
-- not just current participants, closing the race window between
-- "N people already in" and "N invitations also in flight."
create or replace function p2p_create_call_invitation(p_call_id uuid, p_inviter_id uuid, p_invitee_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_call record;
  v_pending_count int;
  v_new_id uuid;
begin
  select * into v_call from p2p_call_logs where id = p_call_id for update;
  if v_call.id is null then raise exception 'call_not_found'; end if;
  if v_call.status <> 'initiated' then raise exception 'call_ended'; end if;
  if not (v_call.participants @> to_jsonb(p_inviter_id::text)) then raise exception 'not_participant'; end if;
  if v_call.participants @> to_jsonb(p_invitee_id::text) then raise exception 'already_in_call'; end if;

  if exists (
    select 1 from p2p_call_invitations
    where call_id = p_call_id and invitee_id = p_invitee_id and status = 'pending' and expires_at > now()
  ) then
    raise exception 'invitation_pending';
  end if;

  select count(*) into v_pending_count from p2p_call_invitations
    where call_id = p_call_id and status = 'pending' and expires_at > now();
  if jsonb_array_length(v_call.participants) + v_pending_count >= 6 then
    raise exception 'call_full';
  end if;

  insert into p2p_call_invitations (call_id, inviter_id, invitee_id, status, expires_at)
  values (p_call_id, p_inviter_id, p_invitee_id, 'pending', now() + interval '10 minutes')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Atomically accepts a pending invitation: re-verifies capacity a second
-- time (independent of the invite-time reservation above) and appends the
-- invitee to the call's authorized participants inside the same locked
-- transaction, so two people accepting near-simultaneously can't both
-- push the call past 6. The inviter's continued presence is deliberately
-- never checked here — an invitation belongs to the call, not to whoever
-- sent it (spec: "the call remains authoritative").
create or replace function p2p_accept_call_invitation(p_invitation_id uuid, p_invitee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv record;
  v_call record;
begin
  select * into v_inv from p2p_call_invitations where id = p_invitation_id for update;
  if v_inv.id is null then raise exception 'invitation_not_found'; end if;
  if v_inv.invitee_id <> p_invitee_id then raise exception 'not_your_invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation_already_used'; end if;
  if v_inv.expires_at <= now() then
    update p2p_call_invitations set status = 'expired' where id = p_invitation_id;
    raise exception 'invitation_expired';
  end if;

  select * into v_call from p2p_call_logs where id = v_inv.call_id for update;
  if v_call.id is null or v_call.status <> 'initiated' then
    update p2p_call_invitations set status = 'expired' where id = p_invitation_id;
    raise exception 'call_ended';
  end if;

  if v_call.participants @> to_jsonb(p_invitee_id::text) then
    update p2p_call_invitations set status = 'accepted', responded_at = now() where id = p_invitation_id;
    return jsonb_build_object('channelName', v_call.channel_name, 'callLogId', v_call.id, 'callType', v_call.call_type, 'conversationId', v_call.conversation_id);
  end if;

  if jsonb_array_length(v_call.participants) >= 6 then
    raise exception 'call_full';
  end if;

  update p2p_call_logs set participants = v_call.participants || to_jsonb(p_invitee_id::text) where id = v_call.id;
  update p2p_call_invitations set status = 'accepted', responded_at = now() where id = p_invitation_id;

  return jsonb_build_object('channelName', v_call.channel_name, 'callLogId', v_call.id, 'callType', v_call.call_type, 'conversationId', v_call.conversation_id);
end;
$$;