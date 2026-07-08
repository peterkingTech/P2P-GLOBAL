import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapLink(row: Record<string, unknown>) {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    discipleId: row.disciple_id,
    startedAt: row.started_at,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
  };
}

// GET /discipleship/:userId/disciples
router.get("/:userId/disciples", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from("p2p_discipleship_links")
    .select("*")
    .eq("mentor_id", userId)
    .eq("is_active", true);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapLink));
});

// POST /discipleship
router.post("/", async (req, res) => {
  const { mentorId, discipleId } = req.body as {
    mentorId: string;
    discipleId: string;
  };

  const { data, error } = await supabase
    .from("p2p_discipleship_links")
    .insert({
      mentor_id: mentorId,
      disciple_id: discipleId,
      started_at: new Date().toISOString(),
      is_active: true,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Insert failed" });
  }
  return res.status(201).json(mapLink(data as Record<string, unknown>));
});

export default router;
