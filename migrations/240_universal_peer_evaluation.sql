-- 240 — Universal Peer Evaluation Engine. Written 2026-11-05. REQUIRES 229–231 and 239.
-- NOT APPLIED. Apply only with the guarded production procedure after the
-- owner's explicit approval. Additive; nothing is deleted; promotions untouched.
--
-- ONE engine (229's lifecycle: queue → invitation → acceptance → 48-hour
-- deadline → completion, with reassignment and audit) for every independently
-- assessed resource on P2P Global:
--   • lesson-backed resources — Kingdom School lessons, Kingdom Stories
--     chapters, Bible Study Plan sessions — wherever they are studied (alone,
--     in the Learning Centre, in Study Together, in a Family or a Church).
--     Every participant's answers stay their own submission with their own
--     evaluation and their own credit (never a group grade);
--   • Family / Church custom-lesson assignments (p2p_group_assignment_
--     submissions) — only when an administrator switches
--     group_assignments_enabled on (default OFF: it changes a family-private
--     workflow), and then only evaluated by current members of that same
--     Family / Church. The group leader's own review keeps working and, if
--     used, closes the engine evaluation.
--
-- WHO MAY EVALUATE — exact-resource qualification, discovered automatically:
--   • a person qualifies for a resource ONLY by having passed THAT resource
--     through an independent evaluation (the Growth Matrix ledger's
--     learning.assessment_passed for that lesson — peer-approved, never
--     self-approved, never by the learner, never from an evaluation with a
--     substantiated quality concern; for a group assignment: their own
--     submission reviewed by someone else). Passing lesson A never qualifies
--     anyone for lesson B, another chapter, plan, curriculum or feature;
--   • no registration, orientation gate or volunteer list. The old routes —
--     completing a lesson (a client-writable flag), reviewer roles with chosen
--     categories, the orientation requirement — no longer qualify anyone;
--   • COLD START (no one has independently passed a resource yet): stays
--     queued and is listed for coordinators. Only if the owner sets
--     bootstrap_roles (default empty) may those roles evaluate a resource
--     that has NO independently qualified person — recorded as 'bootstrap'.
--   • safeguarding as before: never the submitter, active accounts only, no
--     blocks either way, the minor-contact rules, not restricted, available,
--     under capacity, never someone already tried for this evaluation.
--
-- ASSESSMENT VERSIONS — an administrator records a MATERIAL revision of a
--   resource's assessment (p2p_assessment_revisions, append-only, with a
--   reason). Passes from before it keep their learning credit but no longer
--   qualify anyone to evaluate the revised version; a new pass does.
--
-- MATCHING — among qualified people (p2p_eval_qualified_pool, the ONE
--   definition), the engine prefers, in priority order: language (same content
--   language, then same app language) · progressively wider geography from
--   voluntarily shared data — nearby (≤ 50 km), same city, same region, same
--   country, similar time zone, then anywhere in the world (computed in the
--   database, never shown) · one or two stages ahead (a preference, never a
--   condition) · fair workload and recent performance (active, invited this
--   week, completed recently, missed deadlines, expired invitations; a newly
--   qualified person who was never invited gets a small lift) · variety and
--   integrity (not someone who recently evaluated this learner; a strong
--   penalty for reciprocal approvals). Reasons are recorded (labels and
--   counts only). Reciprocal approval pairs are listed for an audited review.
--
-- Accepted work is never taken away because the qualification rule changed:
-- the sweep re-checks safety for accepted evaluations, full eligibility only
-- for open invitations. FRESH START (owner decision): evaluations still
-- waiting when this runs are closed (history kept, nobody notified) and the
-- learners answer those checks again for a new evaluation.

begin;

-- ── Settings ────────────────────────────────────────────────────────────────
alter table public.p2p_evaluation_settings
  add column if not exists bootstrap_roles           text[]  not null default '{}',
  add column if not exists group_assignments_enabled boolean not null default false,
  add column if not exists recent_window_days        integer not null default 30 check (recent_window_days between 1 and 365);

-- ── One record per evaluation, for any kind of resource ─────────────────────
alter table public.p2p_lesson_evaluations
  add column if not exists resource_kind       text not null default 'lesson',
  add column if not exists resource_id         uuid,
  add column if not exists group_submission_id uuid references public.p2p_group_assignment_submissions(id) on delete cascade,
  add column if not exists context             text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_lesson_evaluations_resource_kind_check') then
    alter table public.p2p_lesson_evaluations add constraint p2p_lesson_evaluations_resource_kind_check check (resource_kind in ('lesson', 'group_assignment'));
  end if;
end $$;
-- A group-assignment evaluation has no lesson submission; lesson evaluations keep both.
alter table public.p2p_lesson_evaluations alter column submission_id drop not null;
alter table public.p2p_lesson_evaluations alter column lesson_id drop not null;
update public.p2p_lesson_evaluations e
   set resource_id = e.lesson_id, context = public.p2p_growth_lesson_resource(e.lesson_id)
 where e.resource_id is null and e.resource_kind = 'lesson';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_lesson_evaluations_resource_shape') then
    alter table public.p2p_lesson_evaluations add constraint p2p_lesson_evaluations_resource_shape check (
      (resource_kind = 'lesson' and submission_id is not null and lesson_id is not null)
      or (resource_kind = 'group_assignment' and group_submission_id is not null and resource_id is not null));
  end if;
end $$;
create unique index if not exists p2p_lesson_evaluations_one_per_group_submission on public.p2p_lesson_evaluations (group_submission_id) where group_submission_id is not null;
create index if not exists p2p_lesson_evaluations_resource_idx on public.p2p_lesson_evaluations (resource_kind, resource_id);

-- Rows created by older paths (e.g. 229's submission trigger) get their resource filled in.
create or replace function public.p2p_eval_resource_defaults() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.resource_kind = 'lesson' then
    new.resource_id := coalesce(new.resource_id, new.lesson_id);
    new.context := coalesce(new.context, p2p_growth_lesson_resource(new.lesson_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_eval_resource_defaults on public.p2p_lesson_evaluations;
create trigger trg_p2p_eval_resource_defaults before insert on public.p2p_lesson_evaluations
  for each row execute function public.p2p_eval_resource_defaults();

-- Why each person was invited (booleans and counts only — never a location).
alter table public.p2p_evaluation_assignments add column if not exists match_detail jsonb;

-- ── Assessment versions: a material revision restarts qualification ─────────
-- Learning credit already earned stays (the ledger is append-only); only the
-- right to EVALUATE the revised assessment needs a pass after the revision.
create table if not exists public.p2p_assessment_revisions (
  id            uuid primary key default gen_random_uuid(),
  resource_kind text not null check (resource_kind in ('lesson', 'group_assignment')),
  resource_id   uuid not null,
  revision      integer not null check (revision >= 2),
  reason        text not null check (char_length(btrim(reason)) >= 5),
  actor_id      uuid references public.p2p_profiles(id) on delete set null,
  revised_at    timestamptz not null default now(),
  unique (resource_kind, resource_id, revision)
);
create or replace function public.p2p_assessment_revisions_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'P2P_EVAL: assessment revisions are permanent' using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_assessment_revisions_append_only on public.p2p_assessment_revisions;
create trigger trg_p2p_assessment_revisions_append_only before update or delete on public.p2p_assessment_revisions
  for each row execute function public.p2p_assessment_revisions_append_only();

-- The current assessment version of a resource (1 until a material revision is recorded) and since when.
create or replace function public.p2p_assessment_version(p_kind text, p_resource uuid) returns table (version integer, since timestamptz)
  language sql stable security definer set search_path = public as $$
  select coalesce(max(r.revision), 1), max(r.revised_at) from p2p_assessment_revisions r where r.resource_kind = p_kind and r.resource_id = p_resource;
$$;

-- Record a material revision (an administrator, with a reason). Returns the new version.
create or replace function public.p2p_assessment_record_revision(p_kind text, p_resource uuid, p_actor uuid, p_reason text) returns integer
  language plpgsql security definer set search_path = public as $$
declare v int;
begin
  select coalesce(max(revision), 1) + 1 into v from p2p_assessment_revisions where resource_kind = p_kind and resource_id = p_resource;
  insert into p2p_assessment_revisions (resource_kind, resource_id, revision, reason, actor_id) values (p_kind, p_resource, v, btrim(p_reason), p_actor);
  return v;
end $$;

-- ── Qualification: ONE definition of who may evaluate a resource ─────────────
-- People who passed THIS resource (current assessment version) through an
-- independent evaluation. Everything else (eligibility checks, matching,
-- coverage, admin counts) reads this one function.
create or replace function public.p2p_eval_qualified_pool(p_kind text, p_resource uuid) returns table (user_id uuid, passed_at timestamptz)
  language sql stable security definer set search_path = public as $$
  with v as (select coalesce((select since from p2p_assessment_version(p_kind, p_resource)), '-infinity'::timestamptz) as since)
  select g.user_id, min(g.occurred_at) from p2p_growth_evidence g, v
   where p_kind = 'lesson' and g.evidence_type = 'learning.assessment_passed' and g.unit_key = 'lesson:' || p_resource
     and g.verification = 'verified' and g.voided_at is null and g.occurred_at >= v.since
   group by g.user_id
  union all
  select s.user_id, min(s.reviewed_at) from p2p_group_assignment_submissions s, v
   where p_kind = 'group_assignment' and s.assignment_id = p_resource and s.status = 'reviewed'
     and s.reviewed_by is not null and s.reviewed_by <> s.user_id and s.reviewed_at >= v.since
   group by s.user_id;
$$;

create or replace function public.p2p_eval_independently_qualified(p_user uuid, p_kind text, p_resource uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from p2p_eval_qualified_pool(p_kind, p_resource) q where q.user_id = p_user);
$$;

-- Does anyone (other than the submitter) independently qualify for this evaluation's resource?
create or replace function public.p2p_eval_resource_has_qualified(p_eval uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from p2p_lesson_evaluations e, p2p_eval_qualified_pool(e.resource_kind, e.resource_id) q
                  where e.id = p_eval and q.user_id is distinct from e.submitter_id);
$$;

-- Current member of the Family / Church a group assignment belongs to.
create or replace function public.p2p_eval_in_resource_group(p_user uuid, p_eval uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when e.resource_kind <> 'group_assignment' then true else coalesce((
    select (a.family_id is not null and exists (select 1 from p2p_family_members m where m.family_id = a.family_id and m.user_id = p_user and m.status = 'active'))
        or (a.church_id is not null and exists (select 1 from p2p_church_members m where m.church_id = a.church_id and m.user_id = p_user and m.is_active))
      from p2p_group_assignments a where a.id = e.resource_id), false) end
  from p2p_lesson_evaluations e where e.id = p_eval;
$$;

-- Safety only: may this person CONTINUE an evaluation they already accepted?
create or replace function public.p2p_eval_can_continue(p_user uuid, p_eval uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare e record; v_standing text;
begin
  select * into e from p2p_lesson_evaluations where id = p_eval;
  if e.id is null or p_user is null or p_user = e.submitter_id then return false; end if;
  select standing into v_standing from p2p_evaluator_profiles where user_id = p_user;
  if v_standing = 'restricted' then return false; end if;
  if exists (select 1 from p2p_account_status a where a.user_id = p_user and a.status <> 'active') then return false; end if;
  if exists (select 1 from p2p_user_blocks b where (b.blocker_id = p_user and b.blocked_id = e.submitter_id) or (b.blocker_id = e.submitter_id and b.blocked_id = p_user)) then return false; end if;
  if not p2p_minor_contact_allowed(p_user, e.submitter_id) then return false; end if;
  return p2p_eval_in_resource_group(p_user, p_eval);
end $$;

-- Full eligibility: safe, AND passed this exact resource independently (or the owner's cold-start rule).
create or replace function public.p2p_eval_can_evaluate(p_user uuid, p_eval uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare e record; s p2p_evaluation_settings := p2p_eval_settings(); v_role text;
begin
  if not p2p_eval_can_continue(p_user, p_eval) then return false; end if;
  select * into e from p2p_lesson_evaluations where id = p_eval;
  if p2p_eval_independently_qualified(p_user, e.resource_kind, e.resource_id) then return true; end if;
  -- Cold start only (owner decision, default OFF): nobody has independently passed this resource yet.
  if cardinality(s.bootstrap_roles) = 0 or p2p_eval_resource_has_qualified(p_eval) then return false; end if;
  select role::text into v_role from p2p_profiles where id = p_user;
  return v_role = any (s.bootstrap_roles);
end $$;

-- ── Matching: every eligible, available person, best first ──────────────────
create or replace function public.p2p_eval_tz_offset_hours(p_tz text) returns numeric
  language plpgsql stable set search_path = public as $$
begin
  if p_tz is null or btrim(p_tz) = '' then return null; end if;
  return extract(epoch from ((now() at time zone p_tz) - (now() at time zone 'UTC'))) / 3600.0;
exception when others then
  return null;
end $$;

-- Great-circle distance in km (only when both people voluntarily shared coordinates).
create or replace function public.p2p_eval_distance_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns numeric
  language sql immutable set search_path = public as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null else
    6371 * 2 * asin(least(1, sqrt(power(sin(radians((lat2 - lat1)::float8) / 2), 2)
      + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lon2 - lon1)::float8) / 2), 2))))::numeric end;
$$;

-- Weights, in priority order: exact-resource qualification is the gate; then
-- language, then progressively wider geography (nearby → city → region →
-- country → similar time zone → anywhere), then stage proximity, then fair
-- workload and recent performance. A newly qualified person who has never been
-- invited gets a small lift so the pool rotates.
create or replace function public.p2p_eval_candidates(p_eval uuid, p_limit integer default 20)
  returns table (user_id uuid, score numeric, basis text, reasons jsonb)
  language plpgsql stable security definer set search_path = public as $$
declare
  e record; s p2p_evaluation_settings := p2p_eval_settings();
  v_sub record; v_sub_stage int; v_sub_tz numeric; v_has_qualified boolean;
begin
  select * into e from p2p_lesson_evaluations where id = p_eval;
  if e.id is null then return; end if;
  select p.content_language, p.app_language, p.country_code, p.timezone, lower(btrim(p.city)) as city, lower(btrim(p.region)) as region,
         p.latitude, p.longitude into v_sub from p2p_profiles p where p.id = e.submitter_id;
  v_sub_stage := coalesce((select stage from p2p_growth_status where p2p_growth_status.user_id = e.submitter_id), 1);
  v_sub_tz := p2p_eval_tz_offset_hours(v_sub.timezone);
  v_has_qualified := p2p_eval_resource_has_qualified(p_eval);
  return query
  with pool as (
    select q.user_id as uid, 'passed_this_resource'::text as basis from p2p_eval_qualified_pool(e.resource_kind, e.resource_id) q
    union
    select p.id, 'bootstrap' from p2p_profiles p
     where not v_has_qualified and cardinality(s.bootstrap_roles) > 0 and p.role::text = any (s.bootstrap_roles)
  ), eligible as (
    select distinct on (pool.uid) pool.uid, pool.basis from pool
     where pool.uid is distinct from e.submitter_id
       and not exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = p_eval and x.evaluator_id = pool.uid)
       and p2p_eval_can_evaluate(pool.uid, p_eval)
     order by pool.uid, pool.basis desc   -- 'passed_this_resource' before 'bootstrap'
  ), scored as (
    select el.uid, el.basis, p.content_language, p.app_language, p.country_code,
           coalesce(ep.capacity, s.default_capacity) as cap,
           coalesce((select count(*) from p2p_evaluation_assignments a where a.evaluator_id = el.uid and a.status in ('invited', 'accepted')), 0)::int as active,
           coalesce((select count(*) from p2p_evaluation_assignments a where a.evaluator_id = el.uid and a.invited_at >= now() - interval '7 days'), 0)::int as invited_week,
           coalesce((select count(*) from p2p_evaluation_assignments a where a.evaluator_id = el.uid and a.status = 'completed'
                       and a.ended_at >= now() - make_interval(days => s.recent_window_days)), 0)::int as recent,
           coalesce((select count(*) from p2p_evaluation_assignments a where a.evaluator_id = el.uid and a.status = 'overdue' and a.ended_at >= now() - interval '90 days'), 0)::int as missed,
           coalesce((select count(*) from p2p_evaluation_assignments a where a.evaluator_id = el.uid and a.status = 'expired' and a.ended_at >= now() - interval '30 days'), 0)::int as expired,
           (select max(a.invited_at) from p2p_evaluation_assignments a where a.evaluator_id = el.uid) as last_invited,
           coalesce((select stage from p2p_growth_status gs where gs.user_id = el.uid), 1) - v_sub_stage as stage_gap,
           p2p_eval_tz_offset_hours(p.timezone) as tz,
           p2p_eval_distance_km(p.latitude, p.longitude, v_sub.latitude, v_sub.longitude) as km,
           lower(btrim(p.city)) as city, lower(btrim(p.region)) as region,
           exists (select 1 from p2p_lesson_evaluations o where o.evaluator_id = el.uid and o.submitter_id = e.submitter_id
                     and o.id <> p_eval and o.created_at >= now() - interval '90 days') as recently_paired,
           -- Reciprocity: the learner recently evaluated this candidate (A↔B approving each other).
           exists (select 1 from p2p_lesson_evaluations o where o.evaluator_id = e.submitter_id and o.submitter_id = el.uid
                     and o.status = 'approved' and o.created_at >= now() - interval '90 days') as reciprocal
      from eligible el
      join p2p_profiles p on p.id = el.uid
      left join p2p_evaluator_profiles ep on ep.user_id = el.uid
     where coalesce(ep.available, true) and (ep.unavailable_until is null or ep.unavailable_until <= now())
  ), ranked as (
    select sc.*,
           case when sc.content_language is not null and sc.content_language = v_sub.content_language then 8
                when sc.app_language is not null and sc.app_language = v_sub.app_language then 4 else 0 end as lang_pts,
           case when sc.km is not null and sc.km <= 50 then 4
                when sc.city is not null and sc.city <> '' and sc.city = v_sub.city and sc.country_code is not distinct from v_sub.country_code then 3.5
                when sc.region is not null and sc.region <> '' and sc.region = v_sub.region and sc.country_code is not distinct from v_sub.country_code then 3
                when sc.country_code is not null and sc.country_code = v_sub.country_code then 2
                when sc.tz is not null and v_sub_tz is not null and abs(sc.tz - v_sub_tz) <= 3 then 1 else 0 end as near_pts,
           case when sc.stage_gap between 1 and 2 then 1.5 when sc.stage_gap >= 3 then 0.75 when sc.stage_gap = 0 then 0.25 else 0 end as stage_pts
      from scored sc where sc.active < sc.cap
  )
  select r.uid,
         (r.lang_pts + r.near_pts + r.stage_pts
          - 2 * r.active - 1 * r.invited_week - 0.5 * r.recent - 2 * r.missed - 0.5 * r.expired
          + case when r.last_invited is null then 0.5 else 0 end
          - case when r.recently_paired then 1 else 0 end - case when r.reciprocal then 3 else 0 end
          - case when r.basis = 'bootstrap' then 20 else 0 end)::numeric,
         r.basis,
         jsonb_build_object(
           'basis', r.basis,
           'language', case when r.lang_pts = 8 then 'same_content_language' when r.lang_pts = 4 then 'same_app_language' else 'different_or_unknown' end,
           'proximity', case when r.near_pts = 4 then 'nearby' when r.near_pts = 3.5 then 'same_city' when r.near_pts = 3 then 'same_region'
                             when r.near_pts = 2 then 'same_country' when r.near_pts = 1 then 'similar_time_zone' else 'international_or_unknown' end,
           'stagesAhead', r.stage_gap,
           'activeEvaluations', r.active, 'invitedThisWeek', r.invited_week, 'completedRecently', r.recent,
           'missedDeadlines90d', r.missed, 'expiredInvitations30d', r.expired, 'newlyQualified', r.last_invited is null,
           'recentlyEvaluatedThisLearner', r.recently_paired, 'reciprocalWithLearner', r.reciprocal)
    from ranked r
   order by 2 desc, r.last_invited asc nulls first, md5(r.uid::text || p_eval::text)
   limit greatest(p_limit, 1);
end $$;

-- ── Integrity: reciprocal approvals (A approves B and B approves A) ──────────
create or replace view public.p2p_eval_reciprocal_pairs as
  with ab as (
    select least(e.evaluator_id, e.submitter_id) as a, greatest(e.evaluator_id, e.submitter_id) as b,
           count(*) filter (where e.evaluator_id < e.submitter_id) as a_approved_b,
           count(*) filter (where e.evaluator_id > e.submitter_id) as b_approved_a,
           max(e.resolved_at) as last_at
      from p2p_lesson_evaluations e
     where e.status = 'approved' and not coalesce(e.self_approved, false) and e.evaluator_id is not null and e.submitter_id is not null
       and e.evaluator_id <> e.submitter_id and e.resolved_at >= now() - interval '180 days'
     group by 1, 2
  )
  select md5(a::text || ':' || b::text) as pair_key, a as person_a, b as person_b, a_approved_b::int, b_approved_a::int, last_at
    from ab where a_approved_b > 0 and b_approved_a > 0;

create table if not exists public.p2p_eval_integrity_reviews (
  id         uuid primary key default gen_random_uuid(),
  pair_key   text not null,
  decision   text not null check (decision in ('no_concern', 'concern_raised', 'evidence_voided')),
  note       text not null check (char_length(btrim(note)) >= 5),
  actor_id   uuid references public.p2p_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
drop trigger if exists trg_p2p_eval_integrity_reviews_append_only on public.p2p_eval_integrity_reviews;
create trigger trg_p2p_eval_integrity_reviews_append_only before update or delete on public.p2p_eval_integrity_reviews
  for each row execute function public.p2p_assessment_revisions_append_only();

-- ── Operations at a glance (administrators; counts and timings only) ────────
create or replace function public.p2p_eval_operations() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'qualifiedEvaluators', (select count(distinct user_id) from p2p_growth_evidence where evidence_type = 'learning.assessment_passed' and verification = 'verified' and voided_at is null),
    'resourcesWithQualifiedPeople', (select count(distinct unit_key) from p2p_growth_evidence where evidence_type = 'learning.assessment_passed' and verification = 'verified' and voided_at is null),
    'pending', (select count(*) from p2p_lesson_evaluations where engine_state in ('queued', 'invited', 'in_progress')),
    'unassigned', (select count(*) from p2p_lesson_evaluations where engine_state = 'queued'),
    'expired30d', (select count(*) from p2p_evaluation_assignments where status = 'expired' and ended_at >= now() - interval '30 days'),
    'reassigned30d', (select count(*) from p2p_evaluation_assignments where status in ('declined', 'expired', 'unable', 'overdue', 'removed', 'unavailable') and ended_at >= now() - interval '30 days'),
    'medianHoursToAccept', (select round((percentile_cont(0.5) within group (order by extract(epoch from accepted_at - invited_at) / 3600))::numeric, 1)
                              from p2p_evaluation_assignments where accepted_at is not null and invited_at >= now() - interval '90 days'),
    'medianHoursToComplete', (select round((percentile_cont(0.5) within group (order by extract(epoch from ended_at - accepted_at) / 3600))::numeric, 1)
                                from p2p_evaluation_assignments where status = 'completed' and accepted_at is not null and ended_at >= now() - interval '90 days'),
    'workload', (select coalesce(jsonb_agg(jsonb_build_object('activeEvaluations', n, 'people', people) order by n), '[]'::jsonb)
                   from (select n, count(*)::int people from (select evaluator_id, count(*)::int n from p2p_evaluation_assignments
                                                                where status in ('invited', 'accepted') group by 1) x group by n) y),
    'reciprocalPairs', (select count(*) from p2p_eval_reciprocal_pairs r
                         where not exists (select 1 from p2p_eval_integrity_reviews v where v.pair_key = r.pair_key and v.created_at >= r.last_at)));
$$;

create or replace function public.p2p_eval_pick(p_eval uuid) returns uuid

  language sql stable security definer set search_path = public as $$
  select user_id from p2p_eval_candidates(p_eval, 1);
$$;

-- A resource's title, whatever its kind.
create or replace function public.p2p_eval_resource_title(p_eval uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.title from p2p_lesson_evaluations e join p2p_lessons l on l.id = e.lesson_id where e.id = p_eval),
    (select a.title from p2p_lesson_evaluations e join p2p_group_assignments a on a.id = e.resource_id where e.id = p_eval and e.resource_kind = 'group_assignment'));
$$;

-- ── The engine step (229), now recording why someone was invited ────────────
create or replace function public.p2p_eval_advance(p_eval uuid, p_reason text, p_actor_type text default 'system', p_actor uuid default null)
  returns text language plpgsql security definer set search_path = public as $$
declare
  e p2p_lesson_evaluations; s p2p_evaluation_settings := p2p_eval_settings();
  v_next record; v_attempt integer; v_assignment uuid; v_lesson text; v_minutes integer; v_coord uuid;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.engine_state is null or e.engine_state in ('completed', 'cancelled') then return 'closed'; end if;
  if exists (select 1 from p2p_evaluation_assignments where evaluation_id = p_eval and status in ('invited', 'accepted')) then return 'active'; end if;

  select * into v_next from p2p_eval_candidates(p_eval, 1);
  v_lesson := p2p_eval_resource_title(p_eval);

  if v_next.user_id is null then
    v_minutes := least(s.queue_retry_cap_minutes, s.queue_retry_minutes * (2 ^ least(e.attempts, 10))::integer);
    update p2p_lesson_evaluations set engine_state = 'queued', evaluator_id = null, current_assignment_id = null,
      accepted_at = null, deadline_at = null, queued_since = coalesce(queued_since, now()),
      next_attempt_at = now() + make_interval(mins => v_minutes), attempts = attempts + 1
      where id = p_eval returning * into e;
    perform p2p_eval_event(p_eval, null, 'queued', p_actor_type, p_actor,
      jsonb_build_object('reason', p_reason, 'retryInMinutes', v_minutes, 'qualifiedPeople', p2p_eval_resource_has_qualified(p_eval)), null);
    perform p2p_eval_notify(e.submitter_id, 'evaluation_arranging', 'Arranging your evaluation',
      'P2P Global is arranging a qualified evaluator for your submission. It is safe — we''ll let you know when someone accepts.',
      jsonb_build_object('evaluationId', p_eval), format('eval:%s:arranging:%s', p_eval, e.queued_since));
    for v_coord in select * from p2p_eval_coordinators() loop
      perform p2p_eval_notify(v_coord, 'evaluation_unassigned', 'An evaluation needs an evaluator',
        format('No one available has passed "%s" yet. P2P keeps trying automatically.', coalesce(v_lesson, 'this resource')),
        jsonb_build_object('evaluationId', p_eval), format('eval:%s:unassigned:%s:%s', p_eval, e.queued_since, v_coord));
    end loop;
    return 'queued';
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt from p2p_evaluation_assignments where evaluation_id = p_eval;
  insert into p2p_evaluation_assignments (evaluation_id, evaluator_id, attempt, invite_expires_at, actor_type, actor_id, match_detail)
  values (p_eval, v_next.user_id, v_attempt, now() + make_interval(mins => s.invitation_window_minutes),
          case when p_actor_type = 'admin' then 'admin' else 'system' end, case when p_actor_type = 'admin' then p_actor end,
          v_next.reasons || jsonb_build_object('score', v_next.score))
  returning id into v_assignment;
  update p2p_lesson_evaluations set engine_state = 'invited', current_assignment_id = v_assignment, evaluator_id = null,
    accepted_at = null, deadline_at = null, next_attempt_at = null
    where id = p_eval;
  perform p2p_eval_event(p_eval, v_assignment, 'invited', p_actor_type, p_actor,
    jsonb_build_object('reason', p_reason, 'attempt', v_attempt, 'basis', v_next.basis), format('assignment:%s:invited', v_assignment));
  perform p2p_eval_notify(v_next.user_id, 'evaluation_invitation', 'You''re invited to serve as an evaluator',
    format(case when v_next.basis = 'bootstrap'
             then 'A fellow participant submitted work on "%s". Please accept or decline within %s hours.'
             else 'You passed "%s" — a fellow participant has now submitted work on it. Please accept or decline within %s hours.' end,
           coalesce(v_lesson, 'a lesson'), round(s.invitation_window_minutes / 60.0, 1)),
    jsonb_build_object('evaluationId', p_eval, 'assignmentId', v_assignment), format('assignment:%s:invite-notice', v_assignment));
  return 'invited';
end $$;

-- ── Accepting: no separate orientation — the commitments are agreed on acceptance ─
create or replace function public.p2p_eval_accept(p_assignment uuid, p_user uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a p2p_evaluation_assignments; e p2p_lesson_evaluations; v_now timestamptz := now(); v_conv uuid; v_s p2p_evaluation_settings := p2p_eval_settings();
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into a from p2p_evaluation_assignments where id = p_assignment;
  if a.id is null or a.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into e from p2p_lesson_evaluations where id = a.evaluation_id for update;
  select * into a from p2p_evaluation_assignments where id = p_assignment for update;
  if a.status = 'accepted' then return jsonb_build_object('ok', true, 'already', true, 'deadlineAt', a.deadline_at); end if;
  if a.status <> 'invited' or e.current_assignment_id is distinct from a.id then return jsonb_build_object('ok', false, 'error', 'no_longer_available'); end if;
  if a.invite_expires_at <= v_now then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not p2p_eval_can_evaluate(p_user, e.id) then return jsonb_build_object('ok', false, 'error', 'not_eligible'); end if;
  -- The commitments shown with the invitation are recorded with the first acceptance (no separate sign-up).
  insert into p2p_evaluator_profiles (user_id, orientation_version, orientation_acknowledged_at, commitment)
  values (p_user, v_s.orientation_version, v_now, jsonb_build_object('acceptedWith', 'invitation', 'at', v_now))
  on conflict (user_id) do update set
    orientation_version = greatest(coalesce(p2p_evaluator_profiles.orientation_version, 0), excluded.orientation_version),
    orientation_acknowledged_at = coalesce(p2p_evaluator_profiles.orientation_acknowledged_at, excluded.orientation_acknowledged_at),
    commitment = coalesce(p2p_evaluator_profiles.commitment, excluded.commitment), updated_at = v_now;
  update p2p_evaluation_assignments set status = 'accepted', responded_at = v_now, accepted_at = v_now, deadline_at = v_now + interval '48 hours' where id = a.id;
  update p2p_lesson_evaluations set engine_state = 'in_progress', evaluator_id = p_user, accepted_at = v_now,
    deadline_at = v_now + interval '48 hours', assigned_at = v_now where id = e.id;
  select id into v_conv from p2p_conversations where evaluation_id = e.id;
  if v_conv is not null then
    insert into p2p_conversation_members (conversation_id, user_id) select v_conv, p_user
      where not exists (select 1 from p2p_conversation_members where conversation_id = v_conv and user_id = p_user);
  end if;
  perform p2p_eval_event(e.id, a.id, 'accepted', 'evaluator', p_user, jsonb_build_object('deadlineAt', v_now + interval '48 hours'), format('assignment:%s:accepted', a.id));
  perform p2p_eval_notify(e.submitter_id, 'evaluation_accepted',
    case when exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = e.id and x.status in ('unable', 'overdue', 'removed', 'unavailable'))
      then 'Your new evaluator has accepted' else 'An evaluator has accepted your submission' end,
    case when exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = e.id and x.status in ('unable', 'overdue', 'removed', 'unavailable'))
      then 'Your new evaluator has accepted responsibility for your evaluation. Your review is now in progress.'
      else 'A fellow participant has accepted responsibility for reviewing your submission. Your review is now in progress.' end,
    jsonb_build_object('evaluationId', e.id), format('assignment:%s:accepted-notice', a.id));
  return jsonb_build_object('ok', true, 'acceptedAt', v_now, 'deadlineAt', v_now + interval '48 hours');
end $$;

-- ── Submitting: lesson results as before; group assignments are marked reviewed/returned ─
create or replace function public.p2p_eval_submit(p_eval uuid, p_user uuid, p_outcome text, p_detail jsonb, p_summary text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e p2p_lesson_evaluations; a p2p_evaluation_assignments; v_status text;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.engine_state = 'completed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if e.engine_state <> 'in_progress' then return jsonb_build_object('ok', false, 'error', 'not_active'); end if;
  if e.deadline_at <= now() then return jsonb_build_object('ok', false, 'error', 'deadline_passed'); end if;
  if p_outcome not in ('passed', 'passed_with_recommendations', 'revision_required', 'further_discussion', 'clarification_required') then return jsonb_build_object('ok', false, 'error', 'outcome_required'); end if;
  select * into a from p2p_evaluation_assignments where id = e.current_assignment_id for update;
  v_status := case when p_outcome in ('passed', 'passed_with_recommendations') then 'approved' else 'needs_revision' end;
  update p2p_evaluation_assignments set status = 'completed', ended_at = now(), end_reason = 'completed', draft = null where id = a.id;
  update p2p_lesson_evaluations set outcome = p_outcome, feedback_detail = p_detail, feedback = left(p_summary, 4000),
    status = v_status, engine_state = 'completed', current_assignment_id = null, next_attempt_at = null
    where id = e.id;
  if e.resource_kind = 'group_assignment' then
    update p2p_group_assignment_submissions
       set status = case when v_status = 'approved' then 'reviewed' else 'returned' end,
           feedback = left(p_summary, 4000), reviewed_by = p_user, reviewed_at = now()
     where id = e.group_submission_id and status = 'submitted';
  end if;
  perform p2p_eval_event(e.id, a.id, 'completed', 'evaluator', p_user, jsonb_build_object('outcome', p_outcome, 'onTime', true), format('eval:%s:completed', e.id));
  perform p2p_eval_notify(e.submitter_id, 'evaluation_feedback_ready', 'Your feedback is ready',
    'Your evaluator has completed their review. Open it to read their feedback and encouragement.',
    jsonb_build_object('evaluationId', e.id), format('eval:%s:feedback-ready', e.id));
  -- The submitter's and the evaluator's growth evidence is recorded by the Growth Matrix queue.
  perform p2p_growth_enqueue(e.submitter_id, 'evaluation_completed');
  perform p2p_growth_enqueue(p_user, 'evaluation_given');
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- ── Cancel an engine evaluation that is no longer needed (history kept) ─────
create or replace function public.p2p_eval_cancel(p_eval uuid, p_reason text, p_actor_type text default 'system', p_actor uuid default null) returns text
  language plpgsql security definer set search_path = public as $$
declare e p2p_lesson_evaluations; a p2p_evaluation_assignments;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.engine_state is null or e.engine_state in ('completed', 'cancelled') then return 'closed'; end if;
  select * into a from p2p_evaluation_assignments where evaluation_id = p_eval and status in ('invited', 'accepted') for update;
  if a.id is not null then
    update p2p_evaluation_assignments set status = 'cancelled', ended_at = now(), end_reason = left(p_reason, 60), draft = null where id = a.id;
    if a.status = 'accepted' then
      perform p2p_eval_notify(a.evaluator_id, 'evaluation_cancelled', 'This evaluation is no longer needed',
        'The submission you accepted has been reviewed another way, so there is nothing more to do. Thank you for serving.',
        jsonb_build_object('evaluationId', p_eval), format('assignment:%s:cancelled-notice', a.id));
    end if;
  end if;
  update p2p_lesson_evaluations set engine_state = 'cancelled', current_assignment_id = null, evaluator_id = null,
    accepted_at = null, deadline_at = null, next_attempt_at = null where id = p_eval;
  perform p2p_eval_event(p_eval, a.id, 'cancelled', p_actor_type, p_actor, jsonb_build_object('reason', p_reason), format('eval:%s:cancelled', p_eval));
  return 'cancelled';
end $$;

-- ── Family / Church group assignments enter the engine (only when switched on) ─
create or replace function public.p2p_eval_on_group_submission() returns trigger
  language plpgsql security definer set search_path = public as $$
declare s p2p_evaluation_settings := p2p_eval_settings(); v_eval uuid; v_ctx text; r record;
begin
  if not (s.engine_enabled and s.group_assignments_enabled) then return new; end if;
  perform set_config('p2p.eval_engine', 'on', true);
  -- A resubmission replaces any earlier attempt still waiting for an evaluator.
  for r in select e.id from p2p_lesson_evaluations e join p2p_group_assignment_submissions g on g.id = e.group_submission_id
            where g.assignment_id = new.assignment_id and g.user_id = new.user_id and g.id <> new.id
              and e.engine_state in ('queued', 'invited', 'in_progress') loop
    perform p2p_eval_cancel(r.id, 'resubmitted');
  end loop;
  select case when a.family_id is not null then 'family' else 'church' end into v_ctx from p2p_group_assignments a where a.id = new.assignment_id;
  insert into p2p_lesson_evaluations (resource_kind, resource_id, group_submission_id, context, submitter_id, evaluator_id, status, assigned_at, engine_state, queued_since)
  values ('group_assignment', new.assignment_id, new.id, v_ctx, new.user_id, null, 'pending', now(), 'queued', now())
  on conflict do nothing
  returning id into v_eval;
  if v_eval is not null then
    perform p2p_eval_event(v_eval, null, 'submitted', 'evaluatee', new.user_id, jsonb_build_object('groupSubmissionId', new.id), format('eval:%s:submitted', v_eval));
    perform p2p_eval_advance(v_eval, 'submitted', 'system', null);
  end if;
  return new;
exception when others then
  -- Never block the learner's submission; the group leader can still review it.
  raise warning 'P2P_EVAL: could not queue a group assignment evaluation: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_p2p_eval_on_group_submission on public.p2p_group_assignment_submissions;
create trigger trg_p2p_eval_on_group_submission after insert on public.p2p_group_assignment_submissions
  for each row execute function public.p2p_eval_on_group_submission();

-- The group leader's own review (outside the engine) closes the engine evaluation.
create or replace function public.p2p_eval_on_group_review() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_eval uuid;
begin
  if coalesce(current_setting('p2p.eval_engine', true), '') = 'on' then return new; end if;
  select id into v_eval from p2p_lesson_evaluations where group_submission_id = new.id and engine_state in ('queued', 'invited', 'in_progress');
  if v_eval is not null then perform p2p_eval_cancel(v_eval, 'reviewed_by_group_leader', 'system', new.reviewed_by); end if;
  return new;
end $$;
drop trigger if exists trg_p2p_eval_on_group_review on public.p2p_group_assignment_submissions;
create trigger trg_p2p_eval_on_group_review after update of status on public.p2p_group_assignment_submissions
  for each row when (old.status = 'submitted' and new.status in ('reviewed', 'returned')) execute function public.p2p_eval_on_group_review();

-- ── The sweep (229) — accepted work is checked for SAFETY only ──────────────
create or replace function public.p2p_eval_sweep(p_limit integer default 200) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r record; n_expired int := 0; n_overdue int := 0; n_reminded int := 0; n_retried int := 0; n_unavailable int := 0; n_escalated int := 0;
  v_left interval; v_coord uuid; v_lesson text;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  for r in select id from p2p_evaluation_assignments where status = 'invited' and invite_expires_at <= now() order by invite_expires_at limit p_limit loop
    perform p2p_eval_end_and_reassign(r.id, 'expired', 'invitation_expired', 'system', null); n_expired := n_expired + 1;
  end loop;
  for r in select a.id, a.evaluator_id, a.evaluation_id from p2p_evaluation_assignments a where a.status = 'accepted' and a.deadline_at <= now() order by a.deadline_at limit p_limit loop
    perform 1 from p2p_lesson_evaluations where id = r.evaluation_id for update;
    continue when not exists (select 1 from p2p_evaluation_assignments where id = r.id and status = 'accepted' and deadline_at <= now());
    perform p2p_eval_notify(r.evaluator_id, 'evaluation_missed_deadline', 'Your evaluation time has ended',
      'The 48 hours for this evaluation have passed, so P2P Global has given it to another evaluator. Thank you for serving — if something got in the way, you can share it privately with the coordinators.',
      jsonb_build_object('evaluationId', r.evaluation_id), format('assignment:%s:missed-notice', r.id));
    perform p2p_eval_end_and_reassign(r.id, 'overdue', 'deadline_passed', 'system', null); n_overdue := n_overdue + 1;
  end loop;
  -- Invitations: full eligibility. Accepted work: safety only (a rule change never takes accepted work away).
  for r in select a.id from p2p_evaluation_assignments a
            where (a.status = 'invited' and not p2p_eval_can_evaluate(a.evaluator_id, a.evaluation_id))
               or (a.status = 'accepted' and not p2p_eval_can_continue(a.evaluator_id, a.evaluation_id))
            limit p_limit loop
    perform p2p_eval_end_and_reassign(r.id, 'unavailable', 'no_longer_eligible', 'system', null); n_unavailable := n_unavailable + 1;
  end loop;
  for r in select a.* from p2p_evaluation_assignments a where a.status = 'accepted' and a.deadline_at > now() and a.deadline_at - now() <= interval '24 hours'
           and (a.reminded_24_at is null or (a.deadline_at - now() <= interval '12 hours' and a.reminded_12_at is null) or (a.deadline_at - now() <= interval '6 hours' and a.reminded_6_at is null))
           limit p_limit for update skip locked loop
    v_left := r.deadline_at - now();
    if v_left <= interval '6 hours' then
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'About 6 hours left', 'Your evaluation is due in about 6 hours. If you can''t finish, please report it so P2P can arrange someone else.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'urgent'), format('assignment:%s:reminder-6', r.id));
      update p2p_evaluation_assignments set reminded_6_at = now(), reminded_12_at = coalesce(reminded_12_at, now()), reminded_24_at = coalesce(reminded_24_at, now()) where id = r.id;
    elsif v_left <= interval '12 hours' then
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'About 12 hours left', 'Your evaluation is due in about 12 hours. Thank you for serving faithfully.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'priority'), format('assignment:%s:reminder-12', r.id));
      update p2p_evaluation_assignments set reminded_12_at = now(), reminded_24_at = coalesce(reminded_24_at, now()) where id = r.id;
    else
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'A day left for your evaluation', 'A friendly reminder: your evaluation is due in about 24 hours.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'friendly'), format('assignment:%s:reminder-24', r.id));
      update p2p_evaluation_assignments set reminded_24_at = now() where id = r.id;
    end if;
    n_reminded := n_reminded + 1;
  end loop;
  for r in select id from p2p_lesson_evaluations where engine_state = 'queued' and next_attempt_at <= now() order by next_attempt_at limit p_limit for update skip locked loop
    perform p2p_eval_advance(r.id, 'retry', 'system', null); n_retried := n_retried + 1;
  end loop;
  for r in select a.id, a.evaluation_id, a.deadline_at, a.escalated_12_at, a.escalated_24_at from p2p_evaluation_assignments a
           join p2p_lesson_evaluations e on e.id = a.evaluation_id
           where a.status = 'overdue' and e.engine_state in ('queued', 'invited')
             and ((a.deadline_at <= now() - interval '12 hours' and a.escalated_12_at is null) or (a.deadline_at <= now() - interval '24 hours' and a.escalated_24_at is null))
           limit p_limit for update of a skip locked loop
    v_lesson := p2p_eval_resource_title(r.evaluation_id);
    for v_coord in select * from p2p_eval_coordinators() loop
      perform p2p_eval_notify(v_coord, 'evaluation_escalation',
        case when r.deadline_at <= now() - interval '24 hours' then 'Evaluation unresolved for 24 hours' else 'Evaluation unresolved for 12 hours' end,
        format('An evaluation of "%s" still has no accepted evaluator after a missed deadline.', coalesce(v_lesson, 'a resource')),
        jsonb_build_object('evaluationId', r.evaluation_id),
        format('assignment:%s:escalate-%s:%s', r.id, case when r.deadline_at <= now() - interval '24 hours' then '24' else '12' end, v_coord));
    end loop;
    update p2p_evaluation_assignments set escalated_12_at = coalesce(escalated_12_at, now()),
      escalated_24_at = case when r.deadline_at <= now() - interval '24 hours' then coalesce(escalated_24_at, now()) else escalated_24_at end
      where id = r.id;
    n_escalated := n_escalated + 1;
  end loop;
  perform p2p_eval_event(null, null, 'sweep', 'system', null, jsonb_build_object('expired', n_expired, 'overdue', n_overdue, 'unavailable', n_unavailable, 'reminded', n_reminded, 'retried', n_retried, 'escalated', n_escalated), null);
  return jsonb_build_object('expired', n_expired, 'overdue', n_overdue, 'unavailable', n_unavailable, 'reminded', n_reminded, 'retried', n_retried, 'escalated', n_escalated);
end $$;

-- When someone newly passes a resource, waiting evaluations of that resource are
-- re-tried at the next sweep (instead of waiting out their backoff).
create or replace function public.p2p_eval_requeue_on_new_qualifier() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.evidence_type = 'learning.assessment_passed' and new.unit_key like 'lesson:%' then
    update p2p_lesson_evaluations set next_attempt_at = least(coalesce(next_attempt_at, now()), now())
     where engine_state = 'queued' and resource_kind = 'lesson' and 'lesson:' || resource_id = new.unit_key and submitter_id <> new.user_id;
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists trg_p2p_eval_requeue_on_new_qualifier on public.p2p_growth_evidence;
create trigger trg_p2p_eval_requeue_on_new_qualifier after insert on public.p2p_growth_evidence
  for each row execute function public.p2p_eval_requeue_on_new_qualifier();

-- ── Coverage for coordinators: resources waiting with nobody qualified ───────
create or replace view public.p2p_eval_coverage as
  select e.resource_kind, e.resource_id, e.context, p2p_eval_resource_title(e.id) as title,
         count(*)::int as waiting, min(e.queued_since) as waiting_since,
         bool_or(p2p_eval_resource_has_qualified(e.id)) as has_qualified_people
    from p2p_lesson_evaluations e
   where e.engine_state = 'queued'
   group by e.resource_kind, e.resource_id, e.context, p2p_eval_resource_title(e.id);

-- ── Access: service role only ───────────────────────────────────────────────
revoke all on public.p2p_eval_coverage, public.p2p_eval_reciprocal_pairs from public, anon, authenticated;
grant select on public.p2p_eval_coverage, public.p2p_eval_reciprocal_pairs to service_role;
alter table public.p2p_assessment_revisions enable row level security;
alter table public.p2p_eval_integrity_reviews enable row level security;
revoke all on public.p2p_assessment_revisions, public.p2p_eval_integrity_reviews from public, anon, authenticated;
grant select, insert on public.p2p_assessment_revisions, public.p2p_eval_integrity_reviews to service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'p2p_eval_independently_qualified(uuid, text, uuid)', 'p2p_eval_resource_has_qualified(uuid)', 'p2p_eval_in_resource_group(uuid, uuid)',
    'p2p_eval_can_continue(uuid, uuid)', 'p2p_eval_can_evaluate(uuid, uuid)', 'p2p_eval_tz_offset_hours(text)', 'p2p_eval_candidates(uuid, integer)',
    'p2p_eval_pick(uuid)', 'p2p_eval_resource_title(uuid)', 'p2p_eval_advance(uuid, text, text, uuid)', 'p2p_eval_accept(uuid, uuid)',
    'p2p_eval_submit(uuid, uuid, text, jsonb, text)', 'p2p_eval_cancel(uuid, text, text, uuid)', 'p2p_eval_sweep(integer)',
    'p2p_assessment_version(text, uuid)', 'p2p_assessment_record_revision(text, uuid, uuid, text)', 'p2p_eval_qualified_pool(text, uuid)',
    'p2p_eval_distance_km(numeric, numeric, numeric, numeric)', 'p2p_eval_operations()']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['p2p_eval_resource_defaults()', 'p2p_eval_on_group_submission()', 'p2p_eval_on_group_review()', 'p2p_eval_requeue_on_new_qualifier()', 'p2p_assessment_revisions_append_only()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── A fresh start (owner decision, 2026-11-05) ───────────────────────────────
-- Every evaluation still WAITING when this migration runs — queued or invited,
-- never one an evaluator has already accepted — is closed as 'cancelled' with
-- the reason 'fresh_start'. Nothing is deleted: each one keeps its history
-- and gains a 'cancelled' event; the learner's answers and lesson progress are
-- untouched, and nobody is notified. The learner answers that Comprehensive
-- Check again when they're ready, and the universal engine evaluates the new
-- answer from scratch. Older waiting rows outside the engine are closed the same way.
do $$
declare r record; n int := 0; m int := 0;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  for r in select id from public.p2p_lesson_evaluations where engine_state in ('queued', 'invited') loop
    perform public.p2p_eval_cancel(r.id, 'fresh_start', 'system', null);
    n := n + 1;
  end loop;
  for r in select id from public.p2p_lesson_evaluations where engine_state is null and status = 'pending' loop
    update public.p2p_lesson_evaluations set engine_state = 'cancelled', next_attempt_at = null where id = r.id;
    perform public.p2p_eval_event(r.id, null, 'cancelled', 'system', null, jsonb_build_object('reason', 'fresh_start'), format('eval:%s:cancelled', r.id));
    m := m + 1;
  end loop;
  raise notice 'P2P_EVAL_240: fresh start — % waiting engine evaluations and % older waiting rows closed (history kept, no notifications)', n, m;
end $$;

commit;

-- Rollback (nothing here deletes data): re-run the 229 definitions of p2p_eval_can_evaluate, p2p_eval_pick,
--   p2p_eval_advance, p2p_eval_accept, p2p_eval_submit and p2p_eval_sweep; drop triggers trg_p2p_eval_on_group_submission,
--   trg_p2p_eval_on_group_review, trg_p2p_eval_requeue_on_new_qualifier, trg_p2p_eval_resource_defaults; drop view
--   p2p_eval_coverage and p2p_eval_reciprocal_pairs. Group-assignment evaluation rows (if the option was used) must be cancelled first, after which
--   submission_id / lesson_id can return to NOT NULL. New columns may stay.
