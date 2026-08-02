import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
// p2p_notifications has no client-facing INSERT policy for writing to
// someone ELSE's user_id (only self select/update — see migration 007) —
// notifying a peer guide about someone else's decision needs service-role,
// same reasoning as every other privileged write in this API.
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

// POST /prayers/sinners-prayer/notify-peer-guide — tell the user's peer
// guide they prayed the prayer of commitment today (opt-in, see
// prayer/sinners-prayer.tsx)
router.post("/sinners-prayer/notify-peer-guide", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data: link } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("disciple_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!link?.mentor_id) return res.json({ notified: false, reason: "No peer guide on record" });

  const { data: profile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  const name = profile?.full_name ?? "Your disciple";

  const { error } = await supabaseWrite.from("p2p_notifications").insert({
    user_id: link.mentor_id,
    title: "A sacred moment",
    message: `${name} prayed the prayer of commitment today. This is a sacred moment — reach out to them.`,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notified: true });
});

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
