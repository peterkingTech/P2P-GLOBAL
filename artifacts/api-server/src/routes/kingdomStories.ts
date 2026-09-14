import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";

// Kingdom Stories — P2P-curated editorial content (migration 152).
// Genuinely different authorization model from every other content route
// in this file's neighborhood (Missions/Kingdom Wins/Prayer): there is NO
// author_id/editor_id-based ownership check anywhere below. Every write is
// gated purely by role (admin_content or super_admin — mirrors the DB's
// own p2p_is_kingdom_stories_editor()), so any authorized editor can edit
// or publish any story, not just their own. There is no official account,
// creator profile, or follower system — the content is the product.
const router = Router();

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

const CONTENT_TYPES = ["historical_story", "person", "movement", "event", "place", "present_day_story", "documentary", "scripture_story"];
const MEDIA_TYPES = ["image", "video"];
const SOURCE_TYPES = ["book", "article", "documentary", "primary_source", "oral_history", "website", "other"];
const OWNER_STATUSES = ["draft", "review", "published", "archived"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isEditor(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin_content" || data?.role === "super_admin";
}

function mapStory(row: Record<string, unknown>, extra?: { category?: { slug: string; title: string } | null; media?: unknown[]; sources?: unknown[]; related?: Record<string, unknown> }) {
  return {
    id: row.id, title: row.title, subtitle: row.subtitle, categoryId: row.category_id, category: extra?.category ?? undefined,
    contentType: row.content_type, body: row.body,
    historicalPeriod: row.historical_period, startYear: row.start_year, endYear: row.end_year,
    location: row.location, people: row.people, learningSection: row.learning_section, reflection: row.reflection,
    scriptureReferenceId: row.scripture_reference_id,
    relatedMissionFieldId: row.related_mission_field_id, relatedMissionStoryId: row.related_mission_story_id,
    relatedCurriculumId: row.related_curriculum_id, relatedKingdomWinId: row.related_kingdom_win_id, relatedStoryId: row.related_story_id,
    related: extra?.related ?? undefined,
    isFeatured: row.is_featured, status: row.status,
    // A story is never lost when its editor's account is removed — see
    // migration 152's header. No name is shown either way (this is
    // editorial content, not an author byline / creator identity).
    editorId: row.editor_id,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, archivedAt: row.archived_at,
    media: extra?.media ?? undefined, sources: extra?.sources ?? undefined,
  };
}

async function loadMedia(storyId: string) {
  const { data } = await db.from("p2p_kingdom_story_media").select("*").eq("story_id", storyId).order("display_order", { ascending: true });
  return (data ?? []).map((m) => ({
    id: m.id, mediaType: m.media_type, mediaPath: m.media_path, caption: m.caption,
    displayOrder: m.display_order, isCover: m.is_cover, durationSeconds: m.duration_seconds,
  }));
}
async function loadSources(storyId: string) {
  const { data } = await db.from("p2p_kingdom_story_sources").select("*").eq("story_id", storyId).order("display_order", { ascending: true });
  return (data ?? []).map((s) => ({
    id: s.id, title: s.title, publisher: s.publisher, url: s.url, citation: s.citation,
    sourceType: s.source_type, displayOrder: s.display_order,
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
  return ok(res, (data ?? []).map((c) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description, displayOrder: c.display_order, status: c.status })));
});

// ── Peer feed: published only, paginated, optional category/featured filter ─
router.get("/feed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { category, featured, page = "0", limit = "20" } = req.query as Record<string, string>;
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

  let query = db.from("p2p_kingdom_stories").select("*", { count: "exact" })
    .eq("status", "published").order("published_at", { ascending: false }).range(from, to);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (featured === "true") query = query.eq("is_featured", true);
  const { data, error, count } = await query;
  if (error) return err(res, error.message, 500);

  const categoryIds = [...new Set((data ?? []).map((r) => r.category_id))];
  const { data: cats } = categoryIds.length ? await db.from("p2p_kingdom_story_categories").select("id,slug,title").in("id", categoryIds) : { data: [] };
  const catById = new Map((cats ?? []).map((c) => [c.id, { slug: c.slug, title: c.title }]));

  const stories = await Promise.all((data ?? []).map(async (r) => {
    const { data: cover } = await db.from("p2p_kingdom_story_media").select("*").eq("story_id", r.id).eq("is_cover", true).maybeSingle();
    return mapStory(r as Record<string, unknown>, {
      category: catById.get(r.category_id as string) ?? null,
      media: cover ? [{ id: cover.id, mediaType: cover.media_type, mediaPath: cover.media_path, caption: cover.caption, isCover: true }] : [],
    });
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
  return ok(res, mapStory(story as Record<string, unknown>, { category, media, sources, related }));
});

// Everything below requires an authorized editor (admin_content/super_admin).
router.use(requireAdmin, requireRole("admin_content"));

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
    relatedCurriculumId, relatedKingdomWinId, relatedStoryId, isFeatured, status,
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
  if (status !== undefined) {
    updates.status = status;
    if (status === "published" && existing.status !== "published") updates.published_at = new Date().toISOString();
    if (status === "archived" && !existing.archived_at) updates.archived_at = new Date().toISOString();
  }

  const { data, error } = await db.from("p2p_kingdom_stories").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update story", dbErrStatus(error));
  return ok(res, mapStory(data as Record<string, unknown>));
});

router.delete("/:id", async (req, res) => {
  const { data: existing } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Story not found", 404);
  const media = await loadMedia(req.params.id);
  if (media.length) await db.storage.from("kingdom-stories-media").remove(media.map((m: any) => m.mediaPath));
  const { error } = await db.from("p2p_kingdom_stories").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// ── Media ────────────────────────────────────────────────────────────────
router.post("/:id/media", async (req, res) => {
  const { data: story } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Story not found", 404);
  const { id, mediaType, mediaPath, caption, displayOrder, isCover, durationSeconds } = req.body as Record<string, unknown>;
  if (!mediaType || !MEDIA_TYPES.includes(mediaType as string)) return err(res, `mediaType must be one of: ${MEDIA_TYPES.join(", ")}`);
  if (!mediaPath || typeof mediaPath !== "string") return err(res, "mediaPath is required");
  if (!mediaPath.startsWith(`${req.params.id}/`)) return err(res, "mediaPath must belong to this story", 400);

  const { data, error } = await db.from("p2p_kingdom_story_media").insert({
    ...(id ? { id } : {}), story_id: req.params.id, media_type: mediaType, media_path: mediaPath,
    caption: (caption as string)?.trim() || null, display_order: displayOrder ?? 0, is_cover: !!isCover,
    duration_seconds: durationSeconds ?? null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to add media", dbErrStatus(error));
  return ok(res, { id: data.id, mediaType: data.media_type, mediaPath: data.media_path, caption: data.caption, displayOrder: data.display_order, isCover: data.is_cover, durationSeconds: data.duration_seconds });
});

router.put("/:id/media/:mediaId", async (req, res) => {
  const { caption, displayOrder, isCover } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (caption !== undefined) updates.caption = (caption as string)?.trim() || null;
  if (displayOrder !== undefined) updates.display_order = displayOrder;
  if (isCover !== undefined) updates.is_cover = !!isCover;
  const { data, error } = await db.from("p2p_kingdom_story_media").update(updates).eq("id", req.params.mediaId).eq("story_id", req.params.id).select().maybeSingle();
  if (error) return err(res, error.message, 500);
  if (!data) return err(res, "Media item not found", 404);
  return ok(res, { id: data.id, mediaType: data.media_type, mediaPath: data.media_path, caption: data.caption, displayOrder: data.display_order, isCover: data.is_cover });
});

router.delete("/:id/media/:mediaId", async (req, res) => {
  const { data: media } = await db.from("p2p_kingdom_story_media").select("media_path").eq("id", req.params.mediaId).eq("story_id", req.params.id).maybeSingle();
  if (!media) return err(res, "Media item not found", 404);
  await db.storage.from("kingdom-stories-media").remove([media.media_path as string]);
  const { error } = await db.from("p2p_kingdom_story_media").delete().eq("id", req.params.mediaId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// ── Sources ──────────────────────────────────────────────────────────────
router.post("/:id/sources", async (req, res) => {
  const { data: story } = await db.from("p2p_kingdom_stories").select("id").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Story not found", 404);
  const { title, publisher, url, citation, sourceType, displayOrder } = req.body as Record<string, unknown>;
  if (!title || typeof title !== "string" || !title.trim()) return err(res, "title is required");
  if (sourceType !== undefined && sourceType !== null && !SOURCE_TYPES.includes(sourceType as string)) return err(res, `sourceType must be one of: ${SOURCE_TYPES.join(", ")}`);

  const { data, error } = await db.from("p2p_kingdom_story_sources").insert({
    story_id: req.params.id, title: (title as string).trim(), publisher: (publisher as string)?.trim() || null,
    url: (url as string)?.trim() || null, citation: (citation as string)?.trim() || null,
    source_type: sourceType ?? null, display_order: displayOrder ?? 0,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to add source", dbErrStatus(error));
  return ok(res, { id: data.id, title: data.title, publisher: data.publisher, url: data.url, citation: data.citation, sourceType: data.source_type, displayOrder: data.display_order });
});

router.delete("/:id/sources/:sourceId", async (req, res) => {
  const { error } = await db.from("p2p_kingdom_story_sources").delete().eq("id", req.params.sourceId).eq("story_id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
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
  return ok(res, { id: data.id, slug: data.slug, title: data.title, description: data.description, displayOrder: data.display_order, status: data.status });
});

router.put("/admin/categories/:id", async (req, res) => {
  const { title, description, displayOrder, status } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
  return ok(res, { id: data.id, slug: data.slug, title: data.title, description: data.description, displayOrder: data.display_order, status: data.status });
});

export default router;
