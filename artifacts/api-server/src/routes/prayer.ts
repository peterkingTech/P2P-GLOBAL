import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapPrayer(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    nation: row.nation ?? null,
    text: row.text,
    prayerCount: row.prayer_count ?? 0,
    createdAt: row.created_at,
    hasPrayed: false,
  };
}

// GET /prayers
router.get("/", async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  const { data, error } = await supabase
    .from("p2p_prayer_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapPrayer));
});

// POST /prayers
router.post("/", async (req, res) => {
  const { userId, userName, nation, text } = req.body as {
    userId: string;
    userName: string;
    nation?: string;
    text: string;
  };

  const { data, error } = await supabase
    .from("p2p_prayer_requests")
    .insert({
      user_id: userId,
      user_name: userName,
      nation: nation ?? null,
      text,
      prayer_count: 0,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Insert failed" });
  }
  return res.status(201).json(mapPrayer(data as Record<string, unknown>));
});

// POST /prayers/:id/pray — increment count
router.post("/:id/pray", async (req, res) => {
  const { id } = req.params;

  // Fetch current count, then increment
  const { data: current, error: fetchErr } = await supabase
    .from("p2p_prayer_requests")
    .select("prayer_count")
    .eq("id", id)
    .single();

  if (fetchErr || !current) {
    return res.status(404).json({ error: "Prayer request not found" });
  }

  const newCount = ((current as Record<string, unknown>).prayer_count as number ?? 0) + 1;
  const { data, error } = await supabase
    .from("p2p_prayer_requests")
    .update({ prayer_count: newCount })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Update failed" });
  }
  return res.json(mapPrayer(data as Record<string, unknown>));
});

export default router;
