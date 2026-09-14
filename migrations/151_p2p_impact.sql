-- 151: P2P Impact — a testimony category living INSIDE the existing
-- Kingdom Wins domain (p2p_kingdom_wins, migration 150), per this
-- feature's own instruction that P2P Impact/Testimony/Kingdom Win are
-- "content classifications, not separate social networks." No new
-- content table — every change below is additive to the existing one.
--
-- CORE PRINCIPLE ENFORCED HERE: "Not our work. His work." — a published
-- testimony belongs to the global P2P community and to God's story, not
-- to the author's account lifecycle or to a private-audience toggle.
-- Two real, pre-existing gaps are fixed as part of adding this feature,
-- both flagged explicitly by this feature's own spec:
--
--   (1) GLOBAL VISIBILITY: today status and visibility are independent,
--       so a row could be status='published' AND visibility='private' —
--       exactly the per-entry privacy option the spec forbids for
--       published content. Fixed with a CHECK constraint (defense in
--       depth) plus API-layer validation (see routes/kingdomWins.ts).
--       This applies to the WHOLE table, not just the new entry_type,
--       because the spec states the global-visibility principle for
--       "P2P Impact / Kingdom Wins" together.
--
--   (2) AUTHOR DELETION: author_id was `not null ... on delete cascade`,
--       the exact problem class this spec calls out by name (referencing
--       the earlier Missions implementation). DECISION (stated, not
--       silent): published testimony content is about what GOD did, not
--       about the author's continued account — it must survive account
--       deletion. author_id becomes nullable with `on delete set null`;
--       the API/UI fall back to "A Former P2P Member" when null.

-- ── entry_type: add 'p2p_impact' alongside the existing two ────────────────
alter table p2p_kingdom_wins drop constraint if exists p2p_kingdom_wins_entry_type_check;
alter table p2p_kingdom_wins add constraint p2p_kingdom_wins_entry_type_check
  check (entry_type in ('kingdom_win', 'testimony', 'p2p_impact'));

-- ── status: add 'archived' as a real, distinct lifecycle state ─────────────
-- Distinct from the existing moderation-only 'removed' (a violation
-- outcome) — 'archived' is a normal, non-punitive retirement of an old
-- story, preserving the historical record while dropping it from normal
-- discovery (see the updated select policy below).
alter table p2p_kingdom_wins drop constraint if exists p2p_kingdom_wins_status_check;
alter table p2p_kingdom_wins add constraint p2p_kingdom_wins_status_check
  check (status in ('draft', 'submitted', 'published', 'rejected', 'removed', 'archived'));

-- ── impact_themes: a controlled, richer taxonomy distinct from `category` ──
-- `category` (13 values, 150) is the existing coarse classification used
-- by the original Kingdom Win/Testimony flow — left untouched. Impact
-- themes are a separate, multi-select, API-validated list (same pattern
-- as Missions' mission_focus, migration 146) for the deeper P2P Impact
-- storytelling experience.
alter table p2p_kingdom_wins add column if not exists impact_themes text[] not null default '{}';

-- ── guided_sections: the 5-step creation flow's answers ────────────────────
-- Before / Journey / What God Did / Today / Encouragement — stored so a
-- draft can be resumed/edited section-by-section. `body` remains the
-- single assembled text every existing card/detail screen already
-- renders, so nothing that reads this table needs to change to keep
-- working. None of these are required — the flow is explicitly flexible.
alter table p2p_kingdom_wins add column if not exists guided_sections jsonb;

-- ── consent ─────────────────────────────────────────────────────────────────
-- Required before a story can be submitted or published (enforced at the
-- API layer, see routes/kingdomWins.ts) — an explicit acknowledgment that
-- (a) this will be shared with the global P2P community and (b) the
-- author has permission to share anyone else pictured/named.
alter table p2p_kingdom_wins add column if not exists consent_confirmed_at timestamptz;

-- ── archived_at: symmetry with submitted_at/published_at ───────────────────
alter table p2p_kingdom_wins add column if not exists archived_at timestamptz;

-- ── Fix 1: global visibility — published content cannot be private ────────
alter table p2p_kingdom_wins drop constraint if exists p2p_kingdom_wins_published_visibility_check;
alter table p2p_kingdom_wins add constraint p2p_kingdom_wins_published_visibility_check
  check (status <> 'published' or visibility = 'p2p_network');

-- ── Fix 2: author_id survives account deletion ─────────────────────────────
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'p2p_kingdom_wins'
    AND con.contype = 'f'
    AND att.attname = 'author_id';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.p2p_kingdom_wins DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

alter table p2p_kingdom_wins alter column author_id drop not null;
alter table p2p_kingdom_wins
  add constraint p2p_kingdom_wins_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;

-- ── RLS: extend the existing select policy to exclude archived/removed from
-- normal discovery while still letting the author/admin see their own ──────
drop policy if exists "Published kingdom wins are public, own always visible" on p2p_kingdom_wins;
create policy "Published kingdom wins are public, own always visible" on p2p_kingdom_wins
  for select using (
    (status = 'published' and visibility = 'p2p_network')
    or author_id = auth.uid()
    or p2p_is_admin()
  );
-- (archived rows still match "author_id = auth.uid() or p2p_is_admin()" for
-- the author's own "My Stories" list and moderator inspection — they are
-- simply excluded from the public feed query at the API layer, which
-- already filters status='published' explicitly. Nothing else in this RLS
-- policy needs to change for that.)

drop policy if exists "Authors manage their own kingdom wins" on p2p_kingdom_wins;
create policy "Authors manage their own kingdom wins" on p2p_kingdom_wins
  for update using (author_id = auth.uid() or p2p_is_admin()) with check (
    -- An author may still change their OWN row, but only into a state they
    -- themselves are allowed to set (draft/submitted/published/archived —
    -- never rejected/removed, which stay moderator-only, enforced again at
    -- the API layer as the primary gate).
    p2p_is_admin() or (author_id = auth.uid() and status in ('draft', 'submitted', 'published', 'archived'))
  );
