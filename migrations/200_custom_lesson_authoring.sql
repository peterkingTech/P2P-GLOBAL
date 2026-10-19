-- 200: Custom lesson authoring — per-lesson draft / published / archived,
-- version tracking, tags and resource links, for BOTH custom-lesson tables
-- (p2p_family_study_lessons, p2p_church_study_lessons; migrations 134/135).
-- Both are empty in production (2026-10-18), so nothing existing changes
-- meaning; any row that did exist is marked published (it was visible).
--
--   status       'draft' (leaders only) | 'published' (members) | 'archived'
--   published_at first publish time — a lesson ever published is archived,
--                never hard-deleted (the API refuses DELETE), so work people
--                submit against it (Prompt 5) is never orphaned
--   version      +1 each time a PUBLISHED lesson's content changes; answers
--                record the version and question text they answered
--   tags         short topic tags (the API limits count/length)
--   resources    [{ "title": "...", "url": "https://..." }] (API: https only)
-- questions keeps its jsonb column; the API now stores [{ id, text, kind:
-- 'discussion' | 'reflection' }] with stable ids (plain strings still read).
--
-- Members' read policies additionally require the LESSON to be published.
-- The family custom-study policies are re-created with SECURITY DEFINER
-- helpers (same rules) because the 135 versions recurse for signed-in
-- readers — see below. REQUIRES 199 (p2p_group_learning_member).
-- Additive and re-runnable.

do $$
declare t text;
begin
  foreach t in array array['p2p_family_study_lessons', 'p2p_church_study_lessons'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'status') then
      execute format('alter table public.%I add column status text not null default ''published''', t);
      execute format('alter table public.%I alter column status set default ''draft''', t);
      execute format('alter table public.%I add constraint %I check (status in (''draft'', ''published'', ''archived''))', t, t || '_status_check');
    end if;
    execute format('alter table public.%I add column if not exists published_at timestamptz', t);
    execute format('alter table public.%I add column if not exists archived_at timestamptz', t);
    execute format('alter table public.%I add column if not exists version integer not null default 1', t);
    execute format('alter table public.%I add column if not exists tags text[] not null default ''{}''', t);
    execute format('alter table public.%I add column if not exists resources jsonb not null default ''[]''::jsonb', t);
    execute format('update public.%I set published_at = coalesce(published_at, created_at) where status = ''published'' and published_at is null', t);
  end loop;
end $$;

-- ── Family custom-study policies, without recursion ────────────────────────
-- 135's four policies check membership with inline EXISTS on
-- p2p_family_members / p2p_families, whose own policies reference
-- p2p_family_members again — any signed-in member's direct read of these
-- tables fails with "infinite recursion" (the app reads through the API, so
-- it never surfaced). Same rules, via SECURITY DEFINER helpers (the pattern
-- of p2p_is_conversation_member / p2p_is_church_member):
--   manage = the family's Shepherd or an active Co-Shepherd
--   view   = an active member, study published (and now the LESSON published)
create or replace function public.p2p_family_can_manage(p_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from p2p_families f where f.id = p_family_id and f.shepherd_id = auth.uid())
      or exists (select 1 from p2p_family_members m where m.family_id = p_family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd');
$$;
create or replace function public.p2p_family_study_manageable(p_study_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from p2p_family_studies s where s.id = p_study_id and public.p2p_family_can_manage(s.family_id));
$$;
create or replace function public.p2p_family_study_visible(p_study_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from p2p_family_studies s where s.id = p_study_id and s.status = 'published' and public.p2p_group_learning_member(s.family_id, null));
$$;
revoke all on function public.p2p_family_can_manage(uuid) from public, anon;
revoke all on function public.p2p_family_study_manageable(uuid) from public, anon;
revoke all on function public.p2p_family_study_visible(uuid) from public, anon;
grant execute on function public.p2p_family_can_manage(uuid) to authenticated, service_role;
grant execute on function public.p2p_family_study_manageable(uuid) to authenticated, service_role;
grant execute on function public.p2p_family_study_visible(uuid) to authenticated, service_role;

drop policy if exists "Family shepherd manages studies" on public.p2p_family_studies;
create policy "Family shepherd manages studies" on public.p2p_family_studies
  for all using (public.p2p_family_can_manage(family_id)) with check (public.p2p_family_can_manage(family_id));
drop policy if exists "Family members view published studies" on public.p2p_family_studies;
create policy "Family members view published studies" on public.p2p_family_studies
  for select using (status = 'published' and public.p2p_group_learning_member(family_id, null));
drop policy if exists "Family shepherd manages study lessons" on public.p2p_family_study_lessons;
create policy "Family shepherd manages study lessons" on public.p2p_family_study_lessons
  for all using (public.p2p_family_study_manageable(study_id)) with check (public.p2p_family_study_manageable(study_id));
drop policy if exists "Family members view published study lessons" on public.p2p_family_study_lessons;
create policy "Family members view published study lessons" on public.p2p_family_study_lessons
  for select using (status = 'published' and public.p2p_family_study_visible(study_id));

drop policy if exists "Church members view published study lessons" on public.p2p_church_study_lessons;
create policy "Church members view published study lessons" on public.p2p_church_study_lessons
  for select using (
    status = 'published'
    and exists (
      select 1 from public.p2p_church_studies s
      where s.id = study_id and s.status = 'published' and p2p_is_church_member(s.church_id, auth.uid())
    )
  );

-- Rollback (the new columns and helper functions can stay; restores the
-- previous read/manage policies): re-run the four "drop policy … create
-- policy" blocks for p2p_family_studies / p2p_family_study_lessons from
-- migration 135, and the "Church members view published study lessons"
-- block from migration 134.
