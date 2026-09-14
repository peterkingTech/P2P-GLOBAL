import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// "Pray the Word" Stage 4 — Prayer Journal 2.0. This is an ADDITIVE API
// surface over the EXISTING p2p_prayer_journal table (045) — it does not
// replace the direct-Supabase-client read/write path journal.tsx and
// complete/[id].tsx already use for plain entries (those keep working
// unchanged; the new nullable columns from migration 144 default to null
// either way). This route exists specifically because linking a journal
// entry to the user's OWN Prayer 2.0 request needs a server-side ownership
// check that a raw client insert/update cannot enforce — the same
// "RLS is a backstop, the API does the real check" convention as the rest
// of this codebase, applied to the one cross-table link that actually
// needs it. Scripture/topic links carry no such risk (they're public
// reference data), so are accepted here without an extra ownership check.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const STATUSES = ["still_praying", "trusting_god", "god_is_answering", "answered", "no_longer_needed"];

function mapEntry(row: Record<string, unknown>) {
  return {
    id: row.id, userId: row.user_id, prayerText: row.prayer_text, category: row.category,
    isAnswered: row.is_answered, answeredAt: row.answered_at, answerNotes: row.answer_notes,
    isPrivate: row.is_private, createdAt: row.created_at, updatedAt: row.updated_at,
    scriptureReferenceId: row.scripture_reference_id, topicId: row.topic_id,
    prayer2RequestId: row.prayer2_request_id, status: row.status,
  };
}

// POST /prayer/journal — create an entry, optionally linked to a Scripture,
// a topic, and/or the caller's OWN Prayer 2.0 request.
router.post("/journal", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { prayerText, category, scriptureReferenceId, topicId, prayer2RequestId, status } = req.body as {
    prayerText?: string; category?: string | null; scriptureReferenceId?: string | null;
    topicId?: string | null; prayer2RequestId?: string | null; status?: string | null;
  };
  if (!prayerText?.trim()) return err(res, "prayerText is required");
  if (status !== undefined && status !== null && !STATUSES.includes(status)) {
    return err(res, `status must be one of: ${STATUSES.join(", ")}`);
  }
  if (prayer2RequestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", prayer2RequestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "You can only link a journal entry to your own prayer request", 403);
  }

  const { data, error } = await db.from("p2p_prayer_journal").insert({
    user_id: userId, prayer_text: prayerText.trim(), category: category?.trim() || null,
    scripture_reference_id: scriptureReferenceId ?? null, topic_id: topicId ?? null,
    prayer2_request_id: prayer2RequestId ?? null, status: status ?? null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save journal entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>));
});

// GET /prayer/journal/mine?page=0&limit=20&filter=all|answered|unanswered
// Paginated — the existing journal.tsx screen loads its whole history in
// one query; this endpoint exists so Stage 4's enhanced journal view (and
// any future one) doesn't have to repeat that as history grows.
router.get("/journal/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { page = "0", limit = "20", filter } = req.query as { page?: string; limit?: string; filter?: string };
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("p2p_prayer_journal").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false });
  if (filter === "answered") query = query.eq("is_answered", true);
  if (filter === "unanswered") query = query.eq("is_answered", false);
  const { data, error, count } = await query.range(from, to);
  if (error) return err(res, error.message, 500);
  return ok(res, { entries: (data ?? []).map(mapEntry), total: count ?? 0, page: pageNum, pageSize });
});

router.put("/journal/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: entry } = await db.from("p2p_prayer_journal").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!entry) return err(res, "Journal entry not found", 404);
  if (entry.user_id !== userId) return err(res, "Only the entry's owner can edit it", 403);

  const { prayerText, category, scriptureReferenceId, topicId, prayer2RequestId, status, isAnswered, answerNotes } = req.body as {
    prayerText?: string; category?: string | null; scriptureReferenceId?: string | null; topicId?: string | null;
    prayer2RequestId?: string | null; status?: string | null; isAnswered?: boolean; answerNotes?: string | null;
  };
  if (status !== undefined && status !== null && !STATUSES.includes(status)) {
    return err(res, `status must be one of: ${STATUSES.join(", ")}`);
  }
  if (prayer2RequestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", prayer2RequestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "You can only link a journal entry to your own prayer request", 403);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (prayerText !== undefined) { if (!prayerText.trim()) return err(res, "prayerText cannot be empty"); updates.prayer_text = prayerText.trim(); }
  if (category !== undefined) updates.category = category?.trim() || null;
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (topicId !== undefined) updates.topic_id = topicId;
  if (prayer2RequestId !== undefined) updates.prayer2_request_id = prayer2RequestId;
  if (status !== undefined) {
    updates.status = status;
    // "Answered" is the user's own explicit narrative choice here, same as
    // Prayer 2.0's status='no_longer_needed' auto-transition (139) — the
    // authoritative is_answered boolean is kept in sync, never the reverse.
    if (status === "answered") updates.is_answered = true;
  }
  if (isAnswered !== undefined) {
    updates.is_answered = isAnswered;
    if (isAnswered) updates.answered_at = new Date().toISOString();
  }
  if (answerNotes !== undefined) updates.answer_notes = answerNotes?.trim() || null;

  const { data, error } = await db.from("p2p_prayer_journal").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update journal entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>));
});

router.delete("/journal/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: entry } = await db.from("p2p_prayer_journal").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!entry) return err(res, "Journal entry not found", 404);
  if (entry.user_id !== userId) return err(res, "Only the entry's owner can delete it", 403);

  const { error } = await db.from("p2p_prayer_journal").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

export default router;
