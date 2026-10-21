-- 206: stop the 1:1/group study-session roster policy from recursing (42P17).
--
-- "Study session participants can view the roster" on
-- p2p_study_session_participants looked itself up (EXISTS ... FROM
-- p2p_study_session_participants), so Postgres refuses every signed-in read
-- of the roster with "infinite recursion detected in policy" — and
-- "Study session participants can view their session" on p2p_study_sessions
-- (which checks the roster inline) failed the same way. The API is not
-- affected (service role), and the app reads these tables only through it,
-- so this restores correct behaviour for direct reads and Realtime; it was
-- never an exposure (the policy failed closed). Same fix as migration 203.
--
-- Same rule as before: you may read a session's roster if you are one of its
-- participants. Evaluated through a SECURITY DEFINER helper (reads the roster
-- without RLS, so no recursion). Additive helper + one policy replacement.

create or replace function public.p2p_is_study_session_participant(p_session_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from p2p_study_session_participants p
    where p.study_session_id = p_session_id and p.user_id = auth.uid()
  );
$$;
revoke all on function public.p2p_is_study_session_participant(uuid) from public, anon;
grant execute on function public.p2p_is_study_session_participant(uuid) to authenticated, service_role;

drop policy if exists "Study session participants can view the roster" on public.p2p_study_session_participants;
create policy "Study session participants can view the roster" on public.p2p_study_session_participants
  for select using (public.p2p_is_study_session_participant(study_session_id));

-- Rollback (restores the previous, recursive definition exactly):
--   drop policy if exists "Study session participants can view the roster" on public.p2p_study_session_participants;
--   create policy "Study session participants can view the roster" on public.p2p_study_session_participants for select using ((exists (select 1 from public.p2p_study_session_participants ssp2 where ssp2.study_session_id = p2p_study_session_participants.study_session_id and ssp2.user_id = auth.uid())));
--   drop function if exists public.p2p_is_study_session_participant(uuid);
