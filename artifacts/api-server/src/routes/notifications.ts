import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";

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

// Study Together C7 — Notification Center. These two routes must be
// registered BEFORE /:userId below — Express matches routes in
// registration order, and "/me" would otherwise be captured as
// :userId="me" by the older, param-trusting routes.
//
// GET /notifications/me — the caller's own notifications, identity from
// the verified session, never a route param. The two legacy routes below
// predate C7 and trust the :userId route param as identity, matching this
// whole API's established "no requireAuth middleware" pattern (see
// calls.ts) — that is a real pre-existing gap (documented, not silently
// fixed here: changing their trust model could affect other, unrelated
// features already calling them) but C7's own security requirement (never
// let recipientId be spoofed) applies squarely to what's genuinely NEW
// here, so the Notification Center built in this phase uses these
// JWT-verified routes instead, following the same scoped verifyCaller
// exception C2/C3 established.
router.get("/me", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { data, error } = await supabase
    .from("p2p_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapNotification));
});

// POST /notifications/me/:id/read — scoped to the verified caller's own id,
// never a route param, so a manipulated notification id can at most target
// a notification that isn't the caller's own (404, not another user's data).
router.post("/me/:id/read", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;

  const { data, error } = await supabase
    .from("p2p_notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Notification not found" });
  return res.json(mapNotification(data as Record<string, unknown>));
});

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
