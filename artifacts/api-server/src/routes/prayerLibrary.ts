import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// "Pray the Word" Stage 5 — Personal Prayer Library (migration 145) plus
// the lightweight "Recent" activity logger Stages 2/3 call into. Saved-item
// shape mirrors p2p_plan_saves (042) exactly. "Answered Prayers" and
// "Recent" are pure reads against EXISTING source-of-truth tables
// (p2p_prayer_journal, p2p_user_activity_events) — nothing here copies or
// duplicates that data.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// ── Saved Scriptures ─────────────────────────────────────────────────────────

router.post("/saved-scriptures", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { scriptureId, topicId } = req.body as { scriptureId?: string; topicId?: string | null };
  if (!scriptureId) return err(res, "scriptureId is required");
  const { data: scripture } = await db.from("p2p_scripture_references").select("id").eq("id", scriptureId).maybeSingle();
  if (!scripture) return err(res, "Scripture reference not found", 404);

  const { data, error } = await db.from("p2p_saved_scriptures")
    .upsert({ user_id: userId, scripture_id: scriptureId, topic_id: topicId ?? null }, { onConflict: "user_id,scripture_id" })
    .select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save scripture", 500);
  return ok(res, { id: data.id, scriptureId: data.scripture_id, topicId: data.topic_id, savedAt: data.saved_at });
});

router.delete("/saved-scriptures/:scriptureId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_saved_scriptures").delete().eq("user_id", userId).eq("scripture_id", req.params.scriptureId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.get("/saved-scriptures", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_saved_scriptures")
    .select("id,saved_at,topic_id,scripture:p2p_scripture_references(*)").eq("user_id", userId).order("saved_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({
    id: r.id, savedAt: r.saved_at, topicId: r.topic_id,
    scripture: r.scripture ? {
      id: r.scripture.id, book: r.scripture.book, chapter: r.scripture.chapter,
      startVerse: r.scripture.start_verse, endVerse: r.scripture.end_verse,
      translationCode: r.scripture.translation_code, referenceDisplay: r.scripture.reference_display,
    } : null,
  })));
});

// ── Saved Prayers (from the existing curated Prayer Library) ─────────────────

router.post("/saved-prayers", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { prayerLibraryId } = req.body as { prayerLibraryId?: string };
  if (!prayerLibraryId) return err(res, "prayerLibraryId is required");
  const { data: prayer } = await db.from("p2p_prayer_library").select("id").eq("id", prayerLibraryId).maybeSingle();
  if (!prayer) return err(res, "That prayer could not be found", 404);

  const { data, error } = await db.from("p2p_saved_prayers")
    .upsert({ user_id: userId, prayer_library_id: prayerLibraryId }, { onConflict: "user_id,prayer_library_id" })
    .select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save prayer", 500);
  return ok(res, { id: data.id, prayerLibraryId: data.prayer_library_id, savedAt: data.saved_at });
});

router.delete("/saved-prayers/:prayerLibraryId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_saved_prayers").delete().eq("user_id", userId).eq("prayer_library_id", req.params.prayerLibraryId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.get("/saved-prayers", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_saved_prayers")
    .select("id,saved_at,prayer:p2p_prayer_library(*)").eq("user_id", userId).order("saved_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({
    id: r.id, savedAt: r.saved_at,
    prayer: r.prayer ? {
      id: r.prayer.id, category: r.prayer.category, title: r.prayer.title, prayerText: r.prayer.prayer_text,
      scriptureReference: r.prayer.scripture_reference,
    } : null,
  })));
});

// ── Saved Prayer Paths ────────────────────────────────────────────────────────

router.post("/saved-paths", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { pathId } = req.body as { pathId?: string };
  if (!pathId) return err(res, "pathId is required");
  const { data: path } = await db.from("p2p_prayer_paths").select("id").eq("id", pathId).maybeSingle();
  if (!path) return err(res, "Prayer path not found", 404);

  const { data, error } = await db.from("p2p_saved_prayer_paths")
    .upsert({ user_id: userId, path_id: pathId }, { onConflict: "user_id,path_id" }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save prayer path", 500);
  return ok(res, { id: data.id, pathId: data.path_id, savedAt: data.saved_at });
});

router.delete("/saved-paths/:pathId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_saved_prayer_paths").delete().eq("user_id", userId).eq("path_id", req.params.pathId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.get("/saved-paths", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_saved_prayer_paths")
    .select("id,saved_at,path:p2p_prayer_paths(*)").eq("user_id", userId).order("saved_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({
    id: r.id, savedAt: r.saved_at,
    path: r.path ? { id: r.path.id, slug: r.path.slug, title: r.path.title, description: r.path.description, estimatedMinutes: r.path.estimated_minutes } : null,
  })));
});

// ── Answered Prayers (reads the Journal — the source of truth) ───────────────

router.get("/library/answered", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_journal").select("*")
    .eq("user_id", userId).eq("is_answered", true).order("answered_at", { ascending: false }).limit(100);
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({
    id: r.id, prayerText: r.prayer_text, category: r.category, answeredAt: r.answered_at,
    answerNotes: r.answer_notes, scriptureReferenceId: r.scripture_reference_id, topicId: r.topic_id,
  })));
});

// ── Recent (reads the activity timeline — zero-score, purely informational) ──

const LOGGABLE_EVENTS = ["prayer_topic_viewed", "prayer_scripture_viewed", "prayer_path_started"];

// POST /prayer/activity — a narrow, whitelisted logger for the "Recent"
// timeline only. Never accepts an arbitrary event_type (would let a client
// write into unrelated activity categories); never touches
// p2p_growth_events (the real score engine).
router.post("/activity", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { eventType, metadata } = req.body as { eventType?: string; metadata?: Record<string, unknown> };
  if (!eventType || !LOGGABLE_EVENTS.includes(eventType)) {
    return err(res, `eventType must be one of: ${LOGGABLE_EVENTS.join(", ")}`);
  }
  const { error } = await db.from("p2p_user_activity_events").insert({ user_id: userId, event_type: eventType, metadata: metadata ?? {} });
  if (error) return err(res, error.message, 500);
  return ok(res, { logged: true });
});

router.get("/recent", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_user_activity_events").select("event_type,metadata,created_at")
    .eq("user_id", userId).in("event_type", LOGGABLE_EVENTS).order("created_at", { ascending: false }).limit(50);
  if (error) return err(res, error.message, 500);

  // De-dupe to the most recent occurrence per (event_type, referenced id) —
  // "Recent" means "the last time you looked at each thing," not a full log.
  const seen = new Set<string>();
  const deduped: { eventType: string; metadata: Record<string, unknown>; at: string }[] = [];
  for (const row of data ?? []) {
    const refId = (row.metadata as any)?.id ?? (row.metadata as any)?.topicId ?? (row.metadata as any)?.scriptureId ?? (row.metadata as any)?.pathId ?? "";
    const key = `${row.event_type}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ eventType: row.event_type as string, metadata: row.metadata as Record<string, unknown>, at: row.created_at as string });
    if (deduped.length >= 15) break;
  }
  return ok(res, deduped);
});

export default router;
