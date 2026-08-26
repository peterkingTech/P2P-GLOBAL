import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";

const router = Router();

// p2p_notifications' RLS policies both require auth.uid() = user_id — the
// shared lib/supabase.ts anon client carries no forwarded session, so a
// service-role client is used here, with identity coming from verifyCaller
// (a real Supabase JWT) rather than from RLS on this connection.
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

// Security hardening phase — the legacy GET/POST /:userId routes that used
// to live below this comment trusted the route param as identity (a real
// vulnerability: any authenticated caller could substitute any userId and
// read/mark-read a stranger's notifications). Before removing them, every
// caller in this codebase was searched for (mobile app source, api-server,
// and the mockup-sandbox package) — zero call sites use them; the only
// consumer of p2p_notifications besides these was always the mobile
// client's direct, RLS-protected Realtime subscription (DataContext.tsx,
// filtered to circle_session_start) and, since C7, these /me routes below.
// Confirmed dead code, not a guess, so removed outright rather than left as
// a documented-but-live vulnerability — this is the "verify no callers
// remain, then deprecate" path the hardening spec asked for.
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

export default router;
