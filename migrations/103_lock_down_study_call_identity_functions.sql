-- Remaining RPC security audit: 6 SECURITY DEFINER functions from the Call
-- Together / Study Together feature (migrations 083/084/085) were missed by
-- the prior identity-function sweep (099/100). Each accepts a caller-identity
-- parameter (p_inviter_id, p_invitee_id, p_caller_id, p_leader_id,
-- p_departed_user_id) and enforces a real relationship check against it
-- (participant/leader status) -- but never verifies that parameter against
-- auth.uid(). Their only legitimate caller is artifacts/api-server's
-- calls.ts, which derives every one of these ids from verifyCaller(req) (the
-- verified session), never from req.body, and calls these RPCs through the
-- service-role client. The mobile/web client never calls any of the six
-- directly (grepped every call site). Exactly the same shape and same fix as
-- migration 099's p2p_join_study_session / p2p_start_study_session.
--
-- Confirmed live-exploitable with real JWTs (disposable test accounts, no
-- service-role credentials used as caller identity; all test rows cleaned up
-- afterward):
--   - p2p_create_call_invitation: Student B, not a participant of Student
--     A's call, created a call invitation "as" A (p_inviter_id = A) by
--     calling the RPC directly -- bypasses isEligibleStudyPartner() entirely,
--     since that check only runs in the Express route, not the RPC itself.
--   - p2p_accept_call_invitation: the inviter accepted their own invitation
--     "as" the invitee (p_invitee_id = the real invitee) via direct RPC,
--     adding the invitee to the call's participants array with zero action
--     or consent from the invitee.
--   - p2p_end_study_session: Student B (an outsider) ended Student A's real
--     active study session by passing p_caller_id = A.
--   - p2p_remove_study_participant: Student B (an outsider, not the leader)
--     removed a real third participant from the call and session by passing
--     p_leader_id = the real leader's id.
--   - p2p_update_study_section: Student B moved the shared reading position
--     for the whole group by passing p_caller_id = the real leader's id.
--   - p2p_reassign_study_leader: Student B falsely marked the real leader as
--     departed (forcing a leader reassignment / session end) by passing
--     p_departed_user_id = p_caller_id = the real leader's id.
--
-- Fix: revoke direct anon/authenticated/PUBLIC access, same as 099+100 (both
-- role-level AND PUBLIC-level revokes -- 100 exists because a role-only
-- revoke does nothing while the PUBLIC grant remains, since every role
-- implicitly inherits PUBLIC). The function bodies and their internal
-- participant/leader checks are left completely untouched -- they remain
-- correct defense-in-depth for the one caller (calls.ts) that still reaches
-- them via service_role, which this revoke does not affect.

revoke execute on function public.p2p_create_call_invitation(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_accept_call_invitation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_end_study_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_remove_study_participant(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_update_study_section(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.p2p_reassign_study_leader(uuid, uuid, uuid) from public, anon, authenticated;

-- Bonus, lower-severity hardening in the same family: p2p_check_mentor_fruit_eligibility
-- and p2p_check_teacher_fruit have zero legitimate direct caller (not app
-- code, not an RLS policy predicate -- only called internally, function-to-
-- function, from the fruit-award trigger pipeline in migration 033).
-- Calling them directly can't fabricate false achievement data (they only
-- recompute fruit from already-real p2p_lesson_progress/p2p_submissions
-- facts), so this is a "close an unused door" step, not a confirmed
-- exploit -- same category migration 099 applied to p2p_lesson_progress_recompute.
revoke execute on function public.p2p_check_mentor_fruit_eligibility(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.p2p_check_teacher_fruit(uuid) from public, anon, authenticated;