import crypto from "node:crypto";
import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { GROUP_SCOPES, type GroupScope, isUuid, isGroupMember, canManageGroupLearning, canReviewGroupAssignment } from "../lib/groupLearning";
import { attachmentsEnabled, linkAttachments, discardLinked, ATTACHED_ONLY } from "../lib/learningAttachments";
import { readQuestions, normalizeScripture, normalizeResources } from "../lib/customLessons";

// Reflections and assignments on custom lessons (Family + Church; migration 201).
//   Reflections: private by default (personal journal rows); shared only if
//   the writer chooses 'leaders' or 'group'; shared ones are read here only,
//   after checking writer AND reader are current members of the lesson's group.
//   Assignments: leaders (Shepherd/Co-Shepherd; church leadership) create /
//   publish; members submit attempts (never overwritten); reviewers = the
//   group's leaders or the assignment's creator, while still a member.
// Lesson completion and group progress are never changed from here.
const router = Router();
const ok = (res: import("express").Response, data: unknown) => res.json(data);
const err = (res: import("express").Response, message: string, status = 400) => res.status(status).json({ error: message });
const LIMITS = { reflection: 10000, instructions: 5000, title: 160, submission: 20000, feedback: 3000 };

type Ctx = { scope: GroupScope; lessonId: string; groupId: string; lesson: Record<string, unknown>; visibleToMembers: boolean };

/** The custom lesson and the group that owns it (via its study). */
async function loadLesson(scope: GroupScope, lessonId: string): Promise<Ctx | null> {
  if (!isUuid(lessonId)) return null;
  const lessonTable = scope === "family" ? "p2p_family_study_lessons" : "p2p_church_study_lessons";
  const studyTable = scope === "family" ? "p2p_family_studies" : "p2p_church_studies";
  const { data: lesson } = await db.from(lessonTable).select("*").eq("id", lessonId).maybeSingle();
  if (!lesson) return null;
  const { data: study } = await db.from(studyTable).select("*").eq("id", lesson.study_id as string).maybeSingle();
  if (!study) return null;
  const groupId = (scope === "family" ? study.family_id : study.church_id) as string;
  const lessonStatus = (lesson.status as string | undefined) ?? "published";
  return { scope, lessonId, groupId, lesson: lesson as Record<string, unknown>, visibleToMembers: lessonStatus === "published" && study.status === "published" };
}

function scopeOf(req: import("express").Request): GroupScope | null {
  const s = req.params.scope as GroupScope;
  return GROUP_SCOPES.includes(s) ? s : null;
}

/** Signed-in member who may see this lesson (leaders also see unpublished ones). */
async function lessonAccess(req: import("express").Request, res: import("express").Response) {
  const userId = await verifyCaller(req);
  if (!userId) { err(res, "Unauthorized", 401); return null; }
  const scope = scopeOf(req);
  const ctx = scope ? await loadLesson(scope, String(req.params.lessonId)) : null;
  if (!ctx) { err(res, "Lesson not found", 404); return null; }
  if (!(await isGroupMember(ctx.scope, ctx.groupId, userId))) { err(res, "You're not a member of this group", 403); return null; }
  const canManage = await canManageGroupLearning(ctx.scope, ctx.groupId, userId);
  if (!ctx.visibleToMembers && !canManage) { err(res, "Lesson not found", 404); return null; }
  return { userId, ctx, canManage };
}

const lessonColumn = (scope: GroupScope) => (scope === "family" ? "family_lesson_id" : "church_lesson_id");
const groupColumn = (scope: GroupScope) => (scope === "family" ? "family_id" : "church_id");

async function profilesById(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; photoUrl: string | null }>();
  const { data } = await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", ids);
  return new Map(((data ?? []) as { id: string; full_name: string | null; photo_url: string | null }[]).map((p) => [p.id, { name: p.full_name ?? "Member", photoUrl: p.photo_url }]));
}

// ── Reflections ─────────────────────────────────────────────────────────────

// GET /learning/work/:scope/lessons/:lessonId/reflections/mine — my latest answer per reflection question.
router.get("/:scope/lessons/:lessonId/reflections/mine", async (req, res) => {
  const a = await lessonAccess(req, res); if (!a) return;
  const { data } = await db.from("p2p_journal_reflections").select("id,root_id,question_id,content,visibility,lesson_version,created_at")
    .eq("user_id", a.userId).eq(lessonColumn(a.ctx.scope), a.ctx.lessonId).order("created_at", { ascending: true });
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[]) latest.set(r.question_id as string, r);
  return ok(res, { reflections: [...latest.values()].map((r) => ({ id: r.id, questionId: r.question_id, content: r.content, visibility: r.visibility, lessonVersion: r.lesson_version, submittedAt: r.created_at })) });
});

// POST /learning/work/:scope/lessons/:lessonId/reflections — { questionId, content, visibility? }
router.post("/:scope/lessons/:lessonId/reflections", async (req, res) => {
  const a = await lessonAccess(req, res); if (!a) return;
  const { questionId, content, visibility = "private" } = (req.body ?? {}) as { questionId?: string; content?: string; visibility?: string };
  const question = readQuestions(a.ctx.lesson.questions).find((q) => q.id === questionId && q.kind === "reflection");
  if (!question) return err(res, "That reflection question isn't part of this lesson");
  if (typeof content !== "string" || !content.trim()) return err(res, "Write your reflection first");
  if (content.trim().length > LIMITS.reflection) return err(res, "That reflection is too long");
  if (!["private", "leaders", "group"].includes(visibility)) return err(res, "Choose who can see it");
  // An earlier answer to this question → this one continues the same journal chain.
  const { data: prev } = await db.from("p2p_journal_reflections").select("id,root_id").eq("user_id", a.userId)
    .eq(lessonColumn(a.ctx.scope), a.ctx.lessonId).eq("question_id", question.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const id = crypto.randomUUID();
  const { error } = await db.from("p2p_journal_reflections").insert({
    id, user_id: a.userId, root_id: (prev?.root_id as string) ?? id, parent_id: (prev?.id as string) ?? null,
    prompt: question.text, content: content.trim(), [lessonColumn(a.ctx.scope)]: a.ctx.lessonId, question_id: question.id,
    lesson_version: (a.ctx.lesson.version as number | undefined) ?? 1, visibility, shared_at: visibility === "private" ? null : new Date().toISOString(),
  });
  if (error) return err(res, error.message, 500);
  if (prev) {
    // One sharing choice per answer chain — the latest one, including going
    // back to private — so an older answer is never left shared by mistake.
    await db.from("p2p_journal_reflections").update({ visibility, shared_at: visibility === "private" ? null : new Date().toISOString() })
      .eq("root_id", prev.root_id as string).eq("user_id", a.userId);
  }
  return ok(res, { id, visibility });
});

// PUT /learning/work/reflections/:reflectionId/visibility — { visibility } — the writer only.
router.put("/reflections/:reflectionId/visibility", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const visibility = (req.body as { visibility?: string })?.visibility;
  if (!visibility || !["private", "leaders", "group"].includes(visibility)) return err(res, "Choose who can see it");
  if (!isUuid(req.params.reflectionId)) return err(res, "Not found", 404);
  const { data: row } = await db.from("p2p_journal_reflections").select("id,root_id,user_id").eq("id", req.params.reflectionId).maybeSingle();
  if (!row || row.user_id !== userId) return err(res, "Not found", 404); // never reveal someone else's reflection exists
  const { error } = await db.from("p2p_journal_reflections").update({ visibility, shared_at: visibility === "private" ? null : new Date().toISOString() })
    .eq("root_id", row.root_id as string).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { visibility });
});

// GET /learning/work/:scope/lessons/:lessonId/reflections/shared — what others chose to share with me.
router.get("/:scope/lessons/:lessonId/reflections/shared", async (req, res) => {
  const a = await lessonAccess(req, res); if (!a) return;
  const allowed = a.canManage ? ["leaders", "group"] : ["group"];
  const { data } = await db.from("p2p_journal_reflections").select("id,user_id,question_id,prompt,content,visibility,lesson_version,created_at")
    .eq(lessonColumn(a.ctx.scope), a.ctx.lessonId).in("visibility", allowed).neq("user_id", a.userId).order("created_at", { ascending: true });
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[]) latest.set(`${r.user_id}:${r.question_id}`, r);
  // Only writers who are still members of this group.
  const rows = [];
  for (const r of latest.values()) if (await isGroupMember(a.ctx.scope, a.ctx.groupId, r.user_id as string)) rows.push(r);
  const people = await profilesById([...new Set(rows.map((r) => r.user_id as string))]);
  return ok(res, { reflections: rows.map((r) => ({
    id: r.id, questionId: r.question_id, question: r.prompt, content: r.content, visibility: r.visibility, lessonVersion: r.lesson_version, submittedAt: r.created_at,
    author: { id: r.user_id, ...(people.get(r.user_id as string) ?? { name: "Member", photoUrl: null }) },
  })) });
});

// ── Assignments ─────────────────────────────────────────────────────────────

function mapAssignment(r: Record<string, unknown>) {
  return { id: r.id, title: r.title, instructions: r.instructions ?? null, dueAt: r.due_at ?? null, scriptureReferences: r.scripture_references ?? [],
    resources: r.resources ?? [], allowResubmission: r.allow_resubmission, status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapSubmission(r: Record<string, unknown>) {
  return { id: r.id, attempt: r.attempt, content: r.content, status: r.status, feedback: r.feedback ?? null, reviewedAt: r.reviewed_at ?? null, submittedAt: r.submitted_at };
}

function assignmentFields(body: Record<string, unknown>, partial: boolean): Record<string, unknown> | string {
  const f: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("title")) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return "Give the Comprehensive Check a title";
    if (t.length > LIMITS.title) return "Title is too long";
    f.title = t;
  }
  if (has("instructions")) {
    const v = body.instructions == null ? "" : String(body.instructions).trim();
    if (v.length > LIMITS.instructions) return "Instructions are too long";
    f.instructions = v || null;
  }
  if (has("dueAt")) {
    if (body.dueAt == null || body.dueAt === "") f.due_at = null;
    else { const d = new Date(String(body.dueAt)); if (Number.isNaN(d.getTime())) return "Due date isn't valid"; f.due_at = d.toISOString(); }
  }
  if (has("scriptureReferences")) { const s = normalizeScripture(body.scriptureReferences); if (typeof s === "string") return s; f.scripture_references = s; }
  if (has("resources")) { const r = normalizeResources(body.resources); if (typeof r === "string") return r; f.resources = r; }
  if (has("allowResubmission")) f.allow_resubmission = body.allowResubmission !== false;
  return f;
}

async function loadAssignment(scope: GroupScope, assignmentId: string) {
  if (!isUuid(assignmentId)) return null;
  const { data } = await db.from("p2p_group_assignments").select("*").eq("id", assignmentId).not(lessonColumn(scope), "is", null).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/** May this person review submissions: a group leader, or the assignment's creator while still a member. */
const canReview = canReviewGroupAssignment;

// GET /learning/work/:scope/lessons/:lessonId/assignments
router.get("/:scope/lessons/:lessonId/assignments", async (req, res) => {
  const a = await lessonAccess(req, res); if (!a) return;
  let q = db.from("p2p_group_assignments").select("*").eq(lessonColumn(a.ctx.scope), a.ctx.lessonId).order("created_at", { ascending: true });
  q = a.canManage ? q.neq("status", "archived") : q.eq("status", "published");
  const { data: rows } = await q;
  const assignments = (rows ?? []) as Record<string, unknown>[];
  const ids = assignments.map((x) => x.id as string);
  const { data: mine } = ids.length ? await db.from("p2p_group_assignment_submissions").select("*").eq("user_id", a.userId).in("assignment_id", ids).order("attempt", { ascending: true }) : { data: [] };
  const myLatest = new Map<string, Record<string, unknown>>();
  for (const s of (mine ?? []) as Record<string, unknown>[]) myLatest.set(s.assignment_id as string, s);
  const counts = new Map<string, number>();
  if (a.canManage && ids.length) {
    const { data: all } = await db.from("p2p_group_assignment_submissions").select("assignment_id,user_id").in("assignment_id", ids);
    const seen = new Set<string>();
    for (const s of (all ?? []) as { assignment_id: string; user_id: string }[]) {
      const k = `${s.assignment_id}:${s.user_id}`; if (seen.has(k)) continue; seen.add(k);
      counts.set(s.assignment_id, (counts.get(s.assignment_id) ?? 0) + 1);
    }
  }
  return ok(res, { canManage: a.canManage, assignments: assignments.map((x) => ({
    ...mapAssignment(x), mySubmission: myLatest.has(x.id as string) ? mapSubmission(myLatest.get(x.id as string)!) : null,
    ...(a.canManage ? { submittedCount: counts.get(x.id as string) ?? 0 } : {}),
  })) });
});

// POST /learning/work/:scope/lessons/:lessonId/assignments — leaders.
router.post("/:scope/lessons/:lessonId/assignments", async (req, res) => {
  const a = await lessonAccess(req, res); if (!a) return;
  if (!a.canManage) return err(res, "Only the group's leaders can create Comprehensive Checks", 403);
  const f = assignmentFields((req.body ?? {}) as Record<string, unknown>, false);
  if (typeof f === "string") return err(res, f);
  const status = (req.body as { status?: string })?.status === "published" ? "published" : "draft";
  const { data, error } = await db.from("p2p_group_assignments").insert({
    ...f, status, created_by: a.userId, [lessonColumn(a.ctx.scope)]: a.ctx.lessonId, [groupColumn(a.ctx.scope)]: a.ctx.groupId,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Couldn't create the Comprehensive Check", 500);
  return ok(res, mapAssignment(data as Record<string, unknown>));
});

async function assignmentAccess(req: import("express").Request, res: import("express").Response) {
  const userId = await verifyCaller(req);
  if (!userId) { err(res, "Unauthorized", 401); return null; }
  const scope = scopeOf(req);
  const asg = scope ? await loadAssignment(scope, String(req.params.assignmentId)) : null;
  if (!scope || !asg) { err(res, "Comprehensive Check not found", 404); return null; }
  const groupId = asg[groupColumn(scope)] as string;
  if (!(await isGroupMember(scope, groupId, userId))) { err(res, "Comprehensive Check not found", 404); return null; }
  const canManage = await canManageGroupLearning(scope, groupId, userId);
  if (asg.status !== "published" && !canManage) { err(res, "Comprehensive Check not found", 404); return null; }
  return { userId, scope, asg, groupId, canManage };
}

// PUT /learning/work/:scope/assignments/:assignmentId — leaders. { …fields, status? }
router.put("/:scope/assignments/:assignmentId", async (req, res) => {
  const a = await assignmentAccess(req, res); if (!a) return;
  if (!a.canManage) return err(res, "Only the group's leaders can change Comprehensive Checks", 403);
  const f = assignmentFields((req.body ?? {}) as Record<string, unknown>, true);
  if (typeof f === "string") return err(res, f);
  const status = (req.body as { status?: string })?.status;
  if (status !== undefined) { if (!["draft", "published", "archived"].includes(status)) return err(res, "status must be draft, published or archived"); f.status = status; }
  const { data, error } = await db.from("p2p_group_assignments").update({ ...f, updated_at: new Date().toISOString() }).eq("id", a.asg.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Couldn't update the Comprehensive Check", 500);
  return ok(res, mapAssignment(data as Record<string, unknown>));
});

// GET /learning/work/:scope/assignments/:assignmentId/submissions/mine — my attempts (oldest first).
router.get("/:scope/assignments/:assignmentId/submissions/mine", async (req, res) => {
  const a = await assignmentAccess(req, res); if (!a) return;
  const { data } = await db.from("p2p_group_assignment_submissions").select("*").eq("assignment_id", a.asg.id as string).eq("user_id", a.userId).order("attempt", { ascending: true });
  return ok(res, { assignment: mapAssignment(a.asg), attempts: ((data ?? []) as Record<string, unknown>[]).map(mapSubmission) });
});

// POST /learning/work/:scope/assignments/:assignmentId/submissions — { content }
router.post("/:scope/assignments/:assignmentId/submissions", async (req, res) => {
  const a = await assignmentAccess(req, res); if (!a) return;
  if (a.asg.status !== "published") return err(res, "This Comprehensive Check isn't open", 409);
  const body = (req.body ?? {}) as { content?: unknown; attachmentIds?: unknown; captions?: Record<string, unknown> };
  const attachmentIds = Array.isArray(body.attachmentIds) ? (body.attachmentIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (attachmentIds.length && !attachmentsEnabled()) return err(res, "Drawings and attachments aren't switched on yet.", 503);
  const typed = typeof body.content === "string" ? body.content.trim() : "";
  if (!typed && !attachmentIds.length) return err(res, "Write or attach your answer first");
  if (typed.length > LIMITS.submission) return err(res, "That answer is too long");
  // An answer given only as a drawing / file still carries words, so reviewers
  // on an older app version know there is something to open.
  const content = typed || ATTACHED_ONLY;
  const { data: latest } = await db.from("p2p_group_assignment_submissions").select("attempt,status").eq("assignment_id", a.asg.id as string).eq("user_id", a.userId)
    .order("attempt", { ascending: false }).limit(1).maybeSingle();
  if (latest && latest.status !== "returned" && !a.asg.allow_resubmission) return err(res, "You've already submitted this Comprehensive Check", 409);
  const attempt = ((latest?.attempt as number | undefined) ?? 0) + 1;
  // Attachments are frozen and linked to the attempt's id FIRST, then the attempt is saved;
  // if saving fails, the copies are removed in this same request (the drafts stay).
  const id = crypto.randomUUID();
  if (attachmentIds.length) {
    const linked = await linkAttachments({ ownerId: a.userId, targetKind: "group_submission", targetId: id, ids: attachmentIds, captions: body.captions });
    if ("error" in linked) return err(res, linked.error, linked.status);
  }
  const { data, error } = await db.from("p2p_group_assignment_submissions").insert({ id, assignment_id: a.asg.id, user_id: a.userId, attempt, content }).select().single();
  if (error || !data) {
    if (attachmentIds.length) await discardLinked("group_submission", id);
    return err(res, error?.message ?? "Couldn't submit", 500);
  }
  return ok(res, mapSubmission(data as Record<string, unknown>));
});

// GET /learning/work/:scope/assignments/:assignmentId/submissions — reviewers: latest attempt per member.
router.get("/:scope/assignments/:assignmentId/submissions", async (req, res) => {
  const a = await assignmentAccess(req, res); if (!a) return;
  if (!(await canReview(a.scope, a.asg, a.userId))) return err(res, "Only the group's leaders or the Comprehensive Check's author can review submissions", 403);
  const { data } = await db.from("p2p_group_assignment_submissions").select("*").eq("assignment_id", a.asg.id as string).order("attempt", { ascending: true });
  const latest = new Map<string, Record<string, unknown>>();
  const attemptsBy = new Map<string, number>();
  for (const s of (data ?? []) as Record<string, unknown>[]) { latest.set(s.user_id as string, s); attemptsBy.set(s.user_id as string, (attemptsBy.get(s.user_id as string) ?? 0) + 1); }
  const people = await profilesById([...latest.keys()]);
  return ok(res, { assignment: mapAssignment(a.asg), submissions: [...latest.entries()].map(([uid, s]) => ({
    ...mapSubmission(s), attempts: attemptsBy.get(uid), author: { id: uid, ...(people.get(uid) ?? { name: "Member", photoUrl: null }) },
  })) });
});

// POST /learning/work/:scope/submissions/:submissionId/review — { status: 'reviewed' | 'returned', feedback? }
router.post("/:scope/submissions/:submissionId/review", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const scope = scopeOf(req);
  if (!scope || !isUuid(req.params.submissionId)) return err(res, "Not found", 404);
  const { data: sub } = await db.from("p2p_group_assignment_submissions").select("*").eq("id", req.params.submissionId).maybeSingle();
  const asg = sub ? await loadAssignment(scope, sub.assignment_id as string) : null;
  if (!sub || !asg || !(await canReview(scope, asg, userId))) return err(res, "Not found", 404);
  const { status, feedback } = (req.body ?? {}) as { status?: string; feedback?: string };
  if (status !== "reviewed" && status !== "returned") return err(res, "status must be reviewed or returned");
  const fb = typeof feedback === "string" ? feedback.trim() : "";
  if (fb.length > LIMITS.feedback) return err(res, "Feedback is too long");
  if (status === "returned" && !fb) return err(res, "Say what to change when returning work");
  const now = new Date().toISOString();
  const { data, error } = await db.from("p2p_group_assignment_submissions").update({ status, feedback: fb || null, reviewed_by: userId, reviewed_at: now }).eq("id", sub.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Couldn't save the review", 500);
  // Tell the writer — never the content or feedback itself in the notification.
  await db.from("p2p_notifications").insert({
    user_id: sub.user_id, title: status === "returned" ? "Your Comprehensive Check was returned" : "Your Comprehensive Check was reviewed",
    message: `${asg.title as string} — open it to see the feedback.`, notification_type: "assignment_reviewed",
    data: { assignmentId: asg.id, scope, submissionId: sub.id },
  });
  return ok(res, mapSubmission(data as Record<string, unknown>));
});

export default router;
