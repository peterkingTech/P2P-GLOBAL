-- 219 (PROPOSED — NOT APPLIED; needs owner approval, a restore test and the
-- guarded production apply): Study Together scheduling, reminders and Bible
-- passages. Additive only: new nullable columns, one widened check, one new
-- table. No existing row changes meaning: every current shared study stays
-- unscheduled with no reminders, exactly as today.
--
-- WHY: a shared study (216) has no date or time, so the hub can't show
-- "Upcoming Studies" and nothing can remind people. The only scheduled
-- records today are peer-circle sessions (044) and prayer gatherings (138),
-- which are different things; reusing them would mix studies into circles
-- and prayer. Bible passages can't be studied together because 216 allows
-- only 'kingdom_story' and 'lesson'.
--
-- WHAT:
--   * p2p_shared_studies.scheduled_start_at / duration_minutes / time_zone:
--     optional; set by the study's leader (host, or the group's leader) via
--     the API. time_zone is the organiser's IANA zone, used only to show the
--     organiser's wall time; reminders use the absolute instant, so every
--     participant sees the time in their own zone.
--   * p2p_shared_studies.reminder_offsets: minutes before the start
--     (1440 = 24 h, 60, 30, 0 = at the start). Empty = no reminders.
--   * content_type gains 'bible_passage' (content_id = a row of
--     p2p_scripture_references, the existing structured reference table —
--     never Bible text).
--   * p2p_shared_study_reminders: one row per (study, person, offset, start
--     instant) written by the API's reminder job BEFORE it sends, so a
--     reminder is sent at most once (unique key); a changed start time is a
--     new instant, so the old reminder can't fire for the new time, and a
--     concluded study (or one whose time was cleared) is skipped by the job.
-- ACCESS: as 216 — RLS on, no client policies; only the API (service role)
-- reads or writes, after checking membership on every request.
-- ROLLBACK: the columns are nullable/defaulted and the table is new; rolling
-- the API back leaves them unused. Dropping them would lose schedules, so
-- rollback is "stop using", not "drop".

alter table public.p2p_shared_studies add column if not exists scheduled_start_at timestamptz;
alter table public.p2p_shared_studies add column if not exists duration_minutes smallint;
alter table public.p2p_shared_studies add column if not exists time_zone text;
alter table public.p2p_shared_studies add column if not exists reminder_offsets smallint[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_duration_range') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_duration_range
      check (duration_minutes is null or duration_minutes between 5 and 600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_time_zone_len') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_time_zone_len
      check (time_zone is null or char_length(time_zone) between 1 and 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_reminder_offsets_allowed') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_reminder_offsets_allowed
      check (reminder_offsets <@ array[1440, 60, 30, 0]::smallint[] and cardinality(reminder_offsets) <= 4);
  end if;
  -- Reminders need a time to be relative to.
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_reminders_need_time') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_reminders_need_time
      check (cardinality(reminder_offsets) = 0 or scheduled_start_at is not null);
  end if;
  -- Widen the content types (216's inline check) to add Bible passages.
  if exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_content_type_check'
             and pg_get_constraintdef(oid) not like '%bible_passage%') then
    alter table public.p2p_shared_studies drop constraint p2p_shared_studies_content_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_content_type_check') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_content_type_check
      check (content_type in ('kingdom_story', 'lesson', 'bible_passage'));
  end if;
end $$;

-- Upcoming studies, soonest first (the hub and the reminder job).
create index if not exists p2p_shared_studies_upcoming_idx
  on public.p2p_shared_studies (scheduled_start_at) where status = 'active' and scheduled_start_at is not null;

create table if not exists public.p2p_shared_study_reminders (
  id             uuid primary key default gen_random_uuid(),
  study_id       uuid not null references public.p2p_shared_studies(id) on delete cascade,
  user_id        uuid not null references public.p2p_profiles(id) on delete cascade,
  offset_minutes smallint not null check (offset_minutes in (1440, 60, 30, 0)),
  -- The start instant this reminder was for (a rescheduled study is a new instant).
  starts_at      timestamptz not null,
  sent_at        timestamptz not null default now(),
  unique (study_id, user_id, offset_minutes, starts_at)
);
create index if not exists p2p_shared_study_reminders_user_idx on public.p2p_shared_study_reminders (user_id, sent_at desc);

alter table public.p2p_shared_study_reminders enable row level security;
revoke all on public.p2p_shared_study_reminders from public, anon, authenticated;
grant all on public.p2p_shared_study_reminders to service_role;
