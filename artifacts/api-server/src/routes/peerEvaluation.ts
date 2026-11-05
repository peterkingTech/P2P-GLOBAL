import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { isUuid, profilesById } from "../lib/sharedStudy";
import {
  COMMITMENTS, DEADLINE_HOURS, DECLINE_REASONS, ORIENTATION_VERSION, UNABLE_CATEGORIES,
  cleanFeedback, cleanQuality, evaluateeStage, learnerHistory, missingCommitments, needsReview, recognitions, serviceRecord,
  type AssignmentRow, type QualityRow,
} from "../lib/peerEvaluation";

// Peer Evaluation Engine (migrations 229 + 240), mounted at /evaluation. ONE
// engine for every independently assessed resource — Kingdom School lessons,
// Kingdom Stories chapters, Bible Study Plan sessions (wherever studied:
// alone, Learning Centre, Study Together, Family, Church) and, when switched
// on, Family/Church group assignments. Who may evaluate is discovered
// automatically: only people who passed THAT exact resource through an
// independent evaluation (no registration, no orientation gate, no volunteer
// list). Every decision about WHO evaluates lives in the database engine (p2p_eval_*):
// this API only identifies the caller, checks what they may see, validates
// what they send and calls the engine. The phone never chooses an evaluator,
// never sets a deadline and never sees who was merely invited.
//   GET  /me/evaluator                    my evaluator profile: orientation, availability, service record, recognitions
//   PUT  /me/evaluator                    { available, unavailableUntil, capacity, categories }
//   POST /me/orientation                  { commitments: [...] } — all required
//   GET  /mine                            my submissions' evaluations (evaluatee)
//   GET  /reviewing                       invitations, in progress, history (evaluator)
//   GET  /:id                             one evaluation — what I may see as evaluatee or accepted evaluator
//   GET  /invitations/:assignmentId       what an invited evaluator needs to decide (no evaluatee identity or answers)
//   POST /invitations/:assignmentId/accept | /decline { reason }
//   POST /assignments/:assignmentId/unable { category, note }   (no transfer, no choosing a replacement)
//   PUT  /assignments/:assignmentId/draft  { draft }
//   POST /:id/submit                      { outcome, feedback }
//   POST /:id/discussion                  the evaluation's conversation in P2P messaging
//   POST /:id/quality                     the evaluatee's feedback on the evaluation
//   Admin (super_admin / admin_supervisor): GET /admin/overview, GET /admin/evaluations/:id,
//   POST /admin/evaluations/:id/reassign { reason } (the SYSTEM picks the replacement),
//   GET /admin/evaluators, PUT /admin/evaluators/:userId { standing, reason, available },
//   GET /admin/concerns, PUT /admin/concerns/:evaluationId { substantiated, note },
//   PUT /admin/settings { engineEnabled, invitationWindowMinutes, defaultCapacity, bootstrapRoles, groupAssignmentsEnabled },
//   POST /admin/sweep, GET /admin/coverage (resources waiting with nobody qualified yet),
//   GET /admin/operations (qualified evaluators, workload, expiries, reassignments, turnaround),
//   GET /admin/integrity, POST /admin/integrity/:pairKey/review { decision, note } (reciprocal approvals, audited),
//   POST /admin/resources/revision { kind, resourceId, reason } (a material assessment revision restarts qualification)

const router = Router();
const ADMIN_ROLES = new Set(["super_admin", "admin_supervisor"]);
const BOOTSTRAP_ROLES = new Set(["peer_guide", "church_leader", "super_admin", "admin_supervisor", "admin_content"]);

class EvalError extends Error { constructor(public status: number, message: string) { super(message); } }
async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}
function fail(res: Response, e: unknown) {
  if (e instanceof EvalError) return res.status(e.status).json({ error: e.message });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205" || code === "42703" || code === "PGRST204" || code === "PGRST202" || code === "42883") return res.status(503).json({ error: "Evaluations aren't available yet." });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
const must = <T>(r: { data: T | null; error: unknown }): T => { if (r.error) throw r.error; return r.data as T; };
const notFound = () => new EvalError(404, "This evaluation isn't available.");
const ENGINE_ERRORS: Record<string, [number, string]> = {
  not_found: [404, "This evaluation isn't available."],
  no_longer_available: [409, "This invitation is no longer available — P2P Global has moved on. Thank you."],
  expired: [409, "This invitation has expired. P2P Global has invited someone else."],
  not_eligible: [403, "You can't take this evaluation right now."],
  not_active: [409, "This evaluation is no longer active for you."],
  reason_required: [400, "Please choose a reason."],
  deadline_passed: [409, "The 48 hours for this evaluation have ended, so P2P Global is reassigning it."],
  outcome_required: [400, "Choose an overall outcome."],
  forbidden: [403, "You don't have permission to do that."],
};
async function rpc(fn: string, args: Record<string, unknown>) {
  const r = must(await db.rpc(fn, args)) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (r && r.ok === false) { const [s, m] = ENGINE_ERRORS[r.error ?? ""] ?? [400, "That didn't work."]; throw new EvalError(s, m); }
  return r;
}
async function isAdmin(userId: string) {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  return ADMIN_ROLES.has(String((data as { role?: string } | null)?.role ?? ""));
}
async function needAdmin(userId: string) { if (!(await isAdmin(userId))) throw new EvalError(403, "You don't have permission to do that."); }

interface EvalRow {
  id: string; submission_id: string | null; lesson_id: string | null; submitter_id: string | null; evaluator_id: string | null; status: string;
  resource_kind: "lesson" | "group_assignment"; resource_id: string | null; group_submission_id: string | null; context: string | null;
  feedback: string | null; assigned_at: string; created_at: string; resolved_at: string | null; self_approved: boolean;
  engine_state: string | null; current_assignment_id: string | null; accepted_at: string | null; deadline_at: string | null;
  outcome: string | null; feedback_detail: Record<string, unknown> | null; queued_since: string | null;
}
const EVAL_COLS = "id,submission_id,lesson_id,submitter_id,evaluator_id,status,feedback,assigned_at,created_at,resolved_at,self_approved,engine_state,current_assignment_id,accepted_at,deadline_at,outcome,feedback_detail,queued_since,resource_kind,resource_id,group_submission_id,context";
async function lessonsInfo(ids: string[]) {
  const out = new Map<string, { title: string; curriculum: string | null; curriculumId: string | null }>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return out;
  const lessons = (must(await db.from("p2p_lessons").select("id,title,module_id").in("id", uniq)) ?? []) as { id: string; title: string; module_id: string | null }[];
  const mods = (must(await db.from("p2p_modules").select("id,curriculum_id").in("id", lessons.map((l) => l.module_id).filter((x): x is string => !!x))) ?? []) as { id: string; curriculum_id: string | null }[];
  const curIds = Array.from(new Set(mods.map((m) => m.curriculum_id).filter((x): x is string => !!x)));
  const curs = curIds.length ? ((must(await db.from("p2p_curriculums").select("id,title").in("id", curIds)) ?? []) as { id: string; title: string }[]) : [];
  for (const l of lessons) {
    const cid = mods.find((m) => m.id === l.module_id)?.curriculum_id ?? null;
    out.set(l.id, { title: l.title, curriculumId: cid, curriculum: curs.find((c) => c.id === cid)?.title ?? null });
  }
  return out;
}
const serverNow = () => new Date().toISOString();

// The learner-facing lifecycle, in plain words: Submitted → Searching for a qualified evaluator →
// Assigned → Under evaluation → Approved / Returned for correction; Reassigned when an
// invitation expired, was declined or the evaluator stepped away.
const STATUS_LABELS: Record<string, string> = {
  arranging: "Searching for a qualified evaluator", invitation_pending: "Assigned — waiting for the evaluator to accept", in_progress: "Under evaluation",
  overdue_reassigning: "Reassigned — the evaluator's time ran out", reassigned: "Reassigned to another qualified evaluator",
  feedback_ready: "Approved — feedback ready", revision_required: "Returned for correction", completed: "Completed",
};
async function reassignedSet(evalIds: string[]) {
  if (!evalIds.length) return new Set<string>();
  const rows = (must(await db.from("p2p_evaluation_assignments").select("evaluation_id,status").in("evaluation_id", evalIds)
    .in("status", ["declined", "expired", "unable", "overdue", "removed", "unavailable"])) ?? []) as { evaluation_id: string }[];
  return new Set(rows.map((r) => r.evaluation_id));
}
function learnerStage(r: EvalRow, reassigned: Set<string>) {
  let st = evaluateeStage(r) as string;
  if ((st === "arranging" || st === "invitation_pending") && reassigned.has(r.id)) st = "reassigned";
  return { stage: st, statusLabel: STATUS_LABELS[st] ?? st };
}

type ResourceRef = { resource_kind?: string | null; resource_id?: string | null; lesson_id?: string | null };
/** Title and subject for any resource kind: a lesson (any curriculum) or a Family/Church group assignment. */
async function resourcesInfo(rows: ResourceRef[]) {
  const lessons = await lessonsInfo(rows.filter((r) => (r.resource_kind ?? "lesson") === "lesson").map((r) => r.lesson_id ?? ""));
  const groupIds = Array.from(new Set(rows.filter((r) => r.resource_kind === "group_assignment" && r.resource_id).map((r) => r.resource_id!)));
  const groups = groupIds.length ? ((must(await db.from("p2p_group_assignments").select("id,title,instructions,family_id,church_id").in("id", groupIds)) ?? []) as
    { id: string; title: string; instructions: string | null; family_id: string | null; church_id: string | null }[]) : [];
  return (r: ResourceRef) => {
    if (r.resource_kind === "group_assignment") {
      const g = groups.find((x) => x.id === r.resource_id);
      return { title: g?.title ?? "Assignment", curriculum: g?.family_id ? "Family assignment" : "Church assignment", instructions: g?.instructions ?? null, kind: "group_assignment" as const };
    }
    const l = lessons.get(r.lesson_id ?? "");
    return { title: l?.title ?? "Lesson", curriculum: l?.curriculum ?? null, instructions: null, kind: "lesson" as const };
  };
}

// ── Evaluator profile, orientation, availability ────────────────────────────

router.get("/me/evaluator", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const [{ data: p, error }, settings, asg, qual] = await Promise.all([
      db.from("p2p_evaluator_profiles").select("*").eq("user_id", userId).maybeSingle(),
      db.from("p2p_evaluation_settings").select("engine_enabled,invitation_window_minutes,default_capacity,orientation_version").maybeSingle(),
      db.from("p2p_evaluation_assignments").select("status,accepted_at,deadline_at,ended_at,end_reason").eq("evaluator_id", userId),
      db.from("p2p_evaluation_quality").select("helpfulness,clarity,respectfulness,encouragement,relevance,helped_understand,substantiated,concern").eq("evaluator_id", userId),
    ]);
    if (error) throw error;
    const s = must(settings) as { engine_enabled: boolean; invitation_window_minutes: number; default_capacity: number; orientation_version: number } | null;
    const record = serviceRecord((asg.data ?? []) as AssignmentRow[], (qual.data ?? []) as QualityRow[]);
    const prof = p as Record<string, unknown> | null;
    // Which exact resources this person may be invited to evaluate (passed through an independent evaluation).
    const [{ count: passedLessons }, { count: passedGroup }] = await Promise.all([
      db.from("p2p_growth_evidence").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("evidence_type", "learning.assessment_passed").eq("verification", "verified").is("voided_at", null),
      db.from("p2p_group_assignment_submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "reviewed").neq("reviewed_by", userId),
    ]);
    return res.json({
      // No orientation gate any more (240): older builds read `oriented`, so it is always true.
      oriented: true,
      guideRead: !!prof?.orientation_acknowledged_at && Number(prof?.orientation_version ?? 0) >= (s?.orientation_version ?? ORIENTATION_VERSION),
      qualifiedResources: (passedLessons ?? 0) + (passedGroup ?? 0),
      howInvited: "When you pass a lesson, story chapter or plan session through an independent evaluation, P2P Global may invite you to evaluate that same one — never anything you haven't passed.",
      available: prof ? !!prof.available : false,
      unavailableUntil: prof?.unavailable_until ?? null,
      capacity: (prof?.capacity as number | null) ?? s?.default_capacity ?? 2,
      categories: (prof?.categories as string[] | undefined) ?? [],
      standing: (prof?.standing as string | undefined) ?? "good",
      restrictionReason: prof?.standing === "restricted" ? prof.restriction_reason : null,
      commitments: COMMITMENTS, deadlineHours: DEADLINE_HOURS, invitationWindowMinutes: s?.invitation_window_minutes ?? 180,
      engineEnabled: !!s?.engine_enabled,
      record, recognitions: recognitions(record),
    });
  } catch (e) { return fail(res, e); }
});

router.post("/me/orientation", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const missing = missingCommitments((req.body ?? {}).commitments);
    if (missing.length) throw new EvalError(400, "Please read and accept each commitment.");
    const now = new Date().toISOString();
    const existing = must(await db.from("p2p_evaluator_profiles").select("user_id").eq("user_id", userId).maybeSingle());
    const row = { orientation_version: ORIENTATION_VERSION, orientation_acknowledged_at: now, commitment: { accepted: COMMITMENTS.map((c) => c.id), version: ORIENTATION_VERSION, at: now }, updated_at: now };
    if (existing) must(await db.from("p2p_evaluator_profiles").update(row).eq("user_id", userId).select("user_id"));
    else must(await db.from("p2p_evaluator_profiles").insert({ user_id: userId, ...row }).select("user_id"));
    return res.json({ oriented: true });
  } catch (e) { return fail(res, e); }
});

router.put("/me/evaluator", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { available?: unknown; unavailableUntil?: unknown; capacity?: unknown; categories?: unknown };
  try {
    // No separate sign-up: availability can be set by anyone (a profile row is created on first use).
    const existing = must(await db.from("p2p_evaluator_profiles").select("user_id").eq("user_id", userId).maybeSingle());
    if (!existing) must(await db.from("p2p_evaluator_profiles").insert({ user_id: userId }).select("user_id"));
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.available === "boolean") patch.available = b.available;
    if (b.unavailableUntil !== undefined) {
      const t = b.unavailableUntil === null ? null : Date.parse(String(b.unavailableUntil));
      if (t !== null && (!Number.isFinite(t) || t < Date.now() || t > Date.now() + 365 * 86_400_000)) throw new EvalError(400, "Choose a date within the next year.");
      patch.unavailable_until = t === null ? null : new Date(t).toISOString();
    }
    if (b.capacity !== undefined) { const n = Number(b.capacity); if (!Number.isInteger(n) || n < 1 || n > 5) throw new EvalError(400, "Choose between 1 and 5 at a time."); patch.capacity = n; }
    // `categories` is accepted from older builds but no longer qualifies anyone (exact-resource qualification only).
    if (b.categories !== undefined) { if (!Array.isArray(b.categories) || b.categories.length > 100 || !b.categories.every(isUuid)) throw new EvalError(400, "Choose subjects from the list."); patch.categories = b.categories; }
    // Standing (restriction / reinstatement) is never self-service.
    must(await db.from("p2p_evaluator_profiles").update(patch).eq("user_id", userId).select("user_id"));
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

// ── The evaluatee's evaluations ─────────────────────────────────────────────

router.get("/mine", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const rows = (must(await db.from("p2p_lesson_evaluations").select(EVAL_COLS).eq("submitter_id", userId).order("created_at", { ascending: false }).limit(200)) ?? []) as EvalRow[];
    const visible = rows.filter((r) => !r.self_approved);
    const info = await resourcesInfo(visible);
    const moved = await reassignedSet(visible.filter((r) => r.engine_state === "queued" || r.engine_state === "invited").map((r) => r.id));
    // An evaluator is named only once they ACCEPTED (engine rows) — invited people never.
    const people = await profilesById(visible.filter((r) => r.evaluator_id && (r.engine_state === null || ["in_progress", "completed"].includes(r.engine_state))).map((r) => r.evaluator_id!));
    return res.json({
      serverNow: serverNow(),
      items: visible.map((r) => ({
        id: r.id, lessonId: r.lesson_id, lessonTitle: info(r).title, curriculum: info(r).curriculum, resourceKind: r.resource_kind ?? "lesson",
        submittedAt: r.created_at, ...learnerStage(r, moved), engine: r.engine_state !== null, acceptedAt: r.accepted_at, deadlineAt: r.deadline_at,
        evaluator: r.evaluator_id && people.get(r.evaluator_id) && (r.engine_state === null || ["in_progress", "completed"].includes(r.engine_state ?? "")) ? { name: people.get(r.evaluator_id)!.name, photoUrl: people.get(r.evaluator_id)!.photoUrl ?? null } : null,
        outcome: r.outcome,
      })),
    });
  } catch (e) { return fail(res, e); }
});

// ── The evaluator's list ────────────────────────────────────────────────────

router.get("/reviewing", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const asg = (must(await db.from("p2p_evaluation_assignments").select("id,evaluation_id,status,invited_at,invite_expires_at,accepted_at,deadline_at,ended_at,end_reason").eq("evaluator_id", userId).order("invited_at", { ascending: false }).limit(200)) ?? []) as
      { id: string; evaluation_id: string; status: string; invited_at: string; invite_expires_at: string; accepted_at: string | null; deadline_at: string | null; ended_at: string | null; end_reason: string | null }[];
    const evalIds = Array.from(new Set(asg.map((a) => a.evaluation_id)));
    const evals = evalIds.length ? ((must(await db.from("p2p_lesson_evaluations").select("id,lesson_id,submitter_id,outcome,resource_kind,resource_id").in("id", evalIds)) ?? []) as { id: string; lesson_id: string | null; submitter_id: string | null; outcome: string | null; resource_kind: string; resource_id: string | null }[]) : [];
    const info = await resourcesInfo(evals);
    // The evaluatee's name only for evaluations this person accepted.
    const people = await profilesById(asg.filter((a) => a.status === "accepted" || a.status === "completed").map((a) => evals.find((e) => e.id === a.evaluation_id)?.submitter_id ?? "").filter(Boolean));
    const card = (a: (typeof asg)[number]) => {
      const e = evals.find((x) => x.id === a.evaluation_id);
      const named = (a.status === "accepted" || a.status === "completed") && e?.submitter_id ? people.get(e.submitter_id)?.name ?? null : null;
      return { assignmentId: a.id, evaluationId: a.evaluation_id, status: a.status, lessonTitle: e ? info(e).title : "Lesson", curriculum: e ? info(e).curriculum : null,
        invitedAt: a.invited_at, inviteExpiresAt: a.invite_expires_at, acceptedAt: a.accepted_at, deadlineAt: a.deadline_at, endedAt: a.ended_at, evaluateeName: named, outcome: a.status === "completed" ? e?.outcome ?? null : null };
    };
    return res.json({
      serverNow: serverNow(),
      invitations: asg.filter((a) => a.status === "invited" && Date.parse(a.invite_expires_at) > Date.now()).map(card),
      inProgress: asg.filter((a) => a.status === "accepted").map(card),
      history: asg.filter((a) => !["invited", "accepted"].includes(a.status)).map(card),
    });
  } catch (e) { return fail(res, e); }
});

// ── An invitation: enough to decide, nothing private ────────────────────────

router.get("/invitations/:assignmentId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.assignmentId)) throw notFound();
    const a = must(await db.from("p2p_evaluation_assignments").select("id,evaluation_id,evaluator_id,status,invite_expires_at,match_detail").eq("id", req.params.assignmentId).maybeSingle()) as
      { id: string; evaluation_id: string; evaluator_id: string; status: string; invite_expires_at: string; match_detail: { basis?: string } | null } | null;
    if (!a || a.evaluator_id !== userId) throw notFound();
    const e = must(await db.from("p2p_lesson_evaluations").select("id,lesson_id,submission_id,resource_kind,resource_id").eq("id", a.evaluation_id).maybeSingle()) as { id: string; lesson_id: string | null; submission_id: string | null; resource_kind: string; resource_id: string | null } | null;
    if (!e) throw notFound();
    const competence = a.match_detail?.basis === "bootstrap"
      ? "Nobody has passed this one through an independent evaluation yet, so P2P Global asked an authorised reviewer."
      : e.resource_kind === "group_assignment"
        ? "You completed this same assignment and it was reviewed by someone else — and you belong to the same group."
        : "You passed this exact lesson through an independent evaluation. You're only ever invited for what you have passed.";
    const commitments = COMMITMENTS.map((c) => c.text);
    if (e.resource_kind === "group_assignment") {
      const g = (await resourcesInfo([e]))(e);
      return res.json({
        serverNow: serverNow(), assignmentId: a.id, status: a.status, inviteExpiresAt: a.invite_expires_at,
        lessonTitle: g.title, curriculum: g.curriculum, kind: "Group assignment", checkTitle: g.title, questionCount: 0, answerFormat: "text",
        expectedWork: "Read the submission and give a short, encouraging response on how the assignment was put into practice.",
        competence, commitments,
        deadlinePolicy: `Once you accept, you have ${DEADLINE_HOURS} hours to finish. There are no extensions. If something stops you, report it and P2P Global will reassign it.`,
        safeguarding: "The evaluatee's name and work are shown only after you accept. Keep them private within your group and use them only for this evaluation.",
      });
    }
    const sub = must(await db.from("p2p_submissions").select("assignment_id,submission_type").eq("id", e.submission_id ?? "").maybeSingle()) as { assignment_id: string | null; submission_type: string } | null;
    const asgInfo = sub?.assignment_id ? (must(await db.from("p2p_assignments").select("title").eq("id", sub.assignment_id).maybeSingle()) as { title: string | null } | null) : null;
    const qCount = sub?.assignment_id ? ((must(await db.from("p2p_assignment_questions").select("id").eq("assignment_id", sub.assignment_id)) ?? []) as unknown[]).length : 0;
    const lessons = await lessonsInfo([e.lesson_id ?? ""]);
    return res.json({
      serverNow: serverNow(), assignmentId: a.id, status: a.status, inviteExpiresAt: a.invite_expires_at,
      lessonTitle: lessons.get(e.lesson_id ?? "")?.title ?? "Lesson", curriculum: lessons.get(e.lesson_id ?? "")?.curriculum ?? null,
      kind: "Lesson check", checkTitle: asgInfo?.title ?? null, questionCount: qCount, answerFormat: sub?.submission_type ?? "text",
      expectedWork: qCount ? `Read ${qCount} ${qCount === 1 ? "answer" : "answers"}, give feedback on each, and a short overall response.` : "Read the submission and give a short overall response.",
      competence, commitments,
      deadlinePolicy: `Once you accept, you have ${DEADLINE_HOURS} hours to finish. There are no extensions. If something stops you, report it and P2P Global will reassign it.`,
      safeguarding: "The evaluatee's name and answers are shown only after you accept. Keep them private and use them only for this evaluation.",
    });
  } catch (e) { return fail(res, e); }
});

router.post("/invitations/:assignmentId/accept", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.assignmentId)) throw notFound();
    const r = await rpc("p2p_eval_accept", { p_assignment: req.params.assignmentId, p_user: userId });
    return res.json({ ...r, serverNow: serverNow() });
  } catch (e) { return fail(res, e); }
});
router.post("/invitations/:assignmentId/decline", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.assignmentId)) throw notFound();
    const reason = (DECLINE_REASONS as readonly unknown[]).includes(req.body?.reason) ? String(req.body.reason) : "other";
    await rpc("p2p_eval_decline", { p_assignment: req.params.assignmentId, p_user: userId, p_reason: reason });
    return res.json({ declined: true });
  } catch (e) { return fail(res, e); }
});
router.post("/assignments/:assignmentId/unable", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.assignmentId)) throw notFound();
    const category = (UNABLE_CATEGORIES as readonly unknown[]).includes(req.body?.category) ? String(req.body.category) : null;
    if (!category) throw new EvalError(400, "Please choose a reason.");
    // Deliberately no "replacement" field: the system chooses who is next.
    await rpc("p2p_eval_report_unable", { p_assignment: req.params.assignmentId, p_user: userId, p_category: category, p_note: typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null });
    return res.json({ reported: true });
  } catch (e) { return fail(res, e); }
});
router.put("/assignments/:assignmentId/draft", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.assignmentId)) throw notFound();
    const draft = req.body?.draft;
    if (!draft || typeof draft !== "object" || JSON.stringify(draft).length > 60_000) throw new EvalError(400, "That draft is too large.");
    return res.json(await rpc("p2p_eval_save_draft", { p_assignment: req.params.assignmentId, p_user: userId, p_draft: draft }));
  } catch (e) { return fail(res, e); }
});

// ── One evaluation: the evaluatee's view, or the accepted evaluator's workspace ─

async function loadEval(id: string): Promise<EvalRow> {
  if (!isUuid(id)) throw notFound();
  const e = must(await db.from("p2p_lesson_evaluations").select(EVAL_COLS).eq("id", id).maybeSingle()) as EvalRow | null;
  if (!e) throw notFound();
  return e;
}

router.get("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const e = await loadEval(req.params.id);
    const res0 = (await resourcesInfo([e]))(e);
    const lesson = { title: res0.title, curriculum: res0.curriculum };
    const isGroup = e.resource_kind === "group_assignment";
    const sub = isGroup ? null : (must(await db.from("p2p_submissions").select("id,assignment_id,created_at").eq("id", e.submission_id ?? "").maybeSingle()) as { id: string; assignment_id: string | null; created_at: string } | null);
    const groupSub = isGroup ? (must(await db.from("p2p_group_assignment_submissions").select("id,content,submitted_at").eq("id", e.group_submission_id ?? "").maybeSingle()) as { id: string; content: string; submitted_at: string } | null) : null;
    const asgInfo = sub?.assignment_id ? (must(await db.from("p2p_assignments").select("id,title,instructions").eq("id", sub.assignment_id).maybeSingle()) as { id: string; title: string | null; instructions: string | null } | null) : null;
    const questions = sub?.assignment_id ? ((must(await db.from("p2p_assignment_questions").select("id,question,display_order").eq("assignment_id", sub.assignment_id).order("display_order")) ?? []) as { id: string; question: string; display_order: number }[]) : [];
    const { data: conv } = await db.from("p2p_conversations").select("id").eq("evaluation_id", e.id).maybeSingle();
    const base = { serverNow: serverNow(), id: e.id, lessonId: e.lesson_id, lessonTitle: lesson.title, curriculum: lesson.curriculum, checkTitle: asgInfo?.title ?? (isGroup ? res0.title : null),
      resourceKind: e.resource_kind ?? "lesson", submittedAt: sub?.created_at ?? groupSub?.submitted_at ?? e.created_at, acceptedAt: e.accepted_at, deadlineAt: e.deadline_at, engine: e.engine_state !== null, discussionId: (conv as { id: string } | null)?.id ?? null };

    // The evaluatee.
    if (e.submitter_id === userId) {
      const accepted = e.evaluator_id && (e.engine_state === null || ["in_progress", "completed"].includes(e.engine_state));
      const people = accepted ? await profilesById([e.evaluator_id!]) : new Map();
      const events = e.engine_state !== null ? ((must(await db.from("p2p_evaluation_events").select("event_type,created_at").eq("evaluation_id", e.id).order("created_at")) ?? []) as { event_type: string; created_at: string }[]) : [];
      const { data: q } = await db.from("p2p_evaluation_quality").select("evaluation_id").eq("evaluation_id", e.id).maybeSingle();
      const done = e.engine_state === "completed" || (e.engine_state === null && e.status !== "pending");
      return res.json({
        ...base, role: "evaluatee", ...learnerStage(e, await reassignedSet([e.id])),
        evaluator: accepted && people.get(e.evaluator_id!) ? { name: people.get(e.evaluator_id!)!.name, photoUrl: people.get(e.evaluator_id!)!.photoUrl ?? null } : null,
        history: learnerHistory(events),
        // Feedback only once it's complete; the evaluator's working draft is never shown.
        feedback: done ? { outcome: e.outcome ?? (e.status === "approved" ? "passed" : "revision_required"), summary: e.feedback, detail: e.feedback_detail, questions: questions.map((x) => ({ id: x.id, question: x.question })) } : null,
        canRate: e.engine_state === "completed" && !q,
        canDiscuss: e.engine_state === "in_progress" || e.engine_state === "completed",
      });
    }

    // The accepted evaluator (current), or one who completed it — never a previous / invited one.
    if (e.evaluator_id === userId && (e.engine_state === "in_progress" || e.engine_state === "completed")) {
      const a = e.current_assignment_id ? (must(await db.from("p2p_evaluation_assignments").select("id,draft,draft_saved_at,deadline_at").eq("id", e.current_assignment_id).maybeSingle()) as { id: string; draft: unknown; draft_saved_at: string | null; deadline_at: string } | null) : null;
      const answers = sub?.assignment_id ? ((must(await db.from("p2p_submissions").select("id,assignment_question_id,submission_type,text_content,media_url,created_at").eq("user_id", e.submitter_id).eq("assignment_id", sub.assignment_id).order("created_at")) ?? []) as
        { id: string; assignment_question_id: string | null; submission_type: string; text_content: string | null; media_url: string | null; created_at: string }[]) : [];
      // The latest answer per question, up to this submission (only this check — never reflections, notes or journals).
      const cutoff = Date.parse(sub?.created_at ?? e.created_at) + 60_000;
      const latest = new Map<string, (typeof answers)[number]>();
      for (const x of answers) if (Date.parse(x.created_at) <= cutoff) latest.set(x.assignment_question_id ?? x.id, x);
      const people = await profilesById([e.submitter_id ?? ""]);
      return res.json({
        ...base, role: "evaluator", assignmentId: a?.id ?? null, state: e.engine_state,
        evaluatee: { name: people.get(e.submitter_id ?? "")?.name ?? "A fellow disciple", photoUrl: people.get(e.submitter_id ?? "")?.photoUrl ?? null },
        instructions: asgInfo?.instructions ?? res0.instructions ?? null,
        questions: questions.map((x) => ({ id: x.id, question: x.question, answer: latest.get(x.id) ? { type: latest.get(x.id)!.submission_type, text: latest.get(x.id)!.text_content, mediaUrl: latest.get(x.id)!.media_url } : null })),
        // A group assignment is one piece of work (only that submission — never journals, reflections or notes).
        overallAnswer: isGroup ? (groupSub ? [{ type: "text", text: groupSub.content, mediaUrl: null }] : [])
          : !questions.length ? Array.from(latest.values()).map((x) => ({ type: x.submission_type, text: x.text_content, mediaUrl: x.media_url })) : [],
        draft: e.engine_state === "in_progress" ? a?.draft ?? null : null, draftSavedAt: a?.draft_saved_at ?? null,
        submitted: e.engine_state === "completed" ? { outcome: e.outcome, detail: e.feedback_detail, summary: e.feedback } : null,
      });
    }
    throw notFound();
  } catch (e) { return fail(res, e); }
});

router.post("/:id/submit", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const e = await loadEval(req.params.id);
    if (e.evaluator_id !== userId) throw notFound();
    const sub = e.resource_kind === "group_assignment" ? null : (must(await db.from("p2p_submissions").select("assignment_id").eq("id", e.submission_id ?? "").maybeSingle()) as { assignment_id: string | null } | null);
    const qIds = sub?.assignment_id ? ((must(await db.from("p2p_assignment_questions").select("id").eq("assignment_id", sub.assignment_id)) ?? []) as { id: string }[]).map((q) => q.id) : [];
    const fb = cleanFeedback(req.body?.feedback, qIds);
    if (typeof fb === "string") throw new EvalError(400, fb);
    const r = await rpc("p2p_eval_submit", { p_eval: e.id, p_user: userId, p_outcome: String(req.body?.outcome ?? ""), p_detail: fb.detail, p_summary: fb.summary });
    return res.json(r);
  } catch (e) { return fail(res, e); }
});

router.post("/:id/discussion", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.id)) throw notFound();
    const r = await rpc("p2p_eval_open_discussion", { p_eval: req.params.id, p_user: userId });
    return res.json({ conversationId: r.conversationId });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/quality", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const e = await loadEval(req.params.id);
    if (e.submitter_id !== userId) throw notFound();
    if (e.engine_state !== "completed") throw new EvalError(409, "You can share this once your feedback is ready.");
    const q = cleanQuality(req.body);
    if (typeof q === "string") throw new EvalError(400, q);
    const existing = must(await db.from("p2p_evaluation_quality").select("evaluation_id").eq("evaluation_id", e.id).maybeSingle());
    if (existing) throw new EvalError(409, "You've already shared your thoughts on this evaluation.");
    must(await db.from("p2p_evaluation_quality").insert({ evaluation_id: e.id, evaluatee_id: userId, evaluator_id: e.evaluator_id, ...q }).select("evaluation_id"));
    return res.json({ thanks: true });
  } catch (e) { return fail(res, e); }
});

// ── Authorised oversight (minimum necessary) ────────────────────────────────

router.get("/admin/overview", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const active = (must(await db.from("p2p_lesson_evaluations").select("id,lesson_id,engine_state,deadline_at,queued_since,attempts,created_at,resource_kind,resource_id,context").in("engine_state", ["queued", "invited", "in_progress"]).limit(1000)) ?? []) as
      { id: string; lesson_id: string | null; engine_state: string; deadline_at: string | null; queued_since: string | null; attempts: number; created_at: string; resource_kind: string; resource_id: string | null; context: string | null }[];
    const ended = (must(await db.from("p2p_evaluation_assignments").select("id,evaluation_id,status,ended_at").in("status", ["overdue", "unable", "declined", "expired", "removed", "unavailable"]).order("ended_at", { ascending: false }).limit(50)) ?? []) as { id: string; evaluation_id: string; status: string; ended_at: string }[];
    const sweeps = (must(await db.from("p2p_evaluation_events").select("detail,created_at").eq("event_type", "sweep").order("created_at", { ascending: false }).limit(1)) ?? []) as { detail: Record<string, number>; created_at: string }[];
    const settings = must(await db.from("p2p_evaluation_settings").select("*").maybeSingle());
    const now = Date.now();
    const info = await resourcesInfo(active);
    const item = (a: (typeof active)[number]) => ({ id: a.id, lessonTitle: info(a).title, context: a.context, state: a.engine_state, deadlineAt: a.deadline_at, queuedSince: a.queued_since, attempts: a.attempts });
    const lastSweep = sweeps[0]?.created_at ?? null;
    return res.json({
      serverNow: serverNow(), settings,
      counts: {
        arranging: active.filter((a) => a.engine_state === "queued").length,
        invitations: active.filter((a) => a.engine_state === "invited").length,
        inProgress: active.filter((a) => a.engine_state === "in_progress").length,
        dueSoon: active.filter((a) => a.engine_state === "in_progress" && a.deadline_at && Date.parse(a.deadline_at) - now < 6 * 3600_000 && Date.parse(a.deadline_at) > now).length,
        overdue: active.filter((a) => a.engine_state === "in_progress" && a.deadline_at && Date.parse(a.deadline_at) <= now).length,
      },
      noEvaluator: active.filter((a) => a.engine_state === "queued").map(item),
      dueSoon: active.filter((a) => a.engine_state === "in_progress" && a.deadline_at && Date.parse(a.deadline_at) - now < 6 * 3600_000).map(item),
      recentlyReassigned: ended.slice(0, 20).map((x) => ({ evaluationId: x.evaluation_id, reason: x.status, at: x.ended_at })),
      // Health: the sweep runs every 5 minutes; anything stuck is visible here.
      health: {
        lastSweepAt: lastSweep, sweepLate: !lastSweep || now - Date.parse(lastSweep) > 15 * 60_000, lastSweep: sweeps[0]?.detail ?? null,
        stuck: active.filter((a) => (a.engine_state === "in_progress" && a.deadline_at && now - Date.parse(a.deadline_at) > 15 * 60_000) || (a.engine_state === "invited" && now - Date.parse(a.created_at) > 7 * 86_400_000)).map(item),
      },
    });
  } catch (e) { return fail(res, e); }
});

router.get("/admin/evaluations/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const e = await loadEval(req.params.id);
    const asg = (must(await db.from("p2p_evaluation_assignments").select("id,evaluator_id,attempt,status,invited_at,invite_expires_at,accepted_at,deadline_at,ended_at,end_reason,decline_reason,unable_category,actor_type,match_detail").eq("evaluation_id", e.id).order("attempt")) ?? []) as Record<string, unknown>[];
    // Who the engine would invite next, and why (booleans and counts only — never anyone's location).
    const cand = (must(await db.rpc("p2p_eval_candidates", { p_eval: e.id, p_limit: 5 })) ?? []) as { user_id: string; score: number; basis: string; reasons: Record<string, unknown> }[];
    const events = (must(await db.from("p2p_evaluation_events").select("event_type,actor_type,actor_id,detail,created_at").eq("evaluation_id", e.id).order("created_at")) ?? []) as Record<string, unknown>[];
    const people = await profilesById([e.submitter_id ?? "", ...asg.map((a) => String(a.evaluator_id ?? "")), ...cand.map((x) => x.user_id)]);
    const info = await resourcesInfo([e]);
    // Audit: who was invited / accepted and what happened — never the learner's answers or private notes.
    return res.json({ id: e.id, lessonTitle: info(e).title, resourceKind: e.resource_kind, resourceId: e.resource_id, lessonId: e.lesson_id, context: e.context, state: e.engine_state, status: e.status, deadlineAt: e.deadline_at,
      nextCandidates: cand.map((x) => ({ name: people.get(x.user_id)?.name ?? "—", basis: x.basis, reasons: x.reasons })),
      evaluatee: people.get(e.submitter_id ?? "")?.name ?? "—",
      assignments: asg.map((a) => ({ ...a, evaluatorName: people.get(String(a.evaluator_id ?? ""))?.name ?? "—" })),
      events: events.filter((x) => x.event_type !== "notified") });
  } catch (e) { return fail(res, e); }
});

router.post("/admin/evaluations/:id/reassign", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    if (!isUuid(req.params.id)) throw notFound();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 3) throw new EvalError(400, "Please give a reason.");
    // No evaluator field: the system chooses the replacement.
    return res.json(await rpc("p2p_eval_admin_reassign", { p_eval: req.params.id, p_admin: userId, p_reason: reason }));
  } catch (e) { return fail(res, e); }
});

router.get("/admin/evaluators", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const profs = (must(await db.from("p2p_evaluator_profiles").select("*").limit(1000)) ?? []) as Record<string, unknown>[];
    const ids = profs.map((p) => String(p.user_id));
    const [asg, qual] = ids.length ? await Promise.all([
      db.from("p2p_evaluation_assignments").select("evaluator_id,status,accepted_at,deadline_at,ended_at,end_reason").in("evaluator_id", ids),
      db.from("p2p_evaluation_quality").select("evaluator_id,helpfulness,clarity,respectfulness,encouragement,relevance,helped_understand,substantiated,concern").in("evaluator_id", ids),
    ]) : [{ data: [] }, { data: [] }];
    const people = await profilesById(ids);
    return res.json({ items: profs.map((p) => {
      const rec = serviceRecord(((asg.data ?? []) as (AssignmentRow & { evaluator_id: string })[]).filter((a) => a.evaluator_id === p.user_id), ((qual.data ?? []) as (QualityRow & { evaluator_id: string })[]).filter((q) => q.evaluator_id === p.user_id));
      return { userId: p.user_id, name: people.get(String(p.user_id))?.name ?? "—", available: p.available, standing: p.standing, oriented: !!p.orientation_acknowledged_at, restrictionReason: p.restriction_reason, record: rec, needsReview: needsReview(rec) };
    }) });
  } catch (e) { return fail(res, e); }
});

router.put("/admin/evaluators/:userId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    if (!isUuid(req.params.userId)) throw notFound();
    const b = (req.body ?? {}) as { standing?: unknown; reason?: unknown; available?: unknown };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.standing !== undefined) {
      if (!["good", "under_review", "restricted"].includes(String(b.standing))) throw new EvalError(400, "Choose a standing.");
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      // A restriction (or reinstatement) always has a clear, recorded reason, decided by a person.
      if (reason.length < 5) throw new EvalError(400, "Please give a clear reason.");
      patch.standing = b.standing;
      if (b.standing === "restricted") { patch.restriction_reason = reason.slice(0, 1000); patch.restricted_by = userId; patch.restricted_at = patch.updated_at; }
      else { patch.reinstated_at = patch.updated_at; patch.restriction_reason = null; }
      await db.from("p2p_evaluation_events").insert({ event_type: b.standing === "restricted" ? "evaluator_restricted" : "evaluator_standing", actor_type: "admin", actor_id: userId, detail: { userId: req.params.userId, standing: b.standing, reason: reason.slice(0, 1000) } });
    }
    if (typeof b.available === "boolean") patch.available = b.available;
    const rows = must(await db.from("p2p_evaluator_profiles").update(patch).eq("user_id", req.params.userId).select("user_id")) as unknown[] | null;
    if (!rows?.length) throw notFound();
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

router.get("/admin/concerns", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const rows = (must(await db.from("p2p_evaluation_quality").select("evaluation_id,evaluator_id,helpfulness,clarity,respectfulness,encouragement,relevance,helped_understand,comment,concern,reviewed_at,substantiated,created_at").eq("concern", true).order("created_at", { ascending: false }).limit(200)) ?? []) as Record<string, unknown>[];
    const people = await profilesById(rows.map((r) => String(r.evaluator_id ?? "")));
    return res.json({ items: rows.map((r) => ({ ...r, evaluatorName: people.get(String(r.evaluator_id ?? ""))?.name ?? "—" })) });
  } catch (e) { return fail(res, e); }
});

router.put("/admin/concerns/:evaluationId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    if (!isUuid(req.params.evaluationId) || typeof req.body?.substantiated !== "boolean") throw new EvalError(400, "Say whether the concern was substantiated.");
    const rows = must(await db.from("p2p_evaluation_quality").update({ substantiated: req.body.substantiated, reviewed_at: new Date().toISOString(), reviewed_by: userId, review_note: typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null })
      .eq("evaluation_id", req.params.evaluationId).select("evaluation_id")) as unknown[] | null;
    if (!rows?.length) throw notFound();
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

router.put("/admin/settings", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
    if (typeof b.engineEnabled === "boolean") patch.engine_enabled = b.engineEnabled;
    if (b.invitationWindowMinutes !== undefined) { const n = Number(b.invitationWindowMinutes); if (!Number.isInteger(n) || n < 15 || n > 1440) throw new EvalError(400, "Invitation window: 15 minutes to 24 hours."); patch.invitation_window_minutes = n; }
    if (b.defaultCapacity !== undefined) { const n = Number(b.defaultCapacity); if (!Number.isInteger(n) || n < 1 || n > 10) throw new EvalError(400, "Capacity: 1 to 10."); patch.default_capacity = n; }
    // Cold start only: these roles may evaluate a resource NOBODY has independently passed yet.
    if (b.bootstrapRoles !== undefined) {
      if (!Array.isArray(b.bootstrapRoles) || !b.bootstrapRoles.every((r) => BOOTSTRAP_ROLES.has(String(r)))) throw new EvalError(400, "Choose roles from the list.");
      patch.bootstrap_roles = Array.from(new Set(b.bootstrapRoles.map(String)));
    }
    if (typeof b.groupAssignmentsEnabled === "boolean") patch.group_assignments_enabled = b.groupAssignmentsEnabled;
    // No deadline setting exists: it is always 48 hours.
    must(await db.from("p2p_evaluation_settings").update(patch).eq("id", true).select("id"));
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

// Resources waiting with nobody (yet) independently qualified to evaluate them.
router.get("/admin/coverage", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const rows = (must(await db.from("p2p_eval_coverage").select("*").limit(500)) ?? []) as { resource_kind: string; resource_id: string; context: string | null; title: string | null; waiting: number; waiting_since: string | null; has_qualified_people: boolean }[];
    return res.json({ items: rows.map((r) => ({ resourceKind: r.resource_kind, resourceId: r.resource_id, context: r.context, title: r.title ?? "Resource", waiting: r.waiting, waitingSince: r.waiting_since, hasQualifiedPeople: r.has_qualified_people }))
      .sort((a, b) => Number(a.hasQualifiedPeople) - Number(b.hasQualifiedPeople) || b.waiting - a.waiting) });
  } catch (e) { return fail(res, e); }
});

router.get("/admin/operations", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    return res.json(must(await db.rpc("p2p_eval_operations")));
  } catch (e) { return fail(res, e); }
});

// Pairs who approved each other's work — listed for a human, audited review (never automatic punishment).
router.get("/admin/integrity", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const pairs = (must(await db.from("p2p_eval_reciprocal_pairs").select("*").order("last_at", { ascending: false }).limit(200)) ?? []) as
      { pair_key: string; person_a: string; person_b: string; a_approved_b: number; b_approved_a: number; last_at: string }[];
    const reviews = pairs.length ? ((must(await db.from("p2p_eval_integrity_reviews").select("pair_key,decision,note,created_at").in("pair_key", pairs.map((p) => p.pair_key)).order("created_at", { ascending: false })) ?? []) as
      { pair_key: string; decision: string; note: string; created_at: string }[]) : [];
    const people = await profilesById(pairs.flatMap((p) => [p.person_a, p.person_b]));
    return res.json({ items: pairs.map((p) => {
      const last = reviews.find((r) => r.pair_key === p.pair_key);
      return { pairKey: p.pair_key, people: [people.get(p.person_a)?.name ?? "—", people.get(p.person_b)?.name ?? "—"], approvals: [p.a_approved_b, p.b_approved_a], lastAt: p.last_at,
        review: last ? { decision: last.decision, note: last.note, at: last.created_at } : null, needsReview: !last || Date.parse(last.created_at) < Date.parse(p.last_at) };
    }) });
  } catch (e) { return fail(res, e); }
});
router.post("/admin/integrity/:pairKey/review", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const decision = String(req.body?.decision ?? ""), note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!["no_concern", "concern_raised", "evidence_voided"].includes(decision)) throw new EvalError(400, "Choose a decision.");
    if (note.length < 5) throw new EvalError(400, "Please explain the decision.");
    if (!/^[0-9a-f]{32}$/.test(req.params.pairKey)) throw notFound();
    must(await db.from("p2p_eval_integrity_reviews").insert({ pair_key: req.params.pairKey, decision, note: note.slice(0, 1000), actor_id: userId }).select("id"));
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

// A MATERIAL revision of an assessment: earlier passes keep their learning credit but no longer
// qualify anyone to evaluate the revised version.
router.post("/admin/resources/revision", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    const kind = String(req.body?.kind ?? ""), resourceId = String(req.body?.resourceId ?? ""), reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!["lesson", "group_assignment"].includes(kind) || !isUuid(resourceId)) throw new EvalError(400, "Choose the resource.");
    if (reason.length < 5) throw new EvalError(400, "Please describe what changed.");
    const v = must(await db.rpc("p2p_assessment_record_revision", { p_kind: kind, p_resource: resourceId, p_actor: userId, p_reason: reason.slice(0, 1000) }));
    return res.json({ version: v });
  } catch (e) { return fail(res, e); }
});

router.post("/admin/sweep", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await needAdmin(userId);
    return res.json(must(await db.rpc("p2p_eval_sweep", { p_limit: 200 })));
  } catch (e) { return fail(res, e); }
});

export default router;
