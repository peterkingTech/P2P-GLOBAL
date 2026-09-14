import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// Kingdom Wins / Testimonies — "Look what God has done." A genuinely
// independent peer-authored domain (migration 150): NOT the Prayer Wall
// ("please pray for me"), NOT Missions (admin-curated field reporting).
// Any authenticated user may author their own entry — unlike Mission
// Stories, there is no admin gate on creation here, matching the product
// intent that this is peer testimony, not curated editorial content.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const ENTRY_TYPES = ["kingdom_win", "testimony"];
const CATEGORIES = [
  "answered_prayer", "salvation", "healing", "freedom", "provision", "reconciliation",
  "spiritual_growth", "family", "work_calling", "evangelism", "discipleship", "missions", "other",
];
const REACTION_TYPES = ["praying", "amen", "encourage"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  return !!data && data.role !== "student";
}

function mapEntry(row: Record<string, unknown>, extra?: { authorName?: string | null; reactionCounts?: Record<string, number>; myReactions?: string[] }) {
  return {
    id: row.id, authorId: row.author_id, authorName: row.is_anonymous ? null : extra?.authorName,
    entryType: row.entry_type, title: row.title, body: row.body, lessonLearned: row.lesson_learned,
    category: row.category, scriptureReferenceId: row.scripture_reference_id, missionStoryId: row.mission_story_id,
    missionFieldId: row.mission_field_id, prayer2RequestId: row.prayer2_request_id, mediaType: row.media_type,
    mediaPath: row.media_path, mediaDurationSeconds: row.media_duration_seconds, isAnonymous: row.is_anonymous,
    visibility: row.visibility, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    submittedAt: row.submitted_at, publishedAt: row.published_at,
    reactionCounts: extra?.reactionCounts ?? undefined, myReactions: extra?.myReactions ?? undefined,
  };
}
async function profileName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? "A peer";
}
async function reactionSummary(entryId: string, userId: string) {
  const { data } = await db.from("p2p_kingdom_win_reactions").select("reaction_type,user_id").eq("kingdom_win_id", entryId);
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of data ?? []) {
    counts[r.reaction_type as string] = (counts[r.reaction_type as string] ?? 0) + 1;
    if (r.user_id === userId) mine.push(r.reaction_type as string);
  }
  return { reactionCounts: counts, myReactions: mine };
}

// ── Create / manage own ──────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const {
    id, entryType, title, body, lessonLearned, category, scriptureReferenceId, missionStoryId, missionFieldId,
    prayer2RequestId, mediaType, mediaPath, mediaDurationSeconds, isAnonymous, visibility, status,
  } = req.body as {
    id?: string; entryType?: string; title?: string; body?: string; lessonLearned?: string | null; category?: string;
    scriptureReferenceId?: string | null; missionStoryId?: string | null; missionFieldId?: string | null;
    prayer2RequestId?: string | null; mediaType?: "photo" | "video" | null; mediaPath?: string | null;
    mediaDurationSeconds?: number | null; isAnonymous?: boolean; visibility?: string; status?: string;
  };
  if (id !== undefined && !UUID_RE.test(id)) return err(res, "id must be a valid UUID");
  if (!entryType || !ENTRY_TYPES.includes(entryType)) return err(res, `entryType must be one of: ${ENTRY_TYPES.join(", ")}`);
  if (!title?.trim()) return err(res, "title is required");
  if (!body?.trim()) return err(res, "body is required");
  if (!category || !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (visibility !== undefined && !["p2p_network", "private"].includes(visibility)) return err(res, "visibility must be p2p_network or private");
  if (status !== undefined && !["draft", "submitted", "published"].includes(status)) return err(res, "status must be draft, submitted, or published on create");
  if (mediaType !== undefined && mediaType !== null && !["photo", "video"].includes(mediaType)) return err(res, "mediaType must be photo or video");
  if (mediaType && !mediaPath) return err(res, "mediaPath is required when mediaType is set");
  if (mediaPath) {
    const segments = mediaPath.split("/");
    if (!mediaPath.startsWith(`${userId}/`)) return err(res, "mediaPath must be under your own storage prefix", 403);
    if (!id || segments[1] !== id) return err(res, "mediaPath must belong to this entry's id", 400);
  }
  if (prayer2RequestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", prayer2RequestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "You can only link your own Prayer 2.0 request", 403);
  }
  if (missionStoryId) {
    const { data: story } = await db.from("p2p_mission_stories").select("id").eq("id", missionStoryId).eq("status", "published").maybeSingle();
    if (!story) return err(res, "That mission story could not be found", 404);
  }
  if (missionFieldId) {
    const { data: field } = await db.from("p2p_mission_fields").select("id").eq("id", missionFieldId).eq("status", "published").maybeSingle();
    if (!field) return err(res, "That mission field could not be found", 404);
  }

  const isPublishing = status === "published";
  const { data, error } = await db.from("p2p_kingdom_wins").insert({
    ...(id ? { id } : {}),
    author_id: userId, entry_type: entryType, title: title.trim(), body: body.trim(),
    lesson_learned: lessonLearned?.trim() || null, category,
    scripture_reference_id: scriptureReferenceId ?? null, mission_story_id: missionStoryId ?? null,
    mission_field_id: missionFieldId ?? null, prayer2_request_id: prayer2RequestId ?? null,
    media_type: mediaType ?? null, media_path: mediaPath ?? null, media_duration_seconds: mediaDurationSeconds ?? null,
    is_anonymous: !!isAnonymous, visibility: visibility ?? "p2p_network", status: status ?? "draft",
    submitted_at: status === "submitted" || isPublishing ? new Date().toISOString() : null,
    published_at: isPublishing ? new Date().toISOString() : null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>, { authorName: await profileName(userId) }));
});

router.get("/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_kingdom_wins").select("*").eq("author_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapEntry(r as Record<string, unknown>)));
});

router.put("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_kingdom_wins").select("*").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Entry not found", 404);
  const callerIsAdmin = await isAdmin(userId);
  const isOwner = existing.author_id === userId;
  if (!isOwner && !callerIsAdmin) return err(res, "Only the author can edit this entry", 403);

  const { title, body, lessonLearned, category, scriptureReferenceId, isAnonymous, visibility, status, moderationNote } = req.body as {
    title?: string; body?: string; lessonLearned?: string | null; category?: string; scriptureReferenceId?: string | null;
    isAnonymous?: boolean; visibility?: string; status?: string; moderationNote?: string | null;
  };
  if (category !== undefined && !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (visibility !== undefined && !["p2p_network", "private"].includes(visibility)) return err(res, "visibility must be p2p_network or private");
  if (status !== undefined) {
    const ownerAllowed = ["draft", "submitted", "published"];
    const allowed = callerIsAdmin ? ["draft", "submitted", "published", "rejected", "removed"] : ownerAllowed;
    if (!allowed.includes(status)) return err(res, isOwner && !callerIsAdmin ? "You can only set draft, submitted, or published" : "invalid status");
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (body !== undefined) { if (!body.trim()) return err(res, "body cannot be empty"); updates.body = body.trim(); }
  if (lessonLearned !== undefined) updates.lesson_learned = lessonLearned?.trim() || null;
  if (category !== undefined) updates.category = category;
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (isAnonymous !== undefined) updates.is_anonymous = !!isAnonymous;
  if (visibility !== undefined) updates.visibility = visibility;
  if (callerIsAdmin && moderationNote !== undefined) updates.moderation_note = moderationNote?.trim() || null;
  if (status !== undefined) {
    updates.status = status;
    if (status === "submitted" && !existing.submitted_at) updates.submitted_at = new Date().toISOString();
    if (status === "published" && existing.status !== "published") updates.published_at = new Date().toISOString();
  }

  const { data, error } = await db.from("p2p_kingdom_wins").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>, { authorName: await profileName(existing.author_id as string) }));
});

router.delete("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_kingdom_wins").select("id,author_id,media_path").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Entry not found", 404);
  if (existing.author_id !== userId) return err(res, "Only the author can delete this entry", 403);
  if (existing.media_path) await db.storage.from("kingdom-wins-media").remove([existing.media_path as string]);
  const { error } = await db.from("p2p_kingdom_wins").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// ── Public feed / detail ─────────────────────────────────────────────────────

router.get("/feed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { category, entryType, page = "0", limit = "20" } = req.query as Record<string, string>;
  if (category && !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (entryType && !ENTRY_TYPES.includes(entryType)) return err(res, `entryType must be one of: ${ENTRY_TYPES.join(", ")}`);
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("p2p_kingdom_wins").select("*", { count: "exact" })
    .eq("status", "published").eq("visibility", "p2p_network").order("published_at", { ascending: false }).range(from, to);
  if (category) query = query.eq("category", category);
  if (entryType) query = query.eq("entry_type", entryType);
  const { data, error, count } = await query;
  if (error) return err(res, error.message, 500);

  const withExtras = await Promise.all((data ?? []).map(async (r) => {
    const [authorName, { reactionCounts, myReactions }] = await Promise.all([
      r.is_anonymous ? Promise.resolve(null) : profileName(r.author_id as string),
      reactionSummary(r.id as string, userId),
    ]);
    return mapEntry(r as Record<string, unknown>, { authorName, reactionCounts, myReactions });
  }));
  return ok(res, { entries: withExtras, total: count ?? 0, page: pageNum, pageSize });
});

router.get("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: entry } = await db.from("p2p_kingdom_wins").select("*").eq("id", req.params.id).maybeSingle();
  if (!entry) return err(res, "Entry not found", 404);
  const callerIsAdmin = entry.author_id === userId ? true : await isAdmin(userId);
  const viewable = (entry.status === "published" && entry.visibility === "p2p_network") || entry.author_id === userId || callerIsAdmin;
  if (!viewable) return err(res, "This entry is not available", 404);

  const [authorName, { reactionCounts, myReactions }] = await Promise.all([
    entry.is_anonymous ? Promise.resolve(null) : profileName(entry.author_id as string),
    reactionSummary(entry.id as string, userId),
  ]);
  return ok(res, mapEntry(entry as Record<string, unknown>, { authorName, reactionCounts, myReactions }));
});

// ── Reactions ────────────────────────────────────────────────────────────────

router.post("/:id/react", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { reactionType } = req.body as { reactionType?: string };
  if (!reactionType || !REACTION_TYPES.includes(reactionType)) return err(res, `reactionType must be one of: ${REACTION_TYPES.join(", ")}`);
  const { data: entry } = await db.from("p2p_kingdom_wins").select("id,status,visibility").eq("id", req.params.id).maybeSingle();
  if (!entry || entry.status !== "published" || entry.visibility !== "p2p_network") return err(res, "Entry not found", 404);

  const { error } = await db.from("p2p_kingdom_win_reactions")
    .upsert({ kingdom_win_id: req.params.id, user_id: userId, reaction_type: reactionType }, { onConflict: "kingdom_win_id,user_id,reaction_type" });
  if (error) return err(res, error.message, 500);
  return ok(res, await reactionSummary(req.params.id, userId));
});

router.delete("/:id/react/:reactionType", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_kingdom_win_reactions").delete()
    .eq("kingdom_win_id", req.params.id).eq("user_id", userId).eq("reaction_type", req.params.reactionType);
  if (error) return err(res, error.message, 500);
  return ok(res, await reactionSummary(req.params.id, userId));
});

export default router;
