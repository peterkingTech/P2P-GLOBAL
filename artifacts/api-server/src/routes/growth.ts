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
//   GET  /growth/me/tree               — My Growth Tree: roots, trunk, branches, fruits (one per verified contribution), seeds,
//                                        consistency, application records, learning milestones (shared by Home, My Tree, My Growth)
//   GET  /growth/me/learning-roots     — my learning grouped by the curriculum's own structure (My Growth → Learning Roots)

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
      // How My Tree Grows (2026-11-14): the engine's own checklists for the stages AFTER the next one, so
      // future milestones come from the Matrix and are never recomputed by the app. Optional for older apps.
      later: next ? [next + 1, next + 2, next + 3].filter((n) => n <= 5).map((n) => ({ ...stageInfo(n), objective: stageObjective(n), dimensions: checklistFor(n, s.checklist?.stages) })) : [],
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

// ── My Growth Tree: the tree's data, read from what is already verified (never a second score) ─────────
// Roots ← Kingdom School Foundations + learning units + active weeks/months (the Matrix's own facts);
// trunk ← the verified stage and its dated history; stems ← verified practical actions; branches ←
// verified, credited evidence per P2P area (only real evidence makes a branch); fruits ← ONE per
// Service & Contribution ledger record (its unique dedup_key means one action = one record: a repeated
// approval can't add a fruit; a group session is one record for its facilitator, however many attended);
// seeds ← people I helped who now verifiably help others (development history + their own verified
// service evidence — the date only). Withdrawn/rejected records stay listed (history is kept) but are
// never shown as verified fruit. Counts and dates only — never content, answers or messages.
const GROUP_FRUIT = new Set(["service.study_session_facilitated", "service.family_learning_facilitated", "service.shared_study_facilitated"]);
const AREA_LABELS: Record<string, string> = {
  kingdom_school: "Kingdom School", kingdom_stories: "Kingdom Stories", learning_plan: "Learning Plans", study_together: "Study Together",
  family: "Family", church: "Church", evaluation: "Peer evaluation", peer_confirmation: "Peer support", scripture: "Bible", prayer: "Prayer",
};
type EvRow = { id: string; evidence_type: string; dimension: string; credit: boolean; counts_for_activity?: boolean | null; unit_key?: string | null; source_resource: string; local_date: string; verification: string; voided_at: string | null };
const EV_COLS = "id,evidence_type,dimension,credit,counts_for_activity,unit_key,source_resource,local_date,verification,voided_at";
const EV_LIMIT = 5000;
/** Counts as verified evidence for the Matrix (credited, verified, not withdrawn). */
const creditedOk = (r: EvRow) => r.credit && r.verification === "verified" && !r.voided_at;
/** Learning milestones shown in the Growth Story: the dated pass that made the Nth unique learning unit. */
const LEARNING_MARKS = [1, 10, 20, 50, 100];
const RECENT_DAYS = 14;
router.get("/me/tree", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    const [{ data: st }, { data: history }, { data: ev, error: evErr }] = await Promise.all([
      db.from("p2p_growth_status").select(STATUS_COLS).eq("user_id", caller).maybeSingle(),
      db.from("p2p_growth_history").select("to_stage,achieved_at,kind").eq("user_id", caller).order("to_stage", { ascending: true }),
      // NEWEST first, so a very long record keeps its latest evidence (oldest-first used to drop the newest past 5,000).
      db.from("p2p_growth_evidence").select(EV_COLS).eq("user_id", caller).order("occurred_at", { ascending: false }).limit(EV_LIMIT),
    ]);
    if (evErr) throw evErr;
    if (!st) return res.status(404).json({ error: "Open your growth journey first." });
    const s = st as Status;
    const rows = ((ev ?? []) as EvRow[]).slice().reverse();
    const truncated = (ev ?? []).length >= EV_LIMIT;
    const counts = (r: EvRow) => r.credit && r.verification === "verified" && !r.voided_at;
    const facts = verifiedSummary(s.checklist?.facts);

    // Fruits: Service & Contribution records, one each; people helped per record (a count only).
    const service = rows.filter((r) => r.dimension === "service");
    const ids = service.map((r) => r.id);
    const helpedBy = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: b } = await db.from("p2p_growth_evidence_beneficiaries").select("evidence_id").in("evidence_id", ids.slice(i, i + 200));
      for (const x of (b ?? []) as { evidence_id: string }[]) helpedBy.set(x.evidence_id, (helpedBy.get(x.evidence_id) ?? 0) + 1);
    }
    const fruits = service.map((r) => ({
      id: r.id, type: r.evidence_type, label: EVIDENCE_LABELS[r.evidence_type] ?? r.evidence_type, date: r.local_date,
      area: r.source_resource, areaLabel: AREA_LABELS[r.source_resource] ?? r.source_resource,
      kind: GROUP_FRUIT.has(r.evidence_type) ? "group" : "individual", peopleHelped: helpedBy.get(r.id) ?? null,
      status: r.voided_at ? "withdrawn" : r.verification, countsTowardMilestone: counts(r),
    }));

    // Branches: only areas with verified, credited evidence.
    const byArea = new Map<string, number>();
    for (const r of rows) if (counts(r)) byArea.set(r.source_resource, (byArea.get(r.source_resource) ?? 0) + 1);

    // Seeds: from the development history (relationships), the date each helped person first verifiably helped others.
    const { data: dh } = await db.rpc("p2p_development_history", { p_person: caller });
    const helped = ((dh as { helped?: { personId: string; contributions: number; helpsOthers: boolean }[] } | null)?.helped ?? []);
    const firstHelp = new Map<string, string>();
    const helpers = helped.filter((h) => h.helpsOthers).map((h) => h.personId);
    if (helpers.length) {
      const { data: theirs } = await db.from("p2p_growth_evidence").select("user_id,local_date,verification,voided_at,credit").in("user_id", helpers).eq("dimension", "service").order("occurred_at", { ascending: true }).limit(5000);
      for (const x of (theirs ?? []) as { user_id: string; local_date: string; verification: string; voided_at: string | null; credit: boolean }[]) {
        if (x.credit && x.verification === "verified" && !x.voided_at && !firstHelp.has(x.user_id)) firstHelp.set(x.user_id, x.local_date);
      }
    }

    return res.json({
      stage: { ...stageInfo(s.stage), objective: stageObjective(s.stage), since: s.stage_since, verification: s.verification },
      history: ((history ?? []) as { to_stage: number; achieved_at: string; kind: string }[]).map((h) => ({ stage: h.to_stage, name: stageInfo(h.to_stage).name, achievedAt: h.achieved_at, kind: h.kind })),
      roots: { coreLessons: facts.coreLessons, learningUnits: facts.learningUnits, activeWeeks: facts.activeWeeks, activeMonths: facts.activeMonths },
      stems: { practicalActions: facts.practicalActions },
      branches: [...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([area, verified]) => ({ area, label: AREA_LABELS[area] ?? area, verified })),
      fruits,
      fruitTotals: {
        verified: fruits.filter((f) => f.countsTowardMilestone).length,
        pendingReview: fruits.filter((f) => f.status === "pending_review").length,
        withdrawn: fruits.filter((f) => f.status === "withdrawn").length,
        rejected: fruits.filter((f) => f.status === "rejected").length,
      },
      seeds: helped.map((h, i) => ({ ref: `p${i + 1}`, verifiedContributionsToThem: h.contributions, nowHelpingOthers: h.helpsOthers, firstHelpedOthersOn: firstHelp.get(h.personId) ?? null })),
      // ── Added 2026-11-14 for My Growth (backwards-compatible: new fields only) ──
      // Consistency: the Matrix's own facts (from the last calculation) + recent qualifying evidence (ledger).
      consistency: consistencySummary(s.checklist?.facts, rows),
      // Application: one entry per Application ledger record (verified or awaiting review; withdrawn/rejected kept, never counted).
      application: rows.filter((r) => r.dimension === "application").map((r) => ({
        id: r.id, type: r.evidence_type, label: EVIDENCE_LABELS[r.evidence_type] ?? r.evidence_type, date: r.local_date,
        area: r.source_resource, areaLabel: AREA_LABELS[r.source_resource] ?? r.source_resource,
        status: r.voided_at ? "withdrawn" : r.verification, countsTowardMilestone: creditedOk(r),
      })),
      // Learning milestones: the date the 1st, 10th, 20th, 50th and 100th unique learning unit was passed.
      learningMilestones: learningMilestones(rows),
      contributionsCounted: facts.contributions,
      evidenceTruncated: truncated,
      disclaimer: MILESTONE_DISCLAIMER,
      note: "Every part of the tree comes from records already verified for your growth milestones. Nothing here is a new score.",
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load your tree." });
  }
});

/** Consistency for My Growth: the Matrix's own facts (never recalculated here) + recent qualifying ledger evidence. */
function consistencySummary(facts: Record<string, unknown> | undefined, rows: EvRow[]) {
  const f = (facts ?? {}) as Record<string, unknown>;
  const num = (k: string) => (f[k] === undefined || f[k] === null ? null : Number(f[k]));
  const today = String(f.today_local ?? new Date().toISOString().slice(0, 10));
  const since = new Date(Date.parse(today + "T00:00:00Z") - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const qualifying = rows.filter((r) => r.counts_for_activity && r.verification === "verified" && !r.voided_at);
  const recent = qualifying.filter((r) => r.local_date >= since && r.local_date <= today);
  const win = (f.active_weeks_window ?? {}) as Record<string, unknown>;
  return {
    activeWeeks: num("active_weeks"), activeMonths: num("active_months"), journeyDays: num("journey_days"),
    daysInStage: num("days_in_stage"), pausedDaysInStage: num("paused_days_in_stage"), pausedNow: !!f.paused_now,
    activeWeeksLast16: win["16"] === undefined ? null : Number(win["16"]), activeWeeksLast26: win["26"] === undefined ? null : Number(win["26"]),
    firstActivityAt: (f.first_activity_at as string | null | undefined) ?? null,
    recentDays: RECENT_DAYS, recentQualifying: recent.length,
    lastQualifyingOn: qualifying.length ? qualifying[qualifying.length - 1].local_date : null,
    calculatedFor: today,
  };
}

/** The dated pass that made the 1st, 10th, 20th, 50th, 100th UNIQUE learning unit (a re-pass never counts twice). */
function learningMilestones(rows: EvRow[]) {
  const seen = new Set<string>(); const out: { units: number; date: string }[] = [];
  for (const r of rows) {
    if (r.evidence_type !== "learning.assessment_passed" || !creditedOk(r) || !r.unit_key || seen.has(r.unit_key)) continue;
    seen.add(r.unit_key);
    if (LEARNING_MARKS.includes(seen.size)) out.push({ units: seen.size, date: r.local_date });
  }
  return out;
}

// ── Learning Roots (2026-11-14): my learning grouped by the curriculum's OWN structure ─────────────────
// Read only. Units and statuses come from the evidence ledger (passed = verified, credited, not withdrawn —
// one unit per lesson, so a re-pass or a second pathway never counts twice) and lesson progress. Roots are
// the existing, approved groupings — never a guess from a lesson title:
//   • Kingdom School Foundations → one root per Foundations curriculum (its own title);
//   • Learning Plans → one root per plan category (the 10 approved categories, migration 054);
//   • Kingdom Stories → one root; each story topic listed inside it;
//   • anything else → "Other learning" by its curriculum type.
// The owner's proposed themes (Biblical Understanding, Discipleship, …) need a reviewed mapping first:
// docs/learning-roots-mapping.md. Nothing here is a qualification, a level or a judgement.
type RootLessonStatus = "passed" | "returned" | "submitted" | "in_progress";
router.get("/me/learning-roots", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    const [{ data: ev, error: evErr }, { data: prog }] = await Promise.all([
      db.from("p2p_growth_evidence").select("evidence_type,unit_key,local_date,occurred_at,verification,voided_at,credit,lesson_id:detail->>lesson_id")
        .eq("user_id", caller).in("evidence_type", ["learning.assessment_passed", "learning.assessment_attempted", "learning.assessment_failed", "application.practical_answer_approved"])
        .order("occurred_at", { ascending: false }).limit(EV_LIMIT),
      db.from("p2p_lesson_progress").select("lesson_id,status,progress_percent").eq("user_id", caller).limit(5000),
    ]);
    if (evErr) throw evErr;
    type R = { evidence_type: string; unit_key: string | null; local_date: string; verification: string; voided_at: string | null; credit: boolean; lesson_id: string | null };
    const status = new Map<string, { status: RootLessonStatus; passedOn: string | null; practical: number }>();
    const get = (id: string) => { let x = status.get(id); if (!x) { x = { status: "in_progress", passedOn: null, practical: 0 }; status.set(id, x); } return x; };
    const lastAttempt = new Map<string, "attempted" | "failed">();
    for (const r of ((ev ?? []) as R[]).slice().reverse()) {
      const lid = r.unit_key?.startsWith("lesson:") ? r.unit_key.slice(7) : r.lesson_id;
      if (!lid) continue;
      if (r.evidence_type === "learning.assessment_passed") {
        if (r.credit && r.verification === "verified" && !r.voided_at) { const x = get(lid); if (x.status !== "passed") { x.status = "passed"; x.passedOn = r.local_date; } }
      } else if (r.evidence_type === "application.practical_answer_approved") {
        if (r.credit && r.verification === "verified" && !r.voided_at) get(lid).practical++;
      } else if (!r.voided_at) lastAttempt.set(lid, r.evidence_type === "learning.assessment_failed" ? "failed" : "attempted");
    }
    for (const [lid, a] of lastAttempt) { const x = get(lid); if (x.status !== "passed") x.status = a === "failed" ? "returned" : "submitted"; }
    for (const p of (prog ?? []) as { lesson_id: string; status: string | null; progress_percent: number | null }[]) {
      if (p.lesson_id && !status.has(p.lesson_id) && ((p.status && p.status !== "not_started") || (p.progress_percent ?? 0) > 0)) get(p.lesson_id);
    }

    // The curriculum structure of those lessons (published or not — a passed lesson stays in its root).
    const lessonIds = [...status.keys()];
    const lessons: { id: string; title: string; module_id: string }[] = [];
    for (let i = 0; i < lessonIds.length; i += 150) {
      const { data } = await db.from("p2p_lessons").select("id,title,module_id").in("id", lessonIds.slice(i, i + 150));
      lessons.push(...((data ?? []) as typeof lessons));
    }
    const moduleIds = [...new Set(lessons.map((l) => l.module_id))];
    const modules: { id: string; title: string; curriculum_id: string }[] = [];
    for (let i = 0; i < moduleIds.length; i += 150) {
      const { data } = await db.from("p2p_modules").select("id,title,curriculum_id").in("id", moduleIds.slice(i, i + 150));
      modules.push(...((data ?? []) as typeof modules));
    }
    const curIds = [...new Set(modules.map((m) => m.curriculum_id))];
    type Cur = { id: string; title: string; type: string | null; parent_category_id: string | null; tags: string[] | null };
    const curricula: Cur[] = [];
    for (let i = 0; i < curIds.length; i += 150) {
      const { data } = await db.from("p2p_curriculums").select("id,title,type,parent_category_id,tags").in("id", curIds.slice(i, i + 150));
      curricula.push(...((data ?? []) as Cur[]));
    }
    const catIds = [...new Set(curricula.map((c) => c.parent_category_id).filter(Boolean))] as string[];
    const cats = new Map<string, Cur>();
    if (catIds.length) {
      const { data } = await db.from("p2p_curriculums").select("id,title,type,parent_category_id,tags").in("id", catIds);
      for (const c of (data ?? []) as Cur[]) cats.set(c.id, c);
    }
    const modBy = new Map(modules.map((m) => [m.id, m])), curBy = new Map(curricula.map((c) => [c.id, c]));

    type Lesson = { id: string; title: string; status: RootLessonStatus; passedOn: string | null; practicalVerified: number; group: string };
    type Root = { key: string; source: "foundations_curriculum" | "plan_category" | "kingdom_stories" | "curriculum_type"; title: string; categorySlug: string | null;
      passed: number; submitted: number; returned: number; inProgress: number; practicalVerified: number; lessons: Lesson[] };
    const roots = new Map<string, Root>();
    for (const l of lessons) {
      const m = modBy.get(l.module_id), c = m ? curBy.get(m.curriculum_id) : undefined;
      if (!m || !c) continue;
      let key: string, source: Root["source"], title: string, slug: string | null = null;
      if (c.type === "core") { key = `foundations:${c.id}`; source = "foundations_curriculum"; title = c.title; }
      else if (c.type === "plan") {
        const cat = c.parent_category_id ? cats.get(c.parent_category_id) : undefined;
        slug = cat?.tags?.[0] ?? null; key = `plan_category:${slug ?? "uncategorised"}`; source = "plan_category"; title = cat?.title ?? "Other Learning Plans";
      } else if (c.type === "kingdom_story") { key = "kingdom_stories"; source = "kingdom_stories"; title = "Kingdom Stories"; }
      else { key = `type:${c.type ?? "other"}`; source = "curriculum_type"; title = "Other learning"; }
      let r = roots.get(key);
      if (!r) { r = { key, source, title, categorySlug: slug, passed: 0, submitted: 0, returned: 0, inProgress: 0, practicalVerified: 0, lessons: [] }; roots.set(key, r); }
      const st = status.get(l.id)!;
      r.lessons.push({ id: l.id, title: l.title, status: st.status, passedOn: st.passedOn, practicalVerified: st.practical, group: c.type === "core" ? m.title : c.title });
      if (st.status === "passed") r.passed++; else if (st.status === "submitted") r.submitted++; else if (st.status === "returned") r.returned++; else r.inProgress++;
      r.practicalVerified += st.practical;
    }
    const order = { foundations_curriculum: 0, plan_category: 1, kingdom_stories: 2, curriculum_type: 3 } as const;
    const list = [...roots.values()].sort((a, b) => order[a.source] - order[b.source] || b.passed - a.passed || a.title.localeCompare(b.title));
    for (const r of list) r.lessons.sort((a, b) => (a.status === "passed" ? 0 : 1) - (b.status === "passed" ? 0 : 1) || (b.passedOn ?? "").localeCompare(a.passedOn ?? "") || a.title.localeCompare(b.title));
    return res.json({
      roots: list,
      totals: { passed: list.reduce((n, r) => n + r.passed, 0), submitted: list.reduce((n, r) => n + r.submitted, 0), returned: list.reduce((n, r) => n + r.returned, 0), inProgress: list.reduce((n, r) => n + r.inProgress, 0) },
      themesStatus: "pending_review",
      note: "Each passed lesson is one learning unit, counted once, however often it is repeated or wherever it was studied. Roots follow the curriculum's own groupings.",
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load your learning roots." });
  }
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
