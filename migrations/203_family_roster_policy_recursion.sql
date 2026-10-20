-- 203: stop the family-roster policy from recursing (42P17).
--
-- "Members view their family roster" on p2p_family_members looked itself up
-- (EXISTS ... FROM p2p_family_members) and "Shepherd and co-shepherd manage
-- roster" did the same. Postgres refuses that with "infinite recursion
-- detected in policy for relation p2p_family_members" — so EVERY signed-in
-- read that touches family membership through RLS failed: the roster itself,
-- and every policy that checks membership inline (Gathering sessions,
-- history, participants, session/journey events, shared prayer requests,
-- study plans). The API was unaffected (service role), but direct reads and
-- Realtime postgres_changes (which apply the reader's RLS) never worked —
-- e.g. Gathering session updates were never delivered.
--
-- Fix: the same rules, evaluated through the existing SECURITY DEFINER
-- helpers from migrations 199/200 (they read membership without RLS, so no
-- recursion). Who may see or manage what is unchanged:
--   roster read   : your own row, or any row of a family you're an active member of
--   roster manage : the family's Shepherd, or an active Co-Shepherd of it
--   family read   : its Shepherd, or an active member
-- Policy replacements only; no data, column, grant or function changes.

do $$
begin
  if to_regprocedure('public.p2p_group_learning_member(uuid, uuid)') is null
     or to_regprocedure('public.p2p_family_can_manage(uuid)') is null then
    raise exception '203 requires migrations 199 and 200 (membership helpers)';
  end if;
end $$;

drop policy if exists "Members view their family roster" on public.p2p_family_members;
create policy "Members view their family roster" on public.p2p_family_members
  for select using (auth.uid() = user_id or public.p2p_group_learning_member(family_id, null));

drop policy if exists "Shepherd and co-shepherd manage roster" on public.p2p_family_members;
create policy "Shepherd and co-shepherd manage roster" on public.p2p_family_members
  using (public.p2p_family_can_manage(family_id));

drop policy if exists "Members view their own family" on public.p2p_families;
create policy "Members view their own family" on public.p2p_families
  for select using (auth.uid() = shepherd_id or public.p2p_group_learning_member(id, null));

-- Rollback (restores the previous, recursive definitions exactly):
--   drop policy if exists "Members view their family roster" on public.p2p_family_members;
--   create policy "Members view their family roster" on public.p2p_family_members for select using ((auth.uid() = user_id) or (exists (select 1 from public.p2p_family_members m2 where m2.family_id = p2p_family_members.family_id and m2.user_id = auth.uid() and m2.status = 'active')));
--   drop policy if exists "Shepherd and co-shepherd manage roster" on public.p2p_family_members;
--   create policy "Shepherd and co-shepherd manage roster" on public.p2p_family_members using ((exists (select 1 from public.p2p_families f where f.id = p2p_family_members.family_id and f.shepherd_id = auth.uid())) or (exists (select 1 from public.p2p_family_members m3 where m3.family_id = p2p_family_members.family_id and m3.user_id = auth.uid() and m3.status = 'active' and m3.role = 'co_shepherd')));
--   drop policy if exists "Members view their own family" on public.p2p_families;
--   create policy "Members view their own family" on public.p2p_families for select using ((auth.uid() = shepherd_id) or (exists (select 1 from public.p2p_family_members m where m.family_id = p2p_families.id and m.user_id = auth.uid() and m.status = 'active')));
