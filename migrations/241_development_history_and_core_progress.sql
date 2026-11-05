-- 241 — Development history (mentorship snapshots and checkpoints) and Core
-- Foundations Curriculum progress. Written 2026-11-05. REQUIRES 233, 239, 240.
-- NOT APPLIED. Additive; nothing is deleted; no stage changes.
--
-- 1. Mentorship checkpoints (p2p_mentorship_checkpoints, append-only):
--    every designated Peer Guide relationship keeps an immutable record of
--    BOTH people's verified stage at its start, at every stage change of
--    either person while it lasts, and at its end. They are written at the
--    moment things happen — never reconstructed from someone's current stage.
--    Relationships that began before this record existed get a start
--    checkpoint marked 'unavailable' (the stages then are unknown) and a
--    'baseline' checkpoint with the stages as they are now. Corrections are new
--    'correction' checkpoints that point at the one corrected (audited).
-- 2. p2p_development_history(person): the designated relationships (as
--    participant and as Guide, current and previous) with their checkpoints
--    and the verified contributions made inside each one; the wider
--    contribution network (everyone who verifiably helped this person —
--    Pastors, Shepherds and others included only through real evidence, never
--    a title); and onward generations (people this person helped who went on
--    to help others). Counts and dates from the evidence ledger only.
-- 3. p2p_core_curriculum_progress(person): every lesson of Kingdom School
--    Foundations (all published Kingdom School curricula, future lessons
--    included) with each lesson's status — passed only when its assessment was
--    passed through an independent evaluation.

begin;

-- ── 1. Mentorship checkpoints ────────────────────────────────────────────────
create table if not exists public.p2p_mentorship_checkpoints (
  id                        uuid primary key default gen_random_uuid(),
  link_id                   uuid not null references public.p2p_discipleship_links(id) on delete cascade,
  participant_id            uuid references public.p2p_profiles(id) on delete set null,
  guide_id                  uuid references public.p2p_profiles(id) on delete set null,
  kind                      text not null check (kind in ('start', 'stage_change', 'end', 'baseline', 'correction')),
  at                        timestamptz not null default now(),
  participant_stage         smallint check (participant_stage between 1 and 5),
  guide_stage               smallint check (guide_stage between 1 and 5),
  participant_verification  text,
  guide_verification        text,
  source                    text not null check (source in ('recorded', 'unavailable', 'correction')),
  changed_person            text check (changed_person in ('participant', 'guide')),
  corrects_checkpoint_id    uuid references public.p2p_mentorship_checkpoints(id) on delete set null,
  actor_id                  uuid references public.p2p_profiles(id) on delete set null,
  note                      text check (note is null or char_length(note) <= 1000),
  constraint p2p_mentorship_checkpoints_unavailable check (source <> 'unavailable' or (participant_stage is null and guide_stage is null)),
  constraint p2p_mentorship_checkpoints_correction check ((kind = 'correction') = (corrects_checkpoint_id is not null and source = 'correction'))
);
create index if not exists idx_p2p_mentorship_checkpoints_link on public.p2p_mentorship_checkpoints (link_id, at);
create unique index if not exists p2p_mentorship_checkpoints_one_start on public.p2p_mentorship_checkpoints (link_id) where kind = 'start';
create unique index if not exists p2p_mentorship_checkpoints_one_end on public.p2p_mentorship_checkpoints (link_id) where kind = 'end';

create or replace function public.p2p_mentorship_checkpoints_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from p2p_discipleship_links where id = old.link_id) then return old; end if;
  raise exception 'P2P_GENEALOGY: checkpoints are permanent — add a correction instead' using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_mentorship_checkpoints_append_only on public.p2p_mentorship_checkpoints;
create trigger trg_p2p_mentorship_checkpoints_append_only before update or delete on public.p2p_mentorship_checkpoints
  for each row execute function public.p2p_mentorship_checkpoints_append_only();

-- Write one checkpoint with both people's stages as they are at this moment.
create or replace function public.p2p_mentorship_checkpoint(p_link uuid, p_kind text, p_changed text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare l record; ps record; gs record;
begin
  select * into l from p2p_discipleship_links where id = p_link;
  if l.id is null then return; end if;
  select stage, verification into ps from p2p_growth_status where user_id = l.disciple_id;
  select stage, verification into gs from p2p_growth_status where user_id = l.mentor_id;
  insert into p2p_mentorship_checkpoints (link_id, participant_id, guide_id, kind, participant_stage, guide_stage,
                                          participant_verification, guide_verification, source, changed_person)
  values (l.id, l.disciple_id, l.mentor_id, p_kind, coalesce(ps.stage, 1), coalesce(gs.stage, 1),
          coalesce(ps.verification, 'verified'), coalesce(gs.verification, 'verified'), 'recorded', p_changed)
  on conflict do nothing;
end $$;

-- A relationship becomes active (start), or ends.
create or replace function public.p2p_mentorship_on_link() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active')
       and not exists (select 1 from p2p_mentorship_checkpoints where link_id = new.id and kind = 'start') then
      perform p2p_mentorship_checkpoint(new.id, 'start');
    elsif new.status = 'ended' and tg_op = 'UPDATE' and old.status is distinct from 'ended' then
      perform p2p_mentorship_checkpoint(new.id, 'end');
    end if;
  exception when others then
    raise warning 'P2P_GENEALOGY: could not record a checkpoint: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_p2p_mentorship_on_link on public.p2p_discipleship_links;
create trigger trg_p2p_mentorship_on_link after insert or update of status on public.p2p_discipleship_links
  for each row execute function public.p2p_mentorship_on_link();

-- Either person's verified stage changes while the relationship lasts.
create or replace function public.p2p_mentorship_on_stage() returns trigger
  language plpgsql security definer set search_path = public as $$
declare r record;
begin
  begin
    for r in select id, case when disciple_id = new.user_id then 'participant' else 'guide' end as who
               from p2p_discipleship_links where status in ('active', 'paused') and (disciple_id = new.user_id or mentor_id = new.user_id) loop
      perform p2p_mentorship_checkpoint(r.id, 'stage_change', r.who);
    end loop;
  exception when others then
    raise warning 'P2P_GENEALOGY: could not record a stage checkpoint: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_p2p_mentorship_on_stage on public.p2p_growth_status;
create trigger trg_p2p_mentorship_on_stage after update of stage on public.p2p_growth_status
  for each row when (new.stage is distinct from old.stage) execute function public.p2p_mentorship_on_stage();

-- An audited correction: a new checkpoint pointing at the one it corrects.
create or replace function public.p2p_mentorship_correct(p_checkpoint uuid, p_participant_stage int, p_guide_stage int, p_actor uuid, p_note text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare c record; v uuid;
begin
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'P2P_GENEALOGY: explain the correction'; end if;
  select * into c from p2p_mentorship_checkpoints where id = p_checkpoint;
  if c.id is null then raise exception 'P2P_GENEALOGY: no such checkpoint'; end if;
  insert into p2p_mentorship_checkpoints (link_id, participant_id, guide_id, kind, at, participant_stage, guide_stage, source, corrects_checkpoint_id, actor_id, note)
  values (c.link_id, c.participant_id, c.guide_id, 'correction', c.at, p_participant_stage, p_guide_stage, 'correction', c.id, p_actor, btrim(p_note))
  returning id into v;
  return v;
end $$;

-- ── 2. Development history ───────────────────────────────────────────────────
create or replace function public.p2p_development_history(p_person uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  with rels as (
    select l.id, l.mentor_id, l.disciple_id, l.status, l.is_primary, coalesce(l.started_at, l.created_at) as started_at, l.ended_at, l.end_reason
      from p2p_discipleship_links l
     where (l.disciple_id = p_person or l.mentor_id = p_person) and l.status in ('active', 'paused', 'ended')
  ), cps as (
    select c.link_id, jsonb_agg(jsonb_build_object('kind', c.kind, 'at', c.at, 'participantStage', c.participant_stage, 'guideStage', c.guide_stage,
             'source', c.source, 'changed', c.changed_person, 'corrects', c.corrects_checkpoint_id, 'id', c.id, 'note', case when c.kind = 'correction' then c.note end)
             order by c.at, case c.kind when 'start' then 0 when 'baseline' then 1 when 'stage_change' then 2 when 'correction' then 3 else 4 end) as items
      from p2p_mentorship_checkpoints c where c.link_id in (select id from rels) group by c.link_id
  ), within as (
    -- Verified contributions the Guide made to the participant DURING the relationship (never transferred).
    select r.id, count(*)::int as n, jsonb_object_agg(x.evidence_type, x.k) as by_type
      from rels r
      cross join lateral (
        select e.evidence_type, count(*)::int as k from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
         where e.user_id = r.mentor_id and b.user_id = r.disciple_id and e.credit and e.dimension = 'service'
           and e.verification = 'verified' and e.voided_at is null
           and e.occurred_at >= r.started_at and (r.ended_at is null or e.occurred_at <= r.ended_at)
         group by e.evidence_type) x
     group by r.id
  ), contributors as (
    -- Everyone who verifiably helped this person (designated or not).
    select e.user_id as contributor, count(*)::int as n, min(e.occurred_at) as first_at, max(e.occurred_at) as last_at,
           jsonb_object_agg(distinct e.evidence_type, true) as kinds,
           exists (select 1 from p2p_discipleship_links l where l.mentor_id = e.user_id and l.disciple_id = p_person) as was_guide
      from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
     where b.user_id = p_person and e.user_id <> p_person and e.credit and e.dimension = 'service'
       and e.verification = 'verified' and e.voided_at is null
     group by e.user_id
  ), helped as (
    -- People this person verifiably helped, and whether they went on to help others (next generation).
    select b.user_id as learner, count(*)::int as n,
           exists (select 1 from p2p_growth_evidence e2 join p2p_growth_evidence_beneficiaries b2 on b2.evidence_id = e2.id
                    where e2.user_id = b.user_id and e2.credit and e2.dimension = 'service' and e2.verification = 'verified'
                      and e2.voided_at is null and b2.user_id is not null and b2.user_id not in (p_person, b.user_id)) as helps_others
      from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
     where e.user_id = p_person and b.user_id is not null and b.user_id <> p_person and e.credit and e.dimension = 'service'
       and e.verification = 'verified' and e.voided_at is null
     group by b.user_id
  )
  select jsonb_build_object(
    'person', p_person,
    'stage', (select jsonb_build_object('stage', stage, 'verification', verification, 'since', stage_since) from p2p_growth_status where user_id = p_person),
    'guides', coalesce((select jsonb_agg(jsonb_build_object('linkId', r.id, 'guideId', r.mentor_id, 'status', r.status, 'isPrimary', r.is_primary,
                 'startedAt', r.started_at, 'endedAt', r.ended_at, 'checkpoints', coalesce(c.items, '[]'::jsonb),
                 'contributions', coalesce(w.n, 0), 'contributionsByType', coalesce(w.by_type, '{}'::jsonb)) order by r.started_at desc)
               from rels r left join cps c on c.link_id = r.id left join within w on w.id = r.id where r.disciple_id = p_person), '[]'::jsonb),
    'guiding', coalesce((select jsonb_agg(jsonb_build_object('linkId', r.id, 'participantId', r.disciple_id, 'status', r.status, 'isPrimary', r.is_primary,
                 'startedAt', r.started_at, 'endedAt', r.ended_at, 'checkpoints', coalesce(c.items, '[]'::jsonb),
                 'contributions', coalesce(w.n, 0)) order by r.started_at desc)
               from rels r left join cps c on c.link_id = r.id left join within w on w.id = r.id where r.mentor_id = p_person), '[]'::jsonb),
    'contributors', coalesce((select jsonb_agg(jsonb_build_object('personId', contributor, 'contributions', n, 'firstAt', first_at, 'lastAt', last_at,
                 'kinds', kinds, 'wasDesignatedGuide', was_guide) order by n desc) from contributors), '[]'::jsonb),
    'helped', coalesce((select jsonb_agg(jsonb_build_object('personId', learner, 'contributions', n, 'helpsOthers', helps_others) order by n desc) from helped), '[]'::jsonb));
$$;

-- ── 3. Kingdom School Foundations: every lesson and its status ───────────────
-- Every published lesson in every published Kingdom School curriculum
-- (p2p_growth_foundation_lessons — new Foundations lessons join automatically).
-- passed              — its assessment passed through an independent evaluation (the ledger)
-- awaiting_evaluation — answers submitted and an evaluation still open
-- returned            — the latest evaluation returned it for correction
-- answer_again        — the waiting evaluation was closed at the fresh start: answer the check again
-- not_yet_passed      — answered and resolved, but not passed independently (e.g. an older self-approval)
-- submitted           — every question answered, no evaluation yet
-- in_progress         — started (some answers, or progress recorded)
-- not_started
drop function if exists public.p2p_core_curriculum_progress(uuid);
create or replace function public.p2p_core_curriculum_progress(p_user uuid)
  returns table (lesson_id uuid, title text, curriculum_id uuid, curriculum_title text, curriculum_order integer,
                 module_id uuid, module_title text, module_order integer, lesson_order integer, status text, passed_at timestamptz)
  language sql stable security definer set search_path = public as $$
  with core as (
    select l.id, l.title, c.id as cid, c.title as ctitle, coalesce(c.display_order, 0) as corder,
           m.id as mid, m.title as mtitle, coalesce(m.order_index, 0) as morder, coalesce(l.order_index, 0) as lorder, c.created_at as ccreated
      from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums c on c.id = m.curriculum_id
     where l.id in (select p2p_growth_foundation_lessons())
  ), passed as (
    select substring(e.unit_key from 8)::uuid as lid, min(e.occurred_at) as at from p2p_growth_evidence e
     where e.user_id = p_user and e.evidence_type = 'learning.assessment_passed' and e.verification = 'verified' and e.voided_at is null
       and e.unit_key like 'lesson:%'
     group by 1
  ), latest as (
    select distinct on (s.assignment_question_id) s.lesson_id, s.assignment_question_id, ev.status, ev.engine_state
      from p2p_submissions s
      left join lateral (select e.status, e.engine_state from p2p_lesson_evaluations e where e.submission_id = s.id order by e.created_at desc limit 1) ev on true
     where s.user_id = p_user and s.assignment_question_id is not null and s.lesson_id in (select id from core)
     order by s.assignment_question_id, s.created_at desc
  ), per as (
    select lt.lesson_id, count(*) as answered,
           bool_or(lt.engine_state in ('queued', 'invited', 'in_progress') or (lt.engine_state is null and lt.status = 'pending')) as open_eval,
           bool_or(lt.status = 'needs_revision') as returned,
           bool_or(lt.engine_state = 'cancelled') as cancelled,
           bool_and(lt.status is not null and lt.status <> 'pending') as resolved,
           bool_and(lt.status is null) as unevaluated
      from latest lt group by lt.lesson_id
  ), questions as (
    select a.lesson_id, count(*) as n from p2p_assignments a join p2p_assignment_questions q on q.assignment_id = a.id
     where a.lesson_id in (select id from core) group by a.lesson_id
  )
  select c.id, c.title, c.cid, c.ctitle, c.corder, c.mid, c.mtitle, c.morder, c.lorder,
         case when p.at is not null then 'passed'
              when pr.open_eval then 'awaiting_evaluation'
              when pr.returned then 'returned'
              when pr.cancelled then 'answer_again'
              when pr.answered >= coalesce(q.n, 0) and pr.unevaluated then 'submitted'
              when pr.answered >= coalesce(q.n, 0) and pr.resolved then 'not_yet_passed'
              when pr.answered > 0 or exists (select 1 from p2p_lesson_progress lp where lp.user_id = p_user and lp.lesson_id = c.id
                                                and (lp.status <> 'not_started' or coalesce(lp.progress_percent, 0) > 0)) then 'in_progress'
              else 'not_started' end,
         p.at
    from core c
    left join passed p on p.lid = c.id
    left join per pr on pr.lesson_id = c.id
    left join questions q on q.lesson_id = c.id
   order by c.corder, c.ccreated, c.morder, c.lorder, c.title;
$$;

-- ── Access: service role only ───────────────────────────────────────────────
alter table public.p2p_mentorship_checkpoints enable row level security;
revoke all on public.p2p_mentorship_checkpoints from public, anon, authenticated;
grant select, insert on public.p2p_mentorship_checkpoints to service_role;
do $$
declare f text;
begin
  foreach f in array array['p2p_mentorship_checkpoint(uuid, text, text)', 'p2p_mentorship_correct(uuid, integer, integer, uuid, text)',
                           'p2p_development_history(uuid)', 'p2p_core_curriculum_progress(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['p2p_mentorship_on_link()', 'p2p_mentorship_on_stage()', 'p2p_mentorship_checkpoints_append_only()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Existing relationships: honest starting records ─────────────────────────
-- Their stages at the time they began were never recorded, so the start is
-- marked 'unavailable' (never guessed from today's stage), and a 'baseline'
-- checkpoint records both people's actual stages now.
do $$
declare r record; n int := 0;
begin
  for r in select id, coalesce(started_at, created_at) as at, mentor_id, disciple_id from public.p2p_discipleship_links
            where status in ('active', 'paused', 'ended') loop
    insert into public.p2p_mentorship_checkpoints (link_id, participant_id, guide_id, kind, at, source, note)
    values (r.id, r.disciple_id, r.mentor_id, 'start', r.at, 'unavailable', 'Began before stages were recorded at the start of relationships')
    on conflict do nothing;
    if exists (select 1 from public.p2p_discipleship_links where id = r.id and status in ('active', 'paused')) then
      perform public.p2p_mentorship_checkpoint(r.id, 'baseline');
    end if;
    n := n + 1;
  end loop;
  raise notice 'P2P_GENEALOGY_241: % existing relationships given a start record (stages unavailable) and, if current, a baseline', n;
end $$;

commit;

-- Rollback: drop triggers trg_p2p_mentorship_on_link, trg_p2p_mentorship_on_stage; drop functions
--   p2p_development_history, p2p_core_curriculum_progress, p2p_mentorship_*; the checkpoint table may stay (history) or be
--   exported and dropped.
