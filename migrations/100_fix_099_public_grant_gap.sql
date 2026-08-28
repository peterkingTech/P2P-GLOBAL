-- Migration 099's REVOKE ... FROM anon, authenticated on the four
-- internal-only functions didn't actually close the exploit: all four were
-- also GRANT'd to PUBLIC, and every role (including anon/authenticated)
-- implicitly inherits PUBLIC's privileges regardless of an explicit
-- per-role revoke. Confirmed live: after 099, the exact same cross-user
-- p2p_update_fruit_progress exploit (test2 forging test5's fruit progress)
-- still succeeded (204) because anon/authenticated still had EXECUTE via
-- PUBLIC. has_function_privilege('anon', ..., 'EXECUTE') still returned
-- true post-099 for this reason. This migration revokes the PUBLIC grant
-- itself, which is the one that actually matters.

revoke execute on function public.p2p_update_fruit_progress(uuid, text, integer, integer, jsonb) from public;
revoke execute on function public.p2p_join_study_session(uuid, uuid) from public;
revoke execute on function public.p2p_start_study_session(uuid, uuid, uuid, uuid, text) from public;
revoke execute on function public.p2p_lesson_progress_recompute(uuid, uuid) from public;
