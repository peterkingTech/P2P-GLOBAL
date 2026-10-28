import { supabaseServiceRole as db } from "./supabase";
import { type GroupScope, canManageGroupLearning } from "./groupLearning";
import { getWorkStatus } from "./groupProgress";

// Learning Centre (Universal Learning System, step 1) — ONE read-only view of
// a learner's Comprehensive Checks across the flows that already exist:
//   core   — Kingdom School / Plans lessons: p2p_submissions + peer review
//            (p2p_lesson_evaluations), the same "latest submission per
//            question" rule as p2p_lesson_progress_recompute (031);
//   story  — the same core rows, where the lesson is a Kingdom Stories chapter (212);
//   family / church — custom-lesson checks (201) via getWorkStatus, the
//            same rule the group page uses.
// Nothing here writes. It only ever reads the caller's OWN submissions and
// reviews, plus counts of what waits for them as a reviewer — never other
// people's answers, private reflections, notes or drafts.

export type WorkSource = "core" | "story" | "family" | "church";
export type WorkState = "not_started" | "returned" | "revision_requested" | "awaiting_review" | "completed" | "reviewed";
export interface WorkRoute { pathname: string; params: Record<string, string> }
export interface WorkItem {
  key: string;
  source: WorkSource;
  title: string;
  context: string | null;   // lesson, "Story · Chapter 3", or "Family name · lesson"
  state: WorkState;
  dueAt: string | null;
  at: string | null;        // last activity (submitted / reviewed)
  feedback: string | null;  // the reviewer's words to THIS learner (feedback list only)
  waiting?: number;         // reviewer lists: how many people wait
  route: WorkRoute;
}
export interface LearningOverview {
  toDo: WorkItem[];
  awaitingReview: WorkItem[];
  feedback: WorkItem[];
  toReview: WorkItem[];
}

type Sub = { id: string; lesson_id: string; assignment_question_id: string | null; created_at: string };
type Ev = { id: string; submission_id: string; lesson_id: string; status: string; feedback: string | null; resolved_at: string | null; created_at: string };

const FEEDBACK_DAYS = 60;
const time = (v: string | null | undefined) => (v ? new Date(v).getTime() || 0 : 0);
const newestFirst = (a: WorkItem, b: WorkItem) => time(b.at) - time(a.at);

/**
 * Per lesson, from the learner's own core submissions and their reviews:
 * only each question's MOST RECENT submission counts (031). A lesson needs
 * action if any latest answer was sent back; waits while any is pending or
 * has no review yet; is done when every latest answer is approved.
 */
export function summariseCoreLessons(subs: Sub[], evals: Ev[]) {
  const latest = new Map<string, Sub>();
  for (const s of subs) {
    if (!s.assignment_question_id) continue;
    const k = `${s.lesson_id}:${s.assignment_question_id}`;
    const cur = latest.get(k);
    if (!cur || time(s.created_at) > time(cur.created_at)) latest.set(k, s);
  }
  const evalBySub = new Map<string, Ev>();
  for (const e of evals) {
    const cur = evalBySub.get(e.submission_id);
    if (!cur || time(e.created_at) > time(cur.created_at)) evalBySub.set(e.submission_id, e);
  }
  const lessons = new Map<string, { state: WorkState; at: string | null; feedback: string[] }>();
  for (const s of latest.values()) {
    const e = evalBySub.get(s.id);
    const st: WorkState = e?.status === "needs_revision" ? "revision_requested" : e?.status === "approved" ? "completed" : "awaiting_review";
    const at = e?.resolved_at ?? s.created_at;
    const cur = lessons.get(s.lesson_id) ?? { state: "completed" as WorkState, at: null, feedback: [] };
    const rank = (x: WorkState) => (x === "revision_requested" ? 2 : x === "awaiting_review" ? 1 : 0);
    if (rank(st) > rank(cur.state)) cur.state = st;
    if (time(at) > time(cur.at)) cur.at = at;
    const fb = e?.feedback?.trim();
    if (fb && (e!.status === "approved" || e!.status === "needs_revision")) cur.feedback.push(fb);
    lessons.set(s.lesson_id, cur);
  }
  return lessons;
}

async function lessonInfo(lessonIds: string[]) {
  const info = new Map<string, { title: string; storyId?: string; storyTitle?: string; chapterId?: string; chapterNumber?: number }>();
  if (!lessonIds.length) return info;
  const [{ data: lessons }, { data: chapters }] = await Promise.all([
    db.from("p2p_lessons").select("id,title").in("id", lessonIds),
    db.from("p2p_kingdom_story_chapters").select("id,story_id,chapter_number,lesson_id").in("lesson_id", lessonIds),
  ]);
  for (const l of (lessons ?? []) as { id: string; title: string | null }[]) info.set(l.id, { title: l.title ?? "Lesson" });
  const ch = (chapters ?? []) as { id: string; story_id: string; chapter_number: number; lesson_id: string }[];
  if (ch.length) {
    const { data: stories } = await db.from("p2p_kingdom_stories").select("id,title").in("id", [...new Set(ch.map((c) => c.story_id))]);
    const titles = new Map(((stories ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title]));
    for (const c of ch) {
      const i = info.get(c.lesson_id) ?? { title: "Lesson" };
      info.set(c.lesson_id, { ...i, storyId: c.story_id, storyTitle: titles.get(c.story_id) ?? "Kingdom Story", chapterId: c.id, chapterNumber: c.chapter_number });
    }
  }
  return info;
}

function coreItem(lessonId: string, i: { title: string; storyId?: string; storyTitle?: string; chapterId?: string; chapterNumber?: number } | undefined,
  state: WorkState, at: string | null, feedback: string | null): WorkItem {
  const story = !!i?.storyId;
  return {
    key: `core:${lessonId}`, source: story ? "story" : "core", title: "Comprehensive Check",
    context: story ? `${i!.storyTitle} · Chapter ${i!.chapterNumber}` : i?.title ?? "Lesson",
    state, dueAt: null, at, feedback,
    route: story ? { pathname: "/kingdom-stories/chapter", params: { id: i!.storyId!, chapter: i!.chapterId! } } : { pathname: "/lesson/[id]", params: { id: lessonId } },
  };
}

async function coreOverview(userId: string, out: LearningOverview) {
  const { data: subs } = await db.from("p2p_submissions").select("id,lesson_id,assignment_question_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(2000);
  const mine = ((subs ?? []) as Sub[]).filter((s) => s.assignment_question_id);
  const ids = mine.map((s) => s.id);
  const evals: Ev[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("p2p_lesson_evaluations").select("id,submission_id,lesson_id,status,feedback,resolved_at,created_at").in("submission_id", ids.slice(i, i + 200));
    evals.push(...((data ?? []) as Ev[]));
  }
  const lessons = summariseCoreLessons(mine, evals);

  // As a peer reviewer: pending reviews assigned to me (counts only, never the answers).
  const { data: assigned } = await db.from("p2p_lesson_evaluations").select("lesson_id").eq("evaluator_id", userId).eq("status", "pending");
  const waitingByLesson = new Map<string, number>();
  for (const r of (assigned ?? []) as { lesson_id: string }[]) waitingByLesson.set(r.lesson_id, (waitingByLesson.get(r.lesson_id) ?? 0) + 1);

  const info = await lessonInfo([...new Set([...lessons.keys(), ...waitingByLesson.keys()])]);
  const since = Date.now() - FEEDBACK_DAYS * 86400000;
  for (const [lessonId, l] of lessons) {
    const i = info.get(lessonId);
    if (l.state === "revision_requested") out.toDo.push(coreItem(lessonId, i, l.state, l.at, null));
    else if (l.state === "awaiting_review") out.awaitingReview.push(coreItem(lessonId, i, l.state, l.at, null));
    if (l.feedback.length && time(l.at) >= since) out.feedback.push(coreItem(lessonId, i, l.state, l.at, l.feedback.join("\n\n")));
  }
  for (const [lessonId, n] of waitingByLesson) {
    const it = coreItem(lessonId, info.get(lessonId), "awaiting_review", null, null);
    out.toReview.push({ ...it, key: `review:${lessonId}`, waiting: n, route: { pathname: "/evaluations", params: {} } });
  }
}

async function myGroups(userId: string) {
  const [{ data: fam }, { data: ch }] = await Promise.all([
    db.from("p2p_family_members").select("family_id").eq("user_id", userId).eq("status", "active"),
    db.from("p2p_church_members").select("church_id").eq("user_id", userId).eq("is_active", true),
  ]);
  const familyIds = [...new Set(((fam ?? []) as { family_id: string }[]).map((r) => r.family_id))];
  const churchIds = [...new Set(((ch ?? []) as { church_id: string }[]).map((r) => r.church_id))];
  const [{ data: fn }, { data: cn }] = await Promise.all([
    familyIds.length ? db.from("p2p_families").select("id,name").in("id", familyIds) : Promise.resolve({ data: [] }),
    churchIds.length ? db.from("p2p_churches").select("id,name").in("id", churchIds) : Promise.resolve({ data: [] }),
  ]);
  const name = new Map([...((fn ?? []) as { id: string; name: string }[]), ...((cn ?? []) as { id: string; name: string }[])].map((r) => [r.id, r.name]));
  return [
    ...familyIds.map((id) => ({ scope: "family" as GroupScope, id, name: name.get(id) ?? "Family Circle" })),
    ...churchIds.map((id) => ({ scope: "church" as GroupScope, id, name: name.get(id) ?? "Church" })),
  ];
}

async function groupOverview(userId: string, out: LearningOverview) {
  const groups = await myGroups(userId);
  const route = (scope: GroupScope, assignmentId: string): WorkRoute => ({ pathname: "/learning/assignment/[assignmentId]", params: { assignmentId, s: scope } });
  const ctx = (g: { name: string }, lessonTitle: string | null) => (lessonTitle ? `${g.name} · ${lessonTitle}` : g.name);
  const byId = new Map<string, { scope: GroupScope; id: string; name: string }>();
  for (const g of groups) {
    byId.set(g.id, g);
    const canManage = await canManageGroupLearning(g.scope, g.id, userId);
    const w = await getWorkStatus(g.scope, g.id, userId, canManage);
    for (const a of w.toDo) out.toDo.push({ key: `${g.scope}:${a.assignmentId}`, source: g.scope, title: a.title, context: ctx(g, a.lessonTitle), state: a.state, dueAt: a.dueAt, at: null, feedback: null, route: route(g.scope, a.assignmentId) });
    for (const a of w.toReview) out.toReview.push({ key: `review:${g.scope}:${a.assignmentId}`, source: g.scope, title: a.title, context: ctx(g, a.lessonTitle), state: "awaiting_review", dueAt: null, at: null, feedback: null, waiting: a.waiting, route: route(g.scope, a.assignmentId) });
  }

  // My own latest attempt per published check in a group I still belong to.
  const { data: subs } = await db.from("p2p_group_assignment_submissions").select("assignment_id,attempt,status,feedback,submitted_at,reviewed_at").eq("user_id", userId);
  const latest = new Map<string, { assignment_id: string; attempt: number; status: string; feedback: string | null; submitted_at: string; reviewed_at: string | null }>();
  for (const s of (subs ?? []) as any[]) if (!latest.has(s.assignment_id) || latest.get(s.assignment_id)!.attempt < s.attempt) latest.set(s.assignment_id, s);
  if (!latest.size) return;
  const { data: asg } = await db.from("p2p_group_assignments").select("id,title,status,due_at,family_id,church_id,family_lesson_id,church_lesson_id").in("id", [...latest.keys()]).eq("status", "published");
  const since = Date.now() - FEEDBACK_DAYS * 86400000;
  for (const a of (asg ?? []) as any[]) {
    const scope: GroupScope = a.family_id ? "family" : "church";
    const g = byId.get(scope === "family" ? a.family_id : a.church_id);
    if (!g || g.scope !== scope) continue; // left the group: no longer shown here
    const s = latest.get(a.id)!;
    const base = { source: scope, title: a.title as string, context: g.name, dueAt: (a.due_at as string | null) ?? null, route: route(scope, a.id) };
    if (s.status === "submitted") out.awaitingReview.push({ ...base, key: `${scope}:${a.id}`, state: "awaiting_review", at: s.submitted_at, feedback: null });
    const fb = s.feedback?.trim();
    if (fb && s.status !== "submitted" && time(s.reviewed_at) >= since)
      out.feedback.push({ ...base, key: `fb:${scope}:${a.id}`, state: s.status === "returned" ? "returned" : "reviewed", at: s.reviewed_at, feedback: fb });
  }
}

export async function getLearningOverview(userId: string): Promise<LearningOverview> {
  const out: LearningOverview = { toDo: [], awaitingReview: [], feedback: [], toReview: [] };
  await coreOverview(userId, out);
  await groupOverview(userId, out);
  // Sent-back work first, then by due date (soonest), then newest.
  const urgency = (x: WorkItem) => (x.state === "revision_requested" || x.state === "returned" ? 0 : 1);
  out.toDo.sort((a, b) => urgency(a) - urgency(b) || (time(a.dueAt) || Infinity) - (time(b.dueAt) || Infinity) || newestFirst(a, b));
  out.awaitingReview.sort(newestFirst);
  out.feedback.sort(newestFirst);
  out.toReview.sort((a, b) => (b.waiting ?? 0) - (a.waiting ?? 0));
  return out;
}

