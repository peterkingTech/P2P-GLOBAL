import { Router } from "express";
import { supabaseServiceRole as supabase, verifyCaller, SUPABASE_PUBLIC_URL } from "../lib/supabase";
import { notificationActorId } from "../lib/notificationActors";
import { verifyPreviewToken } from "../lib/previewToken";
import { getPreviewLevels, PREVIEW_CONTENT_LEVELS } from "../lib/notificationPrivacy";

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

// ── iPhone long-press preview (secure fetch) ───────────────────────────────
// POST /notifications/preview with header X-P2P-Preview-Token (never a URL
// query, so it can't land in access logs; the header is also redacted in
// lib/logger.ts). The token (lib/previewToken.ts) proves only "this recipient
// may see this one message's preview until it expires"; every request
// re-checks, against the database:
//   the notification belongs to that recipient and points at that message +
//   conversation; the recipient is still a member; the message still exists
//   in that conversation and isn't deleted; the recipient's CURRENT level is
//   "Name and message" ('full') or "Name, reveal message on hold" ('hold');
//   for voice, the link is our own public voice-messages storage.
// `display` tells the iPhone where it may show the text: "banner" ('full')
// or only the press-and-hold view, "hold" ('hold') — decided from the
// CURRENT level on every fetch, so a change of mind applies immediately.
// Any failure — missing secret, bad/expired token, any check — is the same
// 404 "Preview unavailable", so nothing about a message's existence leaks.
// Read-only: it never marks anything read or changes any state.
const PREVIEW_MAX_TEXT = 1000;
const previewUnavailable = (res: import("express").Response) =>
  res.status(404).set("Cache-Control", "no-store").json({ error: "Preview unavailable" });

export function trustedVoiceUrl(raw: unknown, supabaseBase: string): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL, base: URL;
  try { u = new URL(raw); base = new URL(supabaseBase); } catch { return null; }
  if (u.protocol !== "https:" || u.host !== base.host || u.username || u.password) return null;
  if (!u.pathname.startsWith("/storage/v1/object/public/voice-messages/") || u.pathname.includes("..") || u.pathname.includes("%2e") || u.pathname.includes("%2E")) return null;
  return u.toString();
}

router.post("/preview", async (req, res) => {
  const claims = verifyPreviewToken(req.get("x-p2p-preview-token"));
  if (!claims) return previewUnavailable(res);
  try {
    const { data: note } = await supabase.from("p2p_notifications")
      .select("id, user_id, notification_type, data").eq("id", claims.notificationId).maybeSingle();
    const nd = (note?.data ?? {}) as Record<string, unknown>;
    if (!note || note.user_id !== claims.recipientId || note.notification_type !== "new_message"
      || nd.messageId !== claims.messageId || nd.conversationId !== claims.conversationId) return previewUnavailable(res);

    const level = (await getPreviewLevels([claims.recipientId])).get(claims.recipientId) ?? "none";
    if (!PREVIEW_CONTENT_LEVELS.has(level)) return previewUnavailable(res);
    const display = level === "hold" ? "hold" : "banner";

    const { data: member } = await supabase.from("p2p_conversation_members")
      .select("user_id").eq("conversation_id", claims.conversationId).eq("user_id", claims.recipientId).maybeSingle();
    if (!member) return previewUnavailable(res);

    const { data: msg } = await supabase.from("p2p_messages")
      .select("id, conversation_id, sender_id, body, message_type, media_url, media_duration_seconds, deleted_at")
      .eq("id", claims.messageId).maybeSingle();
    if (!msg || msg.conversation_id !== claims.conversationId || msg.deleted_at || msg.sender_id === claims.recipientId) return previewUnavailable(res);

    res.set("Cache-Control", "no-store");
    if (msg.message_type === "voice") {
      const d = Number(msg.media_duration_seconds);
      return res.json({
        kind: "voice",
        display,
        voice: {
          url: trustedVoiceUrl(msg.media_url, SUPABASE_PUBLIC_URL),
          durationSeconds: Number.isFinite(d) && d > 0 && d < 24 * 3600 ? Math.round(d) : null,
        },
      });
    }
    if ((msg.message_type ?? "text") !== "text") return previewUnavailable(res);
    const text = typeof msg.body === "string" ? msg.body.trim() : "";
    if (!text) return previewUnavailable(res);
    return res.json({ kind: "text", display, text: text.length > PREVIEW_MAX_TEXT ? `${text.slice(0, PREVIEW_MAX_TEXT - 1)}…` : text });
  } catch {
    return previewUnavailable(res);
  }
});

export default router;
