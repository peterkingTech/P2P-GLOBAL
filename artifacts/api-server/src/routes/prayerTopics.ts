import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";
import { getTranslationByCode } from "../lib/bibleService";

// "Pray the Word" Stage 1 — Scripture & Topic foundation (migration 142).
// Mounted at /prayer/topics (public/user reads) and /prayer/admin (editorial
// mutation, requireAdmin-gated — the same middleware bible.ts's own
// /catalog and /admin/warm already use, not a new admin system).
//
// This file NEVER stores or returns Bible verse TEXT — only structured
// references (book/chapter/verse-range). Verse text is resolved separately
// via the existing GET /bible/verse or POST /bible/passage endpoints
// (bibleService.ts), which already enforce the is_licensed_confirmed gate.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

function mapTopic(row: Record<string, unknown>) {
  return {
    id: row.id, slug: row.slug, title: row.title, description: row.description,
    displayOrder: row.display_order, status: row.status, parentTopicId: row.parent_topic_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapScripture(row: Record<string, unknown>, link?: Record<string, unknown>) {
  return {
    id: row.id, book: row.book, chapter: row.chapter, startVerse: row.start_verse, endVerse: row.end_verse,
    translationCode: row.translation_code, referenceDisplay: row.reference_display,
    ...(link ? { role: link.role, displayOrder: link.display_order, editorialNote: link.editorial_note } : {}),
  };
}

// ── Public/user reads ───────────────────────────────────────────────────────

// GET /prayer/topics — published topics only, ordered for browsing.
router.get("/topics", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_topics").select("*")
    .eq("status", "published").order("display_order", { ascending: true }).order("title", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapTopic));
});

// GET /prayer/scriptures/:id — a single bare reference, for callers that
// already hold a scripture_reference_id (Journal entries, saved items) and
// need to display it without a topic context. References carry no
// draft/published state of their own (see migration 142's RLS comment),
// so this is safe to expose to any authenticated caller.
router.get("/scriptures/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_scripture_references").select("*").eq("id", req.params.id).maybeSingle();
  if (error) return err(res, error.message, 500);
  if (!data) return err(res, "Scripture reference not found", 404);
  return ok(res, mapScripture(data as Record<string, unknown>));
});

// GET /prayer/topics/:slug — a published topic plus its curated Scriptures
// (core first, then supporting, each ordered within its role). 404s for a
// draft/archived topic exactly the same as for a nonexistent one — never
// distinguishes "exists but hidden" from "doesn't exist" to a non-admin.
router.get("/topics/:slug", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: topic } = await db.from("p2p_prayer_topics").select("*").eq("slug", req.params.slug).maybeSingle();
  if (!topic || topic.status !== "published") return err(res, "Topic not found", 404);

  const { data: links, error } = await db.from("p2p_topic_scriptures")
    .select("role,display_order,editorial_note,scripture:p2p_scripture_references(*)")
    .eq("topic_id", topic.id as string)
    .order("role", { ascending: true }).order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);

  const scriptures = (links ?? [])
    .filter((l: any) => l.scripture)
    .map((l: any) => mapScripture(l.scripture, l));

  return ok(res, { ...mapTopic(topic as Record<string, unknown>), scriptures });
});

// ── Admin/editorial mutation ─────────────────────────────────────────────────
// Every write below is gated by requireAdmin (real JWT -> real DB role
// check, never a client-supplied identity) and additionally backstopped by
// this table's own RLS (p2p_is_admin()).

router.get("/admin/topics", requireAdmin, async (req, res) => {
  const { data, error } = await db.from("p2p_prayer_topics").select("*").order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapTopic));
});

router.post("/admin/topics", requireAdmin, async (req, res) => {
  const { slug, title, description, displayOrder, status, parentTopicId } = req.body as {
    slug?: string; title?: string; description?: string | null; displayOrder?: number; status?: string; parentTopicId?: string | null;
  };
  if (!slug?.trim()) return err(res, "slug is required");
  if (!title?.trim()) return err(res, "title is required");
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) {
    return err(res, "status must be draft, published, or archived");
  }
  const { data, error } = await db.from("p2p_prayer_topics").insert({
    slug: slug.trim(), title: title.trim(), description: description?.trim() || null,
    display_order: displayOrder ?? 0, status: status ?? "draft", parent_topic_id: parentTopicId ?? null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create topic", 500);
  return ok(res, mapTopic(data as Record<string, unknown>));
});

router.put("/admin/topics/:id", requireAdmin, async (req, res) => {
  const { data: existing } = await db.from("p2p_prayer_topics").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Topic not found", 404);

  const { title, description, displayOrder, status, parentTopicId } = req.body as {
    title?: string; description?: string | null; displayOrder?: number; status?: string; parentTopicId?: string | null;
  };
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) {
    return err(res, "status must be draft, published, or archived");
  }
  if (parentTopicId === req.params.id) return err(res, "A topic cannot be its own parent");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (description !== undefined) updates.description = description?.trim() || null;
  if (displayOrder !== undefined) updates.display_order = displayOrder;
  if (status !== undefined) updates.status = status;
  if (parentTopicId !== undefined) updates.parent_topic_id = parentTopicId;

  const { data, error } = await db.from("p2p_prayer_topics").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update topic", 500);
  return ok(res, mapTopic(data as Record<string, unknown>));
});

router.delete("/admin/topics/:id", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_prayer_topics").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// POST /prayer/admin/scriptures — find-or-create a canonical reference row.
// Dedup is server-enforced via the unique(book,chapter,start_verse,end_verse)
// constraint AND an explicit upsert here, never left to the client to avoid
// creating a duplicate by coincidence.
router.post("/admin/scriptures", requireAdmin, async (req, res) => {
  const { book, chapter, startVerse, endVerse, translationCode, referenceDisplay } = req.body as {
    book?: string; chapter?: number; startVerse?: number; endVerse?: number; translationCode?: string | null; referenceDisplay?: string;
  };
  if (!book?.trim()) return err(res, "book is required");
  if (!chapter || chapter < 1) return err(res, "a valid chapter is required");
  if (!startVerse || startVerse < 1) return err(res, "a valid startVerse is required");
  const end = endVerse ?? startVerse;
  if (end < startVerse) return err(res, "endVerse must not be before startVerse");
  if (!referenceDisplay?.trim()) return err(res, "referenceDisplay is required");

  if (translationCode) {
    const translation = await getTranslationByCode(translationCode);
    if (!translation) return err(res, "That translation is not available or not confirmed-licensed", 400);
  }

  const { data, error } = await db.from("p2p_scripture_references")
    .upsert(
      { book: book.trim(), chapter, start_verse: startVerse, end_verse: end, translation_code: translationCode ?? null, reference_display: referenceDisplay.trim() },
      { onConflict: "book,chapter,start_verse,end_verse" }
    ).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save scripture reference", 500);
  return ok(res, mapScripture(data as Record<string, unknown>));
});

// POST /prayer/admin/topics/:id/scriptures — link an existing scripture
// reference to a topic (never creates a duplicate Scripture row).
router.post("/admin/topics/:id/scriptures", requireAdmin, async (req, res) => {
  const { data: topic } = await db.from("p2p_prayer_topics").select("id").eq("id", req.params.id).maybeSingle();
  if (!topic) return err(res, "Topic not found", 404);

  const { scriptureId, role, displayOrder, editorialNote } = req.body as {
    scriptureId?: string; role?: string; displayOrder?: number; editorialNote?: string | null;
  };
  if (!scriptureId) return err(res, "scriptureId is required");
  if (role !== undefined && !["core", "supporting"].includes(role)) return err(res, "role must be core or supporting");
  const { data: scripture } = await db.from("p2p_scripture_references").select("id").eq("id", scriptureId).maybeSingle();
  if (!scripture) return err(res, "Scripture reference not found", 404);

  const { data, error } = await db.from("p2p_topic_scriptures")
    .upsert(
      { topic_id: topic.id as string, scripture_id: scriptureId, role: role ?? "core", display_order: displayOrder ?? 0, editorial_note: editorialNote?.trim() || null },
      { onConflict: "topic_id,scripture_id" }
    ).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to link scripture to topic", 500);
  return ok(res, { id: data.id, topicId: data.topic_id, scriptureId: data.scripture_id, role: data.role, displayOrder: data.display_order, editorialNote: data.editorial_note });
});

router.delete("/admin/topics/:id/scriptures/:scriptureId", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_topic_scriptures").delete()
    .eq("topic_id", req.params.id).eq("scripture_id", req.params.scriptureId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

export default router;
