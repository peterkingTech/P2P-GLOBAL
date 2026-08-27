-- Prayer Wall moderation-role narrowing.
--
-- Note on scope: this migration was originally drafted to also re-pin
-- search_path on several SECURITY DEFINER functions that a static,
-- migration-file-based audit flagged as unpinned (p2p_award_evaluation_credit,
-- p2p_increment_service_score, p2p_award_wisdom_on_core_approval,
-- p2p_sync_group_conversation, p2p_sync_circle_conversation). Before
-- applying, every one of those was checked directly against the LIVE
-- database (pg_get_functiondef / pg_proc.proconfig) rather than trusting
-- migration-file history — which the audit itself warned may not reflect
-- reality, since some objects were created out-of-band. Live reality:
-- p2p_increment_service_score and p2p_award_wisdom_on_core_approval don't
-- exist at all in this database; p2p_award_evaluation_credit,
-- p2p_sync_group_conversation, and p2p_sync_circle_conversation all already
-- have search_path pinned, with bodies that differ from what the tracked
-- migration files show (evidence of untracked live hotfixes). A full sweep
-- of every SECURITY DEFINER function in the public schema
-- (select proname, proconfig from pg_proc where prosecdef ... ) confirmed
-- all 85 already have search_path pinned — zero unpinned functions exist.
-- search_path hardening is already complete; no migration needed for it.
--
-- p2p_prayer_wall_posts/_comments RLS (live-confirmed via pg_policies
-- before writing this migration — these tables predate tracked migrations,
-- so this is the first time their policies are captured in source control)
-- gated delete/update/broad-read on p2p_is_admin() (role != 'student' — all
-- 17 non-student roles, including peer_guide and every admin_* specialty
-- role). The actual moderation RPC this app already uses for prayer
-- content, p2p_moderate_flag() (migration 013/019), correctly narrows to
-- p2p_current_role() IN ('moderator','church_leader','regional_admin',
-- 'super_admin') — but these RLS policies were never brought in line with
-- that, leaving a second, unaudited path (a raw client-side DELETE,
-- reachable via mobile app/admin/content.tsx's "Remove Post" button) that
-- any peer_guide or admin_content account could use to delete or read any
-- user's prayer post, bypassing the flag/audit trail entirely.
create or replace function p2p_is_prayer_moderator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from p2p_profiles
    where id = auth.uid() and role in ('moderator', 'church_leader', 'regional_admin', 'super_admin')
  );
$$;
revoke all on function p2p_is_prayer_moderator() from public;
grant execute on function p2p_is_prayer_moderator() to authenticated;

drop policy if exists "View visible prayer wall posts" on p2p_prayer_wall_posts;
create policy "View visible prayer wall posts" on p2p_prayer_wall_posts
  for select using (
    visibility = 'global' or user_id = auth.uid() or p2p_is_peer(auth.uid(), user_id) or p2p_is_prayer_moderator()
  );

drop policy if exists "Update own prayer wall posts" on p2p_prayer_wall_posts;
create policy "Update own prayer wall posts" on p2p_prayer_wall_posts
  for update
  using (user_id = auth.uid() or p2p_is_prayer_moderator())
  with check (user_id = auth.uid() or p2p_is_prayer_moderator());

drop policy if exists "Delete own prayer wall posts" on p2p_prayer_wall_posts;
create policy "Delete own prayer wall posts" on p2p_prayer_wall_posts
  for delete using (user_id = auth.uid() or p2p_is_prayer_moderator());

drop policy if exists "View comments on visible posts" on p2p_prayer_wall_comments;
create policy "View comments on visible posts" on p2p_prayer_wall_comments
  for select using (
    exists (
      select 1 from p2p_prayer_wall_posts p
      where p.id = p2p_prayer_wall_comments.post_id
        and (p.visibility = 'global' or p.user_id = auth.uid() or p2p_is_peer(auth.uid(), p.user_id) or p2p_is_prayer_moderator())
    )
  );

drop policy if exists "Delete own comments" on p2p_prayer_wall_comments;
create policy "Delete own comments" on p2p_prayer_wall_comments
  for delete using (user_id = auth.uid() or p2p_is_prayer_moderator());