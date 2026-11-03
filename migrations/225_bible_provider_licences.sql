-- 225 (DRAFT — NOT APPLIED; needs owner approval, a restore test and the
-- guarded production apply): a second Bible provider (AO Lab "Free Use Bible
-- API") with per-translation licence review. Additive only: new nullable
-- columns, one widened check, one new check. Every existing API.Bible row
-- keeps working exactly as today (the new columns stay null for them and the
-- new rule applies only to provider 'helloao').
--
-- WHY: AO Lab's API licence does not grant rights over each Bible text; every
-- translation keeps its own licence. P2P must record, per translation, what
-- that licence permits and who approved it — and nothing may be shown to
-- people until a person has approved it.
--
-- WHAT (on p2p_bible_translations):
--   provider              + 'helloao' (existing: api.bible, dbp, local)
--   provider_translation_id  AO Lab translation id (API.Bible keeps api_bible_id)
--   abbreviation, description, text_direction ('ltr' | 'rtl')
--   copyright_notice, licence_name, licence_url, attribution, source_url
--   provider_licence      AO Lab's own licence summary (their statement, kept as received)
--   permits_display / permits_commercial / permits_caching / permits_offline /
--   permits_audio / permits_sharing   null = unknown = NOT permitted
--   licence_status        unreviewed | approved | rejected | needs_information
--   licence_questions, reviewed_by, reviewed_at
-- RULE (database-enforced): an AO Lab translation can be shown
-- (is_licensed_confirmed = true) only when licence_status = 'approved', the
-- reviewer and time are recorded, and display AND commercial app distribution
-- are explicitly permitted.
-- ACCESS: unchanged — the existing policies on p2p_bible_translations apply;
-- reviews are written only by the API (service role) for super admins
-- (routes/bibleTranslationsAdmin.ts).
-- ROLLBACK: drop the new check, restore the provider check, drop the columns
-- (no AO Lab rows exist until a super admin imports some).

alter table public.p2p_bible_translations
  add column if not exists provider_translation_id text,
  add column if not exists abbreviation text,
  add column if not exists description text,
  add column if not exists text_direction text not null default 'ltr',
  add column if not exists copyright_notice text,
  add column if not exists licence_name text,
  add column if not exists licence_url text,
  add column if not exists attribution text,
  add column if not exists source_url text,
  add column if not exists provider_licence jsonb,
  add column if not exists permits_display boolean,
  add column if not exists permits_commercial boolean,
  add column if not exists permits_caching boolean,
  add column if not exists permits_offline boolean,
  add column if not exists permits_audio boolean,
  add column if not exists permits_sharing boolean,
  add column if not exists licence_status text,
  add column if not exists licence_questions text,
  add column if not exists reviewed_by uuid references public.p2p_profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  -- Widen the provider list.
  if exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_provider_check'
             and pg_get_constraintdef(oid) not like '%helloao%') then
    alter table public.p2p_bible_translations drop constraint p2p_bible_translations_provider_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_provider_check') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_provider_check
      check (provider = any (array['api.bible', 'dbp', 'local', 'helloao']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_text_direction_check') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_text_direction_check
      check (text_direction in ('ltr', 'rtl'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_licence_status_check') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_licence_status_check
      check (licence_status is null or licence_status in ('unreviewed', 'approved', 'rejected', 'needs_information'));
  end if;
  -- AO Lab rows always carry their id and a review status.
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_helloao_identity') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_helloao_identity
      check (provider <> 'helloao' or (provider_translation_id ~ '^[A-Za-z0-9_-]{1,64}$' and licence_status is not null));
  end if;
  -- The approval rule: no AO Lab text is shown without a complete, recorded approval.
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_helloao_approval') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_helloao_approval
      check (provider <> 'helloao' or not is_licensed_confirmed
             or (licence_status = 'approved' and permits_display is true and permits_commercial is true
                 and reviewed_by is not null and reviewed_at is not null));
  end if;
end $$;

create unique index if not exists p2p_bible_translations_helloao_id
  on public.p2p_bible_translations (provider_translation_id) where provider = 'helloao';
