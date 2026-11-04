-- 233 (Phase 1 — relationship foundation, approved by the owner 2026-11-04;
-- restore-tested; applied only with the guarded production procedure).
-- ADDITIVE: new columns, one widened status check, constraints, a history
-- table, rule triggers and server-only functions. No relationship is removed
-- or ended; existing rows only gain is_primary / started_at.
--
-- A mentor ↔ disciple relationship (p2p_discipleship_links) becomes a real
-- discipleship record:
--   • states: pending (asked) → active → paused ↔ active → ended; declined /
--     expired for requests. Ended, declined and expired are final — a new
--     request starts a new relationship, and the old one stays in history;
--   • `active` is kept in step with `status` (older app / API code reads it);
--   • several mentors are allowed; one is the PRIMARY mentor (the first to
--     become active, or the one the disciple chooses);
--   • the database refuses: a person as their own mentor, two open
--     relationships between the same two people, and any cycle (someone
--     becoming the mentor of their own mentor, at any depth);
--   • every change of state or primary mentor is recorded in
--     p2p_discipleship_link_events (who, when, why) — never rewritten.
-- Owner decisions still open (defaults used): who may end a relationship
-- (either person), whether "paused" is wanted (supported), how the primary
-- is chosen (first active; the disciple may change it).

begin;

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.p2p_discipleship_links
  add column if not exists is_primary boolean not null default false,
  add column if not exists started_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references public.p2p_profiles(id) on delete set null,
  add column if not exists end_reason text,
  add column if not exists updated_at timestamptz;

-- created_at was "timestamp without time zone" holding UTC wall time.
do $$
begin
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'p2p_discipleship_links' and column_name = 'created_at') = 'timestamp without time zone' then
    alter table public.p2p_discipleship_links alter column created_at type timestamptz using created_at at time zone 'UTC';
  end if;
end $$;

-- Existing data must already satisfy the new rules; never "fix" relationships silently.
do $$
declare v_dup int; v_self int;
begin
  select count(*) into v_self from public.p2p_discipleship_links where mentor_id = disciple_id;
  select count(*) into v_dup from (select mentor_id, disciple_id from public.p2p_discipleship_links
    where status in ('pending', 'active') group by 1, 2 having count(*) > 1) d;
  if v_self > 0 or v_dup > 0 then
    raise exception 'P2P_LINK_233: % self-relationships and % duplicate open pairs must be reviewed before this migration', v_self, v_dup;
  end if;
end $$;

-- ── States and integrity ────────────────────────────────────────────────────
alter table public.p2p_discipleship_links drop constraint if exists p2p_discipleship_links_status_check;
alter table public.p2p_discipleship_links add constraint p2p_discipleship_links_status_check
  check (status in ('pending', 'active', 'paused', 'declined', 'expired', 'ended'));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_discipleship_links_not_self') then
    alter table public.p2p_discipleship_links add constraint p2p_discipleship_links_not_self check (mentor_id is distinct from disciple_id);
  end if;
end $$;
create unique index if not exists p2p_discipleship_links_one_open_pair
  on public.p2p_discipleship_links (mentor_id, disciple_id) where status in ('pending', 'active', 'paused');
create unique index if not exists p2p_discipleship_links_one_primary
  on public.p2p_discipleship_links (disciple_id) where is_primary and status in ('active', 'paused');
create index if not exists idx_p2p_discipleship_links_mentor_open on public.p2p_discipleship_links (mentor_id) where status in ('active', 'paused');
create index if not exists idx_p2p_discipleship_links_disciple_open on public.p2p_discipleship_links (disciple_id) where status in ('active', 'paused');

-- Backfill: when each active relationship began, and each disciple's primary mentor (the earliest).
update public.p2p_discipleship_links set started_at = coalesce(responded_at, created_at)
 where status in ('active', 'paused') and started_at is null;
update public.p2p_discipleship_links l set is_primary = true
 where l.id in (select distinct on (disciple_id) id from public.p2p_discipleship_links
                 where status in ('active', 'paused') order by disciple_id, started_at nulls last, created_at, id)
   and not exists (select 1 from public.p2p_discipleship_links x where x.disciple_id = l.disciple_id and x.is_primary and x.status in ('active', 'paused'));

-- ── History ─────────────────────────────────────────────────────────────────
create table if not exists public.p2p_discipleship_link_events (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.p2p_discipleship_links(id) on delete cascade,
  event       text not null check (event in ('created', 'activated', 'paused', 'resumed', 'ended', 'declined', 'expired', 'primary_set', 'primary_cleared', 'corrected')),
  from_status text,
  to_status   text,
  actor_id    uuid references public.p2p_profiles(id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_p2p_discipleship_link_events_link on public.p2p_discipleship_link_events (link_id, created_at);
alter table public.p2p_discipleship_link_events enable row level security;
revoke all on public.p2p_discipleship_link_events from anon, authenticated;
grant all on public.p2p_discipleship_link_events to service_role;

-- ── Rules (before) ──────────────────────────────────────────────────────────
create or replace function public.p2p_discipleship_link_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_open constant text[] := array['pending', 'active', 'paused'];
begin
  -- Older code changes only `active`: read it as activate / end.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.active is distinct from old.active then
    new.status := case when new.active then 'active' when old.status in ('active', 'paused') then 'ended' else old.status end;
  end if;
  if tg_op = 'UPDATE' and old.status in ('ended', 'declined', 'expired') and new.status is distinct from old.status then
    raise exception 'P2P_LINK_FINAL: this relationship has ended; a new request starts a new one' using errcode = '23514';
  end if;
  if new.mentor_id = new.disciple_id then
    raise exception 'P2P_LINK_SELF: someone can''t be their own mentor' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.mentor_id is distinct from old.mentor_id or new.disciple_id is distinct from old.disciple_id) then
    raise exception 'P2P_LINK_PEOPLE: the two people in a relationship never change' using errcode = '23514';
  end if;

  new.active := (new.status = 'active');
  new.updated_at := now();
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.started_at := coalesce(new.started_at, now());
    new.paused_at := null;
  end if;
  if new.status = 'paused' and (tg_op = 'INSERT' or old.status is distinct from 'paused') then
    new.paused_at := now();
  end if;
  if new.status in ('ended', 'declined', 'expired', 'pending') then
    new.is_primary := false;
  end if;
  if new.status = 'ended' and (tg_op = 'INSERT' or old.status is distinct from 'ended') then
    new.ended_at := coalesce(new.ended_at, now());
  end if;

  -- No cycles: the new disciple may not already be above the mentor (active / paused links, any depth).
  if new.status = any(v_open) and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform pg_advisory_xact_lock(hashtext('p2p_discipleship_links:graph'));
    if exists (
      with recursive up(person, depth) as (
        select new.mentor_id, 0
        union
        select l.mentor_id, up.depth + 1
          from public.p2p_discipleship_links l join up on l.disciple_id = up.person
         where l.status in ('active', 'paused') and l.id is distinct from new.id and up.depth < 1000
      ) select 1 from up where person = new.disciple_id
    ) then
      raise exception 'P2P_LINK_CYCLE: this person is already in this mentor''s own line of mentors' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_discipleship_link_rules on public.p2p_discipleship_links;
create trigger trg_p2p_discipleship_link_rules before insert or update on public.p2p_discipleship_links
  for each row execute function public.p2p_discipleship_link_rules();

-- ── Primary mentor + history (after) ────────────────────────────────────────
create or replace function public.p2p_discipleship_link_after() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := nullif(current_setting('p2p.link_actor', true), '')::uuid;
  v_reason text := nullif(current_setting('p2p.link_reason', true), '');
  v_next uuid;
begin
  v_actor := coalesce(v_actor, auth.uid());
  -- History: every change of state.
  if tg_op = 'INSERT' then
    insert into p2p_discipleship_link_events (link_id, event, to_status, actor_id, reason)
    values (new.id, case when new.status = 'active' then 'activated' else 'created' end, new.status, v_actor, v_reason);
  elsif new.status is distinct from old.status then
    insert into p2p_discipleship_link_events (link_id, event, from_status, to_status, actor_id, reason)
    values (new.id, case new.status when 'active' then (case when old.status = 'paused' then 'resumed' else 'activated' end)
                                    when 'paused' then 'paused' when 'ended' then 'ended' when 'declined' then 'declined'
                                    when 'expired' then 'expired' else 'corrected' end,
            old.status, new.status, coalesce(v_actor, new.ended_by), v_reason);
  end if;
  if tg_op = 'UPDATE' and new.is_primary is distinct from old.is_primary then
    insert into p2p_discipleship_link_events (link_id, event, actor_id, reason)
    values (new.id, case when new.is_primary then 'primary_set' else 'primary_cleared' end, v_actor, v_reason);
  end if;

  -- The primary updates below fire this again (don't recurse); an explicit primary change sets its own.
  if pg_trigger_depth() > 1 or coalesce(current_setting('p2p.link_primary_change', true), '') = 'on' then return null; end if;
  -- A disciple's first active mentor becomes their primary mentor.
  if new.status = 'active' and not new.is_primary
     and not exists (select 1 from p2p_discipleship_links x where x.disciple_id = new.disciple_id and x.is_primary and x.status in ('active', 'paused')) then
    update p2p_discipleship_links set is_primary = true where id = new.id;
  end if;
  -- The primary relationship ended: the longest-standing remaining one becomes primary.
  if tg_op = 'UPDATE' and old.is_primary and new.status not in ('active', 'paused') then
    select id into v_next from p2p_discipleship_links
     where disciple_id = new.disciple_id and id <> new.id and status in ('active', 'paused')
     order by status = 'active' desc, started_at nulls last, created_at limit 1;
    if v_next is not null then update p2p_discipleship_links set is_primary = true where id = v_next; end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_p2p_discipleship_link_after on public.p2p_discipleship_links;
create trigger trg_p2p_discipleship_link_after after insert or update on public.p2p_discipleship_links
  for each row execute function public.p2p_discipleship_link_after();

-- ── Server-only actions (the API checks who may act, then calls these) ──────
create or replace function public.p2p_link_set_status(p_link uuid, p_actor uuid, p_status text, p_reason text default null)
  returns text language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if p_status not in ('active', 'paused', 'ended') then raise exception 'P2P_LINK: unsupported change' using errcode = '22023'; end if;
  select status into v_old from p2p_discipleship_links where id = p_link for update;
  if v_old is null then raise exception 'P2P_LINK: not found' using errcode = 'P0002'; end if;
  if v_old = p_status then return v_old; end if;   -- already so: idempotent
  if p_status = 'active' and v_old <> 'paused' then raise exception 'P2P_LINK: only a paused relationship can be resumed' using errcode = '22023'; end if;
  if p_status = 'paused' and v_old <> 'active' then raise exception 'P2P_LINK: only an active relationship can be paused' using errcode = '22023'; end if;
  if p_status = 'ended' and v_old not in ('active', 'paused') then raise exception 'P2P_LINK: only an active or paused relationship can be ended' using errcode = '22023'; end if;
  perform set_config('p2p.link_actor', coalesce(p_actor::text, ''), true);
  perform set_config('p2p.link_reason', coalesce(left(p_reason, 500), ''), true);
  update p2p_discipleship_links
     set status = p_status,
         ended_by = case when p_status = 'ended' then p_actor else ended_by end,
         end_reason = case when p_status = 'ended' then left(p_reason, 500) else end_reason end
   where id = p_link;
  return p_status;
end $$;

create or replace function public.p2p_link_set_primary(p_link uuid, p_actor uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_disciple uuid; v_status text;
begin
  select disciple_id, status into v_disciple, v_status from p2p_discipleship_links where id = p_link for update;
  if v_disciple is null then raise exception 'P2P_LINK: not found' using errcode = 'P0002'; end if;
  if v_status not in ('active', 'paused') then raise exception 'P2P_LINK: only a current mentor can be primary' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('p2p_link_primary:' || v_disciple::text));
  perform set_config('p2p.link_actor', coalesce(p_actor::text, ''), true);
  perform set_config('p2p.link_primary_change', 'on', true);
  update p2p_discipleship_links set is_primary = false where disciple_id = v_disciple and is_primary and id <> p_link;
  update p2p_discipleship_links set is_primary = true where id = p_link and not is_primary;
end $$;

revoke execute on function public.p2p_link_set_status(uuid, uuid, text, text), public.p2p_link_set_primary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.p2p_link_set_status(uuid, uuid, text, text), public.p2p_link_set_primary(uuid, uuid) to service_role;
revoke execute on function public.p2p_discipleship_link_rules(), public.p2p_discipleship_link_after() from public, anon, authenticated;

-- History for the relationships that already exist (one "activated" entry each, dated when they began).
insert into public.p2p_discipleship_link_events (link_id, event, to_status, reason, created_at)
select l.id, 'activated', l.status, 'Recorded when relationship history began (migration 233)', coalesce(l.started_at, l.created_at, now())
  from public.p2p_discipleship_links l
 where l.status in ('active', 'paused')
   and not exists (select 1 from public.p2p_discipleship_link_events e where e.link_id = l.id);

commit;

-- Rollback (keeps the data; removes the new rules):
--   drop trigger trg_p2p_discipleship_link_rules / trg_p2p_discipleship_link_after on p2p_discipleship_links;
--   drop index p2p_discipleship_links_one_open_pair, p2p_discipleship_links_one_primary;
--   alter table p2p_discipleship_links drop constraint p2p_discipleship_links_not_self;
--   (the status check may be narrowed again only if no row is 'paused' or 'ended')
