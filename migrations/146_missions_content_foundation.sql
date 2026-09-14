-- 146: Missions Stage 1 — Mission Content Foundation.
--
-- FORENSIC BASIS (Stage 0 report): the current Missions tab has no
-- dedicated backend at all — it shows p2p_missions.length as a stat (4
-- rows, admin-seeded, never rendered as a list) and a "Kingdom Wins" feed
-- that is literally p2p_prayer_wall_posts filtered client-side to
-- postType='testimony'. Neither is touched by this migration: p2p_missions
-- and p2p_prayer_wall_posts are left completely untouched, still fully
-- functional. This migration adds a genuinely new, independent Mission
-- content domain (p2p_mission_*) that does not read from or write to
-- either legacy source.
--
-- CONTRIBUTOR AUTHORIZATION: Stage 0 found no existing role fits "verified
-- missionary/organization" — is_official_account is hard-limited by CHECK
-- to 4 platform-account types (crisis_response/announcement/support/general,
-- migration 068), and is_verified/verification_status is a personal
-- biometric identity system (migration 065), neither a semantic match.
-- Per this stage's own instruction to document rather than invent a weak
-- verification mechanism: content creation is admin-role-gated only
-- (p2p_is_admin() / requireAdmin — the same broad gate already reused for
-- Pray the Word's topic curation), with author_id retained purely for
-- attribution display. A real "verified missionary" concept is left for a
-- future, separately-designed stage.
--
-- GEOGRAPHY: no country/region reference table exists anywhere in this
-- codebase (confirmed by search). Mission Fields use plain curated text
-- fields (country, region) rather than inventing a new geography system
-- for what is, today, a small curated set of records.
--
-- SCRIPTURE: mission_stories/prayer_points reference the EXISTING
-- p2p_scripture_references table (migration 142, "Pray the Word") —
-- never a second Bible provider, never duplicated verse text.
--
-- NO FUNDRAISING: no donation/payment/campaign field exists anywhere
-- below, by design.

-- ── p2p_mission_fields ───────────────────────────────────────────────────────
-- A real geographic/contextual mission area. mission_focus is a curated,
-- API-validated tag list (see routes/missions.ts) — stored as a plain
-- text[] rather than a junction table, since a field only ever needs a
-- handful of tags, not per-tag editorial ordering/notes the way Pray the
-- Word's topic<->scripture model needs.
create table if not exists p2p_mission_fields (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  country         text not null,
  region          text,
  context         text,
  description     text,
  mission_focus   text[] not null default '{}',
  status          text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  display_order   integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_p2p_mission_fields_published on p2p_mission_fields(status, display_order) where status = 'published';

-- ── p2p_mission_stories ──────────────────────────────────────────────────────
-- One domain table with a controlled story_type, per this stage's own
-- instruction ("avoid creating five unrelated tables"). author_id is
-- attribution only — see the authorization note above; RLS/API both gate
-- mutation on p2p_is_admin(), not on author_id.
create table if not exists p2p_mission_stories (
  id                      uuid primary key default gen_random_uuid(),
  author_id               uuid not null references auth.users(id) on delete cascade,
  story_type              text not null default 'story' check (story_type in ('story', 'testimony', 'update', 'growth_story', 'scripture_reflection')),
  title                   text not null,
  summary                 text,
  body                    text not null,
  mission_field_id        uuid references p2p_mission_fields(id) on delete set null,
  mission_focus           text[] not null default '{}',
  scripture_reference_id  uuid references p2p_scripture_references(id) on delete set null,
  media_type              text check (media_type in ('video')),
  media_path              text,
  media_duration_seconds  integer check (media_duration_seconds is null or media_duration_seconds > 0),
  status                  text not null default 'draft' check (status in ('draft', 'pending', 'published', 'archived', 'removed')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  published_at            timestamptz,
  check (media_type is null or media_path is not null)
);

create index if not exists idx_p2p_mission_stories_published on p2p_mission_stories(status, published_at desc) where status = 'published';
create index if not exists idx_p2p_mission_stories_field on p2p_mission_stories(mission_field_id) where mission_field_id is not null;
create index if not exists idx_p2p_mission_stories_author on p2p_mission_stories(author_id);

-- ── p2p_mission_prayer_points ────────────────────────────────────────────────
-- Deliberately NO count column of any kind — real prayer commitments are
-- Prayer 2.0's job (wired in Stage 4 via a reference column on
-- p2p_prayer_coord_requests, not duplicated here).
create table if not exists p2p_mission_prayer_points (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  description             text not null,
  scripture_reference_id  uuid references p2p_scripture_references(id) on delete set null,
  mission_story_id        uuid references p2p_mission_stories(id) on delete cascade,
  mission_field_id        uuid references p2p_mission_fields(id) on delete cascade,
  status                  text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (mission_story_id is not null or mission_field_id is not null)
);

create index if not exists idx_p2p_mission_prayer_points_story on p2p_mission_prayer_points(mission_story_id) where mission_story_id is not null;
create index if not exists idx_p2p_mission_prayer_points_field on p2p_mission_prayer_points(mission_field_id) where mission_field_id is not null;
create index if not exists idx_p2p_mission_prayer_points_published on p2p_mission_prayer_points(status) where status = 'published';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table p2p_mission_fields enable row level security;
alter table p2p_mission_stories enable row level security;
alter table p2p_mission_prayer_points enable row level security;

drop policy if exists "Published mission fields are public, drafts admin-only" on p2p_mission_fields;
create policy "Published mission fields are public, drafts admin-only" on p2p_mission_fields
  for select using (status = 'published' or p2p_is_admin());
drop policy if exists "Admins manage mission fields" on p2p_mission_fields;
create policy "Admins manage mission fields" on p2p_mission_fields
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update mission fields" on p2p_mission_fields;
create policy "Admins update mission fields" on p2p_mission_fields
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete mission fields" on p2p_mission_fields;
create policy "Admins delete mission fields" on p2p_mission_fields
  for delete using (p2p_is_admin());

-- Stories: published readable by anyone; an author can also see their own
-- not-yet-published rows (draft/pending); admins see everything. All
-- mutation is admin-gated — author_id is attribution, not an
-- authorization boundary, since only admins can create these rows today.
drop policy if exists "Published stories are public, own/admin see drafts" on p2p_mission_stories;
create policy "Published stories are public, own/admin see drafts" on p2p_mission_stories
  for select using (status = 'published' or p2p_is_admin() or author_id = auth.uid());
drop policy if exists "Admins create mission stories" on p2p_mission_stories;
create policy "Admins create mission stories" on p2p_mission_stories
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update mission stories" on p2p_mission_stories;
create policy "Admins update mission stories" on p2p_mission_stories
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete mission stories" on p2p_mission_stories;
create policy "Admins delete mission stories" on p2p_mission_stories
  for delete using (p2p_is_admin());

drop policy if exists "Published prayer points are public, drafts admin-only" on p2p_mission_prayer_points;
create policy "Published prayer points are public, drafts admin-only" on p2p_mission_prayer_points
  for select using (status = 'published' or p2p_is_admin());
drop policy if exists "Admins manage mission prayer points" on p2p_mission_prayer_points;
create policy "Admins manage mission prayer points" on p2p_mission_prayer_points
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update mission prayer points" on p2p_mission_prayer_points;
create policy "Admins update mission prayer points" on p2p_mission_prayer_points
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete mission prayer points" on p2p_mission_prayer_points;
create policy "Admins delete mission prayer points" on p2p_mission_prayer_points
  for delete using (p2p_is_admin());

-- ── Storage: "mission-media" bucket ────────────────────────────────────────
-- Identical private-bucket-plus-signed-URL shape as "submissions" (009)
-- and "prayer-testimonies" (141) — a SEPARATE bucket so mission video is
-- never conflated with lesson-assignment or prayer-testimony media.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-media', 'mission-media', false, 104857600,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists "Contributors manage own mission media" on storage.objects;
create policy "Contributors manage own mission media" on storage.objects
  for all
  using  (bucket_id = 'mission-media' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'mission-media' and auth.uid()::text = split_part(name, '/', 1));

drop policy if exists "Read published mission media" on storage.objects;
create policy "Read published mission media" on storage.objects
  for select using (
    bucket_id = 'mission-media' and
    exists (
      select 1 from p2p_mission_stories s
      where s.id::text = split_part(name, '/', 2)
        and s.status = 'published'
    )
  );

drop policy if exists "Admins read all mission media" on storage.objects;
create policy "Admins read all mission media" on storage.objects
  for select using (bucket_id = 'mission-media' and p2p_is_admin());

-- ── Moderation: extend the CURRENT (019/141) functions with 'mission_story' ─
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'p2p_content_flags'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%content_type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.p2p_content_flags DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.p2p_content_flags
  ADD CONSTRAINT p2p_content_flags_content_type_check
  CHECK (content_type IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony', 'mission_story'));

CREATE OR REPLACE FUNCTION p2p_report_content(p_content_type text, p_content_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  v_author_id uuid;
  v_snapshot text;
  v_flag_id uuid;
  v_conversation_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_content_type NOT IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony', 'mission_story') THEN
    RAISE EXCEPTION 'invalid content type';
  END IF;

  IF p_content_type = 'prayer_post' THEN
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_posts WHERE id = p_content_id;
  ELSIF p_content_type = 'prayer_comment' THEN
    SELECT user_id, body INTO v_author_id, v_snapshot FROM p2p_prayer_wall_comments WHERE id = p_content_id;
  ELSIF p_content_type = 'message' THEN
    SELECT sender_id, body, conversation_id INTO v_author_id, v_snapshot, v_conversation_id
      FROM p2p_messages WHERE id = p_content_id;
    IF v_author_id IS NOT NULL AND NOT p2p_is_conversation_member(v_conversation_id, me) THEN
      RAISE EXCEPTION 'not permitted to report this message';
    END IF;
  ELSIF p_content_type = 'prayer_testimony' THEN
    SELECT user_id, testimony_text INTO v_author_id, v_snapshot FROM p2p_prayer_testimonies WHERE id = p_content_id;
  ELSIF p_content_type = 'mission_story' THEN
    SELECT author_id, body INTO v_author_id, v_snapshot FROM p2p_mission_stories WHERE id = p_content_id;
  ELSE -- 'profile'
    IF p_content_id = me THEN
      RAISE EXCEPTION 'cannot report your own profile';
    END IF;
    SELECT id, bio INTO v_author_id, v_snapshot FROM p2p_profiles WHERE id = p_content_id;
  END IF;

  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'content not found';
  END IF;

  INSERT INTO p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
  VALUES (p_content_type, p_content_id, v_author_id, me, p_reason, v_snapshot)
  RETURNING id INTO v_flag_id;

  RETURN v_flag_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_report_content(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_report_content(text, uuid, text) TO authenticated;

-- 'mission_story' remove: like prayer_testimony, this content has its own
-- status lifecycle — 'remove' sets status='removed' rather than a hard
-- DELETE, preserving the row for audit.
CREATE OR REPLACE FUNCTION p2p_moderate_flag(p_flag_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag p2p_content_flags%ROWTYPE;
  v_help_request_id uuid;
  v_new_status text;
BEGIN
  IF p2p_current_role() NOT IN ('moderator', 'church_leader', 'regional_admin', 'super_admin') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_action NOT IN ('dismiss', 'warn', 'remove', 'escalate') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  SELECT * INTO v_flag FROM p2p_content_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'flag not found';
  END IF;

  IF p_action = 'remove' THEN
    IF v_flag.content_type = 'prayer_post' THEN
      DELETE FROM p2p_prayer_wall_posts WHERE id = v_flag.content_id;
    ELSIF v_flag.content_type = 'prayer_comment' THEN
      DELETE FROM p2p_prayer_wall_comments WHERE id = v_flag.content_id;
    ELSIF v_flag.content_type = 'message' THEN
      DELETE FROM p2p_messages WHERE id = v_flag.content_id;
    ELSIF v_flag.content_type = 'prayer_testimony' THEN
      UPDATE p2p_prayer_testimonies SET moderation_status = 'removed', updated_at = now() WHERE id = v_flag.content_id;
    ELSIF v_flag.content_type = 'mission_story' THEN
      UPDATE p2p_mission_stories SET status = 'removed', updated_at = now() WHERE id = v_flag.content_id;
    ELSE -- 'profile'
      UPDATE p2p_profiles SET avatar_url = NULL, bio = NULL WHERE id = v_flag.content_id;
    END IF;
    v_new_status := 'removed';
  ELSIF p_action = 'escalate' THEN
    INSERT INTO p2p_help_requests (user_id, tier, category, note, status)
    VALUES (
      v_flag.author_id,
      'struggling',
      'Moderation Escalation',
      COALESCE(p_note, 'Escalated from content flag: ' || COALESCE(v_flag.content_snapshot, '')),
      'open'
    )
    RETURNING id INTO v_help_request_id;
    v_new_status := 'escalated';
  ELSIF p_action = 'warn' THEN
    v_new_status := 'warned';
  ELSE
    v_new_status := 'dismissed';
  END IF;

  UPDATE p2p_content_flags
  SET status = v_new_status,
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_note = p_note,
      escalation_help_request_id = v_help_request_id
  WHERE id = p_flag_id;
END;
$$;
REVOKE ALL ON FUNCTION p2p_moderate_flag(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p2p_moderate_flag(uuid, text, text) TO authenticated;

-- ── p2p_saved_mission_stories ────────────────────────────────────────────────
-- Same shape as p2p_plan_saves (042) / p2p_saved_scriptures (145) — a
-- private, user-owned reference, never a public "save count."
create table if not exists p2p_saved_mission_stories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  story_id     uuid not null references p2p_mission_stories(id) on delete cascade,
  saved_at     timestamptz not null default now(),
  unique (user_id, story_id)
);
create index if not exists idx_p2p_saved_mission_stories_user on p2p_saved_mission_stories(user_id, saved_at desc);

alter table p2p_saved_mission_stories enable row level security;
drop policy if exists "Users manage their own saved mission stories" on p2p_saved_mission_stories;
create policy "Users manage their own saved mission stories" on p2p_saved_mission_stories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Activity timeline: mission viewing/engagement events ───────────────────
alter table p2p_user_activity_events drop constraint if exists p2p_user_activity_events_event_type_check;
alter table p2p_user_activity_events add constraint p2p_user_activity_events_event_type_check
  check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched',
    'prayer_gathering_completed', 'peer_prayer_supported',
    'prayer_testimony_shared', 'growth_testimony_shared',
    'prayer_topic_viewed', 'prayer_scripture_viewed',
    'prayer_path_started', 'prayer_path_completed',
    'mission_story_viewed', 'mission_field_viewed'
  ));
