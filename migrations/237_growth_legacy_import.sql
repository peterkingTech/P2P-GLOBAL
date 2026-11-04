-- 237 (Phase 2 — move everyone into the growth engine, approved by the owner
-- 2026-11-04; restore-tested; applied only with the guarded procedure).
-- DATA ONLY, additive: one p2p_growth_status row per person (and one history
-- row for a stage above Dormant Seed). Nothing else changes — growth_level is
-- untouched, nobody is notified, nothing is celebrated.
--
--   • Each person keeps the stage they see today (from growth_level on the
--     old ladder 0 · 4 · 12 · 28 · 60 · 110). NOBODY is lowered.
--   • Forest of Nations (110+) is now the collective view, not a personal
--     stage: those people are recorded as Forest Builder — the highest
--     personal stage — with a note saying so.
--   • A stage the draft milestones (235) already confirm is "verified";
--     otherwise it is recognised as "legacy_unverified" with the reason, and
--     the engine confirms it later when the evidence is there. It is never
--     taken away.
-- Idempotent: people who already have a growth status are skipped.

begin;
do $$
declare
  r record;
  v_stage int;
  v_eval jsonb;
  v_eligible int;
  v_verified boolean;
  n int := 0; n_verified int := 0; n_legacy int := 0; n_nations int := 0;
  v_names constant text[] := array['Dormant Seed', 'Sprout', 'Young Tree', 'Fruitful Tree', 'Forest Builder'];
begin
  for r in select p.id, coalesce(p.growth_level, 0) as gl from public.p2p_profiles p
            where not coalesce(p.is_official_account, false)
              and not exists (select 1 from public.p2p_growth_status s where s.user_id = p.id)
            order by p.created_at loop
    v_stage := case when r.gl >= 60 then 5 when r.gl >= 28 then 4 when r.gl >= 12 then 3 when r.gl >= 4 then 2 else 1 end;
    v_eval := public.p2p_growth_evaluate(r.id);
    v_eligible := (v_eval ->> 'eligible_stage')::int;
    v_verified := v_eligible >= v_stage;
    insert into public.p2p_growth_status (user_id, stage, stage_since, verification, legacy_note, eligible_stage, checklist, calc_version, evaluated_at)
    values (r.id, v_stage, now(), case when v_verified then 'verified' else 'legacy_unverified' end,
            case when v_verified then null
                 else format('Recognised from the previous growth system (growth level %s) as %s; not yet confirmed by the milestones.', r.gl, v_names[v_stage])
                      || case when r.gl >= 110 then ' Previously shown as Forest of Nations, which is now the collective view of discipleship, not a personal stage.' else '' end end,
            v_eligible, v_eval, (select calc_version from public.p2p_growth_settings), now());
    if v_stage > 1 then
      insert into public.p2p_growth_history (user_id, from_stage, to_stage, kind, criteria, calc_version, source, reason)
      values (r.id, null, v_stage, 'legacy_import', v_eval, (select calc_version from public.p2p_growth_settings), 'migration_237',
              format('Recognised from the previous growth system (growth level %s)', r.gl))
      on conflict (user_id, to_stage) do nothing;
    end if;
    n := n + 1;
    if v_verified then n_verified := n_verified + 1; else n_legacy := n_legacy + 1; end if;
    if r.gl >= 110 then n_nations := n_nations + 1; end if;
  end loop;
  if n = 0 then raise notice 'P2P_GROWTH_237: nothing to import'; return; end if;
  raise notice 'P2P_GROWTH_237: imported % people (% verified, % legacy_unverified; % previously Forest of Nations → Forest Builder)', n, n_verified, n_legacy, n_nations;
end $$;
commit;

-- Rollback: delete from p2p_growth_history where kind = 'legacy_import' and source = 'migration_237';
--           delete from p2p_growth_status (only before promotions are switched on).
