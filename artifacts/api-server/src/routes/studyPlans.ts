import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { canLeadDestination, destinationMemberIds, destinationName, displayName, groupsUserLeads, isDestinationMember, loadContent, notify, profilesById, type Destination, GROUP_DESTINATIONS } from "../lib/sharedStudy";
import { getArticles } from "../lib/referenceArticles";
import { invalidateDiscovery } from "./planDiscovery";
import { readElectives } from "../lib/planOrganiser";
import {
  COLLECTIONS, DURATIONS, EDITORIAL_FLOW, FOCUS_TYPES, PACES, addDays, durationDays, feasibility, isIsoDate, isUuid, passageDisplay,
  progressOf, resourceKinds, schedule, validateSession, type DurationKey, type Pace, type Passage, type Resource, type SessionInput,
} from "../lib/studyPlans";

// P2P PLANS (owner brief 2026-11-14; tables: migrations/249_p2p_plans.sql), mounted at /study-plans.
// One plan system that ORGANISES existing resources — Bible passages (by reference), Kingdom School lessons,
// Kingdom Stories, Scripture topics, Deep Study, commentaries, the dictionary. The resources stay the content.
//   GET    /                                   catalogue: published P2P plans + my own plans (filters: collection, focus, q)
//   GET    /mine                               my runs (active / paused / completed), my own plans, my saved plans
//   GET    /:id                                plan + sessions (+ my run, schedule and completions)
//   POST   /                                   create my own plan (the builder); editors: { official: true } = a P2P draft
//   PUT    /:id                                edit my own plan / an official DRAFT (editors); keeps session ids
//   DELETE /:id                                archive my own plan
//   POST   /:id/status                         editors: draft → under_review → approved → published → archived
//   POST   /:id/save · DELETE /:id/save         save for later (p2p_plan_saves, migration 042)
//   POST   /:id/start                          { mode, durationKey, customDays?, pace, startDate, sharedStudyId?, acceptSchedule? }
//   PATCH  /runs/:runId                        { action: pause | resume | leave } or { durationKey, customDays, pace } or { showQuestions }
//   POST   /runs/:runId/sessions/:sessionId    mark a session complete · DELETE = undo
//   Groups (2026-11-14, migration 251) — a group's plans over time; the group and its plans have separate lives:
//   GET    /groups/mine                        groups I lead (can attach a plan to), with their active plan
//   GET    /groups/:type/:id                   members: the active plan, completed plans (history), group-level counts
//   POST   /groups/:type/:id/plans             leaders: { planId, schedule?, clientKey? } attach the ACTUAL plan (one active at a time)
//   POST   /groups/:type/:id/plans/:studyId/complete   leaders: the plan is completed; the group continues
//   POST   /:id/groups                         { name, description?, schedule?, clientKey? } create a private group from this plan
// Versions (251): editing a plan that people follow never deletes a session — it is retired and the plan's
// version goes up; each run keeps the sessions it started with (required_session_ids).
// Identity always comes from the token. Completing a session is a PLAN record only: nothing here writes
// Growth Matrix evidence, and a lesson session reads the lesson's own records (which stay authoritative).
// Together = a Study Together shared study (content_type 'study_plan'); each person keeps their own run.

const router = Router();
class PlanError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }
type Plan = {
  id: string; slug: string | null; title: string; description: string | null; focus_type: string; focus_ref: Record<string, unknown>; focus_label: string;
  plan_kind: "scripture" | "structured" | "mixed"; collection: string | null; derived_from: { type: "foundations" | "curriculum"; id?: string } | null; language: string;
  origin: "p2p" | "participant"; owner_id: string | null; editorial_status: string; objectives: string[]; suggested_pace: Pace; suggested_days: number | null;
  together_suitable: boolean; submitted_by: string | null; reviewed_by: string | null; published_at: string | null; created_at: string; updated_at: string;
  // Migration 251 (absent before it is applied — every use has a fallback).
  version?: number; is_draft?: boolean; client_key?: string | null;
};
type SessionRow = { id: string; plan_id: string; position: number; title: string; intro: string | null; passages: Passage[]; primary_resource: Resource | null; supporting: Resource[]; questions: { kind: string; text: string }[]; reflection: string | null; prayer: string | null;
  added_in_version?: number; retired_at?: string | null; retired_in_version?: number | null };
type Run = { id: string; user_id: string; plan_id: string; mode: "individual" | "together"; shared_study_id: string | null; duration_key: DurationKey; target_days: number; pace: Pace;
  start_date: string; anchor_date: string; status: "active" | "paused" | "completed" | "left"; paused_at: string | null; completed_at: string | null; show_questions: boolean; created_at: string; updated_at: string;
  plan_version?: number | null; required_session_ids?: string[] | null };
/** A session as the app sees it: stored, or derived live from a curriculum's real lessons. */
type Session = { id: string; position: number; title: string; group: string | null; intro: string | null; passages: (Passage & { display: string })[]; primaryResource: (Resource & { label?: string | null }) | null;
  supporting: (Resource & { label?: string | null; display?: string })[]; questions: { kind: string; text: string }[]; reflection: string | null; prayer: string | null; derived: boolean; lessonState?: "passed" | "completed" | "open";
  /** For one person's run: retired = removed from the plan after they started (still part of THEIR run);
   *  addedLater = added after they started (optional for them, never blocks their completion). */
  retired?: boolean; addedLater?: boolean };

const today = () => new Date().toISOString().slice(0, 10);
async function caller(req: Request, res: Response): Promise<string | null> {
  const u = await verifyCaller(req);
  if (!u) { res.status(401).json({ error: "Please sign in." }); return null; }
  return u;
}
function fail(res: Response, e: unknown) {
  if (e instanceof PlanError) return res.status(e.status).json({ error: e.message, ...(e.extra ?? {}) });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205") return res.status(503).json({ error: "P2P Plans isn't available yet." });
  if (code === "23505") return res.status(409).json({ error: "That already exists." });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
async function isEditor(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "admin_content" || role === "super_admin";
}
const isLive = (p: Plan) => p.origin === "p2p" && p.editorial_status === "published";

/** Can this person take part in this shared study (host, accepted member, or member of its group)? */
async function inSharedStudy(studyId: string, userId: string, planId: string): Promise<boolean> {
  if (!isUuid(studyId)) return false;
  const { data: s } = await db.from("p2p_shared_studies").select("id,content_type,content_id,host_id,destination_type,destination_id,status").eq("id", studyId).maybeSingle();
  const st = s as { content_type: string; content_id: string; host_id: string; destination_type: Destination; destination_id: string | null; status: string } | null;
  if (!st || st.content_type !== "study_plan" || st.content_id !== planId || st.status !== "active") return false;
  if (st.host_id === userId) return true;
  const { data: m } = await db.from("p2p_shared_study_members").select("status").eq("study_id", studyId).eq("user_id", userId).maybeSingle();
  const status = (m as { status?: string } | null)?.status;
  if (status === "left") return false;
  if (st.destination_id) return isDestinationMember(st.destination_type, st.destination_id, userId);
  return status === "accepted";
}
/** Who may see a plan: anyone signed in (published P2P plan), its owner, editors, or someone following it. */
async function loadPlanFor(id: string, userId: string): Promise<{ plan: Plan; editor: boolean }> {
  if (!isUuid(id)) throw new PlanError(404, "This plan isn't available.");
  const { data, error } = await db.from("p2p_study_plans").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  const plan = data as Plan | null;
  if (!plan) throw new PlanError(404, "This plan isn't available.");
  if (isLive(plan) || plan.owner_id === userId) return { plan, editor: false };
  const editor = plan.origin === "p2p" && (await isEditor(userId));
  if (editor) return { plan, editor };
  const { data: runs } = await db.from("p2p_study_plan_enrollments").select("id,shared_study_id,status").eq("plan_id", plan.id).eq("user_id", userId);
  const mine = (runs ?? []) as { shared_study_id: string | null; status: string }[];
  if (mine.length) return { plan, editor: false };
  // Someone in an active Study Together study of this plan (e.g. a friend's own plan they were invited to).
  const { data: studies } = await db.from("p2p_shared_studies").select("id,status,destination_type,destination_id").eq("content_type", "study_plan").eq("content_id", plan.id);
  for (const s of (studies ?? []) as { id: string; status: string; destination_type: Destination; destination_id: string | null }[]) {
    if (s.status === "active" && await inSharedStudy(s.id, userId, plan.id)) return { plan, editor: false };
    // A group's completed plan stays in its history: its members can revisit it (read only).
    if (s.status === "concluded" && s.destination_id && await isDestinationMember(s.destination_type, s.destination_id, userId)) return { plan, editor: false };
  }
  throw new PlanError(404, "This plan isn't available.");
}

// ── Sessions: stored, or derived from the real lessons ─────────────────────────
async function lessonStates(userId: string, lessonIds: string[]): Promise<Map<string, "passed" | "completed">> {
  const out = new Map<string, "passed" | "completed">();
  if (!lessonIds.length) return out;
  const [{ data: ev }, { data: lp }] = await Promise.all([
    db.from("p2p_growth_evidence").select("unit_key,credit,verification,voided_at").eq("user_id", userId).eq("evidence_type", "learning.assessment_passed").in("unit_key", lessonIds.map((l) => `lesson:${l}`)),
    db.from("p2p_lesson_progress").select("lesson_id,completed").eq("user_id", userId).in("lesson_id", lessonIds),
  ]);
  for (const r of (lp ?? []) as { lesson_id: string; completed: boolean | null }[]) if (r.completed) out.set(r.lesson_id, "completed");
  // An assessment passed through an independent evaluation is the authoritative record.
  for (const r of (ev ?? []) as { unit_key: string; credit: boolean; verification: string; voided_at: string | null }[])
    if (r.credit && r.verification === "verified" && !r.voided_at) out.set(r.unit_key.slice("lesson:".length), "passed");
  return out;
}
async function derivedSessions(plan: Plan, userId: string): Promise<Session[]> {
  const d = plan.derived_from!;
  let rows: { id: string; title: string; group: string | null }[] = [];
  if (d.type === "foundations") {
    const { data } = await db.rpc("p2p_core_curriculum_progress", { p_user: userId });
    rows = ((data ?? []) as { lesson_id: string; title: string; curriculum_title: string; module_title: string }[]).map((r) => ({ id: r.lesson_id, title: r.title, group: `${r.curriculum_title} · ${r.module_title}` }));
  } else if (d.id && isUuid(d.id)) {
    const { data: mods } = await db.from("p2p_modules").select("id,title,order_index").eq("curriculum_id", d.id).order("order_index", { ascending: true });
    const ms = (mods ?? []) as { id: string; title: string }[];
    if (ms.length) {
      const { data: les } = await db.from("p2p_lessons").select("id,title,module_id,order_index,status").in("module_id", ms.map((m) => m.id)).order("order_index", { ascending: true });
      const ls = ((les ?? []) as { id: string; title: string; module_id: string; status: string | null }[]).filter((l) => (l.status ?? "published") === "published");
      // Curriculum order: module order, then lesson order inside the module.
      rows = ms.flatMap((m) => ls.filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, title: l.title, group: m.title })));
    }
  }
  const states = await lessonStates(userId, rows.map((r) => r.id));
  return rows.map((r, i) => ({ id: r.id, position: i + 1, title: r.title, group: r.group, intro: null, passages: [], primaryResource: { kind: "lesson", id: r.id, label: r.title }, supporting: [],
    questions: [], reflection: null, prayer: null, derived: true, lessonState: states.get(r.id) ?? "open" }));
}
/** Titles for referenced resources (lessons, stories, topics, curriculums) — read from their own tables. */
async function labels(resources: Resource[]): Promise<Map<string, string>> {
  const ids = (k: string) => [...new Set(resources.filter((r) => r.kind === k).map((r) => (r as { id: string }).id))];
  const slugs = [...new Set(resources.filter((r) => r.kind === "scripture_topic").map((r) => (r as { slug: string }).slug))];
  const [l, s, c, t, sc] = await Promise.all([
    ids("lesson").length ? db.from("p2p_lessons").select("id,title").in("id", ids("lesson")) : Promise.resolve({ data: [] }),
    ids("kingdom_story").length ? db.from("p2p_kingdom_stories").select("id,title,status").in("id", ids("kingdom_story")) : Promise.resolve({ data: [] }),
    ids("curriculum").length ? db.from("p2p_curriculums").select("id,title").in("id", ids("curriculum")) : Promise.resolve({ data: [] }),
    slugs.length ? db.from("p2p_prayer_topics").select("slug,title,status").in("slug", slugs) : Promise.resolve({ data: [] }),
    ids("scripture_collection").length ? db.from("p2p_scripture_collections").select("id,title,deleted_at").in("id", ids("scripture_collection")) : Promise.resolve({ data: [] }),
  ]);
  const m = new Map<string, string>();
  for (const r of (l.data ?? []) as { id: string; title: string }[]) m.set(`lesson:${r.id}`, r.title);
  for (const r of (s.data ?? []) as { id: string; title: string; status: string }[]) if (r.status === "published") m.set(`kingdom_story:${r.id}`, r.title);
  for (const r of (c.data ?? []) as { id: string; title: string }[]) m.set(`curriculum:${r.id}`, r.title);
  for (const r of (t.data ?? []) as { slug: string; title: string; status: string }[]) if (r.status === "published") m.set(`scripture_topic:${r.slug}`, r.title);
  for (const r of (sc.data ?? []) as { id: string; title: string; deleted_at: string | null }[]) if (!r.deleted_at) m.set(`scripture_collection:${r.id}`, r.title);
  const arts = resources.filter((r) => r.kind === "reference_article");
  if (arts.length) { try { const a = getArticles(); for (const r of arts) { const x = a.byId.get((r as { id: string }).id); if (x) m.set(`reference_article:${x.id}`, x.title); } } catch { /* dictionary not loaded: shown as unavailable */ } }
  return m;
}
const refKey = (r: Resource) => ("id" in r ? `${r.kind}:${r.id}` : "slug" in r ? `${r.kind}:${r.slug}` : null);
/** The plan's current sessions — or, for one person's RUN, the sessions of the version they started with:
 *  a session retired later stays in their run (with their completion); one added later is optional for them. */
async function sessionsOf(plan: Plan, userId: string, run?: Run | null): Promise<Session[]> {
  const req = Array.isArray(run?.required_session_ids) ? new Set(run!.required_session_ids) : null;
  if (plan.derived_from) {
    const ss = await derivedSessions(plan, userId);
    return req ? ss.map((x) => (req.has(x.id) ? x : { ...x, addedLater: true })) : ss;
  }
  const { data, error } = await db.from("p2p_study_plan_sessions").select("*").eq("plan_id", plan.id).order("position", { ascending: true });
  if (error) throw error;
  const rows = ((data ?? []) as SessionRow[]).filter((r) => !r.retired_at || (req && req.has(r.id)));
  const all = rows.flatMap((r) => [...(r.primary_resource ? [r.primary_resource] : []), ...(r.supporting ?? [])]);
  const names = await labels(all);
  // A referenced resource that is no longer available says so (label null) — never a broken link.
  const withLabel = (r: Resource) => {
    const k = refKey(r);
    return { ...r, label: k ? names.get(k) ?? null : null, ...("book" in r ? { display: passageDisplay(r as Passage) } : {}) };
  };
  return rows.map((r) => ({ id: r.id, position: r.position, title: r.title, group: null, intro: r.intro, passages: (r.passages ?? []).map((p) => ({ ...p, display: passageDisplay(p) })),
    primaryResource: r.primary_resource ? withLabel(r.primary_resource) : null, supporting: (r.supporting ?? []).map(withLabel), questions: r.questions ?? [], reflection: r.reflection, prayer: r.prayer, derived: false,
    ...(r.retired_at ? { retired: true } : {}), ...(req && !req.has(r.id) ? { addedLater: true } : {}) }));
}
/** What counts towards a run: everything except sessions added after the person started. */
const required = (ss: Session[]) => ss.filter((x) => !x.addedLater);
function doneSet(sessions: Session[], completions: string[]): Set<string> {
  const set = new Set(completions);
  for (const s of sessions) if (s.derived && s.lessonState && s.lessonState !== "open") set.add(s.id);
  return set;
}
function card(p: Plan, extra: Record<string, unknown> = {}) {
  return { id: p.id, slug: p.slug, version: p.version ?? 1, draft: !!p.is_draft, title: p.title, description: p.description, focusType: p.focus_type, focusLabel: p.focus_label, focusRef: p.focus_ref, kind: p.plan_kind,
    collection: p.collection, origin: p.origin, official: p.origin === "p2p", editorialStatus: p.editorial_status, language: p.language, derived: !!p.derived_from,
    suggestedPace: p.suggested_pace, suggestedDays: p.suggested_days, togetherSuitable: p.together_suitable, objectives: p.objectives ?? [], ...extra };
}
async function sessionCounts(plans: Plan[]): Promise<Map<string, { sessions: number; questions: boolean; supporting: string[] }>> {
  const ids = plans.filter((p) => !p.derived_from).map((p) => p.id);
  const out = new Map<string, { sessions: number; questions: boolean; supporting: string[] }>();
  if (!ids.length) return out;
  const { data } = await db.from("p2p_study_plan_sessions").select("plan_id,questions,supporting,passages,primary_resource").in("plan_id", ids);
  for (const r of (data ?? []) as SessionRow[]) {
    const o = out.get(r.plan_id) ?? { sessions: 0, questions: false, supporting: [] };
    o.sessions++; if ((r.questions ?? []).length) o.questions = true;
    for (const k of resourceKinds([{ passages: r.passages ?? [], primaryResource: r.primary_resource, supporting: r.supporting ?? [] }]).supporting) if (!o.supporting.includes(k)) o.supporting.push(k);
    out.set(r.plan_id, o);
  }
  return out;
}

// ── Catalogue ──────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const q = req.query as Record<string, string | undefined>;
    const [{ data: pub, error }, { data: own }] = await Promise.all([
      db.from("p2p_study_plans").select("*").eq("origin", "p2p").eq("editorial_status", "published"),
      db.from("p2p_study_plans").select("*").eq("owner_id", userId).eq("editorial_status", "draft"),
    ]);
    if (error) throw error;
    let plans = [...((pub ?? []) as Plan[]), ...((own ?? []) as Plan[])];
    if (q.collection && (COLLECTIONS as readonly string[]).includes(q.collection)) plans = plans.filter((p) => p.collection === q.collection);
    if (q.focus && (FOCUS_TYPES as readonly string[]).includes(q.focus)) plans = plans.filter((p) => p.focus_type === q.focus);
    const words = String(q.q ?? "").toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length) plans = plans.filter((p) => { const hay = `${p.title} ${p.description ?? ""} ${p.focus_label}`.toLowerCase().replace(/['’]/g, ""); return words.every((w) => hay.includes(w)); });
    const counts = await sessionCounts(plans);
    const { data: saves } = await db.from("p2p_plan_saves").select("plan_id").eq("user_id", userId);
    const saved = new Set(((saves ?? []) as { plan_id: string }[]).map((s) => s.plan_id));
    plans.sort((a, b) => (a.origin === b.origin ? a.title.localeCompare(b.title) : a.origin === "p2p" ? -1 : 1));
    return res.json({ plans: plans.map((p) => card(p, { sessionCount: p.derived_from ? null : counts.get(p.id)?.sessions ?? 0, questionsIncluded: counts.get(p.id)?.questions ?? false,
      supportingKinds: counts.get(p.id)?.supporting ?? [], saved: saved.has(p.id) })) });
  } catch (e) { return fail(res, e); }
});

router.get("/mine", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { data: runRows, error } = await db.from("p2p_study_plan_enrollments").select("*").eq("user_id", userId).order("updated_at", { ascending: false });
    if (error) throw error;
    const runs = ((runRows ?? []) as Run[]).filter((r) => r.status !== "left");
    const planIds = [...new Set(runs.map((r) => r.plan_id))];
    const [{ data: planRows }, { data: own }, { data: saves }] = await Promise.all([
      planIds.length ? db.from("p2p_study_plans").select("*").in("id", planIds) : Promise.resolve({ data: [] }),
      db.from("p2p_study_plans").select("*").eq("owner_id", userId).eq("editorial_status", "draft"),
      db.from("p2p_plan_saves").select("plan_id,saved_at").eq("user_id", userId),
    ]);
    const plans = new Map(((planRows ?? []) as Plan[]).map((p) => [p.id, p]));
    // Which group each "together" run belongs to (name only — never other members' progress).
    const studyIds = [...new Set(runs.map((r) => r.shared_study_id).filter(Boolean) as string[])];
    const { data: studyRows } = studyIds.length ? await db.from("p2p_shared_studies").select("id,destination_type,destination_id,status").in("id", studyIds) : { data: [] };
    const groupOf = new Map<string, { type: Destination; id: string; name: string | null } | null>();
    for (const st of (studyRows ?? []) as { id: string; destination_type: Destination; destination_id: string | null }[])
      groupOf.set(st.id, st.destination_id ? { type: st.destination_type, id: st.destination_id, name: await destinationName(st.destination_type, st.destination_id) } : null);
    const items = [];
    for (const r of runs) {
      const p = plans.get(r.plan_id);
      if (!p) continue;
      const sessions = required(await sessionsOf(p, userId, r));
      const { data: comp } = await db.from("p2p_study_plan_completions").select("session_id").eq("enrollment_id", r.id);
      const done = doneSet(sessions, ((comp ?? []) as { session_id: string }[]).map((c) => c.session_id));
      const prog = progressOf(sessions, done);
      const sched = schedule(sessions, done, { anchor: r.anchor_date, days: r.target_days, pace: r.pace });
      const cur = sessions.find((s) => s.id === prog.currentId), nxt = sessions.find((s) => s.id === prog.nextId);
      items.push({ run: runOut(r), plan: card(p), progress: { completed: prog.completed, total: prog.total, finished: prog.finished }, group: r.shared_study_id ? groupOf.get(r.shared_study_id) ?? null : null,
        current: cur ? { id: cur.id, title: cur.title, position: cur.position, dueDate: sched.find((x) => x.id === cur.id)?.dueDate ?? null } : null,
        next: nxt ? { id: nxt.id, title: nxt.title, position: nxt.position, dueDate: sched.find((x) => x.id === nxt.id)?.dueDate ?? null } : null });
    }
    const savedIds = ((saves ?? []) as { plan_id: string }[]).map((s) => s.plan_id);
    const { data: savedPlans } = savedIds.length ? await db.from("p2p_study_plans").select("*").in("id", savedIds) : { data: [] };
    return res.json({
      active: items.filter((i) => i.run.status === "active" && !i.progress.finished),
      paused: items.filter((i) => i.run.status === "paused"),
      completed: items.filter((i) => i.run.status === "completed" || (i.run.status === "active" && i.progress.finished)),
      created: ((own ?? []) as Plan[]).filter((p) => !p.is_draft).map((p) => card(p)),
      drafts: ((own ?? []) as Plan[]).filter((p) => p.is_draft).map((p) => card(p)),
      saved: ((savedPlans ?? []) as Plan[]).filter((p) => isLive(p) || p.owner_id === userId).map((p) => card(p)),
    });
  } catch (e) { return fail(res, e); }
});
function runOut(r: Run) {
  return { id: r.id, planId: r.plan_id, mode: r.mode, sharedStudyId: r.shared_study_id, durationKey: r.duration_key, targetDays: r.target_days, pace: r.pace,
    startDate: r.start_date, anchorDate: r.anchor_date, status: r.status, pausedAt: r.paused_at, completedAt: r.completed_at, showQuestions: r.show_questions };
}
async function currentRun(planId: string, userId: string): Promise<Run | null> {
  const { data } = await db.from("p2p_study_plan_enrollments").select("*").eq("plan_id", planId).eq("user_id", userId).in("status", ["active", "paused"]).maybeSingle();
  return (data as Run) ?? null;
}

// Plan-scoped elective access (owner brief 2026-11-19 §5): may THIS person open THIS lesson out of its curriculum's
// order? Only when it's an elective of an organised plan they follow (active, paused or completed). Kingdom School's
// own sequence, prerequisites and curriculum-wide rules are untouched — this answers for one lesson, one plan.
router.get("/electives/:lessonId", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const lessonId = String(req.params.lessonId);
    if (!isUuid(lessonId)) return res.json({ allowed: false });
    const { data: runs } = await db.from("p2p_study_plan_enrollments").select("plan_id,status").eq("user_id", userId).in("status", ["active", "paused", "completed"]);
    const planIds = [...new Set(((runs ?? []) as { plan_id: string }[]).map((r) => r.plan_id))];
    if (!planIds.length) return res.json({ allowed: false });
    const { data: plans } = await db.from("p2p_study_plans").select("id,title,focus_ref").in("id", planIds);
    const hit = ((plans ?? []) as { id: string; title: string; focus_ref: Record<string, unknown> | null }[])
      .find((pl) => pl.focus_ref?.organised === true && Array.isArray(pl.focus_ref.electives) && (pl.focus_ref.electives as unknown[]).includes(lessonId));
    return res.json(hit ? { allowed: true, planId: hit.id, planTitle: hit.title } : { allowed: false });
  } catch (e) { return fail(res, e); }
});

router.get("/:id", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan, editor } = await loadPlanFor(String(req.params.id), userId);
    const run = await currentRun(plan.id, userId) ?? (await (async () => {
      const { data } = await db.from("p2p_study_plan_enrollments").select("*").eq("plan_id", plan.id).eq("user_id", userId).eq("status", "completed").order("completed_at", { ascending: false }).limit(1);
      return ((data ?? []) as Run[])[0] ?? null;
    })());
    // With a run: the sessions of the version the person started with (see sessionsOf).
    const sessions = await sessionsOf(plan, userId, run);
    let mine = null;
    if (run) {
      const { data: comp } = await db.from("p2p_study_plan_completions").select("session_id,completed_at").eq("enrollment_id", run.id);
      const c = (comp ?? []) as { session_id: string; completed_at: string }[];
      const req = required(sessions);
      const done = doneSet(req, c.map((x) => x.session_id));
      const sched = schedule(req, done, { anchor: run.anchor_date, days: run.target_days, pace: run.pace });
      mine = { run: runOut(run), progress: progressOf(req, done), schedule: sched, completedAt: Object.fromEntries(c.map((x) => [x.session_id, x.completed_at])) };
    }
    const kinds = resourceKinds(sessions.map((s) => ({ passages: s.passages, primaryResource: s.primaryResource, supporting: s.supporting })));
    const { data: sv } = await db.from("p2p_plan_saves").select("plan_id").eq("user_id", userId).eq("plan_id", plan.id).maybeSingle();
    return res.json({
      plan: card(plan, { sessionCount: sessions.filter((x) => !x.retired).length, questionsIncluded: sessions.some((s) => s.questions.length), primaryKinds: kinds.primary, supportingKinds: kinds.supporting,
        saved: !!sv, mine: plan.owner_id === userId, canEdit: plan.owner_id === userId ? plan.editorial_status === "draft" : editor && plan.editorial_status === "draft", editor }),
      sessions, me: mine,
      note: "Completing a session is your own plan record. It never awards Growth Matrix credit; lessons count only through their own assessment.",
    });
  } catch (e) { return fail(res, e); }
});

// ── Create / edit (builder; editors for official drafts) ─────────────────────────
/** A plan that follows a curriculum's real lessons: all of Core Foundations, or one course. */
function readDerived(v: unknown): { type: "foundations" } | { type: "curriculum"; id: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type === "foundations") return { type: "foundations" };
  if (o.type === "curriculum" && isUuid(o.id)) return { type: "curriculum", id: o.id };
  throw new PlanError(400, "Choose the curriculum this plan follows.");
}
function readPlanBody(b: Record<string, unknown>, opts: { allowEmpty?: boolean } = {}) {
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 200) throw new PlanError(400, "Give the plan a title.");
  const focusType = String(b.focusType ?? "");
  if (!(FOCUS_TYPES as readonly string[]).includes(focusType)) throw new PlanError(400, "Choose the plan's main focus.");
  const focusLabel = typeof b.focusLabel === "string" && b.focusLabel.trim() ? b.focusLabel.trim().slice(0, 200) : title;
  const focusRef = b.focusRef && typeof b.focusRef === "object" && !Array.isArray(b.focusRef) ? b.focusRef as Record<string, unknown> : {};
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 2000) : null;
  const pace = (PACES as readonly string[]).includes(String(b.suggestedPace)) ? b.suggestedPace as Pace : "daily";
  const days = Number.isInteger(b.suggestedDays) && (b.suggestedDays as number) > 0 && (b.suggestedDays as number) <= 3660 ? b.suggestedDays as number : null;
  const raw = Array.isArray(b.sessions) ? b.sessions : [];
  const derivedFrom = readDerived(b.derivedFrom);
  // A curriculum plan's sessions ARE the curriculum's lessons (read live); nothing is copied into the plan.
  if (derivedFrom && raw.length) throw new PlanError(400, "A plan that follows a curriculum takes its sessions from the curriculum.");
  if (!derivedFrom && !raw.length && !opts.allowEmpty) throw new PlanError(400, "Add at least one session.");
  if (raw.length > 400) throw new PlanError(400, "A plan can have up to 400 sessions.");
  const sessions: (SessionInput & { id?: string })[] = raw.map((s) => {
    const v = validateSession(s);
    if (!v.ok) throw new PlanError(400, v.error);
    const id = (s as { id?: unknown }).id;
    return { ...v.value, ...(isUuid(id) ? { id } : {}) };
  });
  // One main focus: supporting resources enrich it, they never replace it. A session made only of
  // supporting material has nothing of the plan's focus to study.
  const scripture = sessions.every((s) => s.passages.length && !s.primaryResource), structured = sessions.every((s) => !s.passages.length && s.primaryResource);
  const objectives = Array.isArray(b.objectives) ? b.objectives.filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => o.trim().slice(0, 300)).slice(0, 8) : [];
  const collection = (COLLECTIONS as readonly string[]).includes(String(b.collection)) ? String(b.collection) : null;
  return { title, focusType, focusLabel, focusRef, description, pace, days, sessions, kind: derivedFrom ? "structured" : scripture ? "scripture" : structured ? "structured" : "mixed", objectives, collection, derivedFrom };
}
// ── Organised plans (owner brief 2026-11-19) ──
// A plan prepared by the Learning Plan organiser carries, in focus_ref: organised, question, electives (lessons this
// plan may open out of their curriculum's order — ONLY lessons the signed proposal offered AND still in the plan),
// and its Study Deeper lineage (deeperOf, root, depth). A participant can't write any of these themselves.
const ORGANISER_KEYS = ["organised", "question", "electives", "deeperOf", "root", "depth"] as const;
const lessonIdsOf = (sessions: SessionInput[]) => [...new Set(sessions.flatMap((x) => [x.primaryResource, ...x.supporting]).filter((r): r is Resource => !!r && r.kind === "lesson").map((r) => (r as { id: string }).id))];
async function organiserRef(b: Record<string, unknown>, userId: string, sessions: SessionInput[], focusRef: Record<string, unknown>, previous?: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const ref: Record<string, unknown> = { ...focusRef };
  for (const k of ORGANISER_KEYS) delete ref[k];
  const inPlan = new Set(lessonIdsOf(sessions));
  const prevElectives = Array.isArray(previous?.electives) ? (previous!.electives as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (previous?.organised === true) for (const k of ORGANISER_KEYS) if (previous[k] !== undefined) ref[k] = previous[k];
  const org = b.organiser as { token?: unknown; question?: unknown; deeperOf?: unknown } | undefined;
  if (org && typeof org === "object") {
    ref.organised = true;
    if (typeof org.question === "string" && org.question.trim()) ref.question = org.question.trim().slice(0, 200);
    const offered = new Set(readElectives(org.token, userId));
    ref.electives = [...new Set([...prevElectives, ...offered])].filter((id) => inPlan.has(id));
    if (org.deeperOf != null && org.deeperOf !== "" && ref.deeperOf === undefined) {
      if (!isUuid(org.deeperOf)) throw new PlanError(400, "That plan isn't available.");
      const { data: parent } = await db.from("p2p_study_plans").select("id,owner_id,focus_ref").eq("id", org.deeperOf).maybeSingle();
      const par = parent as { id: string; owner_id: string | null; focus_ref: Record<string, unknown> | null } | null;
      const { data: done } = await db.from("p2p_study_plan_enrollments").select("id").eq("plan_id", org.deeperOf).eq("user_id", userId).eq("status", "completed").limit(1);
      if (!par || !((done ?? []) as unknown[]).length) throw new PlanError(409, "Study Deeper opens when you've completed the whole plan.");
      const pr = par.focus_ref ?? {};
      ref.deeperOf = par.id; ref.root = typeof pr.root === "string" && isUuid(pr.root) ? pr.root : par.id; ref.depth = (Number(pr.depth) || 0) + 1;
    }
  } else if (previous?.organised === true) ref.electives = prevElectives.filter((id) => inPlan.has(id));
  return ref;
}
/** Referenced lessons, stories, curriculums and topics must exist and be published. */
async function checkReferences(sessions: SessionInput[]) {
  const all = sessions.flatMap((s) => [...(s.primaryResource ? [s.primaryResource] : []), ...s.supporting]);
  const names = await labels(all);
  const missing = all.find((r) => { const k = refKey(r); return k && r.kind !== "lesson" && r.kind !== "curriculum" ? !names.has(k) : false; });
  if (missing) throw new PlanError(400, "One of the resources you chose isn't available.");
  const lessonIds = [...new Set(all.filter((r) => r.kind === "lesson").map((r) => (r as { id: string }).id))];
  if (lessonIds.length) {
    const { data } = await db.from("p2p_lessons").select("id,status").in("id", lessonIds);
    const ok = new Set(((data ?? []) as { id: string; status: string | null }[]).filter((l) => (l.status ?? "published") === "published").map((l) => l.id));
    if (lessonIds.some((l) => !ok.has(l))) throw new PlanError(400, "One of the lessons you chose isn't available.");
  }
}
type Changes = { added: string[]; retired: string[]; edited: string[] };
const noColumn = (e: unknown) => ["42703", "PGRST204", "42P01", "PGRST205"].includes(String((e as { code?: string } | null)?.code ?? ""));
async function writeSessions(planId: string, sessions: (SessionInput & { id?: string })[], replace: boolean, version = 1): Promise<Changes> {
  const row = (s: SessionInput, i: number) => ({ plan_id: planId, position: i + 1, title: s.title, intro: s.intro, passages: s.passages, primary_resource: s.primaryResource, supporting: s.supporting,
    questions: s.questions, reflection: s.reflection, prayer: s.prayer, updated_at: new Date().toISOString() });
  const changes: Changes = { added: [], retired: [], edited: [] };
  if (!replace) {
    if (!sessions.length) return changes;
    const { data, error } = await db.from("p2p_study_plan_sessions").insert(sessions.map(row)).select("id");
    if (error) throw error;
    changes.added = ((data ?? []) as { id: string }[]).map((r) => r.id);
    return changes;
  }
  // Editing keeps each session's id. A session left out is RETIRED, never deleted: anyone who completed it keeps
  // that completion, and runs that started with it keep it (migration 251).
  const { data: existing } = await db.from("p2p_study_plan_sessions").select("*").eq("plan_id", planId);
  const current = ((existing ?? []) as SessionRow[]).filter((r) => !r.retired_at);
  const keep = new Set(sessions.map((s) => s.id).filter(Boolean) as string[]);
  const gone = current.map((r) => r.id).filter((id) => !keep.has(id));
  if (gone.length) {
    const { error } = await db.from("p2p_study_plan_sessions").update({ retired_at: new Date().toISOString(), retired_in_version: version }).in("id", gone).eq("plan_id", planId);
    if (error) { if (noColumn(error)) throw new PlanError(409, "Removing sessions needs the latest P2P update. You can still edit or add sessions."); throw error; }
    changes.retired = gone;
  }
  const same = (r: SessionRow, s: SessionInput) => JSON.stringify([r.title, r.intro, r.passages, r.primary_resource, r.supporting ?? [], r.questions ?? [], r.reflection, r.prayer])
    === JSON.stringify([s.title, s.intro, s.passages, s.primaryResource, s.supporting, s.questions, s.reflection, s.prayer]);
  // Move kept sessions out of the way first (positions are unique among a plan's current sessions).
  for (const [i, s] of sessions.entries()) if (s.id) await db.from("p2p_study_plan_sessions").update({ position: 1000 - i }).eq("id", s.id).eq("plan_id", planId);
  for (const [i, s] of sessions.entries()) {
    const was = s.id ? current.find((r) => r.id === s.id) : undefined;
    if (s.id && was) {
      const { error } = await db.from("p2p_study_plan_sessions").update(row(s, i)).eq("id", s.id).eq("plan_id", planId);
      if (error) throw error;
      if (!same(was, s)) changes.edited.push(s.id);
    } else {
      const ins = { ...row(s, i), ...(version > 1 ? { added_in_version: version } : {}) };
      let { data, error } = await db.from("p2p_study_plan_sessions").insert(ins).select("id").single();
      if (error && noColumn(error)) ({ data, error } = await db.from("p2p_study_plan_sessions").insert(row(s, i)).select("id").single());
      if (error) throw error;
      changes.added.push((data as { id: string }).id);
    }
  }
  return changes;
}
/** Plans tables before / after 251: insert with the new columns, or without them when they don't exist yet. */
async function insertTolerant(table: string, full: Record<string, unknown>, newCols: string[]) {
  let r = await db.from(table).insert(full).select("*").single();
  if (r.error && noColumn(r.error)) {
    const base = Object.fromEntries(Object.entries(full).filter(([k]) => !newCols.includes(k)));
    r = await db.from(table).insert(base).select("*").single();
  }
  return r;
}
const clientKeyOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v) ? v : null);

router.post("/", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const official = b.official === true;
    if (official && !(await isEditor(userId))) throw new PlanError(403, "Only content editors can create P2P plans.");
    const isDraft = b.draft === true;
    if (official && isDraft) throw new PlanError(400, "Official plans use the editorial workflow instead of drafts.");
    // The same request sent twice (double tap, retry after a dropped connection) returns the plan already made.
    const clientKey = clientKeyOf(b.clientKey);
    if (clientKey) {
      const { data: had, error: hadErr } = await db.from("p2p_study_plans").select("id").eq("created_by", userId).eq("client_key", clientKey).maybeSingle();
      if (!hadErr && had) return res.json({ id: (had as { id: string }).id, existing: true });
    }
    const p = readPlanBody(b, { allowEmpty: isDraft });
    await checkReferences(p.sessions);
    p.focusRef = await organiserRef(b, userId, p.sessions, p.focusRef, null);
    if (p.derivedFrom?.type === "curriculum") {
      const { data: cur } = await db.from("p2p_curriculums").select("id,status,type").eq("id", p.derivedFrom.id).maybeSingle();
      const c = cur as { status: string; type: string } | null;
      if (!c || c.status !== "published" || (c.type !== "plan" && c.type !== "core")) throw new PlanError(400, "That course isn't available.");
    }
    if (!official) {
      const { data: mine } = await db.from("p2p_study_plans").select("id").eq("owner_id", userId).eq("editorial_status", "draft");
      if (((mine ?? []) as unknown[]).length >= 50) throw new PlanError(409, "You have 50 plans. Archive one to create another.");
    }
    const row = {
      title: p.title, description: p.description, focus_type: p.focusType, focus_ref: p.focusRef, focus_label: p.focusLabel, plan_kind: p.kind,
      collection: official ? p.collection : null, origin: official ? "p2p" : "participant", owner_id: official ? null : userId, editorial_status: "draft",
      objectives: p.objectives, suggested_pace: p.pace, suggested_days: p.days, created_by: userId, derived_from: p.derivedFrom,
      ...(isDraft ? { is_draft: true } : {}), ...(clientKey ? { client_key: clientKey } : {}),
    };
    const { data: plan, error } = isDraft ? await db.from("p2p_study_plans").insert(row).select("*").single() : await insertTolerant("p2p_study_plans", row, ["client_key"]);
    if (error) {
      if (isDraft && noColumn(error)) throw new PlanError(503, "Saving drafts needs the latest P2P update.");
      if ((error as { code?: string }).code === "23505" && clientKey) {
        const { data: had } = await db.from("p2p_study_plans").select("id").eq("created_by", userId).eq("client_key", clientKey).maybeSingle();
        if (had) return res.json({ id: (had as { id: string }).id, existing: true });
      }
      throw error;
    }
    await writeSessions((plan as Plan).id, p.sessions, false);
    return res.status(201).json({ id: (plan as Plan).id });
  } catch (e) { return fail(res, e); }
});

router.put("/:id", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan, editor } = await loadPlanFor(String(req.params.id), userId);
    const mine = plan.owner_id === userId;
    if (!(mine || editor)) throw new PlanError(403, "You can only edit your own plans.");
    if (plan.editorial_status !== "draft") throw new PlanError(409, "Only a draft can be edited. Move it back to draft first.");
    if (plan.derived_from) throw new PlanError(409, "This plan follows its curriculum; its sessions can't be edited here.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    // A builder draft can be saved incomplete; "draft: false" finishes it (then it needs at least one session).
    const isDraft = typeof body.draft === "boolean" && mine ? body.draft : !!plan.is_draft;
    const p = readPlanBody(body, { allowEmpty: isDraft });
    if (p.derivedFrom) throw new PlanError(409, "This plan's sessions can't be replaced by a curriculum. Create a new plan instead.");
    await checkReferences(p.sessions);
    p.focusRef = await organiserRef(body, userId, p.sessions, p.focusRef, plan.focus_ref);
    // A new VERSION only once someone follows the plan (a draft being written isn't history yet).
    const { data: anyRun } = await db.from("p2p_study_plan_enrollments").select("id").eq("plan_id", plan.id).limit(1);
    const followed = ((anyRun ?? []) as unknown[]).length > 0;
    const next = followed ? (plan.version ?? 1) + 1 : plan.version ?? 1;
    const changes = await writeSessions(plan.id, p.sessions, true, next);
    const changed = followed && changes.added.length + changes.retired.length + changes.edited.length > 0;
    const patch: Record<string, unknown> = { title: p.title, description: p.description, focus_type: p.focusType, focus_ref: p.focusRef, focus_label: p.focusLabel,
      plan_kind: p.kind, objectives: p.objectives, suggested_pace: p.pace, suggested_days: p.days, ...(editor ? { collection: p.collection } : {}), updated_at: new Date().toISOString() };
    if (plan.is_draft !== undefined) patch.is_draft = isDraft;
    // A significant change is recorded, so earlier progress stays understandable (251).
    if (changed && plan.version !== undefined) {
      patch.version = next;
      const { data: now } = await db.from("p2p_study_plan_sessions").select("id,position,title,retired_at").eq("plan_id", plan.id);
      await db.from("p2p_study_plan_versions").insert({ plan_id: plan.id, version: next, changed_by: userId, changes,
        sessions: ((now ?? []) as { id: string; position: number; title: string; retired_at: string | null }[]).filter((x) => !x.retired_at).sort((a, b) => a.position - b.position).map(({ id, position, title }) => ({ id, position, title })) });
    }
    const { error } = await db.from("p2p_study_plans").update(patch).eq("id", plan.id);
    if (error) throw error;
    return res.json({ id: plan.id, version: patch.version ?? plan.version ?? 1, changes });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan } = await loadPlanFor(String(req.params.id), userId);
    if (plan.owner_id !== userId) throw new PlanError(403, "You can only archive your own plans.");
    await db.from("p2p_study_plans").update({ editorial_status: "archived", updated_at: new Date().toISOString() }).eq("id", plan.id);
    return res.json({ archived: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/status", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new PlanError(403, "Only content editors can change a P2P plan's status.");
    const { plan } = await loadPlanFor(String(req.params.id), userId);
    if (plan.origin !== "p2p") throw new PlanError(409, "A participant's plan is never published as P2P curriculum.");
    const to = String((req.body ?? {}).to ?? "");
    if (!(EDITORIAL_FLOW[plan.editorial_status] ?? []).includes(to)) throw new PlanError(409, `A plan can't move from ${plan.editorial_status} to ${to || "that status"}.`);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { editorial_status: to, updated_at: now };
    if (to === "under_review") Object.assign(patch, { submitted_by: userId, reviewed_by: null, reviewed_at: null });
    if (to === "approved") {
      if (!plan.submitted_by || plan.submitted_by === userId) throw new PlanError(409, "Another editor must approve this plan (not the person who submitted it).");
      Object.assign(patch, { reviewed_by: userId, reviewed_at: now });
    }
    if (to === "published") Object.assign(patch, { published_at: now });
    if (to === "draft") Object.assign(patch, { reviewed_by: null, reviewed_at: null });
    const { error } = await db.from("p2p_study_plans").update(patch).eq("id", plan.id);
    if (error) throw error;
    invalidateDiscovery();
    return res.json({ id: plan.id, status: to });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/save", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan } = await loadPlanFor(String(req.params.id), userId);
    const { data } = await db.from("p2p_plan_saves").select("plan_id").eq("user_id", userId).eq("plan_id", plan.id).maybeSingle();
    if (!data) await db.from("p2p_plan_saves").insert({ user_id: userId, plan_id: plan.id });
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});
router.delete("/:id/save", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    if (!isUuid(req.params.id)) throw new PlanError(404, "This plan isn't available.");
    await db.from("p2p_plan_saves").delete().eq("user_id", userId).eq("plan_id", String(req.params.id));
    return res.json({ saved: false });
  } catch (e) { return fail(res, e); }
});

// ── Following a plan ───────────────────────────────────────────────────────────
function readSchedule(b: Record<string, unknown>, sessions: number, anchor: string) {
  const durationKey = String(b.durationKey ?? "") as DurationKey;
  const pace = String(b.pace ?? "") as Pace;
  if (!(DURATIONS as readonly string[]).includes(durationKey)) throw new PlanError(400, "Choose how long you'd like to take.");
  if (!(PACES as readonly string[]).includes(pace)) throw new PlanError(400, "Choose a schedule.");
  const days = durationDays(durationKey, sessions, pace, b.customDays as number, anchor);
  if (!days) throw new PlanError(400, "Choose a number of days between 1 and 3,660.");
  const f = feasibility(sessions, days, pace, anchor);
  // Too many sessions per study day: explain and suggest a schedule, unless the person chose it knowingly.
  if (!f.ok && b.acceptSchedule !== true) throw new PlanError(422, `That would be ${f.perDay} sessions on each study day. A longer plan would be easier to keep.`, { perDay: f.perDay, suggestion: f.suggestion });
  return { durationKey, pace, days, feasibility: f };
}

/** A member of a group may follow the group's plan even when it is someone else's own plan. */
async function followsInGroup(planId: string, userId: string, studyId: unknown): Promise<boolean> {
  return typeof studyId === "string" && (await inSharedStudy(studyId, userId, planId));
}

router.post("/:id/start", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan } = await loadPlanFor(String(req.params.id), userId);
    if (!(isLive(plan) || plan.owner_id === userId || await followsInGroup(plan.id, userId, (req.body ?? {}).sharedStudyId))) throw new PlanError(409, "This plan isn't published yet.");
    if (plan.is_draft) throw new PlanError(409, "Finish this plan before starting it.");
    let b = (req.body ?? {}) as Record<string, unknown>;
    const existing = await currentRun(plan.id, userId);
    if (existing) throw new PlanError(409, "You're already following this plan.", { runId: existing.id });
    const mode = b.mode === "together" ? "together" : "individual";
    const askedDate = b.startDate === undefined ? today() : b.startDate;
    if (!isIsoDate(askedDate)) throw new PlanError(400, "Choose a start date.");
    let startDate: string = askedDate;
    if (startDate < addDays(today(), -1) || startDate > addDays(today(), 366)) throw new PlanError(400, "Choose a start date from today up to a year ahead.");
    let shared: string | null = null;
    if (mode === "together") {
      shared = String(b.sharedStudyId ?? "");
      // Together reuses Study Together: the person must already take part in that shared study of THIS plan.
      if (!(await inSharedStudy(shared, userId, plan.id))) throw new PlanError(403, "Join the Study Together study of this plan first.");
      // The group's own schedule is the default; each person may still choose their own.
      if (b.durationKey === undefined) {
        const { data: st } = await db.from("p2p_shared_studies").select("*").eq("id", shared).maybeSingle();
        const gs = (st as { plan_schedule?: Record<string, unknown> | null } | null)?.plan_schedule;
        if (gs) b = { ...b, durationKey: gs.durationKey, pace: b.pace ?? gs.pace, customDays: b.customDays ?? gs.customDays };
        if (gs && b.startDate === undefined && isIsoDate(gs.startDate) && gs.startDate >= today() && gs.startDate <= addDays(today(), 366)) startDate = gs.startDate;
      }
    }
    const sessions = await sessionsOf(plan, userId);
    if (!sessions.length) throw new PlanError(409, "This plan has no sessions yet.");
    const s = readSchedule(b, sessions.length, startDate);
    // What was required when the person started (251): later edits to the plan never change THIS run's finish line.
    const { data, error } = await insertTolerant("p2p_study_plan_enrollments", { user_id: userId, plan_id: plan.id, mode, shared_study_id: shared, duration_key: s.durationKey,
      target_days: s.days, pace: s.pace, start_date: startDate, anchor_date: startDate, status: "active", plan_version: plan.version ?? 1, required_session_ids: sessions.map((x) => x.id) },
      ["plan_version", "required_session_ids"]);
    if (error) { if ((error as { code?: string }).code === "23505") throw new PlanError(409, "You're already following this plan."); throw error; }
    return res.status(201).json({ run: runOut(data as Run), perDay: s.feasibility.perDay });
  } catch (e) { return fail(res, e); }
});

async function myRun(runId: string, userId: string): Promise<Run> {
  if (!isUuid(runId)) throw new PlanError(404, "This plan run isn't available.");
  const { data } = await db.from("p2p_study_plan_enrollments").select("*").eq("id", runId).maybeSingle();
  const r = data as Run | null;
  // Only the person's own run — someone else's progress is never visible or changeable.
  if (!r || r.user_id !== userId) throw new PlanError(404, "This plan run isn't available.");
  return r;
}

router.patch("/runs/:runId", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const r = await myRun(String(req.params.runId), userId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    let patch: Record<string, unknown> = { updated_at: now };
    if (typeof b.showQuestions === "boolean") patch.show_questions = b.showQuestions; // a display preference only
    if (b.action === "pause") { if (r.status !== "active") throw new PlanError(409, "Only an active plan can be paused."); patch = { ...patch, status: "paused", paused_at: now }; }
    else if (b.action === "resume") {
      if (r.status !== "paused") throw new PlanError(409, "This plan isn't paused.");
      // Resuming lays the remaining sessions out from today; nothing done is lost.
      patch = { ...patch, status: "active", paused_at: null, anchor_date: today() };
    } else if (b.action === "leave") { if (r.status === "left") throw new PlanError(409, "You've already left this plan."); patch = { ...patch, status: "left", left_at: now }; }
    else if (b.durationKey !== undefined || b.pace !== undefined) {
      if (r.status === "left" || r.status === "completed") throw new PlanError(409, "This plan has finished.");
      const { plan } = await loadPlanFor(r.plan_id, userId);
      const sessions = required(await sessionsOf(plan, userId, r));
      const { data: comp } = await db.from("p2p_study_plan_completions").select("session_id").eq("enrollment_id", r.id);
      const remaining = sessions.length - doneSet(sessions, ((comp ?? []) as { session_id: string }[]).map((c) => c.session_id)).size;
      const s = readSchedule(b, Math.max(1, remaining), today());
      // Changing the schedule re-plans what's left from today. It never changes the plan's content.
      patch = { ...patch, duration_key: s.durationKey, pace: s.pace, target_days: s.days, anchor_date: today() };
    } else if (typeof b.showQuestions !== "boolean") throw new PlanError(400, "Nothing to change.");
    const { data, error } = await db.from("p2p_study_plan_enrollments").update(patch).eq("id", r.id).select("*").single();
    if (error) throw error;
    return res.json({ run: runOut(data as Run) });
  } catch (e) { return fail(res, e); }
});

async function sessionAction(req: Request, res: Response, complete: boolean) {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const r = await myRun(String(req.params.runId), userId);
    if (r.status === "left") throw new PlanError(409, "You've left this plan.");
    if (r.status === "paused") throw new PlanError(409, "Resume the plan to continue.");
    const { plan } = await loadPlanFor(r.plan_id, userId);
    const sid = String(req.params.sessionId);
    const all = await sessionsOf(plan, userId, r);
    const sessions = required(all);
    const s = all.find((x) => x.id === sid);
    if (!s) throw new PlanError(404, "That session isn't part of this plan.");
    if (s.derived) throw new PlanError(409, "This session is complete when its lesson is complete — finish the lesson itself.");
    if (complete) {
      const { data: had } = await db.from("p2p_study_plan_completions").select("id").eq("enrollment_id", r.id).eq("session_id", sid).maybeSingle();
      if (!had) { const { error } = await db.from("p2p_study_plan_completions").insert({ enrollment_id: r.id, plan_id: plan.id, session_id: sid }); if (error && (error as { code?: string }).code !== "23505") throw error; }
    } else await db.from("p2p_study_plan_completions").delete().eq("enrollment_id", r.id).eq("session_id", sid);
    const { data: comp } = await db.from("p2p_study_plan_completions").select("session_id").eq("enrollment_id", r.id);
    const prog = progressOf(sessions, doneSet(sessions, ((comp ?? []) as { session_id: string }[]).map((c) => c.session_id)));
    const now = new Date().toISOString();
    if (prog.finished && r.status !== "completed") await db.from("p2p_study_plan_enrollments").update({ status: "completed", completed_at: now, updated_at: now }).eq("id", r.id);
    if (!prog.finished && r.status === "completed") await db.from("p2p_study_plan_enrollments").update({ status: "active", completed_at: null, updated_at: now }).eq("id", r.id);
    return res.json({ progress: prog });
  } catch (e) { return fail(res, e); }
}
router.post("/runs/:runId/sessions/:sessionId", (req, res) => sessionAction(req, res, true));
router.delete("/runs/:runId/sessions/:sessionId", (req, res) => sessionAction(req, res, false));

// ── Groups: a group's plans over time ───────────────────────────────────────────
// The group and the plan have separate lives. A group (Family, Church, Circle, group, private group) has at
// most ONE active plan; completing it moves it to the group's history and the group carries on. Each member's
// progress is their own run; the group sees counts only (how many started / finished), never who or what.
type StudyRow = { id: string; content_type: string; content_id: string; title: string; host_id: string; destination_type: Destination; destination_id: string | null;
  status: "active" | "concluded"; created_at: string; concluded_at: string | null; plan_schedule?: Record<string, unknown> | null; completed_by?: string | null };
const isGroupType = (v: unknown): v is Destination => (GROUP_DESTINATIONS as readonly string[]).includes(String(v));
function readGroupSchedule(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new PlanError(400, "Choose the group's schedule.");
  const o = v as Record<string, unknown>;
  if (!(DURATIONS as readonly string[]).includes(String(o.durationKey))) throw new PlanError(400, "Choose how long the group will take.");
  if (!(PACES as readonly string[]).includes(String(o.pace))) throw new PlanError(400, "Choose the group's schedule.");
  if (o.startDate !== undefined && !isIsoDate(o.startDate)) throw new PlanError(400, "Choose a start date.");
  const custom = o.durationKey === "custom" ? Number(o.customDays) : undefined;
  if (custom !== undefined && !(Number.isInteger(custom) && custom >= 1 && custom <= 3660)) throw new PlanError(400, "Choose a number of days between 1 and 3,660.");
  return { durationKey: o.durationKey, pace: o.pace, ...(o.startDate ? { startDate: o.startDate } : {}), ...(custom ? { customDays: custom } : {}) };
}
async function groupSummary(type: Destination, id: string) {
  const [name, members] = await Promise.all([destinationName(type, id), destinationMemberIds(type, id)]);
  let description: string | null = null, photoUrl: string | null = null;
  if (type === "private_group") {
    const { data } = await db.from("p2p_conversations").select("description,photo_url").eq("id", id).maybeSingle();
    description = (data as { description: string | null } | null)?.description ?? null; photoUrl = (data as { photo_url: string | null } | null)?.photo_url ?? null;
  }
  return { type, id, name, description, photoUrl, members: members.length };
}
async function groupPlanStudies(type: Destination, id: string): Promise<StudyRow[]> {
  const { data, error } = await db.from("p2p_shared_studies").select("*").eq("destination_type", type).eq("destination_id", id).eq("content_type", "study_plan").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StudyRow[];
}

router.get("/groups/mine", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    // Only groups this person may attach a plan to (they lead them); private groups' membership stays private.
    const led = await groupsUserLeads(userId);
    const out = [];
    for (const g of led.slice(0, 60)) {
      const [summary, studies] = await Promise.all([groupSummary(g.type, g.id), groupPlanStudies(g.type, g.id)]);
      const active = studies.find((x) => x.status === "active") ?? null;
      out.push({ ...summary, canAttach: true, activePlan: active ? { studyId: active.id, planId: active.content_id, title: active.title } : null, completedPlans: studies.filter((x) => x.status === "concluded").length });
    }
    return res.json({ groups: out });
  } catch (e) { return fail(res, e); }
});

router.get("/groups/:type/:id", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const type = req.params.type, id = String(req.params.id);
    if (!isGroupType(type) || !isUuid(id)) throw new PlanError(404, "This group isn't available.");
    // Not a member → the same answer as "no such group".
    if (!(await isDestinationMember(type, id, userId))) throw new PlanError(404, "This group isn't available.");
    const [group, canLead, studies] = await Promise.all([groupSummary(type, id), canLeadDestination(type, id, userId), groupPlanStudies(type, id)]);
    const planIds = [...new Set(studies.map((x) => x.content_id))];
    const { data: planRows } = planIds.length ? await db.from("p2p_study_plans").select("*").in("id", planIds) : { data: [] };
    const plans = new Map(((planRows ?? []) as Plan[]).map((p) => [p.id, p]));
    const sIds = studies.map((x) => x.id);
    const { data: runRows } = sIds.length ? await db.from("p2p_study_plan_enrollments").select("*").in("shared_study_id", sIds) : { data: [] };
    const runs = ((runRows ?? []) as Run[]).filter((r) => r.status !== "left");
    const item = async (st: StudyRow) => {
      const p = plans.get(st.content_id);
      const mineRun = runs.find((r) => r.shared_study_id === st.id && r.user_id === userId) ?? null;
      let mine = null;
      if (p && mineRun) {
        const ss = required(await sessionsOf(p, userId, mineRun));
        const { data: comp } = await db.from("p2p_study_plan_completions").select("session_id").eq("enrollment_id", mineRun.id);
        const prog = progressOf(ss, doneSet(ss, ((comp ?? []) as { session_id: string }[]).map((c) => c.session_id)));
        mine = { runId: mineRun.id, status: mineRun.status, completed: prog.completed, total: prog.total, finished: prog.finished || mineRun.status === "completed" };
      }
      const theirs = runs.filter((r) => r.shared_study_id === st.id);
      return { studyId: st.id, status: st.status, plan: p ? card(p) : { id: st.content_id, title: st.title, unavailable: true }, schedule: st.plan_schedule ?? null,
        startedAt: st.created_at, completedAt: st.concluded_at,
        // Group-level counts only — never who, and never anyone's answers, reflections or assessments.
        overview: { members: group.members, following: theirs.length, finished: theirs.filter((r) => r.status === "completed").length }, mine };
    };
    const active = studies.find((x) => x.status === "active");
    return res.json({
      group, canLead,
      active: active ? await item(active) : null,
      history: await Promise.all(studies.filter((x) => x.status === "concluded").map(item)),
      note: "Each member's progress is their own. Completing a plan never ends the group, and it never awards Growth Matrix credit.",
    });
  } catch (e) { return fail(res, e); }
});

router.post("/groups/:type/:id/plans", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const type = req.params.type, id = String(req.params.id);
    if (!isGroupType(type) || !isUuid(id)) throw new PlanError(404, "This group isn't available.");
    if (!(await isDestinationMember(type, id, userId))) throw new PlanError(404, "This group isn't available.");
    if (!(await canLeadDestination(type, id, userId))) throw new PlanError(403, "Only the group's leaders can choose its plan.");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientKey = clientKeyOf(b.clientKey);
    if (clientKey) {
      const { data: had, error: hadErr } = await db.from("p2p_shared_studies").select("id").eq("host_id", userId).eq("client_key", clientKey).maybeSingle();
      if (!hadErr && had) return res.json({ studyId: (had as { id: string }).id, existing: true });
    }
    // The ACTUAL plan (a published P2P plan, or the leader's own plan) — never a copy.
    const planId = String(b.planId ?? "");
    const content = await loadContent("study_plan", planId, userId);
    if (!content) throw new PlanError(404, "This plan isn't available to share.");
    const { data: pr } = await db.from("p2p_study_plans").select("*").eq("id", planId).maybeSingle();
    if ((pr as Plan | null)?.is_draft) throw new PlanError(409, "Finish this plan before sharing it.");
    const schedule = readGroupSchedule(b.schedule);
    const studies = await groupPlanStudies(type, id);
    const active = studies.find((x) => x.status === "active");
    if (active) throw new PlanError(409, "This group already has an active plan. Complete it first.", { activeStudyId: active.id });
    const { data: st, error } = await insertTolerant("p2p_shared_studies", { content_type: "study_plan", content_id: planId, title: content.title.slice(0, 300), host_id: userId,
      destination_type: type, destination_id: id, current_section_id: content.sections[0]?.id ?? null, plan_schedule: schedule, ...(clientKey ? { client_key: clientKey } : {}) }, ["plan_schedule", "client_key"]);
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new PlanError(409, "This group already has an active plan. Complete it first.");
      throw error;
    }
    const study = st as StudyRow;
    await db.from("p2p_shared_study_members").insert({ study_id: study.id, user_id: userId, role: "host", status: "accepted", responded_at: new Date().toISOString(), last_opened_at: new Date().toISOString() });
    const members = (await destinationMemberIds(type, id)).filter((u) => u !== userId);
    const [who, groupName] = await Promise.all([displayName(userId), destinationName(type, id)]);
    await notify(members, { title: "A new group plan", message: `${who} chose "${content.title}" for ${groupName ?? "your group"}.`, type: "shared_study_started", studyId: study.id });
    return res.status(201).json({ studyId: study.id });
  } catch (e) { return fail(res, e); }
});

router.post("/groups/:type/:id/plans/:studyId/complete", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const type = req.params.type, id = String(req.params.id), studyId = String(req.params.studyId);
    if (!isGroupType(type) || !isUuid(id) || !isUuid(studyId)) throw new PlanError(404, "This group isn't available.");
    if (!(await isDestinationMember(type, id, userId))) throw new PlanError(404, "This group isn't available.");
    if (!(await canLeadDestination(type, id, userId))) throw new PlanError(403, "Only the group's leaders can complete its plan.");
    const { data } = await db.from("p2p_shared_studies").select("*").eq("id", studyId).maybeSingle();
    const st = data as StudyRow | null;
    if (!st || st.destination_type !== type || st.destination_id !== id || st.content_type !== "study_plan") throw new PlanError(404, "That plan isn't part of this group.");
    if (st.status === "concluded") return res.json({ completed: true, existing: true });
    // The plan is completed for the GROUP; the group stays, and every member keeps their own run and history.
    const now = new Date().toISOString();
    let { error } = await db.from("p2p_shared_studies").update({ status: "concluded", concluded_at: now, updated_at: now, completed_by: userId }).eq("id", st.id).eq("status", "active");
    if (error && noColumn(error)) ({ error } = await db.from("p2p_shared_studies").update({ status: "concluded", concluded_at: now, updated_at: now }).eq("id", st.id).eq("status", "active"));
    if (error) throw error;
    return res.json({ completed: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/groups", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { plan } = await loadPlanFor(String(req.params.id), userId);
    if (!(isLive(plan) || plan.owner_id === userId)) throw new PlanError(409, "This plan isn't published yet.");
    if (plan.is_draft) throw new PlanError(409, "Finish this plan before creating a group for it.");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 80) throw new PlanError(400, "Give the group a name (up to 80 characters).");
    const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 1000) : null;
    const schedule = readGroupSchedule(b.schedule);
    const clientKey = clientKeyOf(b.clientKey);
    // One transaction: the private group, its creator as admin, and the plan's Study Together study (251).
    const { data, error } = await db.rpc("p2p_create_plan_group", { p_owner: userId, p_plan: plan.id, p_name: name, p_description: description, p_schedule: schedule, p_client_key: clientKey });
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "42883" || code === "PGRST202") throw new PlanError(503, "Creating a group from a plan needs the latest P2P update.");
      throw error;
    }
    const r = (Array.isArray(data) ? data[0] : data) as { group_id: string; study_id: string; existing: boolean };
    return res.status(r.existing ? 200 : 201).json({ groupId: r.group_id, studyId: r.study_id, existing: r.existing, groupType: "private_group" });
  } catch (e) { return fail(res, e); }
});

export default router;
