import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";

// Missions Stage 1 — Mission Content Foundation (migration 146). Mounted
// at /missions/*. A genuinely new, independent content domain — never
// reads from or writes to the legacy p2p_missions table or
// p2p_prayer_wall_posts (the two systems the current (tabs)/missions.tsx
// screen couples to, per the Stage 0 forensic report). Content creation is
// admin-role-gated (requireAdmin) since no "verified missionary" role
// exists yet — see migration 146's own comment for why is_official_account
// and is_verified were both rejected as reuse candidates.
const router = Router();

// Curated, API-validated mission-focus tags — not a DB enum, so the list
// can grow without a migration, mirroring how Pray the Word's topic list
// isn't DB-enforced either.
const MISSION_FOCUS_TAGS = [
  "evangelism", "discipleship", "church_planting", "bible_translation", "youth", "children",
  "education", "compassion", "medical_missions", "community_development", "refugees",
  "persecuted_church", "unreached_peoples", "cross_cultural_missions", "leadership_development", "digital_missions",
];
const STORY_TYPES = ["story", "testimony", "update", "growth_story", "scripture_reflection"];

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}
function validFocus(tags: unknown): tags is string[] {
  return Array.isArray(tags) && tags.every((t) => typeof t === "string" && MISSION_FOCUS_TAGS.includes(t));
}

function mapField(row: Record<string, unknown>) {
  return {
    id: row.id, slug: row.slug, title: row.title, country: row.country, region: row.region, context: row.context,
    description: row.description, missionFocus: row.mission_focus, status: row.status, displayOrder: row.display_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapStory(row: Record<string, unknown>, extra?: { authorName?: string | null; field?: Record<string, unknown> | null }) {
  return {
    id: row.id, authorId: row.author_id, authorName: extra?.authorName ?? undefined, storyType: row.story_type,
    title: row.title, summary: row.summary, body: row.body, missionFieldId: row.mission_field_id,
    missionField: extra?.field ? mapField(extra.field) : undefined, missionFocus: row.mission_focus,
    scriptureReferenceId: row.scripture_reference_id, mediaType: row.media_type, mediaPath: row.media_path,
    mediaDurationSeconds: row.media_duration_seconds, status: row.status, createdAt: row.created_at,
    updatedAt: row.updated_at, publishedAt: row.published_at,
  };
}
function mapPrayerPoint(row: Record<string, unknown>) {
  return {
    id: row.id, title: row.title, description: row.description, scriptureReferenceId: row.scripture_reference_id,
    missionStoryId: row.mission_story_id, missionFieldId: row.mission_field_id, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
async function profileName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? "A contributor";
}

// ── Public/user reads ───────────────────────────────────────────────────────

router.get("/focus-tags", async (req, res) => ok(res, MISSION_FOCUS_TAGS));

router.get("/fields", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  let query = db.from("p2p_mission_fields").select("*").eq("status", "published").order("display_order", { ascending: true });
  const { focus } = req.query as { focus?: string };
  if (focus) query = query.contains("mission_focus", [focus]);
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapField));
});

router.get("/fields/:slug", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: field } = await db.from("p2p_mission_fields").select("*").eq("slug", req.params.slug).maybeSingle();
  if (!field || field.status !== "published") return err(res, "Mission field not found", 404);

  const { data: stories } = await db.from("p2p_mission_stories").select("*")
    .eq("mission_field_id", field.id as string).eq("status", "published").order("published_at", { ascending: false });
  const { data: prayerPoints } = await db.from("p2p_mission_prayer_points").select("*")
    .eq("mission_field_id", field.id as string).eq("status", "published").order("created_at", { ascending: false });

  return ok(res, {
    ...mapField(field as Record<string, unknown>),
    stories: (stories ?? []).map((s) => mapStory(s as Record<string, unknown>)),
    prayerPoints: (prayerPoints ?? []).map((p) => mapPrayerPoint(p as Record<string, unknown>)),
  });
});

router.get("/stories", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { fieldSlug, focus, storyType, page = "0", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("p2p_mission_stories").select("*, field:p2p_mission_fields(*)", { count: "exact" })
    .eq("status", "published").order("published_at", { ascending: false }).range(from, to);
  if (focus) query = query.contains("mission_focus", [focus]);
  if (storyType) {
    if (!STORY_TYPES.includes(storyType)) return err(res, `storyType must be one of: ${STORY_TYPES.join(", ")}`);
    query = query.eq("story_type", storyType);
  }
  if (fieldSlug) {
    const { data: field } = await db.from("p2p_mission_fields").select("id").eq("slug", fieldSlug).maybeSingle();
    if (!field) return ok(res, { stories: [], total: 0, page: pageNum, pageSize });
    query = query.eq("mission_field_id", field.id as string);
  }
  const { data, error, count } = await query;
  if (error) return err(res, error.message, 500);
  const withNames = await Promise.all((data ?? []).map(async (r: any) => mapStory(r, { authorName: await profileName(r.author_id), field: r.field })));
  return ok(res, { stories: withNames, total: count ?? 0, page: pageNum, pageSize });
});

router.get("/stories/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: story } = await db.from("p2p_mission_stories").select("*, field:p2p_mission_fields(*)").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Mission story not found", 404);
  const viewable = story.status === "published" || story.author_id === userId;
  if (!viewable) return err(res, "This story is not available", 404);

  const { data: prayerPoints } = await db.from("p2p_mission_prayer_points").select("*")
    .eq("mission_story_id", story.id as string).eq("status", "published");
  const { data: related } = await db.from("p2p_mission_stories").select("id,title,summary,story_type")
    .eq("status", "published").eq("mission_field_id", story.mission_field_id as string).neq("id", story.id as string).limit(5);

  return ok(res, {
    ...mapStory(story as any, { authorName: await profileName(story.author_id as string), field: (story as any).field }),
    prayerPoints: (prayerPoints ?? []).map((p) => mapPrayerPoint(p as Record<string, unknown>)),
    relatedStories: related ?? [],
  });
});

router.get("/prayer-points", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { storyId, fieldId } = req.query as { storyId?: string; fieldId?: string };
  let query = db.from("p2p_mission_prayer_points").select("*").eq("status", "published");
  if (storyId) query = query.eq("mission_story_id", storyId);
  if (fieldId) query = query.eq("mission_field_id", fieldId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((p) => mapPrayerPoint(p as Record<string, unknown>)));
});

// ── Saved Mission Stories ────────────────────────────────────────────────────

router.post("/saved-stories", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { storyId } = req.body as { storyId?: string };
  if (!storyId) return err(res, "storyId is required");
  const { data: story } = await db.from("p2p_mission_stories").select("id").eq("id", storyId).eq("status", "published").maybeSingle();
  if (!story) return err(res, "Mission story not found", 404);
  const { data, error } = await db.from("p2p_saved_mission_stories").upsert({ user_id: userId, story_id: storyId }, { onConflict: "user_id,story_id" }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save story", 500);
  return ok(res, { id: data.id, storyId: data.story_id, savedAt: data.saved_at });
});
router.delete("/saved-stories/:storyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_saved_mission_stories").delete().eq("user_id", userId).eq("story_id", req.params.storyId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});
router.get("/saved-stories", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_saved_mission_stories").select("id,saved_at,story:p2p_mission_stories(*)").eq("user_id", userId).order("saved_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({ id: r.id, savedAt: r.saved_at, story: r.story ? mapStory(r.story) : null })));
});

// ── Contributor: story authoring (admin-gated — see file header) ───────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/mine/stories", requireAdmin, async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_mission_stories").select("*").eq("author_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapStory(r as Record<string, unknown>)));
});

router.post("/stories", requireAdmin, async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const {
    id, storyType, title, summary, body, missionFieldId, missionFocus, scriptureReferenceId,
    mediaType, mediaPath, mediaDurationSeconds, status,
  } = req.body as {
    id?: string; storyType?: string; title?: string; summary?: string | null; body?: string; missionFieldId?: string | null;
    missionFocus?: string[]; scriptureReferenceId?: string | null; mediaType?: "video" | "photo" | null; mediaPath?: string | null;
    mediaDurationSeconds?: number | null; status?: string;
  };
  if (id !== undefined && !UUID_RE.test(id)) return err(res, "id must be a valid UUID");
  if (!storyType || !STORY_TYPES.includes(storyType)) return err(res, `storyType must be one of: ${STORY_TYPES.join(", ")}`);
  if (!title?.trim()) return err(res, "title is required");
  if (!body?.trim()) return err(res, "body is required");
  if (mediaType !== undefined && mediaType !== null && !["video", "photo"].includes(mediaType)) return err(res, "mediaType must be video or photo");
  if (missionFocus !== undefined && !validFocus(missionFocus)) return err(res, `missionFocus must be a subset of: ${MISSION_FOCUS_TAGS.join(", ")}`);
  if (status !== undefined && !["draft", "pending", "published", "archived", "removed"].includes(status)) {
    return err(res, "invalid status");
  }
  if (missionFieldId) {
    const { data: field } = await db.from("p2p_mission_fields").select("id").eq("id", missionFieldId).maybeSingle();
    if (!field) return err(res, "Mission field not found", 404);
  }
  if (mediaType && !mediaPath) return err(res, "mediaPath is required when mediaType is set");
  if (mediaPath) {
    const segments = mediaPath.split("/");
    if (!mediaPath.startsWith(`${userId}/`)) return err(res, "mediaPath must be under your own storage prefix", 403);
    if (!id || segments[1] !== id) return err(res, "mediaPath must belong to this story's id", 400);
  }

  const isPublishing = status === "published";
  const { data, error } = await db.from("p2p_mission_stories").insert({
    ...(id ? { id } : {}),
    author_id: userId, story_type: storyType, title: title.trim(), summary: summary?.trim() || null, body: body.trim(),
    mission_field_id: missionFieldId ?? null, mission_focus: missionFocus ?? [], scripture_reference_id: scriptureReferenceId ?? null,
    media_type: mediaType ?? null, media_path: mediaPath ?? null, media_duration_seconds: mediaDurationSeconds ?? null,
    status: status ?? "draft", published_at: isPublishing ? new Date().toISOString() : null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create mission story", 500);
  return ok(res, mapStory(data as Record<string, unknown>));
});

router.put("/stories/:id", requireAdmin, async (req, res) => {
  const { data: existing } = await db.from("p2p_mission_stories").select("id,status").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Mission story not found", 404);

  const { title, summary, body, missionFieldId, missionFocus, scriptureReferenceId, status } = req.body as {
    title?: string; summary?: string | null; body?: string; missionFieldId?: string | null; missionFocus?: string[];
    scriptureReferenceId?: string | null; status?: string;
  };
  if (missionFocus !== undefined && !validFocus(missionFocus)) return err(res, `missionFocus must be a subset of: ${MISSION_FOCUS_TAGS.join(", ")}`);
  if (status !== undefined && !["draft", "pending", "published", "archived", "removed"].includes(status)) return err(res, "invalid status");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (summary !== undefined) updates.summary = summary?.trim() || null;
  if (body !== undefined) { if (!body.trim()) return err(res, "body cannot be empty"); updates.body = body.trim(); }
  if (missionFieldId !== undefined) updates.mission_field_id = missionFieldId;
  if (missionFocus !== undefined) updates.mission_focus = missionFocus;
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (status !== undefined) {
    updates.status = status;
    if (status === "published" && existing.status !== "published") updates.published_at = new Date().toISOString();
  }

  const { data, error } = await db.from("p2p_mission_stories").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update mission story", 500);
  return ok(res, mapStory(data as Record<string, unknown>));
});

router.delete("/stories/:id", requireAdmin, async (req, res) => {
  const { data: story } = await db.from("p2p_mission_stories").select("id,media_path").eq("id", req.params.id).maybeSingle();
  if (!story) return err(res, "Mission story not found", 404);
  if (story.media_path) await db.storage.from("mission-media").remove([story.media_path as string]);
  const { error } = await db.from("p2p_mission_stories").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// ── Admin: fields + prayer points ───────────────────────────────────────────

router.get("/admin/fields", requireAdmin, async (req, res) => {
  const { data, error } = await db.from("p2p_mission_fields").select("*").order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapField));
});
router.post("/admin/fields", requireAdmin, async (req, res) => {
  const userId = await verifyCaller(req);
  const { slug, title, country, region, context, description, missionFocus, status, displayOrder } = req.body as {
    slug?: string; title?: string; country?: string; region?: string | null; context?: string | null;
    description?: string | null; missionFocus?: string[]; status?: string; displayOrder?: number;
  };
  if (!slug?.trim()) return err(res, "slug is required");
  if (!title?.trim()) return err(res, "title is required");
  if (!country?.trim()) return err(res, "country is required");
  if (missionFocus !== undefined && !validFocus(missionFocus)) return err(res, `missionFocus must be a subset of: ${MISSION_FOCUS_TAGS.join(", ")}`);
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) return err(res, "invalid status");
  const { data, error } = await db.from("p2p_mission_fields").insert({
    slug: slug.trim(), title: title.trim(), country: country.trim(), region: region?.trim() || null,
    context: context?.trim() || null, description: description?.trim() || null, mission_focus: missionFocus ?? [],
    status: status ?? "draft", display_order: displayOrder ?? 0, created_by: userId ?? null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create mission field", 500);
  return ok(res, mapField(data as Record<string, unknown>));
});
router.put("/admin/fields/:id", requireAdmin, async (req, res) => {
  const { data: existing } = await db.from("p2p_mission_fields").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Mission field not found", 404);
  const { title, country, region, context, description, missionFocus, status, displayOrder } = req.body as {
    title?: string; country?: string; region?: string | null; context?: string | null; description?: string | null;
    missionFocus?: string[]; status?: string; displayOrder?: number;
  };
  if (missionFocus !== undefined && !validFocus(missionFocus)) return err(res, `missionFocus must be a subset of: ${MISSION_FOCUS_TAGS.join(", ")}`);
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) return err(res, "invalid status");
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (country !== undefined) updates.country = country.trim();
  if (region !== undefined) updates.region = region?.trim() || null;
  if (context !== undefined) updates.context = context?.trim() || null;
  if (description !== undefined) updates.description = description?.trim() || null;
  if (missionFocus !== undefined) updates.mission_focus = missionFocus;
  if (status !== undefined) updates.status = status;
  if (displayOrder !== undefined) updates.display_order = displayOrder;
  const { data, error } = await db.from("p2p_mission_fields").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update mission field", 500);
  return ok(res, mapField(data as Record<string, unknown>));
});
router.delete("/admin/fields/:id", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_mission_fields").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.post("/admin/prayer-points", requireAdmin, async (req, res) => {
  const { title, description, scriptureReferenceId, missionStoryId, missionFieldId, status } = req.body as {
    title?: string; description?: string; scriptureReferenceId?: string | null; missionStoryId?: string | null;
    missionFieldId?: string | null; status?: string;
  };
  if (!title?.trim()) return err(res, "title is required");
  if (!description?.trim()) return err(res, "description is required");
  if (!missionStoryId && !missionFieldId) return err(res, "either missionStoryId or missionFieldId is required");
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) return err(res, "invalid status");
  const { data, error } = await db.from("p2p_mission_prayer_points").insert({
    title: title.trim(), description: description.trim(), scripture_reference_id: scriptureReferenceId ?? null,
    mission_story_id: missionStoryId ?? null, mission_field_id: missionFieldId ?? null, status: status ?? "draft",
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create prayer point", 500);
  return ok(res, mapPrayerPoint(data as Record<string, unknown>));
});
router.put("/admin/prayer-points/:id", requireAdmin, async (req, res) => {
  const { data: existing } = await db.from("p2p_mission_prayer_points").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Prayer point not found", 404);
  const { title, description, scriptureReferenceId, status } = req.body as {
    title?: string; description?: string; scriptureReferenceId?: string | null; status?: string;
  };
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) return err(res, "invalid status");
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description.trim();
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (status !== undefined) updates.status = status;
  const { data, error } = await db.from("p2p_mission_prayer_points").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update prayer point", 500);
  return ok(res, mapPrayerPoint(data as Record<string, unknown>));
});
router.delete("/admin/prayer-points/:id", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_mission_prayer_points").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

export default router;
