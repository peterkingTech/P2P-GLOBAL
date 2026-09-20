import crypto from "node:crypto";
import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// P2P Rooms — Shareable Room Links (Stage B: database + API foundation).
// Purely additive over three existing, UNTOUCHED room domains
// (p2p_break_rooms, p2p_church_calls, p2p_family_worship_sessions).
// Direct calls and Prayer 2.0 gatherings are explicitly deferred — both
// already have their own complete, differently-shaped invitation flows.
//
// NON-NEGOTIABLE: this file never grants room access. Every response is
// either "here is safe preview info about a room" or "here is why you
// can't see that" — the actual join always happens through the existing,
// unmodified join endpoints in calls.ts/churchCalls.ts/familyWorship.ts,
// which independently re-check real authorization exactly as before.
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const ROOM_TYPES = ["break_room", "church_call", "family_worship"] as const;
type RoomType = (typeof ROOM_TYPES)[number];

// ── Token handling ──────────────────────────────────────────────────────────
// The raw token is generated here, returned ONCE in the creation response,
// and never stored or logged anywhere — only its sha256 hash is persisted.
// A database read of p2p_room_invitations alone can never yield a usable link.
function generateRawToken(): string {
  return crypto.randomBytes(24).toString("base64url"); // ~192 bits of entropy
}
function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// ── Per-room-type helpers — mirror the EXACT existing authorization logic
// already used by churchCalls.ts / familyWorship.ts / calls.ts, rather than
// reinventing a new membership model. Each room type owns its own small
// local helper, matching this codebase's established per-file convention.
async function getBreakRoom(roomId: string) {
  const { data } = await db.from("p2p_break_rooms").select("id,name,host_id,is_live,ended_at,room_type,channel_name").eq("id", roomId).maybeSingle();
  return data;
}
async function getChurchCall(roomId: string) {
  const { data } = await db.from("p2p_church_calls").select("id,title,church_id,host_id,status,started_at,ended_at,purpose").eq("id", roomId).maybeSingle();
  return data;
}
async function isActiveChurchMember(churchId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_church_members").select("is_active").eq("church_id", churchId).eq("user_id", userId).maybeSingle();
  return !!data?.is_active;
}
async function getFamilyWorshipSession(roomId: string) {
  const { data } = await db.from("p2p_family_worship_sessions").select("id,family_id,host_id,status,started_at,ended_at").eq("id", roomId).maybeSingle();
  return data;
}
async function isActiveFamilyMember(familyId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_family_members").select("id").eq("family_id", familyId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return !!data;
}
async function profileName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}

// Maps each room type's own status columns into one small, honest set of
// invitation-facing states — reusing each room's EXISTING lifecycle, never
// inventing a parallel one.
type RoomState = "scheduled" | "live" | "completed" | "unavailable";
function breakRoomState(room: { is_live: boolean; ended_at: string | null }): RoomState {
  if (room.ended_at) return "completed";
  return room.is_live ? "live" : "unavailable";
}
function churchCallState(room: { status: string }): RoomState {
  return room.status === "live" ? "live" : "completed";
}
function familyWorshipState(room: { status: string }): RoomState {
  if (["ended"].includes(room.status)) return "completed";
  if (room.status === "scheduled") return "scheduled";
  return "live"; // starting/active/paused/scripture/prayer/sharing/silent_prayer/ending
}

async function getRoomOwnershipAndPreview(roomType: RoomType, roomId: string) {
  if (roomType === "break_room") {
    const room = await getBreakRoom(roomId);
    if (!room) return null;
    return {
      hostId: room.host_id as string, title: room.name as string, roomState: breakRoomState(room as any),
      subtitle: room.room_type as string | null, scheduledAt: null as string | null,
    };
  }
  if (roomType === "church_call") {
    const room = await getChurchCall(roomId);
    if (!room) return null;
    return {
      hostId: room.host_id as string, title: room.title as string, roomState: churchCallState(room as any),
      subtitle: room.purpose as string | null, scheduledAt: room.started_at as string | null,
      churchId: room.church_id as string,
    };
  }
  const room = await getFamilyWorshipSession(roomId);
  if (!room) return null;
  return {
    hostId: room.host_id as string, title: "Family Worship", roomState: familyWorshipState(room as any),
    subtitle: null as string | null, scheduledAt: room.started_at as string | null, familyId: room.family_id as string,
  };
}

// ── Status check — does an active invitation already exist for this room? ──
// Host-only, and deliberately never returns a token (there is nothing to
// return — only the hash is stored). This exists so the client can tell
// "no invitation exists yet" apart from "an invitation exists but this
// device doesn't have it cached" — without it, "Generate Link" on a device
// with no cache would silently revoke a still-active invitation created
// elsewhere, which is exactly the silent-regeneration behavior this
// feature must never do.
router.get("/status", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { roomType, roomId } = req.query as { roomType?: string; roomId?: string };
  if (!roomType || !ROOM_TYPES.includes(roomType as RoomType)) return err(res, `roomType must be one of: ${ROOM_TYPES.join(", ")}`);
  if (!roomId) return err(res, "roomId is required");

  const preview = await getRoomOwnershipAndPreview(roomType as RoomType, roomId);
  if (!preview) return err(res, "Room not found", 404);
  if (preview.hostId !== userId) return err(res, "Only the room host can view this room's invitation status", 403);

  const column = roomType === "break_room" ? "break_room_id" : roomType === "church_call" ? "church_call_id" : "family_worship_session_id";
  const { data: active } = await db.from("p2p_room_invitations").select("id,created_at,expires_at").eq(column, roomId).eq("status", "active").maybeSingle();
  return ok(res, active ? { hasActive: true, invitationId: active.id, createdAt: active.created_at, expiresAt: active.expires_at } : { hasActive: false });
});

// ── Create (or replace) the active invitation for a room ───────────────────
router.post("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { roomType, roomId, expiresAt } = req.body as { roomType?: string; roomId?: string; expiresAt?: string | null };
  if (!roomType || !ROOM_TYPES.includes(roomType as RoomType)) return err(res, `roomType must be one of: ${ROOM_TYPES.join(", ")}`);
  if (!roomId) return err(res, "roomId is required");

  const preview = await getRoomOwnershipAndPreview(roomType as RoomType, roomId);
  if (!preview) return err(res, "Room not found", 404);
  // Only the room's own host may create/replace its invitation — verified
  // against the real room row, never trusted from the client.
  if (preview.hostId !== userId) return err(res, "Only the room host can create an invitation for this room", 403);

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  const { data, error } = await db.rpc("p2p_create_room_invitation", {
    p_room_type: roomType, p_room_id: roomId, p_created_by: userId, p_token_hash: tokenHash,
    p_expires_at: expiresAt ?? null,
  });
  if (error || !data) return err(res, error?.message ?? "Failed to create invitation", 500);
  const row = Array.isArray(data) ? data[0] : data;

  // The raw token is returned exactly once, here, and nowhere else.
  return ok(res, {
    invitationId: row.id, token: rawToken, roomType, roomId, status: row.status,
    expiresAt: row.expires_at, createdAt: row.created_at,
  });
});

// ── Revoke ───────────────────────────────────────────────────────────────
router.post("/:invitationId/revoke", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_room_invitations").select("id,created_by,status").eq("id", req.params.invitationId).maybeSingle();
  if (!existing) return err(res, "Invitation not found", 404);
  if (existing.created_by !== userId) return err(res, "Only the invitation's creator can revoke it", 403);
  if (existing.status === "revoked") return ok(res, { revoked: true });

  const { error } = await db.from("p2p_room_invitations").update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", req.params.invitationId);
  if (error) return err(res, error.message, 500);
  return ok(res, { revoked: true });
});

// ── Resolve by token — authenticated, safe-preview-only ─────────────────────
// This NEVER performs a join and NEVER returns Agora/session credentials.
router.get("/:token", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401); // clear "authentication required" — see app-side sign-in route

  const tokenHash = hashToken(req.params.token);
  const { data: invitation } = await db.from("p2p_room_invitations").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (!invitation) return err(res, "Invitation not found", 404);
  if (invitation.status === "revoked") return err(res, "This invitation has been revoked", 410);
  if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) return err(res, "This invitation has expired", 410);

  const roomType: RoomType = invitation.break_room_id ? "break_room" : invitation.church_call_id ? "church_call" : "family_worship";
  const roomId = (invitation.break_room_id ?? invitation.church_call_id ?? invitation.family_worship_session_id) as string;

  const preview = await getRoomOwnershipAndPreview(roomType, roomId);
  if (!preview) return err(res, "This room no longer exists", 404);

  // Per-room-type authorization for even SEEING the preview — break rooms
  // are already fully open in this codebase (Discover lists them to any
  // authenticated user), so no further check is needed there. Church
  // calls and family worship are real membership boundaries: a non-member
  // gets a distinct "not authorized" state with NO title/host/schedule
  // leaked, never the same response shape as a valid preview.
  if (roomType === "church_call") {
    const authorized = await isActiveChurchMember((preview as any).churchId, userId);
    if (!authorized) return err(res, "You don't have access to this invitation", 403);
  } else if (roomType === "family_worship") {
    const authorized = await isActiveFamilyMember((preview as any).familyId, userId);
    if (!authorized) return err(res, "You don't have access to this invitation", 403);
  }

  const hostName = await profileName(preview.hostId);
  return ok(res, {
    roomType, roomId, title: preview.title, subtitle: preview.subtitle, hostName,
    scheduledAt: preview.scheduledAt, roomState: preview.roomState,
    invitationStatus: invitation.status, canAttemptJoin: preview.roomState === "live",
  });
});

export default router;
