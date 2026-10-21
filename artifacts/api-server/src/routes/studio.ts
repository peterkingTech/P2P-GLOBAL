import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, supabaseAsUser } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import {
  AUDIT_VIEW_ROLES, SCHEDULE_ACTIONS, STUDIO_VIEW_ROLES,
  canEdit, canSchedule, canViewAudit, reviewTransition,
  type ReviewState, type ScheduleAction,
} from "../lib/studio/policy";
import { isValidTimeZone, utcToZonedLocal, zonedLocalToUtc } from "../lib/studio/time";
import { isStudioNotInstalled } from "../lib/studio/runtime";
import { RETRY_BASE_MS, RETRY_MAX_MS } from "../lib/studio/scheduler";

// Publishing Studio (migration 188) — one workspace over EXISTING content.
// Content is never copied here: Kingdom Stories are reviewed, scheduled and
// published through their own canonical records; Kingdom Wins, curriculum and
// Pray the Word are shown READ-ONLY with links to their existing workflows.
//
// Authorization happens before anything is written:
//   1. requireAdmin + Studio view roles for every route;
//   2. a per-action role/state check here (lib/studio/policy.ts) — refused
//      requests never reach a database write;
//   3. every write is ONE database function call made AS THE SIGNED-IN USER
//      (their verified token): the function takes the actor from auth.uid(),
//      re-checks their current role and the rules, and changes state plus
//      appends the audit row in a single transaction.
// Reads use the service role, which has SELECT only on the Studio tables.
const router = Router();
router.use(requireAdmin, requireRole(...STUDIO_VIEW_ROLES));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 366 * 24 * 3600_000;
const READ_ONLY_SOURCE = "Kingdom Wins are moderated in the existing moderation queue. The Studio shows them read-only.";
const DEFAULT_MAX_ATTEMPTS = 5; // p2p_studio_schedules.max_attempts default

// Content types the Studio can LIST. Only kingdom_story is editable here.
const LIST_TYPES = ["kingdom_story", "kingdom_win", "curriculum", "prayer_topic", "prayer_path"] as const;
type ListType = (typeof LIST_TYPES)[number];
const TYPE_INFO: Record<ListType, { label: string; readOnlyReason: string | null; manage: { label: string; path: string | null } }> = {
  kingdom_story: { label: "Kingdom Stories", readOnlyReason: null, manage: { label: "Open the story editor", path: "/admin/kingdom-stories" } },
  kingdom_win: { label: "Kingdom Wins", readOnlyReason: READ_ONLY_SOURCE, manage: { label: "Open the Kingdom Wins moderation queue", path: "/admin/kingdom-wins-review" } },
  curriculum: { label: "Curriculum & Plans", readOnlyReason: "Curriculum and plans are published with their own published switch in the Curriculum Manager.", manage: { label: "Open the Curriculum Manager", path: "/admin/curriculum" } },
  prayer_topic: { label: "Pray the Word topics", readOnlyReason: "Pray the Word topics keep their own status and are managed through the existing Pray the Word admin tools; there is no admin screen for them yet.", manage: { label: "No admin screen yet", path: null } },
  prayer_path: { label: "Pray the Word paths", readOnlyReason: "Pray the Word paths keep their own status and are managed through the existing Pray the Word admin tools; there is no admin screen for them yet.", manage: { label: "No admin screen yet", path: null } },
};

const actor = (req: Request) => ({ id: (req as any).adminUserId as string, role: (req as any).adminRole as string });
/** Database client acting as the signed-in user (identity from their verified token). */
const asUser = (req: Request) => supabaseAsUser((req as any).adminToken as string);
function fail(res: Response, message: string, status = 400) { return res.status(status).json({ error: message }); }
function dbFail(res: Response, error: { code?: string; message?: string } | null) {
  if (isStudioNotInstalled(error)) return fail(res, "The Publishing Studio is not set up yet (migration 188 has not been applied).", 503);
  return fail(res, "Database error.", 500);
}

// Refusals raised by the migration 188 functions (SQLSTATE S04xx).
const DB_MESSAGES: Record<string, string> = {
  studio_unauthenticated: "Sign in again to continue.",
  studio_forbidden: "Your role cannot do this.",
  studio_read_only_source: READ_ONLY_SOURCE,
  studio_four_eyes: "Someone other than the submitter must review this.",
  studio_version_conflict: "This item was changed by someone else. Reload and try again.",
  studio_version_required: "version (the item version you are looking at) is required",
  studio_invalid_transition: "That review step is not possible from the current state.",
  studio_approval_required: "This story must be approved in the Publishing Studio before it can be published. It remains unpublished.",
  studio_approval_stale: "This story changed after it was approved. It remains unpublished until it is reviewed again.",
  studio_reviewer_ineligible: "The editor who approved this story can no longer approve content. It remains unpublished until another editor reviews it.",
  studio_reviewer_missing: "This story's approval no longer has a reviewer. It remains unpublished until it is reviewed again.",
  scripture_reference_required: "A Scripture Story needs its Scripture reference before it can be published. It remains unpublished.",
  studio_live_edit_blocked: "This story is live. Unpublish it, make the change, and get it approved again.",
  studio_already_scheduled: "This action is already scheduled for this item. Cancel it first.",
  studio_idempotency_key_reused: "This request key was already used for a different request.",
  studio_not_cancellable: "This job has already started or finished and can no longer be cancelled.",
  studio_source_missing: "Content not found.",
  studio_schedule_missing: "Schedule not found.",
  studio_invalid_run_at: "Schedule between one minute and one year ahead.",
  studio_invalid_state: "That status is not valid.",
};
const DB_STATUS: Record<string, number> = { S0401: 401, S0403: 403, S0404: 404, S0409: 409, S0422: 400, S0423: 409 };
function studioDbError(res: Response, error: { code?: string; message?: string } | null) {
  const status = error?.code ? DB_STATUS[error.code] : undefined;
  if (status) return res.status(status).json({ error: DB_MESSAGES[error?.message ?? ""] ?? "The request was not accepted.", code: error?.message });
  return dbFail(res, error);
}

function storyParam(req: Request): string | null {
  const { sourceType, sourceId } = req.params as Record<string, string>;
  return sourceType === "kingdom_story" && UUID_RE.test(sourceId ?? "") ? sourceId : null;
}
function paging(req: Request) {
  const page = Math.max(0, Number.parseInt(String(req.query.page ?? "0"), 10) || 0);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  return { page, pageSize, from: page * pageSize, to: page * pageSize + pageSize - 1 };
}
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Studio state for a page of stories: items, live schedules, stale approvals. */
async function storyStudioState(ids: string[]) {
  if (!ids.length) return { items: new Map<string, any>(), schedules: [] as any[], stale: new Set<string>(), error: null as any };
  const items = await db.from("p2p_studio_items")
    .select("id,source_id,review_state,submitted_by,submitted_at,reviewed_by,reviewed_at,review_note,planned_for,timezone,version")
    .eq("source_type", "kingdom_story").in("source_id", ids);
  if (items.error) return { items: new Map(), schedules: [], stale: new Set<string>(), error: items.error };
  const itemIds = (items.data ?? []).map((i: any) => i.id);
  const schedules = itemIds.length
    ? await db.from("p2p_studio_schedules").select("id,item_id,action,run_at,local_time,timezone,status,attempts,last_error")
        .in("item_id", itemIds).in("status", ["pending", "running", "failed"])
    : { data: [], error: null };
  if (schedules.error) return { items: new Map(), schedules: [], stale: new Set<string>(), error: schedules.error };
  const staleRes = await db.rpc("p2p_studio_stale_approvals", { p_source_ids: ids });
  if (staleRes.error) return { items: new Map(), schedules: [], stale: new Set<string>(), error: staleRes.error };
  const stale = new Set<string>(((staleRes.data ?? []) as any[]).map((r) => (typeof r === "string" ? r : Object.values(r)[0] as string)));
  return { items: new Map((items.data ?? []).map((i: any) => [i.source_id, i])), schedules: schedules.data ?? [], stale, error: null };
}
function mapStory(r: any, st: { items: Map<string, any>; schedules: any[]; stale: Set<string> }) {
  const it = st.items.get(r.id);
  return {
    sourceId: r.id, title: r.title, nativeStatus: r.status, contentType: r.content_type ?? null,
    updatedAt: r.updated_at, publishedAt: r.published_at,
    studio: it ? {
      itemId: it.id, reviewState: it.review_state, plannedFor: it.planned_for, timezone: it.timezone, version: it.version,
      submittedBy: it.submitted_by, submittedAt: it.submitted_at, reviewedBy: it.reviewed_by, reviewedAt: it.reviewed_at, reviewNote: it.review_note,
      approvalStale: st.stale.has(r.id),
    } : null,
    schedules: it ? st.schedules.filter((s: any) => s.item_id === it.id).map((s: any) => ({
      id: s.id, action: s.action, runAt: s.run_at, localTime: s.local_time, timezone: s.timezone, status: s.status, attempts: s.attempts, lastError: s.last_error,
    })) : [],
  };
}
const STORY_COLS = "id,title,status,content_type,updated_at,published_at";

// ── Content Library: paginated, searchable, per content type ──────────────
router.get("/items", async (req, res) => {
  const sourceType = String(req.query.sourceType ?? "kingdom_story") as ListType;
  if (!(LIST_TYPES as readonly string[]).includes(sourceType)) return fail(res, `sourceType must be one of: ${LIST_TYPES.join(", ")}`);
  const { page, pageSize, from, to } = paging(req);
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  const status = String(req.query.status ?? "").trim();
  const info = TYPE_INFO[sourceType];
  const meta = { sourceType, label: info.label, editable: sourceType === "kingdom_story" && canEdit(actor(req).role, "kingdom_story"), readOnlyReason: info.readOnlyReason, manage: info.manage, page, pageSize };

  if (sourceType === "kingdom_story") {
    if (status && !["draft", "review", "published", "archived"].includes(status)) return fail(res, "invalid status");
    let query = db.from("p2p_kingdom_stories").select(STORY_COLS, { count: "exact" }).order("updated_at", { ascending: false }).range(from, to);
    if (q) query = query.ilike("title", likePattern(q));
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) return fail(res, "Database error.", 500);
    const st = await storyStudioState((data ?? []).map((r: any) => r.id));
    if (st.error) return dbFail(res, st.error);
    return res.json({ ...meta, total: count ?? 0, items: (data ?? []).map((r: any) => mapStory(r, st)) });
  }
  if (sourceType === "kingdom_win") {
    // Only what moderators already see in the existing queue; private drafts stay private.
    const allowed = ["submitted", "published"];
    if (status && !allowed.includes(status)) return fail(res, "invalid status");
    let query = db.from("p2p_kingdom_wins").select("id,title,status,visibility,updated_at,published_at", { count: "exact" })
      .in("status", status ? [status] : allowed).order("updated_at", { ascending: false }).range(from, to);
    if (q) query = query.ilike("title", likePattern(q));
    const { data, error, count } = await query;
    if (error) return fail(res, "Database error.", 500);
    return res.json({ ...meta, total: count ?? 0, items: (data ?? []).map((r: any) => ({
      sourceId: r.id, title: r.title, nativeStatus: r.status, visibility: r.visibility, contentType: null,
      updatedAt: r.updated_at, publishedAt: r.published_at, studio: null, schedules: [],
    })) });
  }
  if (sourceType === "curriculum") {
    // p2p_curriculums carries `status` (draft | published | archived) — there
    // is no `is_published` column in production.
    if (status && !["published", "draft", "archived"].includes(status)) return fail(res, "invalid status");
    let query = db.from("p2p_curriculums").select("id,title,status,created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
    if (q) query = query.ilike("title", likePattern(q));
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) return fail(res, "Database error.", 500);
    return res.json({ ...meta, total: count ?? 0, items: (data ?? []).map((r: any) => ({
      sourceId: r.id, title: r.title, nativeStatus: r.status ?? "draft", contentType: null,
      updatedAt: r.created_at, publishedAt: null, studio: null, schedules: [],
    })) });
  }
  const table = sourceType === "prayer_topic" ? "p2p_prayer_topics" : "p2p_prayer_paths";
  if (status && !["draft", "published", "archived"].includes(status)) return fail(res, "invalid status");
  let query = db.from(table).select("id,title,status,updated_at", { count: "exact" }).order("updated_at", { ascending: false }).range(from, to);
  if (q) query = query.ilike("title", likePattern(q));
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query;
  if (error) return fail(res, "Database error.", 500);
  return res.json({ ...meta, total: count ?? 0, items: (data ?? []).map((r: any) => ({
    sourceId: r.id, title: r.title, nativeStatus: r.status, contentType: null, updatedAt: r.updated_at, publishedAt: null, studio: null, schedules: [],
  })) });
});

// ── One Kingdom Story with its Studio state (Schedule Editor) ──────────────
router.get("/items/:sourceType/:sourceId", async (req, res) => {
  if (req.params.sourceType === "kingdom_win") return fail(res, READ_ONLY_SOURCE, 403);
  const storyId = storyParam(req);
  if (!storyId) return fail(res, "Unknown content.", 404);
  const { data, error } = await db.from("p2p_kingdom_stories").select(STORY_COLS).eq("id", storyId).maybeSingle();
  if (error) return fail(res, "Database error.", 500);
  if (!data) return fail(res, "Content not found.", 404);
  const st = await storyStudioState([storyId]);
  if (st.error) return dbFail(res, st.error);
  return res.json({ editable: canEdit(actor(req).role, "kingdom_story"), item: mapStory(data, st) });
});

// ── Review queue: Kingdom Stories by review state ──────────────────────────
router.get("/review-queue", async (req, res) => {
  const state = String(req.query.state ?? "in_review");
  if (!["draft", "in_review", "changes_requested", "approved"].includes(state)) return fail(res, "state must be draft, in_review, changes_requested or approved");
  const { page, pageSize, from, to } = paging(req);
  let stories: any[] = [];
  let total = 0;
  if (state === "draft") {
    // Not yet submitted: draft/review stories with no item in a later state.
    const busy = await db.from("p2p_studio_items").select("source_id").eq("source_type", "kingdom_story").in("review_state", ["in_review", "changes_requested", "approved"]);
    if (busy.error) return dbFail(res, busy.error);
    const busyIds = (busy.data ?? []).map((r: any) => r.source_id);
    let query = db.from("p2p_kingdom_stories").select(STORY_COLS, { count: "exact" }).in("status", ["draft", "review"]).order("updated_at", { ascending: false }).range(from, to);
    if (busyIds.length) query = query.not("id", "in", `(${busyIds.join(",")})`);
    const r = await query;
    if (r.error) return fail(res, "Database error.", 500);
    stories = r.data ?? []; total = r.count ?? 0;
  } else {
    const items = await db.from("p2p_studio_items").select("source_id", { count: "exact" }).eq("source_type", "kingdom_story").eq("review_state", state)
      .order("updated_at", { ascending: false }).range(from, to);
    if (items.error) return dbFail(res, items.error);
    total = items.count ?? 0;
    const ids = (items.data ?? []).map((r: any) => r.source_id);
    if (ids.length) {
      const r = await db.from("p2p_kingdom_stories").select(STORY_COLS).in("id", ids);
      if (r.error) return fail(res, "Database error.", 500);
      const byId = new Map((r.data ?? []).map((s: any) => [s.id, s]));
      stories = ids.map((id: string) => byId.get(id)).filter(Boolean);
    }
  }
  const st = await storyStudioState(stories.map((s) => s.id));
  if (st.error) return dbFail(res, st.error);
  return res.json({ state, page, pageSize, total, editable: canEdit(actor(req).role, "kingdom_story"), items: stories.map((s) => mapStory(s, st)) });
});

// ── Overview: real counts from canonical data ─────────────────────────────
router.get("/overview", async (req, res) => {
  const tz = isValidTimeZone(req.query.tz) ? (req.query.tz as string) : "UTC";
  const countStories = async (status: string) => (await db.from("p2p_kingdom_stories").select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0;
  const [draft, review, published, archived] = await Promise.all(["draft", "review", "published", "archived"].map(countStories));
  const items = await db.from("p2p_studio_items").select("review_state").eq("source_type", "kingdom_story");
  if (items.error) return dbFail(res, items.error);
  const reviewCounts: Record<string, number> = { in_review: 0, changes_requested: 0, approved: 0 };
  for (const i of items.data ?? []) if ((i as any).review_state in reviewCounts) reviewCounts[(i as any).review_state]++;
  const live = await db.from("p2p_studio_schedules").select("id,status,run_at,next_attempt_at").in("status", ["pending", "running"]);
  if (live.error) return dbFail(res, live.error);
  const failed = await db.from("p2p_studio_schedules").select("id", { count: "exact", head: true }).eq("status", "failed");
  const now = Date.now();
  const today = utcToZonedLocal(new Date(now), tz).slice(0, 10);
  const pending = (live.data ?? []) as any[];
  const dueToday = pending.filter((s) => utcToZonedLocal(new Date(s.run_at), tz).slice(0, 10) === today).length;
  const overdue = pending.filter((s) => s.status === "pending" && Date.parse(s.next_attempt_at) < now - 5 * 60_000).length;
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const recent = await db.from("p2p_kingdom_stories").select("id,title,published_at").eq("status", "published").gte("published_at", weekAgo)
    .order("published_at", { ascending: false }).limit(8);
  const wins = async (status: string) => (await db.from("p2p_kingdom_wins").select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0;
  const [winsSubmitted, winsPublished] = await Promise.all([wins("submitted"), wins("published")]);
  let activity: any[] | null = null;
  if (canViewAudit(actor(req).role)) {
    const a = await db.from("p2p_studio_audit_log").select("id,at,actor_role,action,source_type,source_id,details").order("at", { ascending: false }).limit(8);
    if (a.error) return dbFail(res, a.error);
    activity = a.data ?? [];
  }
  return res.json({
    timezone: tz, generatedAt: new Date(now).toISOString(),
    stories: { draft, review, published, archived },
    review: reviewCounts,
    schedules: { scheduled: pending.length, dueToday, overdue, failed: failed.count ?? 0 },
    recentlyPublished: (recent.data ?? []).map((r: any) => ({ sourceId: r.id, title: r.title, publishedAt: r.published_at })),
    wins: { awaitingModeration: winsSubmitted, published: winsPublished },
    activity,
  });
});

// ── Calendar: scheduled jobs and publications in a time range ─────────────
router.get("/calendar", async (req, res) => {
  const fromTs = Date.parse(String(req.query.from ?? ""));
  const toTs = Date.parse(String(req.query.to ?? ""));
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs || toTs - fromTs > 62 * 86_400_000) {
    return fail(res, "from and to must be ISO timestamps at most 62 days apart");
  }
  const from = new Date(fromTs).toISOString(), to = new Date(toTs).toISOString();
  const jobs = await db.from("p2p_studio_schedules").select("id,item_id,action,run_at,local_time,timezone,status,attempts,last_error")
    .gte("run_at", from).lt("run_at", to).order("run_at", { ascending: true }).limit(500);
  if (jobs.error) return dbFail(res, jobs.error);
  const itemIds = [...new Set((jobs.data ?? []).map((j: any) => j.item_id))];
  const items = itemIds.length ? await db.from("p2p_studio_items").select("id,source_id").in("id", itemIds) : { data: [], error: null };
  if (items.error) return dbFail(res, items.error);
  const sourceByItem = new Map((items.data ?? []).map((i: any) => [i.id, i.source_id]));
  const published = await db.from("p2p_kingdom_stories").select("id,title,published_at").eq("status", "published").gte("published_at", from).lt("published_at", to).limit(500);
  const storyIds = [...new Set([...sourceByItem.values()])];
  const titles = storyIds.length ? await db.from("p2p_kingdom_stories").select("id,title,status").in("id", storyIds) : { data: [], error: null };
  const storyById = new Map((titles.data ?? []).map((s: any) => [s.id, s]));
  return res.json({
    from, to,
    events: [
      ...(jobs.data ?? []).map((j: any) => {
        const sid = sourceByItem.get(j.item_id);
        return { kind: "schedule", id: j.id, sourceId: sid, title: storyById.get(sid)?.title ?? "(deleted story)", action: j.action, at: j.run_at,
          localTime: j.local_time, timezone: j.timezone, status: j.status, attempts: j.attempts, lastError: j.last_error };
      }),
      ...(published.data ?? []).map((s: any) => ({ kind: "published", id: `pub-${s.id}`, sourceId: s.id, title: s.title, at: s.published_at })),
    ],
  });
});

// ── Media Library: Kingdom Story media rows (files live in a private bucket) ─
router.get("/media", async (req, res) => {
  const { page, pageSize, from, to } = paging(req);
  const type = String(req.query.mediaType ?? "");
  if (type && !["image", "video"].includes(type)) return fail(res, "mediaType must be image or video");
  let query = db.from("p2p_kingdom_story_media").select("id,story_id,media_type,media_path,caption,is_cover,duration_seconds,created_at", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (type) query = query.eq("media_type", type);
  const { data, error, count } = await query;
  if (error) return fail(res, "Database error.", 500);
  const storyIds = [...new Set((data ?? []).map((m: any) => m.story_id))];
  const stories = storyIds.length ? await db.from("p2p_kingdom_stories").select("id,title,status").in("id", storyIds) : { data: [], error: null };
  const byId = new Map((stories.data ?? []).map((s: any) => [s.id, s]));
  return res.json({ page, pageSize, total: count ?? 0, items: (data ?? []).map((m: any) => ({
    id: m.id, sourceId: m.story_id, storyTitle: byId.get(m.story_id)?.title ?? null, storyStatus: byId.get(m.story_id)?.status ?? null,
    mediaType: m.media_type, fileName: String(m.media_path).split("/").pop(), caption: m.caption, isCover: m.is_cover,
    durationSeconds: m.duration_seconds, createdAt: m.created_at,
  })) });
});

// ── Analytics: only what canonical data can tell (no view tracking exists) ─
router.get("/analytics", async (_req, res) => {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const pub = await db.from("p2p_kingdom_stories").select("published_at,category_id").eq("status", "published").gte("published_at", since).limit(5000);
  if (pub.error) return fail(res, "Database error.", 500);
  const byMonth: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const s of pub.data ?? []) {
    const m = String((s as any).published_at).slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + 1;
    byCategory[(s as any).category_id] = (byCategory[(s as any).category_id] ?? 0) + 1;
  }
  const cats = Object.keys(byCategory).length ? await db.from("p2p_kingdom_story_categories").select("id,title").in("id", Object.keys(byCategory)) : { data: [], error: null };
  const catTitle = new Map((cats.data ?? []).map((c: any) => [c.id, c.title]));
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const jobs = await db.from("p2p_studio_schedules").select("status").gte("completed_at", monthAgo).in("status", ["succeeded", "failed", "cancelled"]);
  if (jobs.error) return dbFail(res, jobs.error);
  const jobOutcomes: Record<string, number> = { succeeded: 0, failed: 0, cancelled: 0 };
  for (const j of jobs.data ?? []) jobOutcomes[(j as any).status]++;
  const decisions = await db.from("p2p_studio_audit_log").select("action").gte("at", monthAgo).in("action", ["review.approved", "review.changes_requested", "review.in_review"]);
  if (decisions.error) return dbFail(res, decisions.error);
  const reviewActivity: Record<string, number> = { submitted: 0, approved: 0, changesRequested: 0 };
  for (const d of decisions.data ?? []) {
    const a = (d as any).action;
    if (a === "review.in_review") reviewActivity.submitted++; else if (a === "review.approved") reviewActivity.approved++; else reviewActivity.changesRequested++;
  }
  return res.json({
    generatedAt: new Date().toISOString(),
    publishedByMonth: Object.entries(byMonth).sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, count]) => ({ month, count })),
    publishedByCategory: Object.entries(byCategory).map(([id, count]) => ({ category: catTitle.get(id) ?? "Uncategorised", count })).sort((a, b) => b.count - a.count),
    scheduledJobsLast30Days: jobOutcomes,
    reviewActivityLast30Days: reviewActivity,
    notMeasured: ["Story views and reads", "Shares and distribution reach", "Watch time"],
  });
});

// ── Publishing settings: current configuration (read-only) ────────────────
router.get("/settings", (req, res) => res.json({
  schedulerEnabled: process.env.STUDIO_SCHEDULER_ENABLED === "true",
  scheduling: { minLeadMinutes: MIN_LEAD_MS / 60_000, maxLeadDays: MAX_LEAD_MS / 86_400_000, maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryBaseSeconds: RETRY_BASE_MS / 1000, retryMaxMinutes: RETRY_MAX_MS / 60_000, staleClaimMinutes: 10 },
  roles: { view: STUDIO_VIEW_ROLES, edit: ["admin_content", "super_admin"], audit: AUDIT_VIEW_ROLES },
  approval: { independentReviewer: true, superAdminMaySelfApprove: true, bindsToContent: true, liveStoriesFrozen: true },
  yourRole: actor(req).role,
}));

// ── Time preview: what an entered local time means (DST-aware) ────────────
router.get("/time-preview", (req, res) => {
  const { localTime, timezone, fold } = req.query as Record<string, string>;
  const r = zonedLocalToUtc(localTime, timezone, fold === "later" ? "later" : "earlier");
  if (!r.ok) return fail(res, r.error);
  return res.json({ utc: r.utc.toISOString(), ambiguous: r.ambiguous, offsetMinutes: r.offsetMinutes });
});

// ── Review transitions (Kingdom Stories only) ─────────────────────────────
router.post("/items/:sourceType/:sourceId/review", async (req, res) => {
  const me = actor(req);
  if (req.params.sourceType !== "kingdom_story") return fail(res, READ_ONLY_SOURCE, 403);
  const storyId = storyParam(req);
  if (!storyId) return fail(res, "Unknown content.", 404);
  if (!canEdit(me.role, "kingdom_story")) return fail(res, "Your role cannot change the review state of this content.", 403);
  const { to, note, version } = req.body as { to?: string; note?: string; version?: unknown };
  if (!["draft", "in_review", "changes_requested", "approved"].includes(to ?? "")) return fail(res, "to must be draft, in_review, changes_requested or approved");
  // The version the user was looking at is required: without it a stale
  // screen could overwrite a newer decision.
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return fail(res, DB_MESSAGES.studio_version_required);
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 2000)) return fail(res, "note must be text up to 2000 characters");

  // Early, friendly refusal using the same rules the database enforces.
  const found = await db.from("p2p_studio_items").select("review_state,submitted_by,version").eq("source_type", "kingdom_story").eq("source_id", storyId).maybeSingle();
  if (found.error) return dbFail(res, found.error);
  const cur = found.data as { review_state: ReviewState; submitted_by: string | null; version: number } | null;
  if ((cur?.version ?? 1) !== version) return fail(res, DB_MESSAGES.studio_version_conflict, 409);
  const decision = reviewTransition({ source: "kingdom_story", from: cur?.review_state ?? "draft", to: to as ReviewState, actorRole: me.role, actorId: me.id, submittedBy: cur?.submitted_by ?? null });
  if (!decision.ok) return fail(res, decision.reason, 403);

  const { data, error } = await asUser(req).rpc("p2p_studio_review_transition", {
    p_source_type: "kingdom_story", p_source_id: storyId, p_to: to, p_expected_version: version,
    p_note: typeof note === "string" && note.trim() ? note.trim() : null,
  });
  if (error) return studioDbError(res, error);
  return res.json(data);
});

// ── Publish now / unpublish / archive (Kingdom Stories only) ──────────────
router.post("/items/:sourceType/:sourceId/status", async (req, res) => {
  const me = actor(req);
  if (req.params.sourceType !== "kingdom_story") return fail(res, READ_ONLY_SOURCE, 403);
  const storyId = storyParam(req);
  if (!storyId) return fail(res, "Unknown content.", 404);
  if (!canEdit(me.role, "kingdom_story")) return fail(res, "Your role cannot change this story's status.", 403);
  const { status } = req.body as { status?: string };
  if (!["published", "draft", "archived"].includes(status ?? "")) return fail(res, "status must be published, draft or archived");
  const { data, error } = await asUser(req).rpc("p2p_kingdom_story_set_status", { p_story_id: storyId, p_status: status });
  if (error) return studioDbError(res, error);
  return res.json({ sourceId: storyId, nativeStatus: (data as any)?.status ?? status });
});

// ── Schedule publish / unpublish / archive ────────────────────────────────
router.post("/items/:sourceType/:sourceId/schedules", async (req, res) => {
  const me = actor(req);
  if (req.params.sourceType !== "kingdom_story") return fail(res, READ_ONLY_SOURCE, 403);
  const storyId = storyParam(req);
  if (!storyId) return fail(res, "Unknown content.", 404);
  if (!canEdit(me.role, "kingdom_story")) return fail(res, "Your role cannot schedule this content.", 403);
  const key = String(req.header("Idempotency-Key") ?? "");
  if (key.length < 8 || key.length > 128) return fail(res, "An Idempotency-Key header (8-128 characters) is required.");
  const { action, localTime, timezone, fold } = req.body as { action?: string; localTime?: string; timezone?: string; fold?: string };
  if (!(SCHEDULE_ACTIONS as readonly string[]).includes(action ?? "")) return fail(res, "action must be publish, unpublish or archive");
  if (!isValidTimeZone(timezone)) return fail(res, "timezone must be an IANA time zone, e.g. Europe/London");
  if (fold !== undefined && fold !== "earlier" && fold !== "later") return fail(res, "fold must be earlier or later");
  const t = zonedLocalToUtc(localTime, timezone, fold === "later" ? "later" : "earlier");
  if (!t.ok) {
    return fail(res, t.error === "nonexistent_local_time"
      ? "That local time does not exist in this time zone (clocks skip it for daylight saving). Choose another time."
      : "localTime must be YYYY-MM-DDTHH:mm");
  }
  // A time that happens twice (clocks go back) must be resolved explicitly.
  if (t.ambiguous && fold === undefined) {
    return res.status(400).json({ error: "That local time happens twice in this time zone (clocks go back). Choose the first or second occurrence.", code: "ambiguous_local_time" });
  }
  const lead = t.utc.getTime() - Date.now();
  if (lead < MIN_LEAD_MS) return fail(res, "Schedule at least one minute in the future.");
  if (lead > MAX_LEAD_MS) return fail(res, "Schedule no more than a year ahead.");

  // Early, friendly refusal (publishing needs approval); the database
  // function re-checks under a row lock before creating anything.
  const found = await db.from("p2p_studio_items").select("review_state").eq("source_type", "kingdom_story").eq("source_id", storyId).maybeSingle();
  if (found.error) return dbFail(res, found.error);
  const reviewState = ((found.data as { review_state?: ReviewState } | null)?.review_state ?? "draft") as ReviewState;
  const decision = canSchedule({ source: "kingdom_story", action: action as ScheduleAction, reviewState, actorRole: me.role });
  if (!decision.ok) return fail(res, decision.reason, 403);

  const { data, error } = await asUser(req).rpc("p2p_studio_create_schedule", {
    p_source_type: "kingdom_story", p_source_id: storyId, p_action: action, p_run_at: t.utc.toISOString(),
    p_local_time: localTime, p_timezone: timezone, p_idempotency_key: key,
  });
  if (error) return studioDbError(res, error);
  const r = data as { replayed: boolean; schedule: Record<string, unknown> };
  return res.status(r.replayed ? 200 : 201).json({ ...r, ambiguousLocalTime: t.ambiguous, displayLocal: utcToZonedLocal(t.utc, timezone as string) });
});

router.post("/schedules/:id/cancel", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, "Schedule not found.", 404);
  if (!canEdit(actor(req).role, "kingdom_story")) return fail(res, "Your role cannot cancel this schedule.", 403);
  const { data, error } = await asUser(req).rpc("p2p_studio_cancel_schedule", { p_schedule_id: req.params.id });
  if (error) return studioDbError(res, error);
  return res.json(data);
});

// ── Audit history (auditor roles only) ────────────────────────────────────
const AUDIT_COLS = "id,at,actor_id,actor_role,action,item_id,source_type,source_id,details";
router.get("/audit", async (req, res) => {
  if (!canViewAudit(actor(req).role)) return fail(res, "Your role cannot view the audit history.", 403);
  const { page, pageSize, from, to } = paging(req);
  const { action, sourceType, sourceId } = req.query as Record<string, string | undefined>;
  if (action && !/^[a-z_]+(\.[a-z_]+)?$/.test(action)) return fail(res, "invalid action filter");
  if (sourceType && sourceType !== "kingdom_story") return fail(res, "invalid sourceType");
  if (sourceId && !UUID_RE.test(sourceId)) return fail(res, "invalid sourceId");
  let query = db.from("p2p_studio_audit_log").select(AUDIT_COLS, { count: "exact" }).order("at", { ascending: false }).range(from, to);
  if (action) query = action.includes(".") ? query.eq("action", action) : query.like("action", `${action}.%`);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (sourceId) query = query.eq("source_id", sourceId);
  const { data, error, count } = await query;
  if (error) return dbFail(res, error);
  return res.json({ page, pageSize, total: count ?? 0, entries: data ?? [] });
});
// Per-item shortcut kept for existing callers.
router.get("/items/:sourceType/:sourceId/audit", async (req, res) => {
  if (!canViewAudit(actor(req).role)) return fail(res, "Your role cannot view the audit history.", 403);
  const storyId = storyParam(req);
  if (!storyId) return fail(res, "Unknown content.", 404);
  const { data, error } = await db.from("p2p_studio_audit_log").select(AUDIT_COLS)
    .eq("source_type", "kingdom_story").eq("source_id", storyId).order("at", { ascending: false }).limit(200);
  if (error) return dbFail(res, error);
  return res.json({ entries: data ?? [] });
});

export default router;
