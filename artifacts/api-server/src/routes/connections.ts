import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Same service-role reasoning as everywhere else in this API — no
// requireAuth middleware, and p2p_connection_requests/p2p_user_blocks need
// cross-user reads/writes RLS won't allow via the anon key.
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function mapRequest(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    requestType: row.request_type,
    circleId: row.circle_id ?? null,
    message: row.message ?? null,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? null,
    ...extra,
  };
}

// POST /connections/request — { fromUserId, toUserId, requestType: 'connect'|'circle_invite', circleId?, message? }
// Peer-guide requests go through POST /discipleship/request instead — that
// system already has TTL expiry, auto-rematch-on-decline, and its own
// notification copy; duplicating it here would just create two competing
// sources of truth for the same relationship.
router.post("/request", async (req, res) => {
  const { fromUserId, toUserId, requestType, circleId, message } = req.body as {
    fromUserId?: string; toUserId?: string; requestType?: string; circleId?: string; message?: string;
  };
  if (!fromUserId || !toUserId || !requestType) {
    return res.status(400).json({ error: "fromUserId, toUserId, and requestType are required" });
  }
  if (!["connect", "circle_invite"].includes(requestType)) {
    return res.status(400).json({ error: "requestType must be 'connect' or 'circle_invite' (peer_guide goes through POST /discipleship/request)" });
  }
  if (requestType === "circle_invite" && !circleId) {
    return res.status(400).json({ error: "circleId is required for circle_invite requests" });
  }
  if (fromUserId === toUserId) return res.status(400).json({ error: "Cannot send a request to yourself" });

  // Re-sending after a decline/cancel should revive the same row rather than
  // permanently fail on the unique(from,to,type) constraint.
  const { data: existing } = await supabaseWrite
    .from("p2p_connection_requests")
    .select("id,status")
    .eq("from_user_id", fromUserId).eq("to_user_id", toUserId).eq("request_type", requestType)
    .maybeSingle();

  let row: Record<string, unknown> | null = null;
  if (existing && existing.status !== "pending") {
    const { data, error } = await supabaseWrite
      .from("p2p_connection_requests")
      .update({ status: "pending", circle_id: circleId ?? null, message: message?.trim() || null, created_at: new Date().toISOString(), responded_at: null })
      .eq("id", existing.id)
      .select()
      .single();
    if (error || !data) return res.status(500).json({ error: error?.message ?? "Failed to send request" });
    row = data as Record<string, unknown>;
  } else if (existing) {
    return res.status(409).json({ error: "A pending request already exists" });
  } else {
    const { data, error } = await supabaseWrite
      .from("p2p_connection_requests")
      .insert({ from_user_id: fromUserId, to_user_id: toUserId, request_type: requestType, circle_id: circleId ?? null, message: message?.trim() || null })
      .select()
      .single();
    if (error || !data) return res.status(500).json({ error: error?.message ?? "Failed to send request" });
    row = data as Record<string, unknown>;
  }

  const { data: fromProfile } = await supabaseWrite.from("p2p_profiles").select("full_name,username").eq("id", fromUserId).maybeSingle();
  const fromName = (fromProfile?.username as string | undefined) ? `@${fromProfile!.username}` : (fromProfile?.full_name as string | undefined) ?? "Someone";
  let title = `${fromName} wants to connect with you`;
  let notifMessage = "Tap to view their profile.";
  if (requestType === "circle_invite") {
    const { data: circle } = await supabaseWrite.from("p2p_peer_circles").select("name").eq("id", circleId).maybeSingle();
    title = `${fromName} has invited you to join ${circle?.name ?? "a circle"}`;
  }
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: toUserId, title, message: notifMessage,
    notification_type: "connection_request", data: { requestId: row.id, requestType, fromUserId },
  });

  return res.status(201).json(mapRequest(row));
});

// GET /connections/pending/:userId — incoming requests awaiting this user's response.
router.get("/pending/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabaseWrite
    .from("p2p_connection_requests")
    .select("*")
    .eq("to_user_id", userId).eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const fromIds = Array.from(new Set((data ?? []).map((r) => r.from_user_id as string)));
  const { data: profiles } = fromIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id,full_name,username,photo_url,country").in("id", fromIds)
    : { data: [] as { id: string; full_name: string; username: string | null; photo_url: string | null; country: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return res.json((data ?? []).map((r) => {
    const p = profileById.get(r.from_user_id as string);
    return mapRequest(r as Record<string, unknown>, {
      fromUserName: p?.full_name ?? "Someone", fromUsername: p?.username ?? null,
      fromPhotoUrl: p?.photo_url ?? null, fromCountry: p?.country ?? null,
    });
  }));
});

// POST /connections/:id/respond — { responderId, response: 'accepted'|'declined' }
router.post("/:id/respond", async (req, res) => {
  const { id } = req.params;
  const { responderId, response } = req.body as { responderId?: string; response?: string };
  if (!responderId || !["accepted", "declined"].includes(response ?? "")) {
    return res.status(400).json({ error: "responderId and a valid response are required" });
  }

  const { data: request } = await supabaseWrite.from("p2p_connection_requests").select("*").eq("id", id).maybeSingle();
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.to_user_id !== responderId) return res.status(403).json({ error: "Only the recipient can respond to this request" });
  if (request.status !== "pending") return res.status(409).json({ error: "This request has already been responded to" });

  const { error: updateErr } = await supabaseWrite
    .from("p2p_connection_requests")
    .update({ status: response, responded_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  if (response === "accepted" && request.request_type === "circle_invite" && request.circle_id) {
    await supabaseWrite
      .from("p2p_peer_circle_members")
      .upsert({ circle_id: request.circle_id, user_id: responderId, role: "member", status: "active", joined_at: new Date().toISOString() }, { onConflict: "circle_id,user_id" });
  }

  const { data: responderProfile } = await supabaseWrite.from("p2p_profiles").select("full_name,username").eq("id", responderId).maybeSingle();
  const responderName = (responderProfile?.username as string | undefined) ? `@${responderProfile!.username}` : (responderProfile?.full_name as string | undefined) ?? "Someone";
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: request.from_user_id,
    title: response === "accepted" ? `${responderName} accepted your request` : `${responderName} declined your request`,
    message: "",
  });

  return res.json({ ok: true, status: response });
});

// ── Blocking ──────────────────────────────────────────────────────────────────

// POST /connections/block — { blockerId, blockedId }
router.post("/block", async (req, res) => {
  const { blockerId, blockedId } = req.body as { blockerId?: string; blockedId?: string };
  if (!blockerId || !blockedId) return res.status(400).json({ error: "blockerId and blockedId are required" });
  const { error } = await supabaseWrite
    .from("p2p_user_blocks").upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /connections/unblock — { blockerId, blockedId }
router.post("/unblock", async (req, res) => {
  const { blockerId, blockedId } = req.body as { blockerId?: string; blockedId?: string };
  if (!blockerId || !blockedId) return res.status(400).json({ error: "blockerId and blockedId are required" });
  const { error } = await supabaseWrite
    .from("p2p_user_blocks").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// GET /connections/blocked/:userId
router.get("/blocked/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabaseWrite.from("p2p_user_blocks").select("blocked_id,created_at").eq("blocker_id", userId).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const blockedIds = (data ?? []).map((b) => b.blocked_id as string);
  const { data: profiles } = blockedIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id,username,full_name").in("id", blockedIds)
    : { data: [] as { id: string; username: string | null; full_name: string }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return res.json((data ?? []).map((b) => ({
    userId: b.blocked_id,
    username: profileById.get(b.blocked_id as string)?.username ?? null,
    fullName: profileById.get(b.blocked_id as string)?.full_name ?? "Someone",
    blockedAt: b.created_at,
  })));
});

export default router;
