-- 141: Prayer 2.0 Stage 6 — Prayer Testimonies and Video Growth Testimonies.
--
-- FORENSIC BASIS: two conceptually distinct things are both called
-- "testimony" in the product spec and MUST stay distinguishable in the data
-- model, never merged into one undifferentiated feed:
--   'answered_prayer' — "God answered this specific prayer" — optionally
--       linked back to the exact p2p_prayer_coord_requests row it answers.
--   'growth'           — "here is how I've grown" — a standalone testimony,
--       never linked to a prayer request.
-- Both share the same media/moderation/visibility plumbing, so one table
-- with a testimony_type discriminator (not two parallel tables) avoids
-- duplicating that plumbing — but every read path in the API/mobile layer
-- must keep filtering/labeling by testimony_type explicit, never implicit.
--
-- MEDIA: mirrors the existing, working p2p_submissions / "submissions"
-- bucket pattern exactly (migration 009) — private bucket, owner-only
-- write under a {user_id}/{row_id}/... path, signed URLs for playback
-- (components/MediaPlayer.tsx already does this; app/prayer/testimony
-- screens reuse the identical createSignedUrl call). A SEPARATE bucket
-- ("prayer-testimonies") is used rather than reusing "submissions" so
-- lesson-assignment media and testimony media are never conflated in one
-- bucket's path namespace or admin review tooling.
--
-- MODERATION: extends the CURRENT (migration 019, not the superseded 013)
-- bodies of p2p_report_content / p2p_moderate_flag with a 'prayer_testimony'
-- branch, matching 019's exact shape (author lookup + snapshot, then a
-- REMOVE action). Unlike posts/comments/messages (which have no status
-- column and so are hard-deleted on 'remove'), a testimony already carries
-- its own moderation_status lifecycle (pending/approved/rejected/removed)
-- per the product spec, so 'remove' here sets moderation_status = 'removed'
-- instead of deleting the row — preserving it for audit, same soft-removal
-- spirit as 'dismiss'/'warn'/'escalate' already have for other content.
--
-- VISIBILITY: p2p_profiles.profile_visibility ('public'|'peers'|'private')
-- was already found (migration 071) to collapse 'public' and 'peers' into
-- one identical enforcement bucket everywhere in this codebase — no
-- connections-only content tier exists anywhere else in this app. Rather
-- than invent a fake "peers-only" distinction with no real access-control
-- meaning, testimonies use two real, honestly-different tiers:
--   'p2p_network' — visible to any authenticated peer (once approved).
--   'private'     — draft; visible only to its author, at any status.
-- Family/church visibility is deliberately NOT offered: a testimony is
-- individually-authored, and this app's family/church scoping (Family
-- Prayer, Church Calls) is built around shared, group-owned content —
-- bolting a family/church tier onto personal testimonies without a real
-- product decision on cross-posting semantics would be scope invention,
-- not reuse.

create table if not exists p2p_prayer_testimonies (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  testimony_type         text not null check (testimony_type in ('answered_prayer', 'growth')),
  title                  text not null,
  testimony_text         text not null,
  -- Only meaningful for testimony_type = 'answered_prayer'; the API enforces
  -- that a 'growth' testimony never sets this. on delete set null (not
  -- cascade) so a testimony survives even if the original request row is
  -- later removed — the testimony is the user's own authored content.
  request_id             uuid references p2p_prayer_coord_requests(id) on delete set null,
  scripture_reference    jsonb,
  media_type             text check (media_type in ('video')),
  media_path             text,
  media_duration_seconds integer check (media_duration_seconds is null or media_duration_seconds > 0),
  is_anonymous           boolean not null default false,
  visibility             text not null default 'p2p_network' check (visibility in ('p2p_network', 'private')),
  -- Matches the wall's reactive-moderation convention (content is live
  -- immediately, moderators act on reports afterward) rather than a
  -- pre-publish review queue — no such queue exists anywhere else in this
  -- codebase's content flows, and adding one here would be new moderation
  -- architecture, not reuse.
  moderation_status      text not null default 'approved' check (moderation_status in ('pending', 'approved', 'rejected', 'removed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (testimony_type = 'answered_prayer' or request_id is null),
  check (media_type is null or media_path is not null)
);

create index if not exists idx_p2p_prayer_testimonies_user on p2p_prayer_testimonies(user_id, created_at desc);
create index if not exists idx_p2p_prayer_testimonies_feed on p2p_prayer_testimonies(testimony_type, moderation_status, visibility, created_at desc)
  where moderation_status = 'approved' and visibility = 'p2p_network';
create index if not exists idx_p2p_prayer_testimonies_request on p2p_prayer_testimonies(request_id) where request_id is not null;

alter table p2p_prayer_testimonies enable row level security;

drop policy if exists "Own or approved network testimonies" on p2p_prayer_testimonies;
create policy "Own or approved network testimonies" on p2p_prayer_testimonies
  for select using (
    user_id = auth.uid()
    or (visibility = 'p2p_network' and moderation_status = 'approved')
  );
drop policy if exists "Create own testimonies" on p2p_prayer_testimonies;
create policy "Create own testimonies" on p2p_prayer_testimonies
  for insert with check (user_id = auth.uid());
drop policy if exists "Manage own testimonies" on p2p_prayer_testimonies;
create policy "Manage own testimonies" on p2p_prayer_testimonies
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Delete own testimonies" on p2p_prayer_testimonies;
create policy "Delete own testimonies" on p2p_prayer_testimonies
  for delete using (user_id = auth.uid());
drop policy if exists "Admins manage all testimonies" on p2p_prayer_testimonies;
create policy "Admins manage all testimonies" on p2p_prayer_testimonies
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- ── Storage: "prayer-testimonies" bucket ──────────────────────────────────
-- Path convention: {user_id}/{testimony_id}/video.{ext} — identical shape
-- to the "submissions" bucket (009), so the same split_part(name,'/',N)
-- ownership check applies unchanged.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prayer-testimonies', 'prayer-testimonies', false, 104857600,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists "Testifiers manage own testimony media" on storage.objects;
create policy "Testifiers manage own testimony media" on storage.objects
  for all
  using  (bucket_id = 'prayer-testimonies' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'prayer-testimonies' and auth.uid()::text = split_part(name, '/', 1));

drop policy if exists "Read approved network testimony media" on storage.objects;
create policy "Read approved network testimony media" on storage.objects
  for select using (
    bucket_id = 'prayer-testimonies' and
    exists (
      select 1 from p2p_prayer_testimonies t
      where t.id::text = split_part(name, '/', 2)
        and t.visibility = 'p2p_network'
        and t.moderation_status = 'approved'
    )
  );

drop policy if exists "Admins read all testimony media" on storage.objects;
create policy "Admins read all testimony media" on storage.objects
  for select using (bucket_id = 'prayer-testimonies' and p2p_is_admin());

-- ── Moderation: extend the CURRENT (019) functions with 'prayer_testimony' ─
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
  CHECK (content_type IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony'));

-- 'prayer_testimony': content_id is the p2p_prayer_testimonies row; author
-- is its user_id; snapshot is the testimony_text (same "reviewable text"
-- role content_snapshot plays for every other branch).
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
  IF p_content_type NOT IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony') THEN
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

-- 'prayer_testimony' remove: unlike the hard-delete branches above, a
-- testimony has its own moderation_status lifecycle (spec requires
-- pending/approved/rejected/removed to all be real states) — 'remove' sets
-- moderation_status = 'removed' rather than deleting the row, so removed
-- testimonies remain auditable rather than vanishing outright.
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

-- ── Activity timeline: two more informational, zero-score event types ─────
-- Same p2p_user_activity_events table widened in 139, same reasoning: this
-- is the purely-informational dashboard timeline (not p2p_growth_events,
-- the actual score engine), so adding values here has no scoring effect.
alter table p2p_user_activity_events drop constraint if exists p2p_user_activity_events_event_type_check;
alter table p2p_user_activity_events add constraint p2p_user_activity_events_event_type_check
  check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched',
    'prayer_gathering_completed', 'peer_prayer_supported',
    'prayer_testimony_shared', 'growth_testimony_shared'
  ));
