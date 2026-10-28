import { Router } from "express";
import { supabaseServiceRole as db, supabaseAsUser, verifyCaller } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { moveToBin, sendRecycleError } from "../lib/recycleBin";
import catalogueRouter, { loadChapters } from "./kingdomStoriesCatalogue";
import libraryRouter from "./kingdomStoryLibrary";
import discoverRouter from "./kingdomStoryDiscover";
import { savesFor, libraryNotReady } from "../lib/kingdomStoryLibrary";
import { chapterLearning, storiesProgress, lockChapter } from "../lib/kingdomStoryLearning";

// Kingdom Stories — P2P-curated editorial content (migration 152).
// Genuinely different authorization model from every other content route
// in this file's neighborhood (Missions/Kingdom Wins/Prayer): there is NO
// author_id/editor_id-based ownership check anywhere below. Every write is
// gated purely by role (admin_content or super_admin — mirrors the DB's
// own p2p_is_kingdom_stories_editor()), so any authorized editor can edit
// or publish any story, not just their own. There is no official account,
// creator profile, or follower system — the content is the product.
const router = Router();
// Catalogue (migration 210): categories with counts, topics, chapters. First,
// so its two-segment paths are never taken for a story id.
router.use(catalogueRouter);
// Personal library (migration 215): /me/library, /:id/save, /:id/opened.
router.use(libraryRouter);
// Discovery homepage + editorial collections (migration 215).
router.use(discoverRouter);

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}
// A bad categoryId/scriptureReferenceId/related*Id is a client mistake, not
// a server fault — surface Postgres FK-violation (23503) and CHECK-violation
// (23514) errors as 400s instead of the generic 500 a raw insert/update
// failure would otherwise return.
function dbErrStatus(error: { code?: string } | null): number {
  return error?.code === "23503" || error?.code === "23514" || error?.code === "23505" ? 400 : 500;
}

// Refusals from the Publishing Studio publication gate and live-story freeze
// (migration 188, SQLSTATE S0423). A refused change leaves the story as it was.
const GATE_MESSAGES: Record<string, string> = {
  studio_approval_required: "This story must be approved in the Publishing Studio before it can be published. It remains unpublished.",
  studio_approval_stale: "This story changed after it was approved. It remains unpublished until it is reviewed again in the Publishing Studio.",
  studio_four_eyes: "This story's approval came from its own submitter. It remains unpublished until another editor approves it in the Publishing Studio.",
  studio_reviewer_ineligible: "The editor who approved this story can no longer approve content. It remains unpublished until another editor reviews it in the Publishing Studio.",
  studio_reviewer_missing: "This story's approval no longer has a reviewer. It remains unpublished until it is reviewed again in the Publishing Studio.",
  scripture_reference_required: "A Scripture Story must have a Scripture reference attached before it can be published. It remains unpublished.",
  chapters_incomplete: "Every chapter needs a title, a narrative, 5 Kingdom Lessons and 5 Peer Reflection Questions before the story can be published. It remains unpublished.",
  studio_live_edit_blocked: "This story is live, so its content (text, media and sources) cannot be changed in place. Unpublish it, make the change, and get it approved again in the Publishing Studio.",
};
function storyDbError(res: import("express").Response, error: { code?: string; message?: string } | null, fallback: string) {
  if (error?.code === "S0423") return res.status(409).json({ error: GATE_MESSAGES[error.message ?? ""] ?? GATE_MESSAGES.studio_approval_required, code: error.message, studioRequired: true });
  if (error?.code === "S0403") return err(res, "Your role cannot do this.", 403);
  if (error?.code === "S0401") return err(res, "Sign in again to continue.", 401);
  return err(res, error?.message ?? fallback, dbErrStatus(error));
}

/** The migration 188 status function does not exist on this database (not applied yet). */
function setStatusMissing(error: { code?: string; message?: string }) {
  return (error.code === "PGRST202" || error.code === "42883") && /p2p_kingdom_story_set_status/.test(error.message ?? "");
}

const CONTENT_TYPES = ["historical_story", "person", "movement", "event", "place", "present_day_story", "documentary", "scripture_story"];
const MEDIA_TYPES = ["image", "video"];
const SOURCE_TYPES = ["book", "article", "documentary", "primary_source", "oral_history", "website", "other"];
const OWNER_STATUSES = ["draft", "review", "published", "archived"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isEditor(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin_content" || data?.role === "super_admin";
}

function mapStory(row: Record<string, unknown>, extra?: { category?: { slug: string; title: string } | null; media?: unknown[]; sources?: unknown[]; chapters?: unknown[]; related?: Record<string, unknown> }) {
  return {
    id: row.id, title: row.title, subtitle: row.subtitle, categoryId: row.category_id, category: extra?.category ?? undefined,
    contentType: row.content_type, body: row.body,
    historicalPeriod: row.historical_period, startYear: row.start_year, endYear: row.end_year,
    location: row.location, people: row.people, learningSection: row.learning_section, reflection: row.reflection,
    scriptureReferenceId: row.scripture_reference_id,
    relatedMissionFieldId: row.related_mission_field_id, relatedMissionStoryId: row.related_mission_story_id,
    relatedCurriculumId: row.related_curriculum_id, relatedKingdomWinId: row.related_kingdom_win_id, relatedStoryId: row.related_story_id,
    related: extra?.related ?? undefined,
    isFeatured: row.is_featured, status: row.status, topicId: row.topic_id ?? null,
    // Stable display number within the category (migration 215), never the id.
    topicNumber: (row.topic_number as number | null | undefined) ?? null,
    // A story is never lost when its editor's account is removed — see
    // migration 152's header. No name is shown either way (this is
    // editorial content, not an author byline / creator identity).
    editorId: row.editor_id,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, archivedAt: row.archived_at,
    media: extra?.media ?? undefined, sources: extra?.sources ?? undefined, chapters: extra?.chapters ?? undefined,
  };
}

async function loadMedia(storyId: string) {
  const { data } = await db.from("p2p_kingdom_story_media").select("*").eq("story_id", storyId).order("display_order", { ascending: true });
  return (data ?? []).map((m) => ({
    id: m.id, mediaType: m.media_type, mediaPath: m.media_path, caption: m.caption,
    displayOrder: m.display_order, isCover: m.is_cover, durationSeconds: m.duration_seconds, chapterId: m.chapter_id ?? null,
    // Migration 212: accessibility + attribution (null until an editor adds them).
    altText: m.alt_text ?? null, sourceUrl: m.source_url ?? null, licenseNote: m.license_note ?? null, imageKind: m.image_kind ?? null,
    // Migration 215: where the image is used (null = cover/chapter/gallery by its other fields).
    role: m.role ?? null,
  }));
}
async function loadSources(storyId: string) {
  const { data } = await db.from("p2p_kingdom_story_sources").select("*").eq("story_id", storyId).order("display_order", { ascending: true });
  return (data ?? []).map((s) => ({
    id: s.id, title: s.title, publisher: s.publisher, url: s.url, citation: s.citation,
    sourceType: s.source_type, displayOrder: s.display_order, chapterId: s.chapter_id ?? null,
  }));
}
async function loadRelated(row: Record<string, unknown>) {
  const related: Record<string, unknown> = {};
  if (row.related_mission_field_id) {
    const { data } = await db.from("p2p_mission_fields").select("id,slug,title").eq("id", row.related_mission_field_id).maybeSingle();
    if (data) related.missionField = data;
  }
  if (row.related_mission_story_id) {
    const { data } = await db.from("p2p_mission_stories").select("id,title").eq("id", row.related_mission_story_id).maybeSingle();
    if (data) related.missionStory = data;
  }
  if (row.related_curriculum_id) {
    const { data } = await db.from("p2p_curriculums").select("id,title").eq("id", row.related_curriculum_id).maybeSingle();
    if (data) related.curriculum = data;
  }
  if (row.related_kingdom_win_id) {
    const { data } = await db.from("p2p_kingdom_wins").select("id,title").eq("id", row.related_kingdom_win_id).maybeSingle();
    if (data) related.kingdomWin = data;
  }
  if (row.related_story_id) {
    const { data } = await db.from("p2p_kingdom_stories").select("id,title,status").eq("id", row.related_story_id).eq("status", "published").maybeSingle();
    if (data) related.story = data;
  }
  return related;
}

// ── Categories (public list; editors see draft/archived too) ───────────────
router.get("/categories", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const editor = await isEditor(userId);
  let query = db.from("p2p_kingdom_story_categories").select("*").order("display_order", { ascending: true });
  if (!editor) query = query.eq("status", "published");
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((c) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description, displayOrder: c.display_order, status: c.status, icon: c.icon ?? null })));
});

// ── Peer feed: published only, paginated, optional category/featured filter ─
router.get("/feed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { category, featured, q, page = "0", limit = "20", sort = "topic" } = req.query as Record<string, string>;
  // topic (default: the approved topic order) | title | recent (recently added) | updated
  if (!["topic", "title", "recent", "updated"].includes(sort)) return err(res, "sort must be topic, title, recent or updated");
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  let categoryId: string | undefined;
  if (category) {
    const { data: cat } = await db.from("p2p_kingdom_story_categories").select("id").eq("slug", category).maybeSingle();
    if (!cat) return ok(res, { stories: [], total: 0, page: pageNum, pageSize });
    categoryId = cat.id;
  }

  // Title search over published stories only (never topics).
  const term = (q ?? "").split(String.fromCharCode(92)).join(" ").replace(/[%_]/g, " ").trim().slice(0, 100);
  const run = (order: string) => {
    let query = db.from("p2p_kingdom_stories").select("*", { count: "exact" }).eq("status", "published");
    query = order === "title" ? query.order("title", { ascending: true })
      : order === "updated" ? query.order("updated_at", { ascending: false })
      : order === "recent" ? query.order("published_at", { ascending: false })
      : query.order("topic_number", { ascending: true, nullsFirst: false }).order("published_at", { ascending: true });
    query = query.range(from, to);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (featured === "true") query = query.eq("is_featured", true);
    if (term) query = query.ilike("title", `%${term}%`);
    return query;
  };
  let { data, error, count } = await run(sort);
  // Topic numbers (migration 215) not on this database yet: the previous newest-first order.
  if (error && sort === "topic" && libraryNotReady(error)) ({ data, error, count } = await run("recent"));
  if (error) return err(res, error.message, 500);

  const categoryIds = [...new Set((data ?? []).map((r) => r.category_id))];
  const { data: cats } = categoryIds.length ? await db.from("p2p_kingdom_story_categories").select("id,slug,title").in("id", categoryIds) : { data: [] };
  const catById = new Map((cats ?? []).map((c) => [c.id, { slug: c.slug, title: c.title }]));

  const ids = (data ?? []).map((r) => r.id as string);
  const [progress, saves] = await Promise.all([storiesProgress(ids, userId), savesFor(userId, ids)]);
  const stories = await Promise.all((data ?? []).map(async (r) => {
    const { data: cover } = await db.from("p2p_kingdom_story_media").select("*").eq("story_id", r.id).eq("is_cover", true).maybeSingle();
    return {
      ...mapStory(r as Record<string, unknown>, {
        category: catById.get(r.category_id as string) ?? null,
        media: cover ? [{ id: cover.id, mediaType: cover.media_type, mediaPath: cover.media_path, caption: cover.caption, isCover: true, altText: cover.alt_text ?? null }] : [],
      }),
      // The reader's own progress through the book (chapters submitted or completed).
      myProgress: progress.get(r.id as string) ?? null,
      // The reader's own Favourite / Saved for Later (migration 215).
      mine: saves.get(r.id as string) ?? { favourite: false, later: false },
    };
  }));
  return ok(res, { stories, total: count ?? 0, page: pageNum, pageSize });
});

// ── Story detail ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: story } = await db.from("p2p_kingdom_stories").select("*").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Story not found", 404);
  const editor = await isEditor(userId);
  if (story.status !== "published" && !editor) return err(res, "Story not found", 404);

  const [{ data: category }, media, sources, related] = await Promise.all([
    db.from("p2p_kingdom_story_categories").select("id,slug,title").eq("id", story.category_id).maybeSingle(),
    loadMedia(story.id as string), loadSources(story.id as string), loadRelated(story as Record<string, unknown>),
  ]);
  const loaded = await loadChapters(story.id as string, sources);
  // Storybook (migration 212): each chapter's state for this reader. Editors
  // see every chapter in full; readers get a locked chapter's title only.
  const preview = editor && story.status !== "published";
  const { byChapter, progress } = await chapterLearning({ id: story.id as string, status: story.status as string }, loaded, userId, preview);
  const chapters = loaded.map((ch) => {
    const learning = byChapter.get(ch.id)!;
    const visible = learning.state === "locked" && !editor ? lockChapter(ch) : ch;
    return { ...visible, learning: learning.state === "locked" && !editor ? { ...learning, reflectionQuestions: [], check: null } : learning };
  });
  const mine = (await savesFor(userId, [story.id as string])).get(story.id as string) ?? { favourite: false, later: false };
  return ok(res, { ...mapStory(story as Record<string, unknown>, { category, media, sources, chapters, related }), progress, mine });
});

// A chapter with no Comprehensive Check is finished by reading it. (Chapters
// with a check finish through the check, like any Core Curriculum lesson.)
router.post("/:id/chapters/:chapterId/finish", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.chapterId)) return err(res, "Chapter not found", 404);
  const { data: story } = await db.from("p2p_kingdom_stories").select("id,status").eq("id", req.params.id).maybeSingle();
  if (!story || story.status !== "published") return err(res, "Chapter not found", 404);
  const { data: ch } = await db.from("p2p_kingdom_story_chapters").select("id,lesson_id").eq("id", req.params.chapterId).eq("story_id", req.params.id).maybeSingle();
  if (!ch?.lesson_id) return err(res, "Chapter not found", 404);
  const { data: check } = await db.from("p2p_assignments").select("id").eq("lesson_id", ch.lesson_id).maybeSingle();
  if (check) return err(res, "This chapter finishes when you submit its Comprehensive Check.", 409);
  const { data: open } = await db.rpc("p2p_kingdom_story_chapter_open", { p_user_id: userId, p_lesson_id: ch.lesson_id });
  if (open !== true) return err(res, "Complete the previous chapter first.", 403);
  // The database checks the same rule again on this write (migration 212).
  const { error } = await db.from("p2p_lesson_progress").upsert(
    { user_id: userId, lesson_id: ch.lesson_id, status: "completed", completed: true, progress_percent: 100, updated_at: new Date().toISOString() },
    { onConflict: "user_id,lesson_id" });
  if (error) return err(res, error.code === "23514" ? "Complete the previous chapter first." : error.message, error.code === "23514" ? 403 : 500);
  return ok(res, { finished: true });
});

// Everything below requires an authorized editor (admin_content/super_admin).
router.use(requireAdmin, requireRole("admin_content"));

// Prepare (or refresh) a draft's learning activities — reflections and
// Comprehensive Checks become Core Curriculum rows (migration 212) — so an
// editor can preview them. Publishing does the same automatically.
router.post("/:id/learning/sync", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return err(res, "Story not found", 404);
  const { data, error } = await db.rpc("p2p_kingdom_story_sync_learning", { p_story_id: req.params.id });
  if (error) {
    if (/story_not_found/.test(error.message)) return err(res, "Story not found", 404);
    if (/studio_live_edit_blocked/.test(error.message)) return err(res, "This story is live; its activities were prepared when it was published. Unpublish it to change them.", 409);
    if (/function .*p2p_kingdom_story_sync_learning/.test(error.message)) return err(res, "Storybook learning isn't available yet (migration 212 not applied).", 503);
    return err(res, error.message, 500);
  }
  return ok(res, data);
});

router.get("/admin/list", async (req, res) => {
  const { status } = req.query as { status?: string };
  let query = db.from("p2p_kingdom_stories").select("*").order("updated_at", { ascending: false });
  if (status) {
    if (!OWNER_STATUSES.includes(status)) return err(res, `status must be one of: ${OWNER_STATUSES.join(", ")}`);
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapStory(r as Record<string, unknown>)));
});

router.post("/", async (req, res) => {
  const adminUserId = (req as any).adminUserId as string;
  const {
    title, subtitle, categoryId, contentType, body, historicalPeriod, startYear, endYear, location, people,
    learningSection, reflection, scriptureReferenceId, relatedMissionFieldId, relatedMissionStoryId,
    relatedCurriculumId, relatedKingdomWinId, relatedStoryId, isFeatured,
  } = req.body as Record<string, unknown>;

  if (!title || typeof title !== "string" || !title.trim()) return err(res, "title is required");
  if (!body || typeof body !== "string" || !body.trim()) return err(res, "body is required");
  if (!categoryId || typeof categoryId !== "string" || !UUID_RE.test(categoryId)) return err(res, "categoryId is required");
  if (contentType !== undefined && contentType !== null && !CONTENT_TYPES.includes(contentType as string)) return err(res, `contentType must be one of: ${CONTENT_TYPES.join(", ")}`);

  const { data, error } = await db.from("p2p_kingdom_stories").insert({
    title: (title as string).trim(), subtitle: (subtitle as string)?.trim() || null, category_id: categoryId,
    content_type: contentType ?? null, body: (body as string).trim(),
    historical_period: (historicalPeriod as string)?.trim() || null,
    start_year: startYear ?? null, end_year: endYear ?? null,
    location: (location as string)?.trim() || null, people: (people as string)?.trim() || null,
    learning_section: (learningSection as string)?.trim() || null, reflection: (reflection as string)?.trim() || null,
    scripture_reference_id: scriptureReferenceId ?? null,
    related_mission_field_id: relatedMissionFieldId ?? null, related_mission_story_id: relatedMissionStoryId ?? null,
    related_curriculum_id: relatedCurriculumId ?? null, related_kingdom_win_id: relatedKingdomWinId ?? null,
    related_story_id: relatedStoryId ?? null, is_featured: !!isFeatured, editor_id: adminUserId,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create story", dbErrStatus(error));
  return ok(res, mapStory(data as Record<string, unknown>));
});

router.put("/:id", async (req, res) => {
  const { data: existing } = await db.from("p2p_kingdom_stories").select("*").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Story not found", 404);

  const {
    title, subtitle, categoryId, contentType, body, historicalPeriod, startYear, endYear, location, people,
    learningSection, reflection, scriptureReferenceId, relatedMissionFieldId, relatedMissionStoryId,
    relatedCurriculumId, relatedKingdomWinId, relatedStoryId, isFeatured, status, topicNumber,
  } = req.body as Record<string, unknown>;

  if (status !== undefined && !OWNER_STATUSES.includes(status as string)) return err(res, `status must be one of: ${OWNER_STATUSES.join(", ")}`);
  if (contentType !== undefined && contentType !== null && !CONTENT_TYPES.includes(contentType as string)) return err(res, `contentType must be one of: ${CONTENT_TYPES.join(", ")}`);

  const effectiveContentType = contentType !== undefined ? contentType : existing.content_type;
  const effectiveScripture = scriptureReferenceId !== undefined ? scriptureReferenceId : existing.scripture_reference_id;
  if (status === "published" && effectiveContentType === "scripture_story" && !effectiveScripture) {
    return err(res, "A Scripture Story must have a Scripture reference attached before it can be published.");
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!(title as string).trim()) return err(res, "title cannot be empty"); updates.title = (title as string).trim(); }
  if (subtitle !== undefined) updates.subtitle = (subtitle as string)?.trim() || null;
  if (categoryId !== undefined) { if (!UUID_RE.test(categoryId as string)) return err(res, "invalid categoryId"); updates.category_id = categoryId; }
  if (contentType !== undefined) updates.content_type = contentType;
  if (body !== undefined) { if (!(body as string).trim()) return err(res, "body cannot be empty"); updates.body = (body as string).trim(); }
  if (historicalPeriod !== undefined) updates.historical_period = (historicalPeriod as string)?.trim() || null;
  if (startYear !== undefined) updates.start_year = startYear;
  if (endYear !== undefined) updates.end_year = endYear;
  if (location !== undefined) updates.location = (location as string)?.trim() || null;
  if (people !== undefined) updates.people = (people as string)?.trim() || null;
  if (learningSection !== undefined) updates.learning_section = (learningSection as string)?.trim() || null;
  if (reflection !== undefined) updates.reflection = (reflection as string)?.trim() || null;
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (relatedMissionFieldId !== undefined) updates.related_mission_field_id = relatedMissionFieldId;
  if (relatedMissionStoryId !== undefined) updates.related_mission_story_id = relatedMissionStoryId;
  if (relatedCurriculumId !== undefined) updates.related_curriculum_id = relatedCurriculumId;
  if (relatedKingdomWinId !== undefined) updates.related_kingdom_win_id = relatedKingdomWinId;
  if (relatedStoryId !== undefined) {
    if (relatedStoryId === req.params.id) return err(res, "A story cannot relate to itself");
    updates.related_story_id = relatedStoryId;
  }
  if (isFeatured !== undefined) updates.is_featured = !!isFeatured;
  // Stable topic number (migration 215): unique within the category, never the id.
  if (topicNumber !== undefined) {
    if (topicNumber !== null && (!Number.isInteger(topicNumber) || (topicNumber as number) < 1 || (topicNumber as number) > 9999)) return err(res, "topicNumber must be a whole number from 1 to 9999");
    updates.topic_number = topicNumber;
  }

  // Field edits first (as before). A status change is a separate, named call
  // (migration 188): it is attributed to this editor, audited in the same
  // transaction, and publishing passes the Publishing Studio approval gate —
  // a story is published only if it was approved, by someone other than the
  // submitter, for exactly its current content.
  let data: Record<string, unknown> | null = existing as Record<string, unknown>;
  if (Object.keys(updates).length > 1) {
    const r = await db.from("p2p_kingdom_stories").update(updates).eq("id", req.params.id).select().single();
    if (r.error?.code === "23505" && /topic_number/.test(r.error.message ?? "")) return err(res, `Topic ${String(topicNumber).padStart(3, "0")} is already used by another story in this category.`, 409);
    if (r.error || !r.data) return storyDbError(res, r.error, "Failed to update story");
    data = r.data as Record<string, unknown>;
  }
  if (status !== undefined && status !== existing.status) {
    // As the signed-in editor (their verified token): the database takes the
    // actor from auth.uid(), never from a parameter.
    const r = await supabaseAsUser((req as any).adminToken as string).rpc("p2p_kingdom_story_set_status", { p_story_id: req.params.id, p_status: status });
    if (r.error && setStatusMissing(r.error)) {
      // Migration 188 is not applied on this database yet: the pre-188 status
      // update, unchanged. Once 188 is applied the function exists, and its
      // trigger gates this table on every path anyway.
      const legacy: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "published") legacy.published_at = new Date().toISOString();
      if (status === "archived" && !existing.archived_at) legacy.archived_at = new Date().toISOString();
      const l = await db.from("p2p_kingdom_stories").update(legacy).eq("id", req.params.id).select().single();
      if (l.error || !l.data) return storyDbError(res, l.error, "Failed to update story status");
      data = l.data as Record<string, unknown>;
    } else {
      if (r.error) return storyDbError(res, r.error, "Failed to update story status");
      data = r.data as Record<string, unknown>;
    }
  }
  return ok(res, mapStory(data as Record<string, unknown>));
});

// Deleting moves the story (chapters, images, sources) to the Admin Recycle
// Bin (migration 214); its files stay in storage until it is permanently
// deleted there. A live story must be unpublished first.
router.delete("/:id", async (req, res) => {
  const { data: existing } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Story not found", 404);
  try { await moveToBin((req as any).adminUserId as string, "kingdom_story", String(req.params.id)); }
  catch (e) { return sendRecycleError(res, e); }
  return ok(res, { removed: true, movedToRecycleBin: true });
});

// ── Media ────────────────────────────────────────────────────────────────
router.post("/:id/media", async (req, res) => {
  const { data: story } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Story not found", 404);
  const { id, mediaType, mediaPath, caption, displayOrder, isCover, durationSeconds, chapterId } = req.body as Record<string, unknown>;
  const attribution = mediaAttribution(req.body as Record<string, unknown>);
  if ("error" in attribution) return err(res, attribution.error);
  // Optional (migration 211): the chapter this image illustrates — must be a chapter of this story (enforced by the database too).
  if (chapterId !== undefined && chapterId !== null && (typeof chapterId !== "string" || !UUID_RE.test(chapterId))) return err(res, "invalid chapterId");
  if (!mediaType || !MEDIA_TYPES.includes(mediaType as string)) return err(res, `mediaType must be one of: ${MEDIA_TYPES.join(", ")}`);
  if (!mediaPath || typeof mediaPath !== "string") return err(res, "mediaPath is required");
  if (!mediaPath.startsWith(`${req.params.id}/`)) return err(res, "mediaPath must belong to this story", 400);

  if (attribution.fields.role === "hero") {
    const clear = await db.from("p2p_kingdom_story_media").update({ role: null }).eq("story_id", req.params.id).eq("role", "hero");
    if (clear.error) return storyDbError(res, clear.error, "Failed to add media");
  }
  const { data, error } = await db.from("p2p_kingdom_story_media").insert({
    ...(id ? { id } : {}), story_id: req.params.id, media_type: mediaType, media_path: mediaPath,
    caption: (caption as string)?.trim() || null, display_order: displayOrder ?? 0, is_cover: !!isCover,
    duration_seconds: durationSeconds ?? null, ...(chapterId ? { chapter_id: chapterId } : {}), ...attribution.fields,
  }).select().single();
  if (error || !data) return storyDbError(res, error, "Failed to add media");
  return ok(res, { id: data.id, mediaType: data.media_type, mediaPath: data.media_path, caption: data.caption, displayOrder: data.display_order, isCover: data.is_cover, durationSeconds: data.duration_seconds, chapterId: data.chapter_id ?? null, altText: data.alt_text ?? null, sourceUrl: data.source_url ?? null, licenseNote: data.license_note ?? null, imageKind: data.image_kind ?? null, role: data.role ?? null });
});

router.put("/:id/media/:mediaId", async (req, res) => {
  const { caption, displayOrder, isCover, chapterId } = req.body as Record<string, unknown>;
  const attribution = mediaAttribution(req.body as Record<string, unknown>);
  if ("error" in attribution) return err(res, attribution.error);
  const updates: Record<string, unknown> = { ...attribution.fields };
  if (chapterId !== undefined) {
    if (chapterId !== null && (typeof chapterId !== "string" || !UUID_RE.test(chapterId))) return err(res, "invalid chapterId");
    updates.chapter_id = chapterId;
  }
  if (caption !== undefined) updates.caption = (caption as string)?.trim() || null;
  if (displayOrder !== undefined) updates.display_order = displayOrder;
  if (isCover !== undefined) updates.is_cover = !!isCover;
  if (updates.role === "hero") {
    const clear = await db.from("p2p_kingdom_story_media").update({ role: null }).eq("story_id", req.params.id).eq("role", "hero").neq("id", req.params.mediaId);
    if (clear.error) return storyDbError(res, clear.error, "Failed to update media");
  }
  const { data, error } = await db.from("p2p_kingdom_story_media").update(updates).eq("id", req.params.mediaId).eq("story_id", req.params.id).select().maybeSingle();
  if (error) return storyDbError(res, error, "Failed to update media");
  if (!data) return err(res, "Media item not found", 404);
  return ok(res, { id: data.id, mediaType: data.media_type, mediaPath: data.media_path, caption: data.caption, displayOrder: data.display_order, isCover: data.is_cover, chapterId: data.chapter_id ?? null, altText: data.alt_text ?? null, sourceUrl: data.source_url ?? null, licenseNote: data.license_note ?? null, imageKind: data.image_kind ?? null, role: data.role ?? null });
});

// Optional image attribution + accessibility (migration 212). Only fields sent are changed.
// "artistic_illustration" was retired 2026-10-28 (editor: no such label on images); the DB still tolerates old values.
const IMAGE_KINDS = ["historical_photograph", "artefact", "manuscript", "location_photograph", "ai_generated", "other"];
// Migration 215: where an image is used. One hero per story (setting a new one clears the old).
const MEDIA_ROLES = ["cover", "hero", "overview", "chapter", "thumbnail", "gallery"];
function mediaAttribution(b: Record<string, unknown>): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  for (const [k, col, max] of [["altText", "alt_text", 1000], ["sourceUrl", "source_url", 2000], ["licenseNote", "license_note", 1000]] as const) {
    if (b[k] === undefined) continue;
    if (b[k] !== null && typeof b[k] !== "string") return { error: `${k} must be text` };
    const v = ((b[k] as string | null) ?? "").trim();
    if (v.length > max) return { error: `${k} is too long` };
    fields[col] = v || null;
  }
  if (b.role !== undefined) {
    if (b.role !== null && !MEDIA_ROLES.includes(b.role as string)) return { error: `role must be one of: ${MEDIA_ROLES.join(", ")}` };
    fields.role = b.role ?? null;
  }
  if (b.imageKind !== undefined) {
    if (b.imageKind !== null && !IMAGE_KINDS.includes(b.imageKind as string)) return { error: `imageKind must be one of: ${IMAGE_KINDS.join(", ")}` };
    fields.image_kind = b.imageKind ?? null;
  }
  return { fields };
}

router.delete("/:id/media/:mediaId", async (req, res) => {
  const { data: media } = await db.from("p2p_kingdom_story_media").select("media_path").eq("id", req.params.mediaId).eq("story_id", req.params.id).maybeSingle();
  if (!media) return err(res, "Media item not found", 404);
  // To the Recycle Bin (a live story's media stays frozen); the file is kept until purged there.
  try { await moveToBin((req as any).adminUserId as string, "kingdom_story_media", String(req.params.mediaId)); }
  catch (e) { return sendRecycleError(res, e); }
  return ok(res, { removed: true, movedToRecycleBin: true });
});

// ── Sources ──────────────────────────────────────────────────────────────
router.post("/:id/sources", async (req, res) => {
  const { data: story } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Story not found", 404);
  const { title, publisher, url, citation, sourceType, displayOrder, chapterId } = req.body as Record<string, unknown>;
  if (!title || typeof title !== "string" || !title.trim()) return err(res, "title is required");
  if (chapterId !== undefined && chapterId !== null && (typeof chapterId !== "string" || !UUID_RE.test(chapterId))) return err(res, "invalid chapterId");
  if (sourceType !== undefined && sourceType !== null && !SOURCE_TYPES.includes(sourceType as string)) return err(res, `sourceType must be one of: ${SOURCE_TYPES.join(", ")}`);

  const { data, error } = await db.from("p2p_kingdom_story_sources").insert({
    story_id: req.params.id, title: (title as string).trim(), publisher: (publisher as string)?.trim() || null,
    url: (url as string)?.trim() || null, citation: (citation as string)?.trim() || null,
    source_type: sourceType ?? null, display_order: displayOrder ?? 0, ...(chapterId ? { chapter_id: chapterId } : {}),
  }).select().single();
  if (error || !data) return storyDbError(res, error, "Failed to add source");
  return ok(res, { id: data.id, title: data.title, publisher: data.publisher, url: data.url, citation: data.citation, sourceType: data.source_type, displayOrder: data.display_order, chapterId: data.chapter_id ?? null });
});

router.delete("/:id/sources/:sourceId", async (req, res) => {
  const { data: src } = await db.from("p2p_kingdom_story_sources").select("id").eq("id", req.params.sourceId).eq("story_id", req.params.id).maybeSingle();
  if (!src) return ok(res, { removed: true });
  try { await moveToBin((req as any).adminUserId as string, "kingdom_story_source", String(req.params.sourceId)); }
  catch (e) { return sendRecycleError(res, e); }
  return ok(res, { removed: true, movedToRecycleBin: true });
});

// ── Categories management (editor) ──────────────────────────────────────
router.post("/admin/categories", async (req, res) => {
  const { slug, title, description, displayOrder } = req.body as Record<string, unknown>;
  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) return err(res, "slug is required and must be lowercase-kebab-case");
  if (!title || typeof title !== "string" || !title.trim()) return err(res, "title is required");
  const { data, error } = await db.from("p2p_kingdom_story_categories").insert({
    slug, title: (title as string).trim(), description: (description as string)?.trim() || null, display_order: displayOrder ?? 0,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create category", 500);
  return ok(res, { id: data.id, slug: data.slug, title: data.title, description: data.description, displayOrder: data.display_order, status: data.status, icon: data.icon ?? null, coverImagePath: data.cover_image_path ?? null });
});

router.put("/admin/categories/:id", async (req, res) => {
  const { title, description, displayOrder, status, icon, coverImagePath } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (icon !== undefined) updates.icon = typeof icon === "string" && icon.trim() ? icon.trim().slice(0, 60) : null;
  if (coverImagePath !== undefined) updates.cover_image_path = typeof coverImagePath === "string" && coverImagePath.trim() ? coverImagePath.trim() : null;
  if (title !== undefined) updates.title = (title as string).trim();
  if (description !== undefined) updates.description = (description as string)?.trim() || null;
  if (displayOrder !== undefined) updates.display_order = displayOrder;
  if (status !== undefined) {
    if (!["draft", "published", "archived"].includes(status as string)) return err(res, "invalid status");
    updates.status = status;
  }
  const { data, error } = await db.from("p2p_kingdom_story_categories").update(updates).eq("id", req.params.id).select().maybeSingle();
  if (error) return err(res, error.message, 500);
  if (!data) return err(res, "Category not found", 404);
  return ok(res, { id: data.id, slug: data.slug, title: data.title, description: data.description, displayOrder: data.display_order, status: data.status, icon: data.icon ?? null, coverImagePath: data.cover_image_path ?? null });
});

export default router;
