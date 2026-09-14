import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// Prayer 2.0 Stage 6 — Prayer Testimonies and Video Growth Testimonies
// (migration 141, p2p_prayer_testimonies). Mounted at /prayer/testimonies —
// a separate route file from prayerCoordination.ts because this is a
// distinct sub-feature (authored reflections + optional video), not another
// coordination primitive. Two conceptually distinct testimony_type values
// ('answered_prayer' | 'growth') are both served here but every endpoint
// keeps them explicit, never merges them into one undifferentiated concept.
// Media upload itself goes straight from the mobile client to Supabase
// Storage (identical pattern to components/MediaPlayer.tsx's "submissions"
// bucket usage) — this route only records/returns the resulting storage
// path, it never proxies the bytes.

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

function mapTestimony(row: Record<string, unknown>, extra?: { authorName: string | null }) {
  return {
    id: row.id, userId: row.user_id, testimonyType: row.testimony_type,
    title: row.title, testimonyText: row.testimony_text, requestId: row.request_id,
    scriptureReference: row.scripture_reference, mediaType: row.media_type,
    mediaPath: row.media_path, mediaDurationSeconds: row.media_duration_seconds,
    isAnonymous: row.is_anonymous, visibility: row.visibility, moderationStatus: row.moderation_status,
    createdAt: row.created_at, updatedAt: row.updated_at,
    authorName: row.is_anonymous ? null : (extra?.authorName ?? null),
  };
}

async function profileName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? "Someone";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /testimonies — create a testimony (text-only, or with media already
// uploaded by the client to the "prayer-testimonies" bucket beforehand).
// An optional client-generated `id` is accepted (same shape as
// DataContext.tsx's submitContent/generateUUID pattern) because the storage
// path — and the storage read-policy that joins on it — must be known
// BEFORE this row exists: the mobile client uploads the video first (path
// {userId}/{id}/video.ext), then creates the row with that same id.
// mediaPath is trusted only after verifying it's under this caller's own
// storage prefix AND its id segment matches the row being created.
router.post("/testimonies", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { id, testimonyType, title, testimonyText, requestId, scriptureReference, mediaType, mediaPath, mediaDurationSeconds, isAnonymous, visibility } = req.body as {
    id?: string; testimonyType?: string; title?: string; testimonyText?: string; requestId?: string | null;
    scriptureReference?: unknown; mediaType?: string | null; mediaPath?: string | null; mediaDurationSeconds?: number | null;
    isAnonymous?: boolean; visibility?: string;
  };
  if (id !== undefined && !UUID_RE.test(id)) return err(res, "id must be a valid UUID");
  if (!testimonyType || !["answered_prayer", "growth"].includes(testimonyType)) {
    return err(res, "testimonyType must be answered_prayer or growth");
  }
  if (!title?.trim()) return err(res, "title is required");
  if (!testimonyText?.trim()) return err(res, "testimonyText is required");
  if (visibility !== undefined && !["p2p_network", "private"].includes(visibility)) {
    return err(res, "visibility must be p2p_network or private");
  }
  if (requestId && testimonyType !== "answered_prayer") {
    return err(res, "requestId can only be set on an answered_prayer testimony");
  }
  if (requestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", requestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "You can only link a testimony to your own prayer request", 403);
  }
  if (mediaType && mediaType !== "video") return err(res, "mediaType must be video");
  if (mediaType && !mediaPath) return err(res, "mediaPath is required when mediaType is set");
  if (mediaPath) {
    // The bucket's own storage RLS already restricts writes to
    // {auth.uid()}/... — this is a redundant, explicit re-check at the API
    // layer, same "RLS is a backstop, not the only gate" convention as
    // every other route in this codebase.
    const segments = mediaPath.split("/");
    if (!mediaPath.startsWith(`${userId}/`)) return err(res, "mediaPath must be under your own storage prefix", 403);
    if (!id || segments[1] !== id) return err(res, "mediaPath must belong to this testimony's id", 400);
  }

  const { data, error } = await db.from("p2p_prayer_testimonies").insert({
    ...(id ? { id } : {}),
    user_id: userId, testimony_type: testimonyType, title: title.trim(), testimony_text: testimonyText.trim(),
    request_id: requestId ?? null, scripture_reference: scriptureReference ?? null,
    media_type: mediaType ?? null, media_path: mediaPath ?? null, media_duration_seconds: mediaDurationSeconds ?? null,
    is_anonymous: !!isAnonymous, visibility: visibility ?? "p2p_network",
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save this testimony", 500);

  await db.from("p2p_user_activity_events").insert({
    user_id: userId,
    event_type: testimonyType === "answered_prayer" ? "prayer_testimony_shared" : "growth_testimony_shared",
    metadata: { testimony_id: data.id },
  });

  return ok(res, mapTestimony(data as Record<string, unknown>, { authorName: await profileName(userId) }));
});

// GET /testimonies/mine — the author's own, at any moderation_status
// (so they can see a 'pending'/'rejected' one, which the network feed hides).
router.get("/testimonies/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_testimonies").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapTestimony(r as Record<string, unknown>, { authorName: null })));
});

// GET /testimonies/feed — approved, network-visible testimonies, optionally
// filtered by testimonyType. Registered before "/testimonies/:id" (same
// route-ordering rule used throughout prayerCoordination.ts).
router.get("/testimonies/feed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (type && !["answered_prayer", "growth"].includes(type)) return err(res, "type must be answered_prayer or growth");

  let query = db.from("p2p_prayer_testimonies").select("*")
    .eq("visibility", "p2p_network").eq("moderation_status", "approved")
    .order("created_at", { ascending: false }).limit(50);
  if (type) query = query.eq("testimony_type", type);
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);

  const withNames = await Promise.all((data ?? []).map(async (r) => mapTestimony(
    r as Record<string, unknown>,
    { authorName: r.is_anonymous ? null : await profileName(r.user_id as string) }
  )));
  return ok(res, withNames);
});

router.get("/testimonies/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: testimony } = await db.from("p2p_prayer_testimonies").select("*").eq("id", req.params.id).maybeSingle();
  if (!testimony) return err(res, "Testimony not found", 404);

  const viewable = testimony.user_id === userId
    || (testimony.visibility === "p2p_network" && testimony.moderation_status === "approved");
  if (!viewable) return err(res, "This testimony is not available", 404);

  return ok(res, mapTestimony(testimony as Record<string, unknown>, {
    authorName: testimony.is_anonymous ? null : await profileName(testimony.user_id as string),
  }));
});

router.put("/testimonies/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: testimony } = await db.from("p2p_prayer_testimonies").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!testimony) return err(res, "Testimony not found", 404);
  if (testimony.user_id !== userId) return err(res, "Only the testimony's author can edit it", 403);

  const { title, testimonyText, scriptureReference, isAnonymous, visibility } = req.body as {
    title?: string; testimonyText?: string; scriptureReference?: unknown; isAnonymous?: boolean; visibility?: string;
  };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (testimonyText !== undefined) { if (!testimonyText.trim()) return err(res, "testimonyText cannot be empty"); updates.testimony_text = testimonyText.trim(); }
  if (scriptureReference !== undefined) updates.scripture_reference = scriptureReference;
  if (isAnonymous !== undefined) updates.is_anonymous = !!isAnonymous;
  if (visibility !== undefined) {
    if (!["p2p_network", "private"].includes(visibility)) return err(res, "visibility must be p2p_network or private");
    updates.visibility = visibility;
  }

  const { data, error } = await db.from("p2p_prayer_testimonies").update(updates).eq("id", testimony.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update this testimony", 500);
  return ok(res, mapTestimony(data as Record<string, unknown>, { authorName: await profileName(userId) }));
});

router.delete("/testimonies/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: testimony } = await db.from("p2p_prayer_testimonies").select("id,user_id,media_path").eq("id", req.params.id).maybeSingle();
  if (!testimony) return err(res, "Testimony not found", 404);
  if (testimony.user_id !== userId) return err(res, "Only the testimony's author can delete it", 403);

  if (testimony.media_path) {
    await db.storage.from("prayer-testimonies").remove([testimony.media_path as string]);
  }
  const { error } = await db.from("p2p_prayer_testimonies").delete().eq("id", testimony.id as string);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

export default router;
