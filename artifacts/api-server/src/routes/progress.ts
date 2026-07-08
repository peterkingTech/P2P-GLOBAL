import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapProgress(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    lessonId: row.lesson_id,
    isCompleted: row.is_completed ?? false,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
  };
}

// GET /progress/:userId
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from("p2p_lesson_progress")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapProgress));
});

// PUT /progress/:userId/:lessonId — upsert completion
router.put("/:userId/:lessonId", async (req, res) => {
  const { userId, lessonId } = req.params;
  const completedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("p2p_lesson_progress")
    .upsert(
      {
        user_id: userId,
        lesson_id: lessonId,
        is_completed: true,
        completed_at: completedAt,
      },
      { onConflict: "user_id,lesson_id" }
    )
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Upsert failed" });
  }
  return res.json(mapProgress(data as Record<string, unknown>));
});

export default router;
