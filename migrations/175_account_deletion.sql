-- 175: Permanent account deletion (Stage 2).
--
-- Approved policy (2026-10-07):
--   * 14-day grace period; the user can sign in and cancel during it.
--   * Content the user wrote in shared spaces stays, shown as "Deleted user".
--   * Records involving other people or safety (the other party's call
--     history, support/crisis threads, report records, shared worship/church
--     chat and session history) stay, with the deleted user's identity removed.
--   * Leaders of a family/circle that others are in are blocked until handover.
--
-- 1. FK changes, CASCADE -> SET NULL, for those kept records. Without them,
--    deleting a login would also delete the OTHER person's call history,
--    support threads, report records and shared session history. Each column
--    becomes nullable (null = "deleted account"); no existing row changes.
--    The API code that lists these ids was made null-safe in the same change.
-- 2. p2p_account_deletions: a durable log of every deletion request and each
--    completed step, so a failed run can resume and a finished one is never
--    repeated. Server-only (RLS on, no policies, no client grants).
-- 3. p2p_account_deletion_blockers(uid): read-only reasons deletion must not
--    run (staff, leadership, other people's growth/mentoring/study/prayer
--    records, safeguarding flags, authored content).
-- 4. p2p_purge_account(uid): the whole database part of a deletion in ONE
--    transaction: re-check blockers, remove the user from shared arrays,
--    delete their records that have no FK, delete the profile and the login.
--    Either all of it happens or none of it. Idempotent.
-- Both functions: SECURITY DEFINER, executable by service_role only.

-- 1. Keep other people's records when an account is deleted ---------------
alter table public.p2p_call_logs alter column initiated_by drop not null;
alter table public.p2p_call_logs drop constraint if exists p2p_call_logs_initiated_by_fkey;
alter table public.p2p_call_logs add constraint p2p_call_logs_initiated_by_fkey
  foreign key (initiated_by) references auth.users(id) on delete set null;

alter table public.p2p_incoming_calls alter column caller_id drop not null;
alter table public.p2p_incoming_calls drop constraint if exists p2p_incoming_calls_caller_id_fkey;
alter table public.p2p_incoming_calls add constraint p2p_incoming_calls_caller_id_fkey
  foreign key (caller_id) references auth.users(id) on delete set null;
alter table public.p2p_incoming_calls alter column recipient_id drop not null;
alter table public.p2p_incoming_calls drop constraint if exists p2p_incoming_calls_recipient_id_fkey;
alter table public.p2p_incoming_calls add constraint p2p_incoming_calls_recipient_id_fkey
  foreign key (recipient_id) references auth.users(id) on delete set null;

alter table public.p2p_contact_messages alter column from_user_id drop not null;
alter table public.p2p_contact_messages drop constraint if exists p2p_contact_messages_from_user_id_fkey;
alter table public.p2p_contact_messages add constraint p2p_contact_messages_from_user_id_fkey
  foreign key (from_user_id) references public.p2p_profiles(id) on delete set null;

alter table public.p2p_break_room_flags alter column flagger_id drop not null;
alter table public.p2p_break_room_flags drop constraint if exists p2p_break_room_flags_flagger_id_fkey;
alter table public.p2p_break_room_flags add constraint p2p_break_room_flags_flagger_id_fkey
  foreign key (flagger_id) references auth.users(id) on delete set null;

alter table public.p2p_family_worship_sessions alter column host_id drop not null;
alter table public.p2p_family_worship_sessions drop constraint if exists p2p_family_worship_sessions_host_id_fkey;
alter table public.p2p_family_worship_sessions add constraint p2p_family_worship_sessions_host_id_fkey
  foreign key (host_id) references auth.users(id) on delete set null;

alter table public.p2p_break_rooms alter column host_id drop not null;
alter table public.p2p_break_rooms drop constraint if exists p2p_break_rooms_host_id_fkey;
alter table public.p2p_break_rooms add constraint p2p_break_rooms_host_id_fkey
  foreign key (host_id) references auth.users(id) on delete set null;

alter table public.p2p_family_worship_messages alter column user_id drop not null;
alter table public.p2p_family_worship_messages drop constraint if exists p2p_family_worship_messages_user_id_fkey;
alter table public.p2p_family_worship_messages add constraint p2p_family_worship_messages_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.p2p_family_worship_notes alter column author_id drop not null;
alter table public.p2p_family_worship_notes drop constraint if exists p2p_family_worship_notes_author_id_fkey;
alter table public.p2p_family_worship_notes add constraint p2p_family_worship_notes_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;

alter table public.p2p_church_call_messages alter column user_id drop not null;
alter table public.p2p_church_call_messages drop constraint if exists p2p_church_call_messages_user_id_fkey;
alter table public.p2p_church_call_messages add constraint p2p_church_call_messages_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.p2p_church_call_notes alter column author_id drop not null;
alter table public.p2p_church_call_notes drop constraint if exists p2p_church_call_notes_author_id_fkey;
alter table public.p2p_church_call_notes add constraint p2p_church_call_notes_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;

-- 2. Deletion log -----------------------------------------------------------
create table if not exists public.p2p_account_deletions (
  id uuid primary key default gen_random_uuid(),
  -- No FK on purpose: the row must outlive the account it describes.
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  reason_code text,
  cancelled_at timestamptz,
  db_purged_at timestamptz,
  storage_purged_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  summary jsonb
);
create index if not exists p2p_account_deletions_open_idx
  on public.p2p_account_deletions (scheduled_for)
  where cancelled_at is null and completed_at is null;
create unique index if not exists p2p_account_deletions_one_open_per_user
  on public.p2p_account_deletions (user_id)
  where cancelled_at is null and completed_at is null;
alter table public.p2p_account_deletions enable row level security;
revoke all on public.p2p_account_deletions from anon, authenticated;

-- 3. Blockers ---------------------------------------------------------------
create or replace function public.p2p_account_deletion_blockers(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(reason order by reason), '{}') from (
    select 'staff_account' as reason where exists (
      select 1 from p2p_profiles p where p.id = p_user and (
        p.is_official_account or p.role::text in ('super_admin', 'regional_admin', 'moderator')
        or p.role::text like 'admin\_%'))
      or exists (select 1 from p2p_admin_roles where user_id = p_user)
    union all
    select 'leads_family' where exists (
      select 1 from p2p_families f join p2p_family_members m on m.family_id = f.id
      where f.shepherd_id = p_user and m.user_id <> p_user and m.status = 'active')
    union all
    select 'leads_circle' where exists (
      select 1 from p2p_peer_circles c join p2p_peer_circle_members m on m.circle_id = c.id
      where c.leader_id = p_user and m.user_id <> p_user and m.status = 'active')
      or exists (
      select 1 from p2p_peer_circles c join p2p_peer_circle_join_requests r on r.circle_id = c.id
      where c.leader_id = p_user and r.user_id <> p_user)
    union all
    select 'shared_growth_records' where
         exists (select 1 from p2p_peer_circle_evaluations where evaluator_id = p_user or submitter_id = p_user)
      or exists (select 1 from p2p_peer_confirmations where actor_user_id = p_user or confirmer_user_id = p_user)
      or exists (select 1 from p2p_evaluation_reassignments where new_evaluator_id = p_user or previous_evaluator_id = p_user)
      or exists (select 1 from p2p_lesson_evaluations where reassigned_from = p_user)
      or exists (select 1 from p2p_peer_confirmation_audit where performed_by = p_user)
      or exists (select 1 from p2p_completion_letters where learner_id = p_user or peer_guide_id = p_user)
      or exists (select 1 from p2p_user_fruits where awarded_by_user_id = p_user)
    union all
    select 'mentoring' where
         exists (select 1 from p2p_discipleship_links where mentor_id = p_user or disciple_id = p_user or assigned_by = p_user)
      or exists (select 1 from p2p_sessions where mentor_id = p_user or participant_id = p_user)
      or exists (select 1 from p2p_session_attendance where user_id = p_user)
      or exists (select 1 from p2p_session_notes where author_id = p_user)
    union all
    select 'study_sessions' where
         exists (select 1 from p2p_study_sessions where leader_id = p_user or created_by = p_user)
      or exists (select 1 from p2p_study_session_participants where user_id = p_user)
    union all
    select 'shared_prayer' where
         exists (select 1 from p2p_prayer_coord_gatherings where host_id = p_user or recipient_id = p_user)
      or exists (select 1 from p2p_prayer_coord_invitations where requester_id = p_user or recipient_id = p_user)
    union all
    select 'safeguarding' where
         exists (select 1 from p2p_user_flags where user_id = p_user)
      or exists (select 1 from p2p_admin_interaction_feedback where peer_user_id = p_user or admin_user_id = p_user)
    union all
    select 'authored_content' where
         exists (select 1 from p2p_churches where created_by = p_user)
      or exists (select 1 from p2p_content_approvals where submitted_by = p_user or reviewed_by = p_user)
      or exists (select 1 from p2p_regions where regional_leader_id = p_user)
      or exists (select 1 from p2p_content_status_log where changed_by = p_user)
      or exists (select 1 from p2p_languages where ui_reviewed_by = p_user)
      or exists (select 1 from p2p_lesson_blocks where created_by = p_user)
      or exists (select 1 from p2p_lessons where last_edited_by = p_user)
      or exists (select 1 from p2p_peer_circle_join_requests where responded_by = p_user)
      or exists (select 1 from p2p_peer_circle_sessions where created_by = p_user)
  ) r;
$$;

-- 4. Purge (database part of a deletion, one transaction) -------------------
create or replace function public.p2p_purge_account(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers text[];
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  -- Serialise with any concurrent run / cancellation for this user.
  perform 1 from p2p_account_status where user_id = p_user for update;

  if not exists (select 1 from auth.users where id = p_user)
     and not exists (select 1 from p2p_profiles where id = p_user) then
    return jsonb_build_object('result', 'already_deleted');
  end if;

  -- Only an account that is (still) scheduled for deletion may be purged.
  if exists (select 1 from auth.users where id = p_user)
     and not exists (select 1 from p2p_account_status where user_id = p_user and status = 'deletion_scheduled') then
    raise exception 'ACCOUNT_NOT_SCHEDULED' using errcode = 'P0001';
  end if;

  v_blockers := p2p_account_deletion_blockers(p_user);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'ACCOUNT_DELETION_BLOCKED: %', array_to_string(v_blockers, ',') using errcode = 'P0001';
  end if;

  -- Identity removed from records kept for other people (no FK to the user).
  update p2p_call_logs
     set participants = coalesce((select jsonb_agg(x) from jsonb_array_elements(participants) x where x <> to_jsonb(p_user::text)), '[]'::jsonb)
   where participants @> jsonb_build_array(p_user::text);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('call_logs_participant_removed', v_n);
  update p2p_family_worship_sessions set trusted_user_ids = array_remove(trusted_user_ids, p_user) where p_user = any(trusted_user_ids);
  update p2p_audit_logs set user_id = null where user_id = p_user;
  update p2p_audit_logs set target_id = null where target_id = p_user;
  update p2p_groups set peer_guide_id = null where peer_guide_id = p_user;

  -- The user's own records that have no FK (would otherwise be orphaned).
  delete from p2p_lesson_progress where user_id = p_user;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('lesson_progress', v_n);
  delete from p2p_notifications where user_id = p_user;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notifications', v_n);
  delete from p2p_prayer_requests where user_id = p_user;
  delete from p2p_enrollments where user_id = p_user;
  delete from p2p_group_members where user_id = p_user;

  -- Profile: CASCADE removes the user's own rows (push tokens, highlights,
  -- notes, memberships, …); SET NULL keeps shared content as "Deleted user".
  delete from p2p_profiles where id = p_user;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('profile', v_n);

  -- Login: CASCADE removes the remaining own rows (status, presence, progress
  -- tables keyed to auth.users, sessions, identities, refresh tokens);
  -- SET NULL keeps other people's call history and shared records.
  delete from auth.users where id = p_user;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('auth_user', v_n);

  return jsonb_build_object('result', 'purged', 'counts', v_counts);
end;
$$;

-- 5. The user's stored files (avatars, voice messages, submissions, …) —
--    by owner and by the "<user id>/" folder convention the app uploads to.
--    Read before the purge and saved in the deletion log, so file removal
--    (a separate, external step) can always be resumed.
create or replace function public.p2p_account_storage_objects(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = storage, pg_temp
as $$
  select o.bucket_id, o.name from storage.objects o
  where o.owner = p_user or o.owner_id = p_user::text or o.name like p_user::text || '/%';
$$;

revoke all on function public.p2p_account_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function public.p2p_purge_account(uuid) from public, anon, authenticated;
revoke all on function public.p2p_account_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.p2p_account_deletion_blockers(uuid) to service_role;
grant execute on function public.p2p_purge_account(uuid) to service_role;
grant execute on function public.p2p_account_storage_objects(uuid) to service_role;
