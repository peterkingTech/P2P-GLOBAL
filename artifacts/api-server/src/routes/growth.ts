import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { COLLECTIVE_OBJECTIVE, COLLECTIVE_STAGE, DIMENSIONS, MILESTONE_DISCLAIMER, MILESTONE_EXPLANATION, checklistFor, percentOf, stageInfo, stageObjective, verifiedSummary } from "../lib/growthStages";

// Your growth milestones (migrations 235–239). Only ever the signed-in person's
// own: their milestone (and since when), whether it is verified or a recognised
// earlier stage, what has been verified so far, and what the next milestone asks
// for in each of the four dimensions — with what is still missing. Counts and
// dates only — never the content of a reflection, journal, message or
// evaluation. The calculation runs in the database (p2p_growth_recalculate);
// nothing here can change a stage.
//   GET  /growth/me                    — the journey
//   GET  /growth/me/evidence           — my recorded evidence: kinds and dates (no content)
//   POST /growth/me/pause              — pause my milestones for a while (history kept)
//   POST /growth/me/pause/:id/end      — resume early
//   PUT  /growth/me/collective-country — opt in/out of my country in the collective totals
//   GET  /growth/me/core-foundations   — every Kingdom School Foundations lesson and my status (from Seed onwards)

const router = Router();

type Status = { stage: number; stage_since: string; verification: string; legacy_note: string | null; eligible_stage: number | null; checklist: { stages?: { stage: number; met: boolean; requirements: never[] }[]; facts?: Record<string, unknown>; calc_version?: number } | null; evaluated_at: string | null; calc_version: number | null };
const STATUS_COLS = "stage,stage_since,verification,legacy_note,eligible_stage,checklist,evaluated_at,calc_version";

const EVIDENCE_LABELS: Record<string, string> = {
  "learning.assessment_passed": "Learning unit passed",
  "learning.assessment_attempted": "Assessment answer submitted",
  "learning.assessment_failed": "Answer returned for revision",
  "learning.reflection_submitted": "Reflection submitted",
  "application.practical_answer_approved": "Practical action verified",
  "application.group_practical_reviewed": "Group practical activity reviewed",
  "application.peer_confirmed_action": "Practical help confirmed by the other person",
  "service.learning_feedback": "Useful learning feedback given",
  "service.study_session_facilitated": "Study session led",
  "service.family_learning_facilitated": "Family learning gathering hosted",
  "service.shared_study_facilitated": "Study Together hosted",
  "service.peer_confirmed_support": "Support confirmed by the person helped",
  "consistency.group_learning_attended": "Group learning attended",
  "consistency.scripture_listening": "Scripture listening completed",
  "consistency.server_activity": "Prayer participation",
};

router.get("/me", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    const [{ data: settings }, first] = await Promise.all([
      db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled,calc_version").maybeSingle(),
      db.from("p2p_growth_status").select(STATUS_COLS).eq("user_id", caller).maybeSingle(),
    ]);
    let st = first.data;
    const current = (settings as { calc_version?: number } | null)?.calc_version ?? null;
    if (!st || (current !== null && (st as Status).calc_version !== current)) {
      // First visit (a new account), or not yet checked by the current calculation.
      await db.rpc("p2p_growth_recalculate", { p_user: caller, p_source: "first_view" });
      ({ data: st } = await db.from("p2p_growth_status").select(STATUS_COLS).eq("user_id", caller).maybeSingle());
    }
    if (!st) return res.status(404).json({ error: "No growth journey for this account." });
    const s = st as Status;
    const [{ data: history }, { data: pauses }, { data: me }] = await Promise.all([
      db.from("p2p_growth_history").select("to_stage,achieved_at,kind").eq("user_id", caller).order("to_stage", { ascending: true }),
      db.from("p2p_growth_pauses").select("id,starts_on,planned_end_on,ended_on,reason").eq("user_id", caller).order("starts_on", { ascending: false }).limit(10),
      db.from("p2p_profiles").select("share_country_in_collective").eq("id", caller).maybeSingle(),
    ]);
    const next = s.stage < 5 ? s.stage + 1 : null;
    const facts = s.checklist?.facts;
    const today = String((facts as { today_local?: string } | undefined)?.today_local ?? new Date().toISOString().slice(0, 10));
    return res.json({
      explanation: MILESTONE_EXPLANATION,
      disclaimer: MILESTONE_DISCLAIMER,
      dimensionNames: DIMENSIONS,
      stage: { ...stageInfo(s.stage), objective: stageObjective(s.stage), since: s.stage_since, verification: s.verification, legacyNote: s.legacy_note },
      next: next ? { ...stageInfo(next), objective: stageObjective(next), eligible: (s.eligible_stage ?? 1) >= next, dimensions: checklistFor(next, s.checklist?.stages) } : null,
      verified: verifiedSummary(facts),
      milestones: (settings as { thresholds_status?: string } | null)?.thresholds_status === "approved" ? "approved" : "draft",
      promotionsEnabled: !!(settings as { promotions_enabled?: boolean } | null)?.promotions_enabled,
      calcVersion: (settings as { calc_version?: number } | null)?.calc_version ?? s.calc_version,
      history: ((history ?? []) as { to_stage: number; achieved_at: string; kind: string }[]).map((h) => ({ stage: h.to_stage, name: stageInfo(h.to_stage).name, achievedAt: h.achieved_at, kind: h.kind })),
      pauses: ((pauses ?? []) as { id: string; starts_on: string; planned_end_on: string; ended_on: string | null; reason: string }[]).map((p) => ({
        id: p.id, startsOn: p.starts_on, endsOn: p.ended_on ?? p.planned_end_on, reason: p.reason,
        current: p.starts_on <= today && (p.ended_on ?? p.planned_end_on) >= today, upcoming: p.starts_on > today && !p.ended_on,
      })),
      shareCountryInCollective: !!(me as { share_country_in_collective?: boolean } | null)?.share_country_in_collective,
      collective: { ...COLLECTIVE_STAGE, objective: COLLECTIVE_OBJECTIVE },
      evaluatedAt: s.evaluated_at,
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load your growth journey." });
  }
});

// Kingdom School Foundations (the Core Foundations Curriculum): every lesson of every published
// Kingdom School curriculum, with my status, from the moment I join. Only a lesson whose
// assessment was passed through an independent evaluation counts.
const CORE_STATUS_LABELS: Record<string, string> = {
  passed: "Passed", awaiting_evaluation: "Awaiting evaluation", returned: "Returned for correction", not_yet_passed: "Not yet passed",
  answer_again: "Answer the check again for a fresh evaluation",
  submitted: "Assessment submitted", in_progress: "In progress", not_started: "Not started",
};
router.get("/me/core-foundations", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const { data, error } = await db.rpc("p2p_core_curriculum_progress", { p_user: caller });
  if (error) return res.status(500).json({ error: "Couldn't load Kingdom School Foundations." });
  const rows = (data ?? []) as { lesson_id: string; title: string; curriculum_id: string; curriculum_title: string; module_id: string; module_title: string; status: string; passed_at: string | null }[];
  const passed = rows.filter((r) => r.status === "passed").length;
  type Lesson = { id: string; title: string; status: string; statusLabel: string; passedAt: string | null };
  type Mod = { id: string; title: string; curriculumId: string; curriculumTitle: string; lessons: Lesson[] };
  const modules: Mod[] = [];
  const curricula: { id: string; title: string; passed: number; total: number; modules: Mod[] }[] = [];
  for (const r of rows) {
    let cu = curricula.find((x) => x.id === r.curriculum_id);
    if (!cu) { cu = { id: r.curriculum_id, title: r.curriculum_title, passed: 0, total: 0, modules: [] }; curricula.push(cu); }
    let m = cu.modules.find((x) => x.id === r.module_id);
    if (!m) { m = { id: r.module_id, title: r.module_title, curriculumId: r.curriculum_id, curriculumTitle: r.curriculum_title, lessons: [] }; cu.modules.push(m); modules.push(m); }
    m.lessons.push({ id: r.lesson_id, title: r.title, status: r.status, statusLabel: CORE_STATUS_LABELS[r.status] ?? r.status, passedAt: r.passed_at });
    cu.total++; if (r.status === "passed") cu.passed++;
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const nextLesson = rows.find((r) => r.status !== "passed");
  return res.json({
    name: "Kingdom School Foundations", passed, total: rows.length, percent: percentOf(passed, rows.length), outstanding: rows.length - passed,
    counts, curricula: curricula.map((c) => ({ ...c, percent: percentOf(c.passed, c.total) })), modules,
    next: nextLesson ? { id: nextLesson.lesson_id, title: nextLesson.title, status: nextLesson.status } : null,
    note: "Every lesson in Kingdom School Foundations counts once, when its assessment is passed through an independent evaluation. All of them are needed for Forest Builder; you can take them at any stage. New Foundations lessons are added automatically.",
  });
});

// My recorded evidence — what kind, when, and its verification. Never content.
router.get("/me/evidence", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const { data, error } = await db.from("p2p_growth_evidence")
    .select("evidence_type,dimension,credit,source_resource,local_date,verification,voided_at")
    .eq("user_id", caller).order("occurred_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: "Couldn't load your evidence." });
  return res.json({
    evidence: ((data ?? []) as { evidence_type: string; dimension: string; credit: boolean; source_resource: string; local_date: string; verification: string; voided_at: string | null }[]).map((e) => ({
      kind: e.evidence_type, label: EVIDENCE_LABELS[e.evidence_type] ?? e.evidence_type, dimension: e.dimension, dimensionName: DIMENSIONS[e.dimension],
      counts: e.credit && e.verification === "verified" && !e.voided_at, resource: e.source_resource, date: e.local_date,
      status: e.voided_at ? "withdrawn" : e.verification,
    })),
  });
});

const REASONS = new Set(["health", "family", "travel", "work", "ministry", "other", "prefer_not_to_say"]);
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

router.post("/me/pause", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const { startsOn, endsOn, reason } = req.body ?? {};
  if (!isDate(startsOn) || !isDate(endsOn)) return res.status(400).json({ error: "Choose a start and an end date." });
  const r = REASONS.has(String(reason)) ? String(reason) : "prefer_not_to_say";
  const { data, error } = await db.rpc("p2p_growth_pause_start", { p_user: caller, p_starts: startsOn, p_ends: endsOn, p_reason: r, p_actor: caller });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_GROWTH_PAUSE:\s*/, "") });
  return res.json({ id: data });
});

router.post("/me/pause/:id/end", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const { error } = await db.rpc("p2p_growth_pause_end", { p_user: caller, p_pause: String(req.params.id), p_actor: caller });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_GROWTH_PAUSE:\s*/, "") });
  return res.json({ ended: true });
});

router.put("/me/collective-country", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  if (typeof req.body?.share !== "boolean") return res.status(400).json({ error: "Say whether to share your country." });
  const { error } = await db.from("p2p_profiles").update({ share_country_in_collective: req.body.share }).eq("id", caller);
  if (error) return res.status(500).json({ error: "Couldn't save that." });
  return res.json({ shareCountryInCollective: req.body.share });
});

export default router;
