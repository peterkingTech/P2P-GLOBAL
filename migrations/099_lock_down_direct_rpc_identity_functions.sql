-- Security audit: SECURITY DEFINER functions accepting a raw p_user_id.
--
-- Audited all 30 such functions live (pg_proc + real caller sites in
-- application code and other DB functions/triggers/RLS policies), per the
-- "do not blanket-fix, identify each caller first" mandate. Found two
-- genuinely exploitable vulnerabilities, confirmed live against production
-- with real JWTs (test2 successfully mutated test5's data; damage reverted
-- immediately after confirming), and three functions that are correctly
-- authorized internally but should never have been directly RPC-callable
-- by anon/authenticated in the first place.
--
-- Everything else audited (p2p_is_church_*, p2p_is_conversation_member,
-- p2p_is_group_member, p2p_module_*_done, p2p_check_fruit_eligibility,
-- p2p_*_streak, p2p_user_activity_dates, p2p_check_global_fruit) is used as
-- an RLS policy predicate and/or an internal helper called by other
-- SECURITY DEFINER functions — boolean/read-only, no side effects, and
-- revoking EXECUTE from `authenticated` on these would break the RLS
-- policies that reference them for every normal user's own queries (RLS
-- policy evaluation still requires the querying role to hold EXECUTE on
-- any function referenced in its USING/WITH CHECK clause, independent of
-- SECURITY DEFINER). Deliberately left untouched this pass — residual risk
-- is a single boolean fact disclosed via direct RPC probing, not data
-- corruption, and is a lower priority than the two confirmed mutations
-- below. get_user_tree_data, p2p_award_fruit, p2p_get_growth_dashboard,
-- p2p_shares_group_with already had a correct `p_user_id = auth.uid()`
-- guard and needed no change.

-- 1. p2p_increment_servant_score — confirmed exploitable: any authenticated
-- client can inflate/deflate ANY other user's servant_score with zero
-- authorization (verified live: test2's session set test5's score to
-- 99999). The only legitimate caller (DataContext.tsx) always passes the
-- caller's own profile id, so this guard changes nothing for real usage —
-- same pattern already used correctly in p2p_award_fruit.
create or replace function public.p2p_increment_servant_score(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_authorized';
  end if;
  update p2p_profiles set servant_score = servant_score + p_amount where id = p_user_id;
end;
$$;

-- 2. p2p_update_fruit_progress — confirmed exploitable the same way
-- (test2 fabricated christ_identity_fruit progress for test5). Its only
-- legitimate callers are p2p_check_mentor_fruit_eligibility and
-- p2p_process_confirmation, both of which legitimately update a fruit
-- progress record for a DIFFERENT user than the one who triggered the
-- confirmation (e.g. a mentor's fruit progress advances when their
-- disciple's session is confirmed) — so an auth.uid()-based guard would
-- break that real cross-user flow. SECURITY DEFINER functions calling this
-- internally don't need their own EXECUTE grant on it; only the direct
-- anon/authenticated RPC path (the actual exploit vector) needs closing.
revoke execute on function public.p2p_update_fruit_progress(uuid, text, integer, integer, jsonb) from anon, authenticated;

-- 3 & 4. p2p_join_study_session / p2p_start_study_session — each already
-- has its own internal authorization (verifies p_user_id is a real
-- participant in the target call_log before acting), but their only real
-- caller is calls.ts using the service-role client, after the Express
-- route has already established the caller's identity. The mobile/web
-- client never calls either directly. Revoking the unused
-- anon/authenticated grant removes an unnecessary direct-RPC path without
-- touching the real (service-role) call path at all.
revoke execute on function public.p2p_join_study_session(uuid, uuid) from anon, authenticated;
revoke execute on function public.p2p_start_study_session(uuid, uuid, uuid, uuid, text) from anon, authenticated;

-- 5. p2p_lesson_progress_recompute — only called internally by the
-- evaluation pipeline (p2p_apply_evaluation_outcome,
-- p2p_assign_evaluator_on_submission, p2p_process_circle_evaluation), where
-- the caller (an evaluator approving someone else's submission) is
-- legitimately a different person than p_user_id (the submitter). No
-- application code calls it directly. Its own logic only recomputes status
-- from already-real, already-authorized p2p_submissions/p2p_lesson_evaluations
-- rows, so a direct RPC call couldn't fabricate progress outright — but
-- removing the unused direct-RPC path is a safe, free hardening step.
revoke execute on function public.p2p_lesson_progress_recompute(uuid, uuid) from anon, authenticated;
