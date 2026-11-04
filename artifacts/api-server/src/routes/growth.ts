import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { COLLECTIVE_STAGE, checklistFor, stageInfo } from "../lib/growthStages";

// Your growth journey (migrations 235–237). Only ever the signed-in person's
// own: their stage (and since when), whether it is verified by the milestones
// or a recognised earlier stage, what the next stage asks for in each of the
// four dimensions, and the stages they have reached. Counts and dates only —
// never the content of a reflection, journal or evaluation. The calculation
// itself runs in the database (p2p_growth_recalculate); nothing here can
// change a stage.

const router = Router();

type Status = { stage: number; stage_since: string; verification: string; legacy_note: string | null; eligible_stage: number | null; checklist: { stages?: { stage: number; met: boolean; requirements: never[] }[] } | null; evaluated_at: string | null };

router.get("/me", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    let { data: st } = await db.from("p2p_growth_status").select("stage,stage_since,verification,legacy_note,eligible_stage,checklist,evaluated_at").eq("user_id", caller).maybeSingle();
    if (!st) {
      // First visit (a new account): the engine records where they are.
      await db.rpc("p2p_growth_recalculate", { p_user: caller, p_source: "first_view" });
      ({ data: st } = await db.from("p2p_growth_status").select("stage,stage_since,verification,legacy_note,eligible_stage,checklist,evaluated_at").eq("user_id", caller).maybeSingle());
    }
    if (!st) return res.status(404).json({ error: "No growth journey for this account." });
    const s = st as Status;
    const [{ data: settings }, { data: history }] = await Promise.all([
      db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled").maybeSingle(),
      db.from("p2p_growth_history").select("to_stage,achieved_at,kind").eq("user_id", caller).order("to_stage", { ascending: true }),
    ]);
    const next = s.stage < 5 ? s.stage + 1 : null;
    return res.json({
      stage: { ...stageInfo(s.stage), since: s.stage_since, verification: s.verification, legacyNote: s.legacy_note },
      next: next ? { ...stageInfo(next), dimensions: checklistFor(next, s.checklist?.stages) } : null,
      milestones: (settings as { thresholds_status?: string } | null)?.thresholds_status === "approved" ? "approved" : "draft",
      promotionsEnabled: !!(settings as { promotions_enabled?: boolean } | null)?.promotions_enabled,
      history: ((history ?? []) as { to_stage: number; achieved_at: string; kind: string }[]).map((h) => ({ stage: h.to_stage, name: stageInfo(h.to_stage).name, achievedAt: h.achieved_at, kind: h.kind })),
      collective: COLLECTIVE_STAGE,
      evaluatedAt: s.evaluated_at,
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load your growth journey." });
  }
});

export default router;
