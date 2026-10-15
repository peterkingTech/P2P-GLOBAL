import { Router } from "express";
import { supabaseServiceRole as supabase, verifyCaller } from "../lib/supabase";
import { notificationActorId } from "../lib/notificationActors";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// p2p_notifications' RLS policies both require auth.uid() = user_id — the
// shared lib/supabase.ts anon client carries no forwarded session, so the
// shared service-role client is used here (same URL/key resolution this file
// used to duplicate), with identity coming from verifyCaller (a real
// Supabase JWT) rather than from RLS on this connection.

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
// GET /notifications/me — newest first. Still a plain array (older app
// builds read it as one). Optional paging: ?limit=1..100 (default 100) and
// ?before=<createdAt of the last row seen>. Each row carries `actor`: the
// acting person's public name/photo/username for the types listed in
// lib/notificationActors.ts, null for system events.
router.get("/me", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "100"), 10) || 100));
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;

  let query = supabase
    .from("p2p_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data ?? []) as Record<string, unknown>[];

  // One batched profile read for every acting person on this page; only
  // public fields (never email, date of birth or other private columns).
  const actorIds = [...new Set(rows.map((r) => notificationActorId(r.notification_type as string, r.data as Record<string, unknown>)).filter((x): x is string => !!x))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("p2p_profiles").select("id,full_name,photo_url,username").in("id", actorIds)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map(((profiles ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
  return res.json(rows.map((r) => {
    const actorId = notificationActorId(r.notification_type as string, r.data as Record<string, unknown>);
    const p = actorId ? byId.get(actorId) : undefined;
    return {
      ...mapNotification(r),
      actor: p ? { id: p.id, name: (p.full_name as string) ?? null, photoUrl: (p.photo_url as string) ?? null, username: (p.username as string) ?? null } : null,
    };
  }));
});

// GET /notifications/me/unread-count — exact, across ALL of the caller's
// notifications (not just the newest page), so badges and counters agree
// on every device.
router.get("/me/unread-count", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { count, error } = await supabase
    .from("p2p_notifications").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("read", false);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ count: count ?? 0 });
});

// POST /notifications/me/:id/read — scoped to the verified caller's own id,
// never a route param, so a manipulated notification id can at most target
// a notification that isn't the caller's own (404, not another user's data).
// Idempotent: repeating it (duplicate taps, retries) changes nothing and
// reports wasUnread=false, so a client never counts the same read twice.
router.post("/me/:id/read", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Notification not found" });

  const { data: changed, error } = await supabase
    .from("p2p_notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("read", false)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (changed) return res.json({ ...mapNotification(changed as Record<string, unknown>), wasUnread: true });

  const { data: existing, error: readErr } = await supabase
    .from("p2p_notifications").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (readErr) return res.status(500).json({ error: readErr.message });
  if (!existing) return res.status(404).json({ error: "Notification not found" });
  return res.json({ ...mapNotification(existing as Record<string, unknown>), wasUnread: false });
});

// POST /notifications/me/read-all — same identity/scoping model as the
// single-notification route above; only ever touches the caller's own
// unread rows.
router.post("/me/read-all", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { error } = await supabase
    .from("p2p_notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;
