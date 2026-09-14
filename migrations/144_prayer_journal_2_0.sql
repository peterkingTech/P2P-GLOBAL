-- 144: "Pray the Word" Stage 4 — Prayer Journal 2.0.
--
-- Purely additive to the EXISTING p2p_prayer_journal table (045) — no new
-- journal table, no change to existing rows, no change to existing RLS
-- (owner-only, unconditional — already correct per Stage 0's forensic
-- finding that is_private is a dead column since RLS never varied by it).
--
-- scripture_reference_id / topic_id: optional links into the Stage 1/142
-- foundation. On delete set null (not cascade) — a journal entry is the
-- user's own authored record and must survive even if an admin later
-- removes/renames the topic or reference it once pointed to.
--
-- prayer2_request_id: an optional REFERENCE to the user's own Prayer 2.0
-- request (p2p_prayer_coord_requests, migration 138) — never a duplicate
-- of that row's data. RLS on p2p_prayer_coord_requests already restricts
-- a user to seeing only their own or open requests; the API layer (not
-- this migration) additionally verifies request ownership before allowing
-- a journal entry to link to it, so a user can never link a journal entry
-- to someone else's private request id.
--
-- status: an OPTIONAL soft narrative label, separate from the existing
-- is_answered boolean (which remains the authoritative "answered" gate —
-- exactly as Prayer 2.0's progress_note_type (139) was kept separate from
-- p2p_prayer_coord_requests.status). The user controls this value; no
-- trigger infers or assigns it automatically.
alter table p2p_prayer_journal
  add column if not exists scripture_reference_id uuid references p2p_scripture_references(id) on delete set null,
  add column if not exists topic_id uuid references p2p_prayer_topics(id) on delete set null,
  add column if not exists prayer2_request_id uuid references p2p_prayer_coord_requests(id) on delete set null,
  add column if not exists status text check (status in ('still_praying', 'trusting_god', 'god_is_answering', 'answered', 'no_longer_needed')),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_p2p_prayer_journal_scripture on p2p_prayer_journal(scripture_reference_id) where scripture_reference_id is not null;
create index if not exists idx_p2p_prayer_journal_prayer2_request on p2p_prayer_journal(prayer2_request_id) where prayer2_request_id is not null;
