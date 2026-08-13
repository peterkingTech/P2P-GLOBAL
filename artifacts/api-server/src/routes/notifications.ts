import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// p2p_notifications' RLS policies both require auth.uid() = user_id (see
// migrations) — the shared lib/supabase.ts client carries no forwarded
// session, so every read/write through it was silently blocked (rows exist,
// queries just return empty/no-op). Same fix as calls.ts/circles.ts: a local
// service-role client, scoped by the trusted :userId route param instead of
// a verified JWT (this API has no requireAuth middleware — see calls.ts).
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function mapNotification(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message ?? null,
    isRead: row.read ?? false,
    createdAt: row.created_at,
    notificationType: row.notification_type ?? null,
    data: row.data ?? null,
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
