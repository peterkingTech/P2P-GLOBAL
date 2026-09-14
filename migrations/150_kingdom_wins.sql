-- 150: Kingdom Wins / Testimonies — a genuine peer-authored testimony
-- domain, deliberately independent from both the legacy Prayer Wall
-- (p2p_prayer_wall_posts, "please pray for me") and Missions
-- (p2p_mission_stories, admin-curated field reporting). Kingdom Wins is
-- "look what God has done" — any authenticated user may author one,
-- unlike Mission Stories (admin-role-gated).
--
-- ENTRY MODEL: one domain table with a controlled entry_type
-- ('kingdom_win' | 'testimony'), matching this program's own established
-- preference (Mission Stories' story_type) over five separate tables.
--
-- LIFECYCLE: draft -> submitted -> published, with rejected/removed as
-- moderation outcomes — draft/submitted/rejected never public.
--
-- CONNECTIONS: nullable references only (scripture_reference_id,
-- mission_story_id, mission_field_id, prayer2_request_id) — never a
-- duplicate of the referenced row, matching every prior cross-domain
-- link in this program (Journal->Scripture, Prayer2.0->Missions, etc.).
--
-- REACTIONS: a NEW, small table (p2p_kingdom_win_reactions) rather than
-- reusing p2p_prayer_wall_reactions — reusing the wall's reaction table
-- would blur domain ownership (the wall's reactions are keyed to wall
-- posts specifically) and the wall's reaction system has no RLS in
-- source control at all (a pre-existing Stage-0-documented risk from the
-- Prayer 2.0 forensic audit) — not something to extend, not something to
-- inherit here. "Scripture" and "Share" are not persisted reactions:
-- Scripture is a navigation action to the existing Bible/study flow;
-- Share uses the device's native share sheet, no record kept.
create table if not exists p2p_kingdom_wins (
  id                      uuid primary key default gen_random_uuid(),
  author_id               uuid not null references auth.users(id) on delete cascade,
  entry_type              text not null check (entry_type in ('kingdom_win', 'testimony')),
  title                   text not null,
  body                    text not null,
  lesson_learned          text,
  category                text not null check (category in (
    'answered_prayer', 'salvation', 'healing', 'freedom', 'provision', 'reconciliation',
    'spiritual_growth', 'family', 'work_calling', 'evangelism', 'discipleship', 'missions', 'other'
  )),
  scripture_reference_id  uuid references p2p_scripture_references(id) on delete set null,
  mission_story_id        uuid references p2p_mission_stories(id) on delete set null,
  mission_field_id        uuid references p2p_mission_fields(id) on delete set null,
  prayer2_request_id      uuid references p2p_prayer_coord_requests(id) on delete set null,
  media_type              text check (media_type in ('photo', 'video')),
  media_path              text,
  media_duration_seconds  integer check (media_duration_seconds is null or media_duration_seconds > 0),
  is_anonymous            boolean not null default false,
  visibility              text not null default 'p2p_network' check (visibility in ('p2p_network', 'private')),
  status                  text not null default 'draft' check (status in ('draft', 'submitted', 'published', 'rejected', 'removed')),
  moderation_note         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  submitted_at            timestamptz,
  published_at            timestamptz,
  check (media_type is null or media_path is not null)
);

create index if not exists idx_p2p_kingdom_wins_author on p2p_kingdom_wins(author_id, created_at desc);
create index if not exists idx_p2p_kingdom_wins_feed on p2p_kingdom_wins(status, visibility, published_at desc)
  where status = 'published' and visibility = 'p2p_network';
create index if not exists idx_p2p_kingdom_wins_category on p2p_kingdom_wins(category) where status = 'published';

create table if not exists p2p_kingdom_win_reactions (
  id              uuid primary key default gen_random_uuid(),
  kingdom_win_id  uuid not null references p2p_kingdom_wins(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  reaction_type   text not null check (reaction_type in ('praying', 'amen', 'encourage')),
  created_at      timestamptz not null default now(),
  unique (kingdom_win_id, user_id, reaction_type)
);
create index if not exists idx_p2p_kingdom_win_reactions_win on p2p_kingdom_win_reactions(kingdom_win_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table p2p_kingdom_wins enable row level security;
alter table p2p_kingdom_win_reactions enable row level security;

-- Published+network content is public to any authenticated user; the
-- author always sees their own regardless of status (drafts included);
-- admins/moderators see everything for review.
drop policy if exists "Published kingdom wins are public, own always visible" on p2p_kingdom_wins;
create policy "Published kingdom wins are public, own always visible" on p2p_kingdom_wins
  for select using (
    (status = 'published' and visibility = 'p2p_network')
    or author_id = auth.uid()
    or p2p_is_admin()
  );
-- Any authenticated user may author their OWN Kingdom Win/Testimony —
-- unlike Mission Stories, there is no admin gate here by design (this is
-- peer-generated content, not curated editorial content).
drop policy if exists "Users create their own kingdom wins" on p2p_kingdom_wins;
create policy "Users create their own kingdom wins" on p2p_kingdom_wins
  for insert with check (author_id = auth.uid());
drop policy if exists "Authors manage their own kingdom wins" on p2p_kingdom_wins;
create policy "Authors manage their own kingdom wins" on p2p_kingdom_wins
  for update using (author_id = auth.uid() or p2p_is_admin()) with check (author_id = auth.uid() or p2p_is_admin());
drop policy if exists "Authors delete their own kingdom wins" on p2p_kingdom_wins;
create policy "Authors delete their own kingdom wins" on p2p_kingdom_wins
  for delete using (author_id = auth.uid());

drop policy if exists "Reactions visible with their kingdom win" on p2p_kingdom_win_reactions;
create policy "Reactions visible with their kingdom win" on p2p_kingdom_win_reactions
  for select using (
    exists (
      select 1 from p2p_kingdom_wins w
      where w.id = kingdom_win_id
        and ((w.status = 'published' and w.visibility = 'p2p_network') or w.author_id = auth.uid() or p2p_is_admin())
    )
  );
drop policy if exists "Users manage their own reactions" on p2p_kingdom_win_reactions;
create policy "Users manage their own reactions" on p2p_kingdom_win_reactions
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from p2p_kingdom_wins w where w.id = kingdom_win_id and w.status = 'published' and w.visibility = 'p2p_network')
  );

-- ── Storage: "kingdom-wins-media" bucket ────────────────────────────────────
-- A separate bucket from "mission-media" — Kingdom Wins is peer-authored
-- (any user) with a different authorization model than Mission Stories
-- (admin-role-gated); mixing them in one bucket's read-policy would need
-- to branch on content_type internally, which is exactly the domain
-- confusion this migration's own header explains why to avoid.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kingdom-wins-media', 'kingdom-wins-media', false, 104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists "Authors manage own kingdom win media" on storage.objects;
create policy "Authors manage own kingdom win media" on storage.objects
  for all
  using  (bucket_id = 'kingdom-wins-media' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'kingdom-wins-media' and auth.uid()::text = split_part(name, '/', 1));

drop policy if exists "Read published kingdom win media" on storage.objects;
create policy "Read published kingdom win media" on storage.objects
  for select using (
    bucket_id = 'kingdom-wins-media' and
    exists (
      select 1 from p2p_kingdom_wins w
      where w.id::text = split_part(name, '/', 2)
        and w.status = 'published' and w.visibility = 'p2p_network'
    )
  );

drop policy if exists "Admins read all kingdom win media" on storage.objects;
create policy "Admins read all kingdom win media" on storage.objects
  for select using (bucket_id = 'kingdom-wins-media' and p2p_is_admin());

-- ── Moderation: extend the CURRENT functions with 'kingdom_win' ────────────
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
  CHECK (content_type IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony', 'mission_story', 'kingdom_win'));

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
  IF p_content_type NOT IN ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony', 'mission_story', 'kingdom_win') THEN
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
  ELSIF p_content_type = 'kingdom_win' THEN
    SELECT author_id, body INTO v_author_id, v_snapshot FROM p2p_kingdom_wins WHERE id = p_content_id;
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
    ELSIF v_flag.content_type = 'kingdom_win' THEN
      UPDATE p2p_kingdom_wins SET status = 'removed', updated_at = now() WHERE id = v_flag.content_id;
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
