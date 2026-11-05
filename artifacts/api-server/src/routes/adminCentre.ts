import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin, requirePermission } from "../middleware/adminAuth";
import { audit } from "../lib/adminIdentity";
import { DIMENSIONS, checklistFor, stageInfo, verifiedSummary } from "../lib/growthStages";

// Admin Centre (Phase 6). Every figure comes from real records — totals only,
// never a reflection, journal, message, prayer or evaluation's content.
//   GET  /admin-centre/overview                       (dashboard.view)
//   GET  /admin-centre/growth                         (growth.view)         — the milestone matrix and its state
//   PUT  /admin-centre/growth                         (growth.approve_matrix) — approve the matrix / switch promotions, with a reason
//   PUT  /admin-centre/growth/threshold               (growth.approve_matrix) — change one threshold (draft only), with a reason
//   GET  /admin-centre/growth/person?username=        (genealogy.view_named) — why someone qualifies or not: checklist, provenance, Guide history, contribution network
//   GET  /admin-centre/growth/evidence/review         (growth.review_evidence) — evidence waiting for review
//   POST /admin-centre/growth/evidence/:id/review     (growth.review_evidence) — approve / reject / void / restore, with a reason
//   POST /admin-centre/growth/person/:userId/recalculate (growth.review_evidence)
//   POST /admin-centre/growth/reconcile-legacy        (growth.correct)      — re-check legacy stages from trusted history (never raises)
//   GET  /admin-centre/growth/learning-units          (growth.view)         — Core Curriculum audit; units with no assessment
//   PUT  /admin-centre/growth/questions/:id/practical (content.manage)      — mark an assessment question as a practical action
//   POST /admin-centre/growth/exception               (growth.correct)      — an authorised exception (off by default; two administrators)
//   GET  /admin-centre/relationships?username=        (genealogy.view_named) — one person's relationships
//   POST /admin-centre/relationships/:linkId/end      (genealogy.correct)   — a correction: ended with a reason, history kept
// Sensitive actions go to the append-only admin audit (who, role, what, why).

const router = Router();
router.use(requireAdmin);
const ctx = (req: Request) => ({ adminUserId: (req as any).adminUserId as string, adminRole: (req as any).adminRole as string, sessionId: ((req as any).adminSessionId as string | undefined) ?? null });
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const count = async (table: string, build: (q: any) => any = (q) => q): Promise<number> => {
  const { count: n } = await build(db.from(table).select("*", { count: "exact", head: true }));
  return n ?? 0;
};

router.get("/overview", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  try {
    const peers = (q: any) => q.eq("is_official_account", false);
    const [total, active7, active30, new7, new30, families, familyMembers, churches, churchMembers] = await Promise.all([
      count("p2p_profiles", peers), count("p2p_profiles", (q) => peers(q).gte("last_active_at", ago(7))), count("p2p_profiles", (q) => peers(q).gte("last_active_at", ago(30))),
      count("p2p_profiles", (q) => peers(q).gte("created_at", ago(7))), count("p2p_profiles", (q) => peers(q).gte("created_at", ago(30))),
      count("p2p_families"), count("p2p_family_members", (q) => q.eq("status", "active")), count("p2p_churches"), count("p2p_church_members", (q) => q.eq("is_active", true)),
    ]);
    const { data: links } = await db.from("p2p_discipleship_links").select("mentor_id,disciple_id,started_at").in("status", ["active", "paused"]).limit(100000);
    const rows = (links ?? []) as { mentor_id: string; disciple_id: string; started_at: string | null }[];
    const kids = new Map<string, string[]>(); const disciples = new Set<string>(); const mentors = new Set<string>();
    for (const r of rows) { kids.set(r.mentor_id, [...(kids.get(r.mentor_id) ?? []), r.disciple_id]); disciples.add(r.disciple_id); mentors.add(r.mentor_id); }
    let generations = 0;
    for (const root of [...mentors].filter((m) => !disciples.has(m))) {
      let frontier = [root]; const seen = new Set([root]); let d = 1;
      while (frontier.length && d < 200) { const next = frontier.flatMap((f) => kids.get(f) ?? []).filter((x) => !seen.has(x)); next.forEach((x) => seen.add(x)); if (next.length) d++; frontier = next; }
      generations = Math.max(generations, d);
    }
    const { data: st } = await db.from("p2p_growth_status").select("stage,verification");
    const stages = [1, 2, 3, 4, 5].map((n) => ({ stage: n, name: stageInfo(n).name, people: ((st ?? []) as { stage: number }[]).filter((s) => s.stage === n).length }));
    const legacy = ((st ?? []) as { verification: string }[]).filter((s) => s.verification === "legacy_unverified").length;
    const { data: gs } = await db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled").maybeSingle();
    const [lessons30, evalQueued, evalActive, evalLegacy, evalDone30, storiesPub, storiesReview, storiesDraft, curPub, curDraft, growthQueue, growthFailing, pushWaiting] = await Promise.all([
      count("p2p_growth_events", (q) => q.eq("event_type", "lesson_completed").gte("created_at", ago(30))),
      count("p2p_lesson_evaluations", (q) => q.eq("engine_state", "queued")),
      count("p2p_lesson_evaluations", (q) => q.in("engine_state", ["invited", "in_progress"])),
      count("p2p_lesson_evaluations", (q) => q.is("engine_state", null).eq("status", "pending")),
      count("p2p_lesson_evaluations", (q) => q.in("status", ["approved", "needs_revision"]).gte("resolved_at", ago(30))),
      count("p2p_kingdom_stories", (q) => q.eq("status", "published")), count("p2p_kingdom_stories", (q) => q.eq("status", "review")), count("p2p_kingdom_stories", (q) => q.eq("status", "draft")),
      count("p2p_curriculums", (q) => q.eq("status", "published")), count("p2p_curriculums", (q) => q.eq("status", "draft")),
      count("p2p_growth_queue"), count("p2p_growth_queue", (q) => q.gt("attempts", 0)),
      count("p2p_notifications", (q) => q.is("pushed_at", null).lt("created_at", ago(1 / 96)).gte("created_at", ago(1))),
    ]);
    const { data: learnersRows } = await db.from("p2p_growth_events").select("user_id").eq("event_type", "lesson_completed").gte("created_at", ago(30)).limit(50000);
    const { data: sweep } = await db.from("p2p_evaluation_events").select("created_at").eq("event_type", "sweep").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const perms = ((req as any).adminPermissions as string[] | undefined) ?? [];
    let recent: unknown[] = [];
    if (perms.includes("audit.view")) {
      const { data: a } = await db.from("p2p_admin_audit").select("at,admin_role,action,target_type").order("at", { ascending: false }).limit(10);
      recent = a ?? [];
    }
    return res.json({
      community: { peers: total, active7, active30, newRegistrations7: new7, newRegistrations30: new30, families, familyMembers, churches, churchMembers },
      discipleship: { activeRelationships: rows.length, beingGuided: disciples.size, guiding: mentors.size, generations: rows.length ? generations : 0,
        relationshipsBegun30: rows.filter((r) => r.started_at && r.started_at >= ago(30)).length, stages, legacyStages: legacy,
        milestones: (gs as { thresholds_status?: string } | null)?.thresholds_status ?? "draft", promotionsEnabled: !!(gs as { promotions_enabled?: boolean } | null)?.promotions_enabled },
      learning: { lessonsCompleted30: lessons30, activeLearners30: new Set(((learnersRows ?? []) as { user_id: string }[]).map((r) => r.user_id)).size,
        evaluationsWaiting: evalQueued + evalLegacy, evaluationsInProgress: evalActive, evaluationsCompleted30: evalDone30 },
      content: { storiesPublished: storiesPub, storiesInReview: storiesReview, storiesDraft, curriculaPublished: curPub, curriculaDraft: curDraft },
      health: { api: "ok", growthQueue, growthQueueFailing: growthFailing, evaluationSweepLastRun: (sweep as { created_at?: string } | null)?.created_at ?? null, notificationsAwaitingPush: pushWaiting },
      recentAdminActivity: recent,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load the overview." });
  }
});

router.get("/growth", requirePermission("growth.view"), async (_req: Request, res: Response) => {
  const { data: settings } = await db.from("p2p_growth_settings")
    .select("calc_version,thresholds_status,promotions_enabled,approved_at,updated_at,legacy_formula_frozen,enforce_guide_stage,exceptions_enabled,development_min_units,feedback_min_chars,min_session_minutes,collective_min_cell,max_pause_days_per_year")
    .maybeSingle();
  const version = (settings as { calc_version?: number } | null)?.calc_version ?? 2;
  const [{ data: reqs }, { data: types }, { data: changes }] = await Promise.all([
    db.from("p2p_growth_matrix").select("stage,dimension,fact_key,min_value,param,label,explanation,display_order").eq("calc_version", version).order("stage").order("display_order"),
    db.from("p2p_growth_evidence_types").select("evidence_type,dimension,credit,counts_for_activity,requires_review,enabled,description").order("dimension"),
    db.from("p2p_growth_matrix_changes").select("stage,fact_key,old_value,new_value,reason,changed_at").order("changed_at", { ascending: false }).limit(20),
  ]);
  return res.json({
    settings, dimensions: DIMENSIONS,
    // `data_source` kept for older Admin Centre builds; the explanation is what counts.
    requirements: ((reqs ?? []) as { stage: number; explanation: string }[]).map((r) => ({ ...r, stageName: stageInfo(r.stage).name, data_source: r.explanation })),
    evidenceTypes: types ?? [], recentThresholdChanges: changes ?? [],
  });
});

// A threshold, changed centrally (only while the matrix is a draft), with a reason.
router.put("/growth/threshold", requirePermission("growth.approve_matrix"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  const stage = Number(req.body?.stage), value = Number(req.body?.value), fact = String(req.body?.factKey ?? "");
  if (!reason) return res.status(400).json({ error: "Say why this change is being made." });
  if (!Number.isInteger(stage) || !Number.isFinite(value) || !fact) return res.status(400).json({ error: "Choose a requirement and a value." });
  const { data, error } = await db.rpc("p2p_growth_set_threshold", { p_actor: adminUserId, p_stage: stage, p_fact: fact, p_value: value, p_reason: reason });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_GROWTH:\s*/, "") });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.threshold_changed", targetType: "growth_matrix", reason, detail: data as Record<string, unknown> });
  return res.json({ changed: data });
});

// Why one person does or does not qualify: their checklist, evidence provenance
// (kinds, counts and dates — never content), pauses, Guide history and the
// contribution network (development of the people they helped, pseudonymous).
router.get("/growth/person", requirePermission("genealogy.view_named"), async (req: Request, res: Response) => {
  const username = String(req.query.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).json({ error: "A username is required." });
  const { data: person } = await db.from("p2p_profiles").select("id,full_name,username").ilike("username", username).maybeSingle();
  if (!person) return res.status(404).json({ error: "No one with that username." });
  const p = person as { id: string; full_name: string | null; username: string };
  const [{ data: status }, { data: evidence }, { data: pauses }, { data: links }, { data: development }, { data: history }] = await Promise.all([
    db.from("p2p_growth_status").select("stage,stage_since,verification,legacy_note,eligible_stage,checklist,evaluated_at,calc_version").eq("user_id", p.id).maybeSingle(),
    db.from("p2p_growth_evidence").select("id,evidence_type,dimension,credit,source_resource,source_table,local_date,verification,verification_method,voided_at,void_reason").eq("user_id", p.id).order("occurred_at", { ascending: false }).limit(500),
    db.from("p2p_growth_pauses").select("starts_on,planned_end_on,ended_on,reason,created_at,ended_at").eq("user_id", p.id).order("starts_on", { ascending: false }),
    db.from("p2p_discipleship_links").select("id,mentor_id,disciple_id,status,is_primary,started_at,ended_at,end_reason").or(`mentor_id.eq.${p.id},disciple_id.eq.${p.id}`).order("created_at", { ascending: false }).limit(100),
    db.from("p2p_growth_learner_development").select("learner_key,learner_id,first_support_at,last_support_at,support_months,units_after,developed,onward_months").eq("contributor_id", p.id),
    db.from("p2p_growth_history").select("from_stage,to_stage,achieved_at,kind,calc_version,source,reason").eq("user_id", p.id).order("achieved_at"),
  ]);
  // Core Foundations (every lesson's status) and the development history (designated Guides with
  // both people's stages at each checkpoint, contributors, onward generations) — counts and dates only.
  const [{ data: coreRows }, { data: devHistory }] = await Promise.all([
    db.rpc("p2p_core_curriculum_progress", { p_user: p.id }),
    db.rpc("p2p_development_history", { p_person: p.id }),
  ]);
  const core = (coreRows ?? []) as { status: string }[];
  const coreCounts: Record<string, number> = {};
  for (const r of core) coreCounts[r.status] = (coreCounts[r.status] ?? 0) + 1;
  const ev = (evidence ?? []) as { evidence_type: string; verification: string; voided_at: string | null }[];
  const provenance: Record<string, { counted: number; pending: number; rejected: number; withdrawn: number }> = {};
  for (const e of ev) {
    const b = (provenance[e.evidence_type] ??= { counted: 0, pending: 0, rejected: 0, withdrawn: 0 });
    if (e.voided_at) b.withdrawn++; else if (e.verification === "pending_review") b.pending++; else if (e.verification === "rejected") b.rejected++; else b.counted++;
  }
  const st = status as { stage: number; checklist?: { stages?: never[]; facts?: Record<string, unknown> } } | null;
  const { adminUserId, adminRole, sessionId } = ctx(req);
  await audit({ adminUserId, adminRole, sessionId, action: "growth.person_explained", targetType: "profile", targetId: p.id });
  return res.json({
    person: { id: p.id, name: p.full_name || `@${p.username}` },
    status: st ? { ...st, stageName: stageInfo(st.stage).name, next: st.stage < 5 ? checklistFor(st.stage + 1, st.checklist?.stages) : null, verified: verifiedSummary(st.checklist?.facts) } : null,
    provenance, evidence: ev.slice(0, 200), pauses: pauses ?? [], guideHistory: links ?? [], history: history ?? [],
    coreFoundations: { passed: coreCounts.passed ?? 0, total: core.length, counts: coreCounts },
    developmentHistory: devHistory ?? null,
    // The people helped appear only as a pseudonymous key plus whether they are still on P2P Global.
    contributionNetwork: ((development ?? []) as { learner_id: string | null }[]).map(({ learner_id, ...d }) => ({ ...d, learnerStillActive: !!learner_id })),
  });
});

// Evidence waiting for review (only evidence types an administrator has set to require review).
router.get("/growth/evidence/review", requirePermission("growth.review_evidence"), async (_req: Request, res: Response) => {
  const { data } = await db.from("p2p_growth_evidence").select("id,user_id,evidence_type,dimension,source_resource,source_table,local_date,verification_method,created_at")
    .eq("verification", "pending_review").is("voided_at", null).order("created_at").limit(200);
  const rows = (data ?? []) as { user_id: string }[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: ps } = ids.length ? await db.from("p2p_profiles").select("id,username").in("id", ids) : { data: [] };
  const name = new Map(((ps ?? []) as { id: string; username: string | null }[]).map((x) => [x.id, x.username ? `@${x.username}` : "A participant"]));
  return res.json({ evidence: rows.map((r) => ({ ...r, participant: name.get(r.user_id) })) });
});

// Approve, reject, void (withdraw) or restore one record — always with a reason; the history is permanent.
router.post("/growth/evidence/:id/review", requirePermission("growth.review_evidence"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const action = String(req.body?.action ?? "");
  const reason = String(req.body?.reason ?? "").trim();
  if (!["approve", "reject", "void", "restore"].includes(action)) return res.status(400).json({ error: "Choose approve, reject, void or restore." });
  if (reason.length < 5) return res.status(400).json({ error: "Explain the decision (it is kept with the evidence)." });
  const { data, error } = await db.rpc("p2p_growth_review_evidence", { p_evidence: String(req.params.id), p_actor: adminUserId, p_action: action, p_reason: reason });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_GROWTH:\s*/, "") });
  await audit({ adminUserId, adminRole, sessionId, action: `growth.evidence_${action}`, targetType: "growth_evidence", targetId: String(req.params.id), reason });
  return res.json({ reviewed: data });
});

// Re-check one person now (the queue also does this on every relevant event and nightly).
router.post("/growth/person/:userId/recalculate", requirePermission("growth.review_evidence"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const { data, error } = await db.rpc("p2p_growth_recalculate", { p_user: String(req.params.userId), p_source: "admin_recalculate" });
  if (error) return res.status(409).json({ error: "Couldn't recalculate." });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.recalculated", targetType: "profile", targetId: String(req.params.userId) });
  return res.json({ result: data });
});

// Legacy (recognised, not yet verified) stages: record trusted history and re-check everyone — never raising anyone.
router.post("/growth/reconcile-legacy", requirePermission("growth.correct"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const { data, error } = await db.rpc("p2p_growth_reconcile_legacy");
  if (error) return res.status(409).json({ error: "Couldn't reconcile." });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.legacy_reconciled", targetType: "growth_status", detail: data as Record<string, unknown> });
  return res.json({ result: data });
});

// Learning units and their assessments: the Core Curriculum audit, and any unit that
// cannot earn credit because it has no assessment yet (defined in Curriculum admin).
router.get("/growth/learning-units", requirePermission("growth.view"), async (_req: Request, res: Response) => {
  const { data } = await db.from("p2p_growth_learning_units")
    .select("lesson_id,title,lesson_status,module_title,curriculum_title,curriculum_type,resource,is_core,assessments,assessment_questions,practical_questions").limit(20000);
  const units = (data ?? []) as { lesson_status: string; resource: string; is_core: boolean; assessment_questions: number; practical_questions: number }[];
  const published = units.filter((u) => u.lesson_status === "published");
  const byResource: Record<string, { units: number; withoutAssessment: number; practicalQuestions: number }> = {};
  for (const u of published) {
    const b = (byResource[u.resource] ??= { units: 0, withoutAssessment: 0, practicalQuestions: 0 });
    b.units++; if (!u.assessment_questions) b.withoutAssessment++; b.practicalQuestions += u.practical_questions;
  }
  const core = published.filter((u) => u.is_core);
  return res.json({
    // Kingdom School Foundations: every published lesson of every published Kingdom School curriculum.
    core: { publishedLessons: core.length, expected: core.length, withAssessment: core.filter((u) => u.assessment_questions > 0).length,
            withoutAssessment: core.filter((u) => !u.assessment_questions) },
    byResource, withoutAssessment: published.filter((u) => !u.assessment_questions).slice(0, 500),
  });
});

// Mark (or unmark) an assessment question as a practical action. Existing workflow, no new forms.
router.put("/growth/questions/:questionId/practical", requirePermission("content.manage"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  if (typeof req.body?.isPractical !== "boolean" || reason.length < 5) return res.status(400).json({ error: "Say whether it is practical, and why." });
  const { error } = await db.from("p2p_assignment_questions").update({ is_practical: req.body.isPractical }).eq("id", String(req.params.questionId));
  if (error) return res.status(409).json({ error: "Couldn't update that question." });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.practical_question_set", targetType: "assignment_question", targetId: String(req.params.questionId), reason, detail: { isPractical: req.body.isPractical } });
  // Everyone's record is refreshed by the nightly reconciliation.
  return res.json({ isPractical: req.body.isPractical });
});

// An authorised, audited exception: off unless the owner enables it; needs a second administrator.
router.post("/growth/exception", requirePermission("growth.correct"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  const { userId, toStage, authorisedBy } = req.body ?? {};
  const { data, error } = await db.rpc("p2p_growth_exception", { p_user: String(userId ?? ""), p_to_stage: Number(toStage), p_actor: adminUserId, p_authoriser: String(authorisedBy ?? ""), p_reason: reason });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_GROWTH:\s*/, "") });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.exception_granted", targetType: "profile", targetId: String(userId), reason, detail: { toStage, authorisedBy } });
  return res.json({ result: data });
});

router.put("/growth", requirePermission("growth.approve_matrix"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Say why this change is being made." });
  const { data: before } = await db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled").maybeSingle();
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.approveMatrix === true) { next.thresholds_status = "approved"; next.approved_at = new Date().toISOString(); next.approved_by = adminUserId; }
  if (typeof req.body?.promotionsEnabled === "boolean") next.promotions_enabled = req.body.promotionsEnabled;
  const { error } = await db.from("p2p_growth_settings").update(next).eq("id", true);
  if (error) return res.status(409).json({ error: /promote_approved/.test(error.message) ? "Promotions can only start once the milestone matrix is approved." : "Couldn't update growth settings." });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.settings_changed", targetType: "growth_settings", reason, detail: { before, after: next } });
  // When promotions start, everyone is re-checked by the engine's own worker.
  if (next.promotions_enabled === true) await db.rpc("p2p_growth_reconcile_all");
  return res.json({ updated: true });
});

router.get("/relationships", requirePermission("genealogy.view_named"), async (req: Request, res: Response) => {
  const username = String(req.query.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).json({ error: "A username is required." });
  const { data: person } = await db.from("p2p_profiles").select("id,full_name,username").ilike("username", username).maybeSingle();
  if (!person) return res.status(404).json({ error: "No one with that username." });
  const p = person as { id: string; full_name: string | null; username: string };
  const { data: links } = await db.from("p2p_discipleship_links").select("id,mentor_id,disciple_id,status,is_primary,started_at,ended_at,end_reason,created_at")
    .or(`mentor_id.eq.${p.id},disciple_id.eq.${p.id}`).order("created_at", { ascending: false }).limit(200);
  const rows = (links ?? []) as { id: string; mentor_id: string; disciple_id: string; status: string; is_primary: boolean; started_at: string | null; ended_at: string | null; end_reason: string | null; created_at: string }[];
  const ids = [...new Set(rows.flatMap((r) => [r.mentor_id, r.disciple_id]))];
  const { data: ps } = ids.length ? await db.from("p2p_profiles").select("id,full_name,username").in("id", ids) : { data: [] };
  const name = new Map(((ps ?? []) as { id: string; full_name: string | null; username: string | null }[]).map((x) => [x.id, x.full_name || (x.username ? `@${x.username}` : "Unknown")]));
  const { adminUserId, adminRole, sessionId } = ctx(req);
  await audit({ adminUserId, adminRole, sessionId, action: "genealogy.relationships_viewed", targetType: "profile", targetId: p.id });
  return res.json({ person: { id: p.id, name: p.full_name || `@${p.username}` }, relationships: rows.map((r) => ({ ...r, mentorName: name.get(r.mentor_id), discipleName: name.get(r.disciple_id) })) });
});

router.post("/relationships/:linkId/end", requirePermission("genealogy.correct"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  if (reason.length < 5) return res.status(400).json({ error: "Explain the correction (it is kept with the relationship's history)." });
  const { data, error } = await db.rpc("p2p_link_set_status", { p_link: String(req.params.linkId), p_actor: adminUserId, p_status: "ended", p_reason: `Administrator correction: ${reason}` });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_LINK[A-Z_]*:\s*/, "") });
  await audit({ adminUserId, adminRole, sessionId, action: "genealogy.relationship_ended", targetType: "discipleship_link", targetId: String(req.params.linkId), reason, detail: { status: data } });
  return res.json({ status: data });
});

export default router;
