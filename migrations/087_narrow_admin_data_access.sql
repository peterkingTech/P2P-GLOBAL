-- p2p_is_admin() audit remediation (approved scope, see security audit report).
--
-- WHY: p2p_is_admin() = role != 'student' treats all 17 non-student roles
-- (peer_guide, church_leader, regional_admin, moderator, and 13 admin_*
-- specialty roles) identically for RLS purposes. Live-tested and confirmed:
-- a real admin_marketing account (whose entire app surface is one mail
-- inbox) and a real admin_help account could both read an arbitrary,
-- unrelated student's private p2p_lesson_progress row directly via
-- PostgREST, bypassing the app's own role-scoped admin dashboard entirely.
--
-- p2p_is_admin() ITSELF is not changed — ~50 of its 87 dependent policy rows
-- are curriculum/content-authoring tables (lessons, translations, admin role
-- assignment, etc.) where broad admin access is appropriate and where a
-- change would risk breaking Kingdom School content management. Only the
-- specific policies gating private, individually-owned user data are
-- narrowed here, each replacing p2p_is_admin() with the new
-- p2p_is_super_admin() (approved: super-admin-only for this data).
--
-- EXCLUDED, deliberately, per investigation: p2p_help_requests. Its "Admins
-- can update/view help requests" policies back a real, currently-working
-- admin_help feature (DataContext.tsx's getHelpRequests() runs an
-- intentionally unfiltered query, relying on this exact RLS bypass so the
-- help-desk dashboard can list everyone's open requests) — narrowing it
-- would break that feature, so it is untouched here, unlike every other
-- table below, all of which were verified (via a client-side grep of every
-- query against them) to have NO legitimate feature depending on the broad
-- admin bypass: p2p_lesson_progress and p2p_fruit_progress/p2p_user_fruits
-- are only ever queried own-user-scoped; p2p_assignment_submissions,
-- p2p_submissions, and p2p_lesson_evaluations already have dedicated
-- evaluator_id-scoped policies that fully cover the real peer-evaluation
-- feature independent of the admin clause; p2p_discipleship_links and
-- p2p_peer_confirmations are only ever queried scoped to the caller's own
-- mentor_id/confirmer_user_id; p2p_pastoral_care_log,
-- p2p_evaluation_reassignments, p2p_peer_confirmation_audit, and
-- p2p_fruit_audit_log have no client-side query at all (audit/internal
-- tables); p2p_sessions' one unscoped query is a general "my upcoming
-- items" home-feed loader with no admin-specific UI built around it.

create or replace function p2p_is_super_admin()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from p2p_profiles where id = auth.uid() and role = 'super_admin');
$$;

-- p2p_lesson_progress
alter policy "Admins can read all lesson progress" on p2p_lesson_progress
  using (p2p_is_super_admin());

-- p2p_assignment_submissions
alter policy "Admins can manage submissions" on p2p_assignment_submissions
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Users can view own submissions" on p2p_assignment_submissions
  using ((( select auth.uid() ) = user_id) or p2p_is_super_admin());

-- p2p_submissions
alter policy "Admins manage all submissions" on p2p_submissions
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());

-- p2p_lesson_evaluations
alter policy "Admins can manage evaluations" on p2p_lesson_evaluations
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Participants can view own evaluations" on p2p_lesson_evaluations
  using ((( select auth.uid() ) = submitter_id) or (( select auth.uid() ) = evaluator_id) or p2p_is_super_admin());

-- p2p_evaluation_reassignments
alter policy "Admins can view reassignment log" on p2p_evaluation_reassignments
  using (p2p_is_super_admin());

-- p2p_fruit_progress
alter policy "Admins can manage fruit progress" on p2p_fruit_progress
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Users can read own fruit progress" on p2p_fruit_progress
  using ((auth.uid() = user_id) or p2p_is_super_admin());

-- p2p_user_fruits
alter policy "Admins can manage user fruits" on p2p_user_fruits
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Users can read own fruits" on p2p_user_fruits
  using ((auth.uid() = user_id) or p2p_is_super_admin());

-- p2p_sessions
alter policy "Admins manage sessions" on p2p_sessions
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Participants can view own sessions" on p2p_sessions
  using ((auth.uid() = mentor_id) or (auth.uid() = participant_id) or p2p_is_super_admin());
alter policy "Participants can update own sessions" on p2p_sessions
  using ((auth.uid() = mentor_id) or (auth.uid() = participant_id) or p2p_is_super_admin())
  with check ((auth.uid() = mentor_id) or (auth.uid() = participant_id) or p2p_is_super_admin());

-- p2p_discipleship_links
alter policy "p2p_discipleship_links_admin_update" on p2p_discipleship_links
  using (p2p_is_super_admin());
alter policy "p2p_discipleship_links_select" on p2p_discipleship_links
  using ((( select auth.uid() ) = mentor_id) or (( select auth.uid() ) = disciple_id) or p2p_is_super_admin());
alter policy "p2p_discipleship_links_admin_write" on p2p_discipleship_links
  with check (p2p_is_super_admin());

-- p2p_peer_confirmations
alter policy "Admins can manage confirmations" on p2p_peer_confirmations
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());
alter policy "Users can read own confirmations" on p2p_peer_confirmations
  using ((auth.uid() = actor_user_id) or (auth.uid() = confirmer_user_id) or p2p_is_super_admin());

-- p2p_peer_confirmation_audit
alter policy "Admins can read confirmation audit" on p2p_peer_confirmation_audit
  using (p2p_is_super_admin());

-- p2p_fruit_audit_log
alter policy "Admins can read fruit audit log" on p2p_fruit_audit_log
  using (p2p_is_super_admin());

-- p2p_pastoral_care_log
alter policy "Admins can manage the pastoral care log" on p2p_pastoral_care_log
  using (p2p_is_super_admin()) with check (p2p_is_super_admin());

-- storage.objects — direct access to uploaded submission files/media
alter policy "Admins read all submission media" on storage.objects
  using ((bucket_id = 'submissions'::text) and p2p_is_super_admin());