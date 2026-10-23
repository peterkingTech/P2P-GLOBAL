import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";

// Kingdom Stories catalogue (migration 210): Category → Topic → Story → Chapters.
// Mounted by routes/kingdomStories.ts BEFORE its own routes; every path here
// has at least two segments, so nothing collides with GET /:id.
//   • Readers: categories with the number of PUBLISHED stories and, separately,
//     the number of planned topics (a count only — topic titles are never
//     shown to readers; an unpublished topic is never presented as a story).
//   • Editors (admin_content / super_admin, the same rule as the database's
//     p2p_is_kingdom_stories_editor()): topics, chapters, catalogue overview.
// Works before migration 210 is applied: catalogue reads report "not set up"
// instead of failing the rest of Kingdom Stories.
const router = Router();
const editor = [requireAdmin, requireRole("admin_content")];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOPIC_STATUSES = ["topic", "researching", "drafting", "in_review", "ready_to_publish", "published", "archived"] as const;
const PRIORITIES = ["P1", "P2", "P3", "P4"];
const MAX_ITEMS = 5;

type DbError = { code?: string; message?: string } | null;
/** A route parameter as text. */
const p = (req: Request, k: string): string => String(req.params[k] ?? "");
function err(res: Response, message: string, status = 400) { return res.status(status).json({ error: message }); }
/** The catalogue tables don't exist yet (migration 210 not applied on this database). */
function catalogueMissing(error: DbError) {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204");
}
function dbFail(res: Response, error: DbError, fallback: string) {
  if (catalogueMissing(error)) return err(res, "The Kingdom Stories catalogue is not set up on this server yet.", 503);
  if (error?.code === "S0423") return res.status(409).json({ error: "This story is live, so its chapters cannot be changed in place. Unpublish it, make the change, and get it approved again in the Publishing Studio.", code: error.message, studioRequired: true });
  const status = error?.code === "23503" || error?.code === "23514" || error?.code === "23505" || error?.code === "22023" ? 400 : 500;
  return err(res, error?.message ?? fallback, status);
}

/** Every row of a query, 1000 at a time (PostgREST caps a response). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<{ data: T[]; error: DbError }> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return { data: all, error: null };
  }
}

/** URL-safe slug; matches scripts/kingdom-stories/catalogue.mjs. */
export function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[^ -~]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 150).replace(/-+$/g, "");
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

function mapTopic(t: Record<string, any>, stories?: Array<Record<string, any>>) {
  return {
    id: t.id, slug: t.slug, title: t.title, categoryId: t.category_id, summary: t.summary, tags: t.tags ?? [],
    historicalPeriod: t.historical_period, region: t.region, keyPeople: t.key_people, researchNotes: t.research_notes,
    priority: t.priority, status: t.status, displayOrder: t.display_order, overlapNote: t.overlap_note,
    createdAt: t.created_at, updatedAt: t.updated_at,
    stories: stories?.map((s) => ({ id: s.id, title: s.title, status: s.status })),
  };
}

export function mapChapter(c: Record<string, any>, sources: Array<Record<string, any>> = []) {
  return {
    id: c.id, storyId: c.story_id, chapterNumber: c.chapter_number, title: c.title, narrative: c.narrative,
    lessonId: c.lesson_id ?? null, // migration 212: the chapter's lesson in the Core Curriculum learning engine
    people: c.people, places: c.places, dates: c.dates, scriptureRefs: c.scripture_refs,
    evidence: { documented: c.evidence_documented, testimony: c.evidence_testimony, tradition: c.evidence_tradition, disputed: c.evidence_disputed },
    lessons: c.lessons ?? [], reflections: c.reflections ?? [],
    // Migration 211; null until it is applied or the chapter has none.
    assignment: c.assignment_title || c.assignment ? { title: c.assignment_title ?? null, text: c.assignment ?? null } : null,
    complete: chapterComplete(c),
    sources: sources.filter((s) => s.chapterId === c.id),
    createdAt: c.created_at, updatedAt: c.updated_at,
  };
}
/** Same rule as the database's publish check (migration 210). */
export function chapterComplete(c: Record<string, any>): boolean {
  const full = (a: unknown) => Array.isArray(a) && a.length === MAX_ITEMS && a.every((x) => typeof x === "string" && x.trim() !== "");
  return !!c.title?.trim() && !!c.narrative?.trim() && full(c.lessons) && full(c.reflections);
}

/** A story's chapters, oldest-first; [] when the chapters table doesn't exist yet. */
export async function loadChapters(storyId: string, sources: Array<Record<string, any>>) {
  const { data, error } = await db.from("p2p_kingdom_story_chapters").select("*").eq("story_id", storyId).order("chapter_number", { ascending: true });
  if (error) return [];
  return (data ?? []).map((c) => mapChapter(c as Record<string, any>, sources));
}

// ── Readers: categories with honest counts ─────────────────────────────────
router.get("/catalogue/categories", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: cats, error } = await db.from("p2p_kingdom_story_categories").select("*").eq("status", "published").order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);
  const stories = await fetchAll<{ category_id: string; topic_id?: string | null }>((a, b) =>
    db.from("p2p_kingdom_stories").select("category_id,topic_id").eq("status", "published").order("id", { ascending: true }).range(a, b));
  let storyRows = stories.data;
  if (stories.error) {
    // Before migration 210 there is no topic_id column: count stories only.
    const plain = await fetchAll<{ category_id: string }>((a, b) => db.from("p2p_kingdom_stories").select("category_id").eq("status", "published").order("id", { ascending: true }).range(a, b));
    storyRows = plain.data;
  }
  const topics = await fetchAll<{ id: string; category_id: string; status: string }>((a, b) =>
    db.from("p2p_kingdom_story_topics").select("id,category_id,status").order("id", { ascending: true }).range(a, b));
  const publishedTopicIds = new Set(storyRows.map((s) => s.topic_id).filter(Boolean));
  const published = new Map<string, number>();
  for (const s of storyRows) published.set(s.category_id, (published.get(s.category_id) ?? 0) + 1);
  const planned = new Map<string, number>();
  for (const t of topics.error ? [] : topics.data) {
    if (t.status === "archived" || t.status === "published" || publishedTopicIds.has(t.id)) continue;
    planned.set(t.category_id, (planned.get(t.category_id) ?? 0) + 1);
  }
  return res.json({
    categories: (cats ?? []).map((c) => ({
      id: c.id, slug: c.slug, title: c.title, description: c.description, icon: c.icon ?? null, displayOrder: c.display_order,
      publishedStories: published.get(c.id) ?? 0, plannedTopics: planned.get(c.id) ?? 0,
    })),
  });
});

// ── Editors: overview (counts only — no completion percentages) ────────────
router.get("/admin/catalogue/overview", ...editor, async (_req, res) => {
  const [{ data: cats, error: cErr }, topics, stories] = await Promise.all([
    db.from("p2p_kingdom_story_categories").select("*").order("display_order", { ascending: true }),
    fetchAll<{ id: string; category_id: string; status: string; priority: string }>((a, b) => db.from("p2p_kingdom_story_topics").select("id,category_id,status,priority").order("id", { ascending: true }).range(a, b)),
    fetchAll<{ id: string; title: string; category_id: string; status: string; topic_id: string | null }>((a, b) => db.from("p2p_kingdom_stories").select("id,title,category_id,status,topic_id").order("id", { ascending: true }).range(a, b)),
  ]);
  if (cErr) return dbFail(res, cErr, "Failed to load categories");
  if (topics.error) return dbFail(res, topics.error, "Failed to load topics");
  if (stories.error) return dbFail(res, stories.error, "Failed to load stories");
  const tally = <K extends string>(rows: Array<Record<K, string>>, key: K) => rows.reduce<Record<string, number>>((m, r) => { m[r[key]] = (m[r[key]] ?? 0) + 1; return m; }, {});
  const unfinished = stories.data.filter((s) => s.status !== "published" && s.status !== "archived");
  const chapters = unfinished.length
    ? await fetchAll<Record<string, any>>((a, b) => db.from("p2p_kingdom_story_chapters").select("story_id,title,narrative,lessons,reflections").in("story_id", unfinished.map((s) => s.id)).order("story_id", { ascending: true }).range(a, b))
    : { data: [], error: null };
  const byStory = new Map<string, { chapters: number; complete: number }>();
  for (const c of chapters.data) {
    const e = byStory.get(c.story_id) ?? { chapters: 0, complete: 0 };
    e.chapters++; if (chapterComplete(c)) e.complete++;
    byStory.set(c.story_id, e);
  }
  return res.json({
    totals: {
      categories: (cats ?? []).length, activeCategories: (cats ?? []).filter((c) => c.status === "published").length,
      topics: topics.data.length, stories: stories.data.length,
      topicsWithStory: new Set(stories.data.map((s) => s.topic_id).filter(Boolean)).size,
    },
    topicsByStatus: tally(topics.data, "status"),
    topicsByPriority: tally(topics.data, "priority"),
    storiesByStatus: tally(stories.data, "status"),
    categories: (cats ?? []).map((c) => {
      const ts = topics.data.filter((t) => t.category_id === c.id);
      const ss = stories.data.filter((s) => s.category_id === c.id);
      return {
        id: c.id, slug: c.slug, title: c.title, status: c.status, displayOrder: c.display_order, icon: c.icon ?? null,
        topics: ts.length, topicsByStatus: tally(ts, "status"),
        publishedStories: ss.filter((s) => s.status === "published").length,
        storiesInProgress: ss.filter((s) => s.status === "draft" || s.status === "review").length,
      };
    }),
    storiesInProgress: unfinished.map((s) => ({ id: s.id, title: s.title, status: s.status, topicId: s.topic_id, ...(byStory.get(s.id) ?? { chapters: 0, complete: 0 }) })),
  });
});

// ── Editors: topics ────────────────────────────────────────────────────────
router.get("/admin/topics", ...editor, async (req, res) => {
  const { category, status, priority, period, region, q, page = "0", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  let query = db.from("p2p_kingdom_story_topics").select("*", { count: "exact" });
  if (category) {
    if (UUID_RE.test(category)) query = query.eq("category_id", category);
    else {
      const { data: c } = await db.from("p2p_kingdom_story_categories").select("id").eq("slug", category).maybeSingle();
      if (!c) return res.json({ topics: [], total: 0, page: pageNum, pageSize });
      query = query.eq("category_id", c.id);
    }
  }
  if (status) { if (!(TOPIC_STATUSES as readonly string[]).includes(status)) return err(res, `status must be one of: ${TOPIC_STATUSES.join(", ")}`); query = query.eq("status", status); }
  if (priority) { if (!PRIORITIES.includes(priority)) return err(res, "priority must be P1–P4"); query = query.eq("priority", priority); }
  const like = (v: string) => `%${v.split(String.fromCharCode(92)).join(" ").replace(/[%_]/g, " ").trim()}%`;
  if (period?.trim()) query = query.ilike("historical_period", like(period));
  if (region?.trim()) query = query.ilike("region", like(region));
  if (q?.trim()) query = query.ilike("title", like(q));
  // Category view: the editor's order; across categories: by title.
  query = category ? query.order("display_order", { ascending: true }) : query.order("title", { ascending: true });
  const { data, error, count } = await query.range(pageNum * pageSize, pageNum * pageSize + pageSize - 1);
  if (error) return dbFail(res, error, "Failed to load topics");
  const ids = (data ?? []).map((t) => t.id);
  const { data: linked } = ids.length ? await db.from("p2p_kingdom_stories").select("id,title,status,topic_id").in("topic_id", ids) : { data: [] };
  return res.json({
    topics: (data ?? []).map((t) => mapTopic(t, (linked ?? []).filter((s) => s.topic_id === t.id))),
    total: count ?? 0, page: pageNum, pageSize,
  });
});

router.get("/admin/topics/:topicId", ...editor, async (req, res) => {
  if (!UUID_RE.test(p(req, "topicId"))) return err(res, "Topic not found", 404);
  const { data, error } = await db.from("p2p_kingdom_story_topics").select("*").eq("id", p(req, "topicId")).maybeSingle();
  if (error) return dbFail(res, error, "Failed to load topic");
  if (!data) return err(res, "Topic not found", 404);
  const { data: linked } = await db.from("p2p_kingdom_stories").select("id,title,status,topic_id").eq("topic_id", data.id);
  return res.json(mapTopic(data, linked ?? []));
});

/** Validated column updates from a request body (create or edit). */
function topicFields(body: Record<string, unknown>): { fields: Record<string, unknown> } | { error: string } {
  const f: Record<string, unknown> = {};
  if (body.title !== undefined) { const t = text(body.title, 200); if (!t) return { error: "title is required" }; f.title = t; }
  if (body.categoryId !== undefined) { if (typeof body.categoryId !== "string" || !UUID_RE.test(body.categoryId)) return { error: "invalid categoryId" }; f.category_id = body.categoryId; }
  for (const [k, col, max] of [["summary", "summary", 2000], ["historicalPeriod", "historical_period", 200], ["region", "region", 200], ["keyPeople", "key_people", 1000], ["researchNotes", "research_notes", 10000], ["overlapNote", "overlap_note", 2000]] as const) {
    if (body[k] !== undefined) { const v = text(body[k], max); if (v === undefined) return { error: `${k} must be text` }; f[col] = v; }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string")) return { error: "tags must be a list of text" };
    f.tags = [...new Set((body.tags as string[]).map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
  }
  if (body.priority !== undefined) { if (!PRIORITIES.includes(body.priority as string)) return { error: "priority must be P1–P4" }; f.priority = body.priority; }
  if (body.status !== undefined) { if (!(TOPIC_STATUSES as readonly string[]).includes(body.status as string)) return { error: `status must be one of: ${TOPIC_STATUSES.join(", ")}` }; f.status = body.status; }
  return { fields: f };
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || "topic";
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const { data } = await db.from("p2p_kingdom_story_topics").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${root}-${Date.now()}`;
}

async function hasPublishedStory(topicId: string) {
  const { data } = await db.from("p2p_kingdom_stories").select("id").eq("topic_id", topicId).eq("status", "published").limit(1);
  return (data ?? []).length > 0;
}

router.post("/admin/topics", ...editor, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.title) return err(res, "title is required");
  if (!body.categoryId) return err(res, "categoryId is required");
  const r = topicFields(body);
  if ("error" in r) return err(res, r.error);
  if (r.fields.status === "published") return err(res, "A new topic has no published story yet. Publish its story first.");
  const { data: last } = await db.from("p2p_kingdom_story_topics").select("display_order").eq("category_id", r.fields.category_id).order("display_order", { ascending: false }).limit(1);
  const { data, error } = await db.from("p2p_kingdom_story_topics").insert({
    ...r.fields, slug: await uniqueSlug(slugify(r.fields.title as string)),
    display_order: ((last ?? [])[0]?.display_order ?? -1) + 1, created_by: (req as any).adminUserId,
  }).select().single();
  if (error || !data) return dbFail(res, error, "Failed to create topic");
  return res.json(mapTopic(data, []));
});

router.put("/admin/topics/:topicId", ...editor, async (req, res) => {
  if (!UUID_RE.test(p(req, "topicId"))) return err(res, "Topic not found", 404);
  const r = topicFields(req.body as Record<string, unknown>);
  if ("error" in r) return err(res, r.error);
  if (r.fields.status === "published" && !(await hasPublishedStory(p(req, "topicId")))) {
    return err(res, "Mark a topic Published only once its story is published.");
  }
  if (r.fields.category_id) {
    // Moving category: goes to the end of the new category's order.
    const { data: cur } = await db.from("p2p_kingdom_story_topics").select("category_id").eq("id", p(req, "topicId")).maybeSingle();
    if (cur && cur.category_id !== r.fields.category_id) {
      const { data: last } = await db.from("p2p_kingdom_story_topics").select("display_order").eq("category_id", r.fields.category_id).order("display_order", { ascending: false }).limit(1);
      r.fields.display_order = ((last ?? [])[0]?.display_order ?? -1) + 1;
    }
  }
  const { data, error } = await db.from("p2p_kingdom_story_topics").update({ ...r.fields, updated_at: new Date().toISOString() }).eq("id", p(req, "topicId")).select().maybeSingle();
  if (error) return dbFail(res, error, "Failed to update topic");
  if (!data) return err(res, "Topic not found", 404);
  const { data: linked } = await db.from("p2p_kingdom_stories").select("id,title,status,topic_id").eq("topic_id", data.id);
  return res.json(mapTopic(data, linked ?? []));
});

router.post("/admin/topics/reorder", ...editor, async (req, res) => {
  const { categoryId, orderedIds } = req.body as { categoryId?: string; orderedIds?: unknown };
  if (!categoryId || !UUID_RE.test(categoryId)) return err(res, "categoryId is required");
  if (!Array.isArray(orderedIds) || orderedIds.some((i) => typeof i !== "string" || !UUID_RE.test(i))) return err(res, "orderedIds must be a list of topic ids");
  const { data: rows, error } = await fetchAll<{ id: string }>((a, b) => db.from("p2p_kingdom_story_topics").select("id").eq("category_id", categoryId).order("id", { ascending: true }).range(a, b));
  if (error) return dbFail(res, error, "Failed to load topics");
  const have = new Set(rows.map((r) => r.id));
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.length !== have.size || orderedIds.some((i) => !have.has(i as string))) {
    return err(res, "Send every topic of this category exactly once.");
  }
  for (let i = 0; i < orderedIds.length; i++) {
    const u = await db.from("p2p_kingdom_story_topics").update({ display_order: i }).eq("id", orderedIds[i]).eq("category_id", categoryId);
    if (u.error) return dbFail(res, u.error, "Failed to reorder topics");
  }
  return res.json({ ok: true });
});

// Start the story for a topic: an empty DRAFT in the topic's category (no
// generated text — the editor writes it). The topic moves to "Drafting".
router.post("/admin/topics/:topicId/story", ...editor, async (req, res) => {
  if (!UUID_RE.test(p(req, "topicId"))) return err(res, "Topic not found", 404);
  const { data: topic, error: tErr } = await db.from("p2p_kingdom_story_topics").select("*").eq("id", p(req, "topicId")).maybeSingle();
  if (tErr) return dbFail(res, tErr, "Failed to load topic");
  if (!topic) return err(res, "Topic not found", 404);
  const { data, error } = await db.from("p2p_kingdom_stories").insert({
    title: topic.title, category_id: topic.category_id, body: "", status: "draft", topic_id: topic.id,
    editor_id: (req as any).adminUserId,
  }).select("id,title,status,topic_id").single();
  if (error || !data) return dbFail(res, error, "Failed to create story");
  if (topic.status === "topic" || topic.status === "researching") {
    await db.from("p2p_kingdom_story_topics").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("id", topic.id);
  }
  return res.json({ story: data });
});

router.post("/admin/topics/:topicId/link", ...editor, async (req, res) => {
  const { storyId } = req.body as { storyId?: string };
  if (!UUID_RE.test(p(req, "topicId"))) return err(res, "Topic not found", 404);
  if (!storyId || !UUID_RE.test(storyId)) return err(res, "storyId is required");
  const { data: topic } = await db.from("p2p_kingdom_story_topics").select("id").eq("id", p(req, "topicId")).maybeSingle();
  if (!topic) return err(res, "Topic not found", 404);
  const { data, error } = await db.from("p2p_kingdom_stories").update({ topic_id: topic.id }).eq("id", storyId).select("id,title,status,topic_id").maybeSingle();
  if (error) return dbFail(res, error, "Failed to link story");
  if (!data) return err(res, "Story not found", 404);
  return res.json({ story: data });
});

router.delete("/admin/topics/:topicId/link/:storyId", ...editor, async (req, res) => {
  const { data, error } = await db.from("p2p_kingdom_stories").update({ topic_id: null }).eq("id", p(req, "storyId")).eq("topic_id", p(req, "topicId")).select("id").maybeSingle();
  if (error) return dbFail(res, error, "Failed to unlink story");
  if (!data) return err(res, "That story is not linked to this topic", 404);
  return res.json({ unlinked: true });
});

// ── Editors: chapters ──────────────────────────────────────────────────────
function chapterFields(body: Record<string, unknown>): { fields: Record<string, unknown> } | { error: string } {
  const f: Record<string, unknown> = {};
  if (body.title !== undefined) { const v = text(body.title, 200); if (v === undefined) return { error: "title must be text" }; f.title = v ?? ""; }
  if (body.narrative !== undefined) { const v = text(body.narrative, 60000); if (v === undefined) return { error: "narrative must be text" }; f.narrative = v ?? ""; }
  for (const [k, col, max] of [["people", "people", 2000], ["places", "places", 2000], ["dates", "dates", 1000], ["scriptureRefs", "scripture_refs", 2000], ["assignmentTitle", "assignment_title", 200], ["assignment", "assignment", 10000]] as const) {
    if (body[k] !== undefined) { const v = text(body[k], max); if (v === undefined) return { error: `${k} must be text` }; f[col] = v; }
  }
  const ev = body.evidence as Record<string, unknown> | undefined;
  if (ev !== undefined) {
    if (!ev || typeof ev !== "object") return { error: "evidence must be an object" };
    for (const [k, col] of [["documented", "evidence_documented"], ["testimony", "evidence_testimony"], ["tradition", "evidence_tradition"], ["disputed", "evidence_disputed"]] as const) {
      if (ev[k] !== undefined) { const v = text(ev[k], 10000); if (v === undefined) return { error: `evidence.${k} must be text` }; f[col] = v; }
    }
  }
  for (const k of ["lessons", "reflections"] as const) {
    if (body[k] === undefined) continue;
    const a = body[k];
    if (!Array.isArray(a) || a.some((x) => typeof x !== "string")) return { error: `${k} must be a list of text` };
    const items = (a as string[]).map((x) => x.trim().slice(0, 1000)).filter(Boolean);
    if (items.length > MAX_ITEMS) return { error: `A chapter has at most ${MAX_ITEMS} ${k === "lessons" ? "Kingdom Lessons" : "Peer Reflection Questions"}.` };
    f[k] = items;
  }
  return { fields: f };
}

async function storyExists(id: string) {
  if (!UUID_RE.test(id)) return false;
  const { data } = await db.from("p2p_kingdom_stories").select("id").eq("id", id).maybeSingle();
  return !!data;
}

router.post("/:id/chapters", ...editor, async (req, res) => {
  if (!(await storyExists(p(req, "id")))) return err(res, "Story not found", 404);
  const r = chapterFields(req.body as Record<string, unknown>);
  if ("error" in r) return err(res, r.error);
  const { data: last, error: lErr } = await db.from("p2p_kingdom_story_chapters").select("chapter_number").eq("story_id", p(req, "id")).order("chapter_number", { ascending: false }).limit(1);
  if (lErr) return dbFail(res, lErr, "Failed to load chapters");
  const { data, error } = await db.from("p2p_kingdom_story_chapters").insert({
    ...r.fields, story_id: p(req, "id"), chapter_number: ((last ?? [])[0]?.chapter_number ?? 0) + 1,
  }).select().single();
  if (error || !data) return dbFail(res, error, "Failed to add chapter");
  return res.json(mapChapter(data));
});

router.put("/:id/chapters/:chapterId", ...editor, async (req, res) => {
  const r = chapterFields(req.body as Record<string, unknown>);
  if ("error" in r) return err(res, r.error);
  if (!UUID_RE.test(p(req, "chapterId")) || !UUID_RE.test(p(req, "id"))) return err(res, "Chapter not found", 404);
  const { data, error } = await db.from("p2p_kingdom_story_chapters").update({ ...r.fields, updated_at: new Date().toISOString() })
    .eq("id", p(req, "chapterId")).eq("story_id", p(req, "id")).select().maybeSingle();
  if (error) return dbFail(res, error, "Failed to save chapter");
  if (!data) return err(res, "Chapter not found", 404);
  return res.json(mapChapter(data));
});

router.post("/:id/chapters/reorder", ...editor, async (req, res) => {
  const { orderedIds } = req.body as { orderedIds?: unknown };
  if (!(await storyExists(p(req, "id")))) return err(res, "Story not found", 404);
  if (!Array.isArray(orderedIds) || orderedIds.some((i) => typeof i !== "string" || !UUID_RE.test(i))) return err(res, "orderedIds must be a list of chapter ids");
  const { error } = await db.rpc("p2p_kingdom_story_reorder_chapters", { p_story_id: p(req, "id"), p_chapter_ids: orderedIds });
  if (error) return dbFail(res, error, "Failed to reorder chapters");
  return res.json({ ok: true });
});

router.delete("/:id/chapters/:chapterId", ...editor, async (req, res) => {
  if (!UUID_RE.test(p(req, "chapterId")) || !UUID_RE.test(p(req, "id"))) return err(res, "Chapter not found", 404);
  // The chapter's images (migration 211) go with it: rows by cascade, files below once the row is gone.
  const { data: chMedia } = await db.from("p2p_kingdom_story_media").select("media_path").eq("story_id", p(req, "id")).eq("chapter_id", p(req, "chapterId"));
  const { data, error } = await db.from("p2p_kingdom_story_chapters").delete().eq("id", p(req, "chapterId")).eq("story_id", p(req, "id")).select("id").maybeSingle();
  if (error) return dbFail(res, error, "Failed to remove chapter");
  if (!data) return err(res, "Chapter not found", 404);
  if (chMedia?.length) await db.storage.from("kingdom-stories-media").remove(chMedia.map((m) => m.media_path as string));
  // Close the gap so chapters stay numbered 1, 2, 3…
  const { data: rest } = await db.from("p2p_kingdom_story_chapters").select("id").eq("story_id", p(req, "id")).order("chapter_number", { ascending: true });
  if ((rest ?? []).length) await db.rpc("p2p_kingdom_story_reorder_chapters", { p_story_id: p(req, "id"), p_chapter_ids: (rest ?? []).map((c) => c.id) });
  return res.json({ removed: true });
});

export default router;
