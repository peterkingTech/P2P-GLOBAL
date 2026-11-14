-- APPLIED TO PRODUCTION 2026-11-14 14:38:26 UTC (owner approval 2026-11-14; guarded single-transaction apply with in-transaction checks; backup C:/Users/offic/P2P-Backups/prod-c5e1812c-2026-11-14T14-38-14-679Z-tables-247-250 (JSON of every touched table)).
-- The notes below were written before applying; "PROPOSED" there is historical.
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PROPOSED — NOT APPLIED. Do not run without the owner's explicit approval.  ║
-- ║ Kept outside migrations/ on purpose so no apply script can pick it up.     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Growth integrity fixes found in the 2026-11-14 Growth Matrix audit. Additive only: no data is changed
-- or deleted, no threshold is touched. If approved, copy to migrations/247_… and apply with the guarded
-- procedure (precheck → transaction → postcheck), service-role only.
--
-- 1. STAGE HISTORY IS APPEND-ONLY (finding: p2p_growth_history had no immutability guard, unlike the
--    evidence ledger and mentorship checkpoints). New rows are still written by p2p_growth_recalculate;
--    existing rows can no longer be edited or deleted — a correction is a NEW row (kind 'correction').
--    Deleting a person's account still removes their rows (cascade), as for the ledger.
create or replace function public.p2p_growth_history_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Same rule as the evidence ledger (239:254): only when the person's profile is being removed (cascade).
  if tg_op = 'DELETE' and not exists (select 1 from public.p2p_profiles where id = old.user_id) then
    return old;
  end if;
  raise exception 'P2P_GROWTH_HISTORY: stage history is permanent; record a correction as a new entry' using errcode = '42501';
end $$;

drop trigger if exists p2p_growth_history_append_only on public.p2p_growth_history;
create trigger p2p_growth_history_append_only
  before update or delete on public.p2p_growth_history
  for each row execute function public.p2p_growth_history_append_only();

-- 2. NOT INCLUDED AS SQL (need the full function bodies rewritten; proposed for review):
--    a. p2p_development_history (241): `helpsOthers` should count only the helped person's service to
--       others AFTER this person's first support (as p2p_growth_refresh_development already does, 239:816).
--    b. p2p_development_history (241): `wasDesignatedGuide` should ignore declined / expired / pending links.
--    c. p2p_mentorship_checkpoint (241): a person with no growth status row should be recorded as stage
--       NULL / source 'unavailable', not as a verified Seed (coalesce(stage,1), 'verified').
--    d. Pause and resume of a Guide relationship should write checkpoints too.
--    e. Optional: p2p_learning_theme_map (docs/learning-roots-mapping.md) once the theme mapping is approved.
--
-- Rollback for 1:  drop trigger if exists p2p_growth_history_append_only on public.p2p_growth_history;
--                  drop function if exists public.p2p_growth_history_append_only();
