import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapNotification(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message ?? null,
    isRead: row.read ?? false,
    createdAt: row.created_at,
  };
}

// GET /notifications/:userId
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from("p2p_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapNotification));
});

// POST /notifications/:userId/:id/read
router.post("/:userId/:id/read", async (req, res) => {
  const { userId, id } = req.params;
  // Scope update by both id AND user_id to prevent cross-user modification
  const { data, error } = await supabase
    .from("p2p_notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Notification not found" });
  }
  return res.json(mapNotification(data as Record<string, unknown>));
});

export default router;
