import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id,
    hostId: row.host_id,
    title: row.title,
    description: row.description ?? null,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes ?? 45,
    participantCount: row.participant_count ?? 0,
    isLive: row.is_live ?? false,
    hostName: row.host_name ?? null,
    createdAt: row.created_at,
  };
}

// GET /sessions
router.get("/", async (req, res) => {
  const limit = Number(req.query.limit ?? 10);
  const { data, error } = await supabase
    .from("p2p_sessions")
    .select("*")
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapSession));
});

// POST /sessions
router.post("/", async (req, res) => {
  const { hostId, title, description, scheduledAt, durationMinutes, hostName } =
    req.body as {
      hostId: string;
      title: string;
      description?: string;
      scheduledAt: string;
      durationMinutes: number;
      hostName?: string;
    };

  const { data, error } = await supabase
    .from("p2p_sessions")
    .insert({
      host_id: hostId,
      title,
      description: description ?? null,
      scheduled_at: scheduledAt,
      duration_minutes: durationMinutes,
      participant_count: 0,
      is_live: false,
      host_name: hostName ?? null,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Insert failed" });
  }
  return res.status(201).json(mapSession(data as Record<string, unknown>));
});

export default router;
