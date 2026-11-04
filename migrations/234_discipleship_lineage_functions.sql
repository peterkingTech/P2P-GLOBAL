-- 234 (Phase 1 — lineage, approved by the owner 2026-11-04; restore-tested;
-- applied only with the guarded production procedure): FUNCTIONS ONLY.
--
-- Generations come from discipleship relationships only (active or paused —
-- never connections, Family or Church membership, invitations or dates):
--   • p2p_lineage_descendants(root): the people discipled by root (generation
--     1), by them (2), and so on — no fixed depth (a safety cap of 200). A
--     person reached through several mentors appears ONCE, at their nearest
--     generation, preferring their primary mentor's line;
--   • p2p_lineage_ancestors(person): their mentors (generation 1, every
--     current mentor, primary first), then — following primary mentors only —
--     their mentor's mentor, and so on;
--   • p2p_lineage_generation_counts(root): how many people at each generation.
-- Cycles can't exist (233), and every walk also carries its path, so a bad
-- row could never make it loop. Server-only: the API decides who may see
-- what (no phone can call these).

create or replace function public.p2p_lineage_descendants(p_root uuid, p_max_depth int default 200)
returns table (person_id uuid, mentor_id uuid, generation int, link_id uuid, is_primary boolean, status text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  with recursive d as (
    select l.disciple_id as person_id, l.mentor_id, 1 as generation, l.id as link_id, l.is_primary, l.status, l.started_at,
           array[p_root, l.disciple_id] as path
      from p2p_discipleship_links l
     where l.mentor_id = p_root and l.status in ('active', 'paused')
    union all
    select l.disciple_id, l.mentor_id, d.generation + 1, l.id, l.is_primary, l.status, l.started_at, d.path || l.disciple_id
      from d join p2p_discipleship_links l on l.mentor_id = d.person_id and l.status in ('active', 'paused')
     where d.generation < least(greatest(p_max_depth, 1), 200) and not (l.disciple_id = any(d.path))
  )
  select distinct on (person_id) person_id, mentor_id, generation, link_id, is_primary, status, started_at
    from d
   order by person_id, generation, is_primary desc, started_at nulls last;
$$;

create or replace function public.p2p_lineage_ancestors(p_person uuid, p_max_depth int default 200)
returns table (person_id uuid, disciple_id uuid, generation int, link_id uuid, is_primary boolean, status text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  with recursive a as (
    select l.mentor_id as person_id, l.disciple_id, 1 as generation, l.id as link_id, l.is_primary, l.status, l.started_at,
           array[p_person, l.mentor_id] as path
      from p2p_discipleship_links l
     where l.disciple_id = p_person and l.status in ('active', 'paused')
    union all
    select l.mentor_id, l.disciple_id, a.generation + 1, l.id, l.is_primary, l.status, l.started_at, a.path || l.mentor_id
      from a join p2p_discipleship_links l on l.disciple_id = a.person_id and l.status in ('active', 'paused') and l.is_primary
     where a.is_primary and a.generation < least(greatest(p_max_depth, 1), 200) and not (l.mentor_id = any(a.path))
  )
  select person_id, disciple_id, generation, link_id, is_primary, status, started_at
    from a
   order by generation, is_primary desc, started_at nulls last;
$$;

create or replace function public.p2p_lineage_generation_counts(p_root uuid)
returns table (generation int, people int)
language sql stable security definer set search_path = public as $$
  select generation, count(*)::int from public.p2p_lineage_descendants(p_root) group by generation order by generation;
$$;

revoke execute on function public.p2p_lineage_descendants(uuid, int), public.p2p_lineage_ancestors(uuid, int), public.p2p_lineage_generation_counts(uuid) from public, anon, authenticated;
grant execute on function public.p2p_lineage_descendants(uuid, int), public.p2p_lineage_ancestors(uuid, int), public.p2p_lineage_generation_counts(uuid) to service_role;

-- Rollback: drop function public.p2p_lineage_generation_counts(uuid), public.p2p_lineage_descendants(uuid, int), public.p2p_lineage_ancestors(uuid, int);
