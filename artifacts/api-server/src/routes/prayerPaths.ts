import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";

// "Pray the Word" Stage 3 — Prayer Paths (migration 143). A Prayer Path is
// a curated, ordered sequence of EXISTING p2p_scripture_references rows
// (142) — never Bible-replacement courses, never AI-generated, never a
// social challenge. "Complete" means the user reached the last step; there
// is no points/streak field anywhere in this file or its table.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

function mapPath(row: Record<string, unknown>) {
  return {
    id: row.id, slug: row.slug, title: row.title, description: row.description,
    topicId: row.topic_id, estimatedMinutes: row.estimated_minutes, status: row.status,
    displayOrder: row.display_order, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapStep(row: Record<string, unknown>, scripture?: Record<string, unknown>) {
  return {
    id: row.id, pathId: row.path_id, scriptureId: row.scripture_id, stepOrder: row.step_order,
    reflectPrompt: row.reflect_prompt, prayPrompt: row.pray_prompt, respondPrompt: row.respond_prompt,
    scripture: scripture ? {
      id: scripture.id, book: scripture.book, chapter: scripture.chapter,
      startVerse: scripture.start_verse, endVerse: scripture.end_verse,
      translationCode: scripture.translation_code, referenceDisplay: scripture.reference_display,
    } : undefined,
  };
}
function mapProgress(row: Record<string, unknown>) {
  return {
    id: row.id, userId: row.user_id, pathId: row.path_id, status: row.status,
    currentStepOrder: row.current_step_order, startedAt: row.started_at,
    completedAt: row.completed_at, updatedAt: row.updated_at,
  };
}

// ── Public/user reads ───────────────────────────────────────────────────────

router.get("/paths", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_paths").select("*, steps:p2p_prayer_path_steps(count)")
    .eq("status", "published").order("display_order", { ascending: true }).order("title", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r: any) => ({ ...mapPath(r), scriptureCount: r.steps?.[0]?.count ?? 0 })));
});

router.get("/paths/:slug", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: path } = await db.from("p2p_prayer_paths").select("*").eq("slug", req.params.slug).maybeSingle();
  if (!path || path.status !== "published") return err(res, "Prayer path not found", 404);

  const { data: steps, error } = await db.from("p2p_prayer_path_steps")
    .select("*, scripture:p2p_scripture_references(*)").eq("path_id", path.id as string).order("step_order", { ascending: true });
  if (error) return err(res, error.message, 500);

  const { data: progress } = await db.from("p2p_prayer_path_progress").select("*")
    .eq("user_id", userId).eq("path_id", path.id as string).maybeSingle();

  return ok(res, {
    ...mapPath(path as Record<string, unknown>),
    steps: (steps ?? []).map((s: any) => mapStep(s, s.scripture)),
    myProgress: progress ? mapProgress(progress as Record<string, unknown>) : null,
  });
});

// PUT /prayer/paths/:id/progress — upsert the caller's OWN progress on a
// path. One row per (user, path), updated in place — never a per-step
// insert. Setting currentStepOrder to (or past) the last step marks the
// path completed; this is the ONLY completion signal, no separate "claim
// completion" action exists to game.
router.put("/paths/:id/progress", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: path } = await db.from("p2p_prayer_paths").select("id,status").eq("id", req.params.id).maybeSingle();
  if (!path || path.status !== "published") return err(res, "Prayer path not found", 404);

  const { currentStepOrder } = req.body as { currentStepOrder?: number };
  if (!currentStepOrder || currentStepOrder < 1) return err(res, "a valid currentStepOrder is required");

  const { count: totalSteps } = await db.from("p2p_prayer_path_steps").select("id", { count: "exact", head: true }).eq("path_id", path.id as string);
  const isComplete = totalSteps != null && currentStepOrder >= totalSteps;

  const { data: existing } = await db.from("p2p_prayer_path_progress").select("id,status,completed_at")
    .eq("user_id", userId).eq("path_id", path.id as string).maybeSingle();

  const updates: Record<string, unknown> = {
    user_id: userId, path_id: path.id, current_step_order: currentStepOrder,
    status: isComplete ? "completed" : "in_progress", updated_at: new Date().toISOString(),
  };
  if (isComplete && !existing?.completed_at) updates.completed_at = new Date().toISOString();

  const { data, error } = await db.from("p2p_prayer_path_progress")
    .upsert(updates, { onConflict: "user_id,path_id" }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save progress", 500);
  return ok(res, mapProgress(data as Record<string, unknown>));
});

// ── Admin/editorial mutation ─────────────────────────────────────────────────

router.get("/admin/paths", requireAdmin, async (req, res) => {
  const { data, error } = await db.from("p2p_prayer_paths").select("*").order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapPath));
});

router.post("/admin/paths", requireAdmin, async (req, res) => {
  const { slug, title, description, topicId, estimatedMinutes, status, displayOrder } = req.body as {
    slug?: string; title?: string; description?: string | null; topicId?: string | null;
    estimatedMinutes?: number | null; status?: string; displayOrder?: number;
  };
  if (!slug?.trim()) return err(res, "slug is required");
  if (!title?.trim()) return err(res, "title is required");
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) {
    return err(res, "status must be draft, published, or archived");
  }
  const { data, error } = await db.from("p2p_prayer_paths").insert({
    slug: slug.trim(), title: title.trim(), description: description?.trim() || null,
    topic_id: topicId ?? null, estimated_minutes: estimatedMinutes ?? null,
    status: status ?? "draft", display_order: displayOrder ?? 0,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create prayer path", 500);
  return ok(res, mapPath(data as Record<string, unknown>));
});

router.put("/admin/paths/:id", requireAdmin, async (req, res) => {
  const { data: existing } = await db.from("p2p_prayer_paths").select("id").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Prayer path not found", 404);

  const { title, description, topicId, estimatedMinutes, status, displayOrder } = req.body as {
    title?: string; description?: string | null; topicId?: string | null;
    estimatedMinutes?: number | null; status?: string; displayOrder?: number;
  };
  if (status !== undefined && !["draft", "published", "archived"].includes(status)) {
    return err(res, "status must be draft, published, or archived");
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (description !== undefined) updates.description = description?.trim() || null;
  if (topicId !== undefined) updates.topic_id = topicId;
  if (estimatedMinutes !== undefined) updates.estimated_minutes = estimatedMinutes;
  if (status !== undefined) updates.status = status;
  if (displayOrder !== undefined) updates.display_order = displayOrder;

  const { data, error } = await db.from("p2p_prayer_paths").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update prayer path", 500);
  return ok(res, mapPath(data as Record<string, unknown>));
});

router.delete("/admin/paths/:id", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_prayer_paths").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.post("/admin/paths/:id/steps", requireAdmin, async (req, res) => {
  const { data: path } = await db.from("p2p_prayer_paths").select("id").eq("id", req.params.id).maybeSingle();
  if (!path) return err(res, "Prayer path not found", 404);

  const { scriptureId, stepOrder, reflectPrompt, prayPrompt, respondPrompt } = req.body as {
    scriptureId?: string; stepOrder?: number; reflectPrompt?: string | null; prayPrompt?: string | null; respondPrompt?: string | null;
  };
  if (!scriptureId) return err(res, "scriptureId is required");
  if (!stepOrder || stepOrder < 1) return err(res, "a valid stepOrder is required");
  const { data: scripture } = await db.from("p2p_scripture_references").select("id").eq("id", scriptureId).maybeSingle();
  if (!scripture) return err(res, "Scripture reference not found", 404);

  const { data, error } = await db.from("p2p_prayer_path_steps")
    .upsert(
      { path_id: path.id as string, scripture_id: scriptureId, step_order: stepOrder, reflect_prompt: reflectPrompt ?? null, pray_prompt: prayPrompt ?? null, respond_prompt: respondPrompt ?? null },
      { onConflict: "path_id,step_order" }
    ).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to save path step", 500);
  return ok(res, mapStep(data as Record<string, unknown>));
});

router.delete("/admin/paths/:id/steps/:stepId", requireAdmin, async (req, res) => {
  const { error } = await db.from("p2p_prayer_path_steps").delete().eq("id", req.params.stepId).eq("path_id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

export default router;
