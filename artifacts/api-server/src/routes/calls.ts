import crypto from "node:crypto";
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { notifyInterestedUsers, notifyModerators } from "../lib/breakRooms";
import { isEligibleStudyPartner, getEligibleStudyPartners } from "../lib/studyPartnerAuth";

const router = Router();

// Same RLS workaround used throughout this codebase (see curriculum.ts's
// supabaseRead, profiles.ts's supabaseRead) — a service-role client for
// server-side reads/writes across tables with RLS policies that only allow
// the row's own owner to read/write via the anon key. This server has no
// per-request authenticated Supabase session (routes take userId directly
// in the body/query, not a verified JWT — see discipleship.ts, circles.ts),
// so a service-role client is the only way these routes can act at all.
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const APP_ID = process.env.AGORA_APP_ID ?? "";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "";
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// Admin Identity Separation — the roles treated as "P2P Admin" for calling
// purposes. Deliberately NOT the same set as adminAuth.ts's ADMIN_ROLES
// (which also includes peer_guide and church_leader, since those gate
// admin-panel access) — peer guides are meant to be discoverable and
// callable by their disciples, and Church Portal is its own separate
// permission domain (never conflate the two). This set matches migration
// 069's admin hierarchy plus the two pre-existing admin-ish roles.
const P2P_ADMIN_ROLES = new Set([
  "super_admin", "regional_admin", "moderator",
  "admin_supervisor", "admin_zone", "admin_national", "admin_content",
  "admin_translation", "admin_moderation", "admin_verification",
  "admin_help", "admin_username", "admin_finance", "admin_marketing", "admin_church",
]);
function isAdminOrOfficial(profile: { role?: string | null; is_official_account?: boolean | null } | null | undefined): boolean {
  return !!profile?.is_official_account || P2P_ADMIN_ROLES.has(profile?.role ?? "");
}

// Study Together C1 — Group Calling Foundation. Initial cap on how many
// real people (including the caller) one p2p_ peer call can hold. Not
// provider-imposed (Agora has no hard ceiling here) — chosen so the
// eventual group Study Together UI (participant chips, adaptive video
// grid) stays legible; see the Group Calling Foundation report for the
// full reasoning. Raise only after that UI is proven at this size.
const MAX_CALL_PARTICIPANTS = 6;

// The currently-active (not yet ended) p2p_call_logs row for a peer
// channel — the single source of truth for "who is actually allowed in
// this specific call." A channel name is deterministic per pair
// (`p2p_${sorted}`) and gets reused across every call two people ever
// have, so this always takes the most recent row and requires
// status = "initiated" (an ended/missed row is not "active").
async function getActivePeerCallLog(channelName: string) {
  const { data, error } = await supabaseWrite
    .from("p2p_call_logs")
    .select("id, initiated_by, participants")
    .eq("channel_name", channelName)
    .eq("status", "initiated")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; initiated_by: string; participants: string[] } | null;
}

function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}
function ok(res: import("express").Response, data: unknown) {
  return res.json(data);
}

// Study Together C2 — Add People + Invitations. Every other route in this
// file (and this whole codebase — see the comment above) trusts a
// caller-supplied id in the request body, since there's no requireAuth
// middleware anywhere in this API. The C2 spec explicitly requires real
// identity verification for who's allowed to invite/accept into a call —
// never trust a client-supplied inviterId/inviteeId as proof of identity —
// so these invitation endpoints alone verify the caller's actual Supabase
// session via their access token. This is a scoped exception for this one
// feature, not a codebase-wide auth overhaul.
const authClient = createClient(SUPABASE_URL, ANON_KEY);
async function verifyCaller(req: import("express").Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// POST /calls/token — mint an Agora RTC token for a channel + numeric uid.
// No requireAuth middleware exists in this codebase (see discipleship.ts,
// circles.ts) — every route here trusts the caller-supplied identity the
// same way the rest of the API does.
//
// SECURITY (Study Together C1): for p2p_ peer channels only, the caller
// must be a recorded participant of that channel's active call log —
// otherwise knowing/guessing a channelName would be enough to join an
// unrelated call (see the Group Calling Foundation investigation, §14).
// Peer Circle (circle_*) and Break Room (room_*) channels are untouched —
// they already have their own separate membership/join authorization
// upstream of ever requesting a token, and never write a p2p_call_logs
// row, so this check does not apply to them.
router.post("/calls/token", async (req, res) => {
  try {
    const { channelName, uid, userId } = req.body as { channelName?: string; uid?: number; userId?: string };
    if (!channelName || uid === undefined || uid === null) {
      return err(res, "channelName and uid required");
    }
    if (!APP_ID || !APP_CERTIFICATE) {
      return err(res, "Agora not configured on server", 500);
    }

    if (channelName.startsWith("p2p_")) {
      if (!userId) return err(res, "userId required for this call type", 400);
      const activeLog = await getActivePeerCallLog(channelName);
      if (!activeLog || !(activeLog.participants ?? []).includes(userId)) {
        return err(res, "Not authorized to join this call", 403);
      }
    } else if (channelName.startsWith("circle_")) {
      // Security roadmap Phase 4 — this Agora channel previously had no
      // membership check at all (unlike p2p_ channels above): anyone who
      // could compute or guess a circleId could get a real token and join
      // a Peer Circle's live audio/video call, not just observe its
      // signaling channel. Peer Circles are a closed membership model
      // (p2p_peer_circle_members), so authorization here mirrors that.
      if (!userId) return err(res, "userId required for this call type", 400);
      const circleId = channelName.slice("circle_".length);
      const { data: membership } = await supabaseWrite
        .from("p2p_peer_circle_members").select("id").eq("circle_id", circleId).eq("user_id", userId).eq("status", "active").maybeSingle();
      if (!membership) return err(res, "Not authorized to join this circle call", 403);
    } else if (channelName.startsWith("room_")) {
      // Break Rooms are intentionally open-join (any authenticated user may
      // join an open community room, per its own /calls/rooms/:roomId/join
      // endpoint which already checks p2p_break_room_blocks) — so the bar
      // here is "has an active participant row" (join always runs first),
      // not a closed membership list like Peer Circles.
      if (!userId) return err(res, "userId required for this call type", 400);
      const roomId = channelName.slice("room_".length);
      const { data: participant } = await supabaseWrite
        .from("p2p_break_room_participants").select("id").eq("room_id", roomId).eq("user_id", userId).is("left_at", null).maybeSingle();
      if (!participant) return err(res, "Not authorized to join this room", 403);
    }

    const expirationTime = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationTime,
      expirationTime,
    );

    return ok(res, { token, channelName, uid, appId: APP_ID, expiresAt: expirationTime });
  } catch (e) {
    // CALL DEBUG forensic fix — this previously swallowed the real error
    // entirely (not even a server log), so a genuine failure here (e.g. a
    // Supabase read inside getActivePeerCallLog throwing) was invisible in
    // production logs and indistinguishable from a client bug. Never logs
    // the token/certificate/channel — only what stage failed.
    console.error("[CALL ERROR] stage=token_generation", e instanceof Error ? e.message : String(e));
    return err(res, "Failed to generate token", 500);
  }
});

// GET /calls/participants?channelName= — the real user ids currently
// authorized in an active p2p_ call. Call screens use this to resolve
// Agora's numeric uids (via uidFromUserId) back to real participants once
// a call has more than the one original party — there is no server-side
// uid registry, so this is the only source of truth for "who is actually
// in the call" beyond the single otherUserId route param the 1:1 flow
// already carries.
router.get("/calls/participants", async (req, res) => {
  const { channelName } = req.query as { channelName?: string };
  if (!channelName) return err(res, "channelName required", 400);
  if (!channelName.startsWith("p2p_")) return ok(res, { participants: [] });
  try {
    const activeLog = await getActivePeerCallLog(channelName);
    return ok(res, { participants: activeLog?.participants ?? [] });
  } catch (e: any) {
    return err(res, e?.message ?? "Failed to load participants", 500);
  }
});

// POST /calls/join — Study Together C1's controlled participant-entry
// mechanism: adds userId to an already-active p2p_ call's authorized
// participant list. This is deliberately NOT an "Add People" feature —
// there is no invitation/acceptance step here, no UI button calls this
// yet, and it exists purely as the call-foundation's test/extension
// point for a later phase to build a real invitation flow on top of.
// Authorization reuses the same relationship rule as
// GET /discipleship/study-partners/:userId (isEligibleStudyPartner) —
// the joiner must have a real relationship with the call's original
// caller. Idempotent for someone already listed (safe for reconnects).
router.post("/calls/join", async (req, res) => {
  const { channelName, userId } = req.body as { channelName?: string; userId?: string };
  if (!channelName || !userId) return err(res, "channelName and userId required", 400);
  if (!channelName.startsWith("p2p_")) return err(res, "This call type does not support joining", 400);

  let activeLog;
  try {
    activeLog = await getActivePeerCallLog(channelName);
  } catch (e: any) {
    return err(res, e?.message ?? "Failed to load call", 500);
  }
  if (!activeLog) return err(res, "No active call found for this channel", 404);

  const participants = activeLog.participants ?? [];
  if (participants.includes(userId)) {
    return ok(res, { joined: true, participants });
  }
  if (participants.length >= MAX_CALL_PARTICIPANTS) {
    return err(res, "This call has reached its maximum number of participants", 409);
  }

  const eligible = await isEligibleStudyPartner(supabaseWrite, userId, activeLog.initiated_by);
  if (!eligible) return err(res, "Not authorized to join this call", 403);

  const nextParticipants = [...participants, userId];
  const { error: updateErr } = await supabaseWrite
    .from("p2p_call_logs")
    .update({ participants: nextParticipants })
    .eq("id", activeLog.id);
  if (updateErr) return err(res, updateErr.message, 500);

  return ok(res, { joined: true, participants: nextParticipants });
});

// GET /calls/:callId/inviteable-people — relationship-scoped, excludes
// anyone already in the call. Reuses getEligibleStudyPartners (the same
// relationship rule as GET /discipleship/study-partners/:userId) rather
// than a second definition of "study partner."
router.get("/calls/:callId/inviteable-people", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;

  const { data: callLog } = await supabaseWrite
    .from("p2p_call_logs").select("id, status, participants").eq("id", callId).maybeSingle();
  if (!callLog) return err(res, "Call not found", 404);
  const participants = (callLog.participants as string[]) ?? [];
  if (!participants.includes(requesterId)) return err(res, "Not authorized for this call", 403);

  const relationshipById = await getEligibleStudyPartners(supabaseWrite, requesterId);
  const eligibleIds = Array.from(relationshipById.keys()).filter((id) => !participants.includes(id));

  const { data: pendingInvites } = await supabaseWrite
    .from("p2p_call_invitations").select("invitee_id")
    .eq("call_id", callId).eq("status", "pending").gt("expires_at", new Date().toISOString());
  const pendingIds = new Set((pendingInvites ?? []).map((i) => i.invitee_id as string));

  if (eligibleIds.length === 0) return ok(res, { people: [] });
  const { data: profiles } = await supabaseWrite
    .from("p2p_profiles").select("id, full_name, username, photo_url").in("id", eligibleIds);

  const rank = { peer_guide: 0, disciple: 1, connection: 2 } as const;
  const people = ((profiles ?? []) as Record<string, unknown>[])
    .map((p) => ({
      userId: p.id as string,
      displayName: (p.full_name as string) ?? "Someone",
      username: (p.username as string) ?? null,
      photoUrl: (p.photo_url as string) ?? null,
      relationship: relationshipById.get(p.id as string)!,
      invitationPending: pendingIds.has(p.id as string),
    }))
    .sort((a, b) => rank[a.relationship] - rank[b.relationship] || a.displayName.localeCompare(b.displayName));

  return ok(res, { people });
});

// POST /calls/:callId/invitations — body { inviteeId }. Inviter identity
// comes from the verified session, never req.body. Eligibility reuses
// isEligibleStudyPartner; capacity/duplicate/membership checks run
// atomically in p2p_create_call_invitation (SQL, row-locked — see
// migration 083) so concurrent invitations can't overrun the 6-person cap.
// On success, also writes a p2p_incoming_calls row so the invitee is
// notified through the app's existing ringing-call mechanism (realtime
// subscription -> IncomingCallHost -> call/incoming.tsx) instead of a
// second notification system.
router.post("/calls/:callId/invitations", async (req, res) => {
  const inviterId = await verifyCaller(req);
  if (!inviterId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { inviteeId } = req.body as { inviteeId?: string };
  if (!inviteeId) return err(res, "inviteeId required", 400);

  const { data: callLog } = await supabaseWrite
    .from("p2p_call_logs").select("id, channel_name, call_type, conversation_id, status").eq("id", callId).maybeSingle();
  if (!callLog) return err(res, "Call not found", 404);
  if (callLog.status !== "initiated") return err(res, "This call has ended", 410);

  const eligible = await isEligibleStudyPartner(supabaseWrite, inviterId, inviteeId);
  if (!eligible) return err(res, "This person cannot be added to this call", 403);

  const { data: invitationId, error: rpcErr } = await supabaseWrite.rpc("p2p_create_call_invitation", {
    p_call_id: callId, p_inviter_id: inviterId, p_invitee_id: inviteeId,
  });
  if (rpcErr) {
    const reason = rpcErr.message ?? "";
    if (reason.includes("call_full")) return err(res, "This call is already full.", 409);
    if (reason.includes("invitation_pending")) return err(res, "An invitation is already pending.", 409);
    if (reason.includes("already_in_call")) return err(res, "This person is already in the call.", 409);
    if (reason.includes("not_participant")) return err(res, "Not authorized for this call", 403);
    if (reason.includes("call_ended")) return err(res, "This call has ended", 410);
    if (reason.includes("call_not_found")) return err(res, "Call not found", 404);
    return err(res, "Unable to invite this person.", 500);
  }

  const { data: inviterProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", inviterId).maybeSingle();
  await supabaseWrite.from("p2p_incoming_calls").insert({
    channel_name: callLog.channel_name, call_type: callLog.call_type,
    caller_id: inviterId, recipient_id: inviteeId, status: "ringing",
    conversation_id: callLog.conversation_id ?? null, call_log_id: callLog.id, invitation_id: invitationId,
  });

  // Study Together notification center — the live "ringing" row above only
  // reaches the invitee while they're actively watching the incoming-call
  // screen; a durable p2p_notifications record is what lets them find the
  // invitation later (notification center, eventually push) if they weren't.
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: inviteeId,
    title: "Study Together invitation",
    message: `${inviterProfile?.full_name ?? "Someone"} invited you to study together.`,
    notification_type: "study_invitation_received",
    data: { callId, invitationId },
  });

  return ok(res, { success: true, invitationId, status: "pending" });
});

// POST /calls/invitations/:id/accept — invitee identity from the verified
// session, never req.body. All capacity/expiry/status checks happen
// atomically in p2p_accept_call_invitation (SQL, row-locked).
router.post("/calls/invitations/:id/accept", async (req, res) => {
  const invitee = await verifyCaller(req);
  if (!invitee) return err(res, "Unauthorized", 401);
  const { id } = req.params;

  const { data, error } = await supabaseWrite.rpc("p2p_accept_call_invitation", {
    p_invitation_id: id, p_invitee_id: invitee,
  });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("call_full")) return err(res, "This call is already full.", 409);
    if (reason.includes("invitation_expired")) return err(res, "This invitation is no longer available.", 410);
    if (reason.includes("invitation_already_used")) return err(res, "This invitation has already been handled.", 409);
    if (reason.includes("not_your_invitation")) return err(res, "Not authorized", 403);
    if (reason.includes("invitation_not_found")) return err(res, "Invitation not found", 404);
    if (reason.includes("call_ended")) return err(res, "This call has ended", 410);
    return err(res, "Unable to join this call.", 500);
  }

  // C5 — notify the inviter, once, only on a genuine successful accept (the
  // RPC above already rejects a second accept attempt with
  // invitation_already_used before this line is ever reached, so a retry
  // or double-tap can't produce a duplicate notification).
  const { data: invitation } = await supabaseWrite
    .from("p2p_call_invitations").select("inviter_id").eq("id", id).maybeSingle();
  if (invitation?.inviter_id) {
    const { data: inviteeProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", invitee).maybeSingle();
    await supabaseWrite.from("p2p_notifications").insert({
      user_id: invitation.inviter_id,
      title: "Invitation accepted",
      message: `${inviteeProfile?.full_name ?? "Someone"} accepted your Study Together invitation.`,
      notification_type: "study_invitation_accepted",
      data: { callId: (data as Record<string, unknown>)?.callLogId ?? null },
    });
  }

  return ok(res, data);
});

// POST /calls/invitations/:id/decline — invitee identity from the
// verified session.
router.post("/calls/invitations/:id/decline", async (req, res) => {
  const invitee = await verifyCaller(req);
  if (!invitee) return err(res, "Unauthorized", 401);
  const { id } = req.params;

  const { data: invitation } = await supabaseWrite.from("p2p_call_invitations").select("invitee_id, inviter_id, status").eq("id", id).maybeSingle();
  if (!invitation) return err(res, "Invitation not found", 404);
  if (invitation.invitee_id !== invitee) return err(res, "Not authorized", 403);
  // Idempotent: an already-handled invitation (including a previous decline)
  // short-circuits here, before the notification insert below, so a
  // duplicate/retry decline never produces a second notification.
  if (invitation.status !== "pending") return ok(res, { declined: true });

  const { error } = await supabaseWrite
    .from("p2p_call_invitations").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", id);
  if (error) return err(res, error.message, 500);

  if (invitation.inviter_id) {
    const { data: inviteeProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", invitee).maybeSingle();
    await supabaseWrite.from("p2p_notifications").insert({
      user_id: invitation.inviter_id,
      title: "Invitation declined",
      message: `${inviteeProfile?.full_name ?? "Someone"} declined your Study Together invitation.`,
      notification_type: "study_invitation_declined",
      data: {},
    });
  }

  return ok(res, { declined: true });
});

// ── Study Together C3: Group Study Together ─────────────────────────────────
// A group study session is server-authoritative (migration 084,
// p2p_study_sessions / p2p_study_session_participants) precisely so a
// mid-call joiner or a reconnecting participant can ask "what's actually
// happening right now" — the Realtime Broadcast channel useStudySession
// already used for section-sync/discussion/scripture-share has no memory
// for anyone who wasn't listening at the moment a signal went out. Every
// endpoint here verifies the real caller identity (verifyCaller, the same
// scoped JWT exception C2 introduced) and never trusts a body-supplied
// userId/leaderId, per C3 §20. The existing 1:1 Study Together path
// (useStudySession.ts, isGroup === false) never calls any of these — it
// keeps writing directly to p2p_sessions exactly as before.

// POST /calls/:callId/study/start — body { lessonId, moduleId, title }.
router.post("/calls/:callId/study/start", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { lessonId, moduleId, title } = req.body as { lessonId?: string; moduleId?: string; title?: string };
  if (!lessonId) return err(res, "lessonId required", 400);

  const { data: sessionId, error } = await supabaseWrite.rpc("p2p_start_study_session", {
    p_call_id: callId, p_user_id: userId, p_lesson_id: lessonId, p_module_id: moduleId ?? null, p_title: title ?? null,
  });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("call_not_found")) return err(res, "Call not found", 404);
    if (reason.includes("call_ended")) return err(res, "This call has ended", 410);
    if (reason.includes("not_participant")) return err(res, "Not authorized for this call", 403);
    if (reason.includes("session_already_active")) return err(res, "A study session is already active for this call.", 409);
    return err(res, "Unable to start study together.", 500);
  }
  return ok(res, { sessionId, leaderId: userId });
});

// GET /calls/:callId/study/current — the mid-call-join / reconnect lookup
// (spec §9, §18): "is there an active group study session for this call, and
// what's its state." Returns { active: false } if none.
router.get("/calls/:callId/study/current", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;

  const { data: callLog } = await supabaseWrite
    .from("p2p_call_logs").select("participants, status, channel_name, call_type, conversation_id").eq("id", callId).maybeSingle();
  if (!callLog) return err(res, "Call not found", 404);
  if (!((callLog.participants as string[]) ?? []).includes(userId)) return err(res, "Not authorized for this call", 403);

  // C7.6 — notification deep links need to tell "study ended, call still
  // going" apart from "the whole call is over," so a stale notification
  // gets an honest message instead of a silent failed navigation.
  if (callLog.status !== "initiated") return ok(res, { active: false, callEnded: true });

  const { data: session } = await supabaseWrite
    .from("p2p_study_sessions")
    .select("id, lesson_id, module_id, title, leader_id, current_section_index")
    .eq("call_log_id", callId).eq("status", "active").maybeSingle();
  if (!session) {
    return ok(res, {
      active: false, callEnded: false,
      channelName: callLog.channel_name, callType: callLog.call_type, conversationId: callLog.conversation_id ?? null,
    });
  }

  const { data: participantRows } = await supabaseWrite
    .from("p2p_study_session_participants")
    .select("user_id, joined_at")
    .eq("study_session_id", session.id).is("left_at", null)
    .order("joined_at", { ascending: true });
  const ids = (participantRows ?? []).map((p) => p.user_id as string);
  const { data: profiles } = ids.length
    ? await supabaseWrite.from("p2p_profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return ok(res, {
    active: true,
    callEnded: false,
    sessionId: session.id,
    lessonId: session.lesson_id,
    moduleId: session.module_id,
    title: session.title,
    leaderId: session.leader_id,
    currentSectionIndex: session.current_section_index,
    participants: (participantRows ?? []).map((p) => ({ userId: p.user_id, name: nameById.get(p.user_id as string) ?? "Someone" })),
    channelName: callLog.channel_name,
    callType: callLog.call_type,
    conversationId: callLog.conversation_id ?? null,
  });
});

// POST /calls/:callId/study/join — "Join Study" for a mid-call joiner, and
// also the reconnect entry point (idempotent — clears left_at if rejoining).
router.post("/calls/:callId/study/join", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;

  const { data, error } = await supabaseWrite.rpc("p2p_join_study_session", { p_call_id: callId, p_user_id: userId });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("call_not_found")) return err(res, "Call not found", 404);
    if (reason.includes("not_participant")) return err(res, "Not authorized for this call", 403);
    if (reason.includes("no_active_session")) return err(res, "There is no active study session for this call.", 404);
    return err(res, "Unable to join study together.", 500);
  }
  return ok(res, data);
});

// POST /calls/:callId/study/section — body { index }. Leader-only, enforced
// in p2p_update_study_section itself (spec §17/§20) so a non-leader calling
// this directly cannot move the shared group position.
router.post("/calls/:callId/study/section", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { index } = req.body as { index?: number };
  if (index === undefined || index === null) return err(res, "index required", 400);

  const { error } = await supabaseWrite.rpc("p2p_update_study_section", { p_call_id: callId, p_caller_id: userId, p_index: index });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("no_active_session")) return err(res, "There is no active study session for this call.", 404);
    if (reason.includes("not_leader")) return err(res, "Only the study leader can move the shared position.", 403);
    return err(res, "Unable to update the shared position.", 500);
  }
  return ok(res, { updated: true });
});

// POST /calls/:callId/study/participant-departed — body { departedUserId }.
// C4.7/C4.3 combined: called by any remaining study participant whose
// client observes (via Agora's onUserOffline) that someone's connection
// dropped — not just the leader (C3 only covered the leader-departure
// case; a non-leader who left stayed listed as an active study
// participant forever, which migration 085's updated
// p2p_reassign_study_leader fixes: it always marks the departure, and only
// computes a new leader — deterministically, earliest joined_at among the
// remaining active participants, never arbitrary — when the departure
// actually affects leadership). Safe under concurrent calls: row-locked
// and idempotent.
router.post("/calls/:callId/study/participant-departed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { departedUserId } = req.body as { departedUserId?: string };
  if (!departedUserId) return err(res, "departedUserId required", 400);

  const { data, error } = await supabaseWrite.rpc("p2p_reassign_study_leader", {
    p_call_id: callId, p_departed_user_id: departedUserId, p_caller_id: userId,
  });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("no_active_session")) return err(res, "There is no active study session for this call.", 404);
    if (reason.includes("not_participant")) return err(res, "Not authorized for this call", 403);
    return err(res, "Unable to update study participation.", 500);
  }

  // C7 — a leader transfer is exactly the one Study Together event worth a
  // notification (spec explicitly warns against notifying for every minor
  // change): tell only the new leader, once, never the whole group.
  if (data?.leaderChanged && data?.leaderId && !data?.ended) {
    const { data: session } = await supabaseWrite
      .from("p2p_study_sessions").select("title").eq("id", data.sessionId).maybeSingle();
    await supabaseWrite.from("p2p_notifications").insert({
      user_id: data.leaderId,
      title: "You are now leading this study",
      message: session?.title ? `You're now leading the group through "${session.title}."` : "You're now leading this group study session.",
      notification_type: "study_leader_transfer",
      data: { callId, studySessionId: data.sessionId },
    });
  }

  return ok(res, data);
});

// POST /calls/:callId/study/end — ends the group session for everyone (does
// not end the call itself), matching the existing 1:1 "End Study" symmetry
// where either participant can end study without ending the call.
router.post("/calls/:callId/study/end", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;

  // Fetched before ending — once p2p_end_study_session marks the session
  // 'ended' there's no clean way to ask "who was actively in this" anymore.
  const { data: sessionBefore } = await supabaseWrite
    .from("p2p_study_sessions").select("id, title").eq("call_log_id", callId).eq("status", "active").maybeSingle();
  const participantIds = sessionBefore
    ? (await supabaseWrite
        .from("p2p_study_session_participants").select("user_id")
        .eq("study_session_id", sessionBefore.id).is("left_at", null)
      ).data?.map((p) => p.user_id as string) ?? []
    : [];

  const { error } = await supabaseWrite.rpc("p2p_end_study_session", { p_call_id: callId, p_caller_id: userId });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("no_active_session")) return ok(res, { ended: true });
    if (reason.includes("not_participant")) return err(res, "Not authorized for this call", 403);
    return err(res, "Unable to end study together.", 500);
  }

  // Notify every other participant who was actively in the session — not
  // the caller who just ended it, and not participants who'd already left.
  const recipients = participantIds.filter((id) => id !== userId);
  if (recipients.length) {
    await supabaseWrite.from("p2p_notifications").insert(
      recipients.map((id) => ({
        user_id: id,
        title: "Study Together ended",
        message: sessionBefore?.title ? `The group study "${sessionBefore.title}" has ended.` : "This group study session has ended.",
        notification_type: "study_ended",
        data: { callId, studySessionId: sessionBefore?.id ?? null },
      }))
    );
  }

  return ok(res, { ended: true });
});

// POST /calls/:callId/study/participants/:userId/remove — Study Together
// C6. Leader-only (the current p2p_study_sessions.leader_id — the same
// already-synchronized role the app already shows, not a new "call owner"
// concept), enforced in p2p_remove_study_participant itself (migration
// 094), not just client-side. Removes the target from the call's own
// authorization list (p2p_call_logs.participants), which is what actually
// revokes their ability to get a new Agora token or resubscribe to the
// private Study Together realtime channel — Agora itself gives no
// participant authority over another client's media stream, so the
// removed client's own app must still act on the broadcast signal sent
// below to actually leave the call (same cooperative-removal pattern
// group.tsx/room.tsx already use for Peer Circles/Break Rooms).
router.post("/calls/:callId/study/participants/:userId/remove", async (req, res) => {
  const leaderId = await verifyCaller(req);
  if (!leaderId) return err(res, "Unauthorized", 401);
  const { callId, userId: targetUserId } = req.params;

  const { error } = await supabaseWrite.rpc("p2p_remove_study_participant", {
    p_call_id: callId, p_leader_id: leaderId, p_target_user_id: targetUserId,
  });
  if (error) {
    const reason = error.message ?? "";
    if (reason.includes("cannot_remove_self")) return err(res, "You can't remove yourself.", 400);
    if (reason.includes("call_not_found")) return err(res, "Call not found", 404);
    if (reason.includes("call_ended")) return err(res, "This call has ended", 410);
    if (reason.includes("not_a_participant")) return err(res, "This person is not in the call.", 404);
    if (reason.includes("not_leader")) return err(res, "Only the study leader can remove participants.", 403);
    return err(res, "Unable to remove this participant.", 500);
  }

  // Durable record alongside the realtime "participant_removed" broadcast
  // signal the client already sends — the broadcast only reaches the
  // removed participant if their client is actively connected right now;
  // this is what lets them find out (and, later, get pushed) otherwise.
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: targetUserId,
    title: "Removed from Study Together",
    message: "The study leader removed you from a Study Together session.",
    notification_type: "study_participant_removed",
    data: { callId },
  });

  return ok(res, { removed: true });
});

// POST /calls/peer-channel — deterministic channel name for a 1:1 pair,
// sorted so both sides compute the same name regardless of who initiates.
router.post("/calls/peer-channel", async (req, res) => {
  const { currentUserId, otherUserId } = req.body as { currentUserId?: string; otherUserId?: string };
  if (!currentUserId || !otherUserId) return err(res, "currentUserId and otherUserId required");

  const sorted = [currentUserId, otherUserId].sort();
  const channelName = `p2p_${sorted[0]}_${sorted[1]}`;
  return ok(res, { channelName });
});

// POST /calls/circle-channel — one stable channel per Peer Circle.
router.post("/calls/circle-channel", async (req, res) => {
  const { circleId } = req.body as { circleId?: string };
  if (!circleId) return err(res, "circleId required");
  return ok(res, { channelName: `circle_${circleId}` });
});

// POST /calls/room-channel — one stable channel per break room.
router.post("/calls/room-channel", async (req, res) => {
  const { roomId } = req.body as { roomId?: string };
  if (!roomId) return err(res, "roomId required");
  return ok(res, { channelName: `room_${roomId}` });
});

// POST /calls/start — creates the one p2p_call_logs row for this call plus
// the p2p_incoming_calls row that signals the recipient. Both writes go
// through the service-role client because neither table has an INSERT RLS
// policy for the anon key (see migration 058) — call/message system writes
// are server-owned, not client-owned. The caller's identity, however, is
// verified from the JWT (not a body-supplied id) and recipientId is
// confirmed to be a real, live account before either insert: both
// caller_id and recipient_id on p2p_incoming_calls are FKs to auth.users
// (migration 058), but every client call site sources recipientId from a
// p2p_profiles-scoped relationship (conversation members, discipleship
// links, etc.) — never from auth.users directly. p2p_profiles.id equals
// auth.users.id only by convention (set once at signup), so a stale/
// orphaned profile whose auth.users row no longer exists would otherwise
// blow up the second insert with a raw p2p_incoming_calls_recipient_id_fkey
// violation instead of a clean error.
router.post("/calls/start", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return err(res, "Unauthorized", 401);

  const { channelName, callType, recipientId, conversationId } = req.body as {
    channelName?: string; callType?: string; recipientId?: string; conversationId?: string;
  };
  if (!channelName || !callType || !recipientId) {
    return err(res, "channelName, callType, recipientId required");
  }

  const [{ data: profileRow }, { data: authUserData, error: authUserErr }, { data: callerProfile }] = await Promise.all([
    supabaseWrite.from("p2p_profiles").select("id, role, is_official_account").eq("id", recipientId).maybeSingle(),
    supabaseWrite.auth.admin.getUserById(recipientId),
    supabaseWrite.from("p2p_profiles").select("role, is_official_account").eq("id", callerId).maybeSingle(),
  ]);
  if (!profileRow || authUserErr || !authUserData?.user) {
    return err(res, "This person's account is no longer available", 404);
  }

  // Admin Identity Separation: a P2P admin or official account can call an
  // ordinary user, but not the other way around — a normal user must not be
  // able to ring an admin's personal account or a "P2P Official" identity
  // directly. Peer guides and church leaders are deliberately NOT covered
  // by this (see isAdminOrOfficial) — calling one's own peer guide, or a
  // church leader, remains unaffected. Mirrored in RLS on
  // p2p_incoming_calls (migration 101) so a direct PostgREST insert can't
  // bypass this check.
  if (isAdminOrOfficial(profileRow) && !isAdminOrOfficial(callerProfile)) {
    return err(res, "You can't call this account directly.", 403);
  }

  const { data: callLog, error: logErr } = await supabaseWrite
    .from("p2p_call_logs")
    .insert({
      channel_name: channelName, call_type: callType, initiated_by: callerId,
      participants: [callerId, recipientId], status: "initiated",
      conversation_id: conversationId ?? null,
    })
    .select("id").single();
  if (logErr || !callLog) return err(res, logErr?.message ?? "Failed to create call log", 500);

  const { data: incomingCall, error: incomingErr } = await supabaseWrite
    .from("p2p_incoming_calls")
    .insert({
      channel_name: channelName, call_type: callType, caller_id: callerId, recipient_id: recipientId,
      status: "ringing", conversation_id: conversationId ?? null, call_log_id: callLog.id,
    })
    .select("id").single();
  if (incomingErr || !incomingCall) {
    // Don't leave an orphaned "initiated" call log behind if the ringing
    // row couldn't be created.
    await supabaseWrite.from("p2p_call_logs").delete().eq("id", callLog.id);
    return err(res, incomingErr?.message ?? "Failed to create incoming call", 500);
  }

  return ok(res, { callLogId: callLog.id as string, incomingCallId: incomingCall.id as string });
});

const CALL_TYPE_SUMMARY_LABEL: Record<string, string> = {
  audio: "Audio call", video: "Video call", pastoral: "Pastoral check-in", crisis: "Crisis call", group: "Group call",
};

// Call History / Call Information audit fix — the wording a call-summary
// message uses for a call that never connected. p2p_call_logs.status has
// always documented 'missed'/'declined' as valid values (migration 058's
// comment) but the code only ever wrote 'missed' — collapsing "the
// recipient declined," "nobody answered," and "the caller gave up first"
// into one indistinguishable string. p2p_incoming_calls.status already
// captures the real distinction (declined/missed/cancelled, written by
// incoming.tsx's settle() and the caller-side timeout/hangup paths) — this
// reuses that existing data instead of inventing a new column.
const UNANSWERED_LABEL: Record<string, string> = {
  declined: "Declined", missed: "No answer", cancelled: "Cancelled",
};

// POST /calls/end — closes out the call_log row and, if this call belonged
// to a DM conversation, posts a read-only call-information system message
// (see migration 059 for the message_type/call_log_id columns, and
// migration 102 for the idempotency guard). Caller identity is verified
// (like every other route in this file that touches a specific call) and
// the message's sender_id is the real initiator, not null — the mobile
// thread screen uses this to render the card on the correct side, the
// exact same way it decides direction for an ordinary message.
router.post("/calls/end", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);

  const { callLogId, incomingCallId, conversationId, callType, connected, durationSeconds, connectedAt } = req.body as {
    callLogId?: string; incomingCallId?: string; conversationId?: string | null; callType?: string;
    connected?: boolean; durationSeconds?: number; connectedAt?: string | null;
  };
  if (!callLogId) return err(res, "callLogId required");

  const { data: callLog } = await supabaseWrite
    .from("p2p_call_logs").select("initiated_by, participants, connected_at").eq("id", callLogId).maybeSingle();
  if (!callLog) return err(res, "Call not found", 404);
  const participants = (callLog.participants as string[]) ?? [];
  if (!participants.includes(requesterId)) return err(res, "Not authorized for this call", 403);

  const duration = Math.max(0, Math.round(durationSeconds ?? 0));

  // Only look this up for a call that never connected — a completed call's
  // incoming_calls row is already 'accepted' and tells us nothing new.
  let finalStatus = connected ? "ended" : "missed";
  if (!connected && incomingCallId) {
    const { data: incoming } = await supabaseWrite
      .from("p2p_incoming_calls").select("status").eq("id", incomingCallId).maybeSingle();
    if (incoming?.status === "declined" || incoming?.status === "cancelled") finalStatus = incoming.status;
  }

  // Forensic calling audit — this is the only place a call's real
  // onUserJoined moment (see app/call/audio.tsx's connectedAtRef) ever gets
  // persisted. Either party's device can report it (both reach /calls/end
  // independently, same as the call_summary message below), so this only
  // writes it once, taking whichever value arrives first.
  const updatePayload: Record<string, unknown> = { status: finalStatus, ended_at: new Date().toISOString(), duration_seconds: duration };
  if (connectedAt && !callLog.connected_at) updatePayload.connected_at = connectedAt;

  const { error: updateErr } = await supabaseWrite
    .from("p2p_call_logs")
    .update(updatePayload)
    .eq("id", callLogId);
  if (updateErr) return err(res, updateErr.message, 500);

  // A call that never connected (caller gave up, hung up, or the no-answer
  // timeout fired) leaves its p2p_incoming_calls "ringing" row stuck there
  // forever otherwise — only the recipient's own client can normally update
  // it (RLS: "Recipients update own incoming calls"), and if the recipient
  // never opened the ringing screen at all, nothing ever would. Guarded to
  // only touch a row still "ringing", so this can't clobber a real
  // accept/decline that landed in the same instant.
  if (incomingCallId && !connected) {
    await supabaseWrite
      .from("p2p_incoming_calls")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("id", incomingCallId)
      .eq("status", "ringing");
  }

  // Study Together C2 — a call ending invalidates every outstanding
  // invitation for it; p2p_accept_call_invitation would also catch this
  // lazily (it checks the call's status), but cancelling proactively means
  // an invitee's incoming-call screen doesn't sit ringing for a call that
  // no longer exists.
  await supabaseWrite
    .from("p2p_call_invitations")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("call_id", callLogId)
    .eq("status", "pending");

  if (conversationId) {
    // A call that grew past 2 participants via the invite flow is a group
    // call — the label should say so rather than "Audio/Video call" (the
    // "group" entry in CALL_TYPE_SUMMARY_LABEL already existed but was
    // never reachable before this fix).
    const isGroup = participants.length > 2;
    const label = isGroup ? CALL_TYPE_SUMMARY_LABEL.group : (CALL_TYPE_SUMMARY_LABEL[callType ?? ""] ?? "Call");
    const icon = callType === "video" ? "📹" : "📞";
    const body = connected
      ? `${icon} ${label} · ${formatDuration(duration)}`
      : `${icon} ${label} · ${UNANSWERED_LABEL[finalStatus] ?? "Missed call"}`;
    const { error: msgErr } = await supabaseWrite
      .from("p2p_messages")
      .insert({
        conversation_id: conversationId, sender_id: callLog.initiated_by, body,
        message_type: "call_summary", call_log_id: callLogId,
      });
    // A partial unique index on call_log_id (migration 102) makes this
    // insert idempotent: both parties' clients can independently reach
    // /calls/end for the same call (button press + the other side's
    // onUserOffline both fire handleEndCall, neither gated by isInitiator)
    // — the second insert hits 23505 and is treated as already-done, not
    // an error, instead of producing two identical bubbles.
    if (msgErr && (msgErr as { code?: string }).code !== "23505") return err(res, msgErr.message, 500);
  }

  return ok(res, { ended: true });
});

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// GET /calls/history/:userId — every 1:1/pastoral/crisis call this user was
// part of (participants jsonb contains them), most recent first. Group calls
// (Peer Circles) and Break Rooms aren't logged into p2p_call_logs — circles
// already show their own session history, and rooms are ephemeral community
// audio, not personal call history.
router.get("/calls/history/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data: logs, error } = await supabaseWrite
    .from("p2p_call_logs")
    .select("id, channel_name, call_type, status, duration_seconds, created_at, conversation_id, participants")
    // supabase-js's .contains() helper mis-serializes a plain array against a
    // jsonb column here (errors "invalid input syntax for type json") —
    // .filter with an explicitly JSON-stringified value is the form that
    // actually produces valid `participants @> '["id"]'` SQL.
    .filter("participants", "cs", JSON.stringify([userId]))
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return err(res, error.message, 500);

  const otherIds = new Set<string>();
  for (const row of logs ?? []) {
    for (const p of (row.participants as string[]) ?? []) {
      if (p !== userId) otherIds.add(p);
    }
  }
  const { data: profiles } = otherIds.size
    ? await supabaseWrite.from("p2p_profiles").select("id,full_name").in("id", Array.from(otherIds))
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return ok(res, (logs ?? []).map((row) => {
    const otherId = ((row.participants as string[]) ?? []).find((p) => p !== userId) ?? null;
    return {
      id: row.id,
      callType: row.call_type,
      status: row.status,
      durationSeconds: row.duration_seconds ?? 0,
      createdAt: row.created_at,
      conversationId: row.conversation_id ?? null,
      otherUserId: otherId,
      otherUserName: otherId ? (nameById.get(otherId) ?? "Someone") : null,
    };
  }));
});

// ── Scheduled session video integration ─────────────────────────────────────
// p2p_sessions (mentor/participant peer sessions) is a genuinely different
// table from DataContext's `sessions` array/sessions.ts route — see the
// comment in session/[id].tsx — so these query its real columns directly
// rather than going through that already-broken mapper.

// POST /calls/sessions/:sessionId/mark-in-progress — either participant calls
// this the moment the other side's Agora connection comes up (onUserJoined),
// idempotent so it's safe if both sides fire it.
router.post("/calls/sessions/:sessionId/mark-in-progress", async (req, res) => {
  const { sessionId } = req.params;
  const { data: session } = await supabaseWrite.from("p2p_sessions").select("status,started_at").eq("id", sessionId).maybeSingle();
  if (!session) return err(res, "Session not found", 404);
  if (session.status === "in_progress" || session.started_at) return ok(res, { alreadyStarted: true });

  const { error } = await supabaseWrite
    .from("p2p_sessions")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) return err(res, error.message, 500);
  return ok(res, { alreadyStarted: false });
});

// POST /calls/sessions/:sessionId/reflection — the post-call reflection note
// + optional 1-5 star rating.
router.post("/calls/sessions/:sessionId/reflection", async (req, res) => {
  const { sessionId } = req.params;
  const { note, rating } = req.body as { note?: string; rating?: number };
  if (rating !== undefined && (rating < 1 || rating > 5)) return err(res, "rating must be 1-5");

  const { error } = await supabaseWrite
    .from("p2p_sessions")
    .update({ reflection_note: note?.trim() || null, rating: rating ?? null })
    .eq("id", sessionId);
  if (error) return err(res, error.message, 500);
  return ok(res, { saved: true });
});

// GET /calls/study-progress?requesterId=&otherUserId=&lessonId= — Study
// Together's individual-progress display. p2p_lesson_progress RLS is
// self-only, so a participant's client can't read the other party's row
// directly; this exposes only {status, completed} for the one lesson both
// parties are already, mutually, studying together — never raw answers,
// notes, or evaluations.
//
// SECURITY: requesterId/otherUserId are caller-supplied query params, so
// the mutual-relationship precondition described above must be verified
// here, not assumed — see isEligibleStudyPartner. Without this check any
// authenticated caller could substitute an arbitrary otherUserId and read
// that stranger's real completion status for any lesson (confirmed live
// during the Study Together Group Expansion investigation).
router.get("/calls/study-progress", async (req, res) => {
  const { requesterId, otherUserId, lessonId } = req.query as {
    requesterId?: string; otherUserId?: string; lessonId?: string;
  };
  if (!requesterId || !otherUserId || !lessonId) {
    return err(res, "requesterId, otherUserId, and lessonId are required", 400);
  }
  const eligible = await isEligibleStudyPartner(supabaseWrite, requesterId, otherUserId);
  if (!eligible) {
    return err(res, "Not authorized to view this user's progress", 403);
  }
  const { data, error } = await supabaseWrite
    .from("p2p_lesson_progress")
    .select("user_id, status, completed")
    .eq("lesson_id", lessonId)
    .in("user_id", [requesterId, otherUserId]);
  if (error) return err(res, error.message, 500);

  const byUser = new Map((data ?? []).map((r) => [r.user_id as string, r]));
  const toProgress = (userId: string) => {
    const row = byUser.get(userId);
    return { status: (row?.status as string) ?? "not_started", completed: (row?.completed as boolean) ?? false };
  };
  return ok(res, { mine: toProgress(requesterId), theirs: toProgress(otherUserId) });
});

// GET /calls/:callId/study-progress?requesterId=&lessonId= — the group
// analog of the endpoint above, for Study Together C3. Deliberately a
// separate route (not an extra branch of the pairwise one above) so the
// already-fixed, already-tested 1:1 endpoint is never touched by this
// change. Authorization here is call-membership, not pairwise
// isEligibleStudyPartner: every participant in this specific active call
// already passed a real relationship check to get there (C2's invitation
// flow, gated by isEligibleStudyPartner), so being a recorded participant
// of THIS call is what grants access to the group's progress context — not
// ownership of any other participant's private submissions or answers,
// only the same {status, completed} summary the 1:1 endpoint exposes.
router.get("/calls/:callId/study-progress", async (req, res) => {
  const { requesterId, lessonId } = req.query as { requesterId?: string; lessonId?: string };
  const { callId } = req.params;
  if (!requesterId || !lessonId) return err(res, "requesterId and lessonId are required", 400);

  const { data: callLog } = await supabaseWrite.from("p2p_call_logs").select("participants").eq("id", callId).maybeSingle();
  if (!callLog) return err(res, "Call not found", 404);
  const participants = (callLog.participants as string[]) ?? [];
  if (!participants.includes(requesterId)) return err(res, "Not authorized to view this call's progress", 403);

  const { data, error } = await supabaseWrite
    .from("p2p_lesson_progress")
    .select("user_id, status, completed")
    .eq("lesson_id", lessonId)
    .in("user_id", participants);
  if (error) return err(res, error.message, 500);

  const byUser = new Map((data ?? []).map((r) => [r.user_id as string, r]));
  const result: Record<string, { status: string; completed: boolean }> = {};
  for (const uid of participants) {
    const row = byUser.get(uid);
    result[uid] = { status: (row?.status as string) ?? "not_started", completed: (row?.completed as boolean) ?? false };
  }
  return ok(res, { participants: result });
});

// ── Break Rooms ──────────────────────────────────────────────────────────────
// Spontaneous audio community rooms (migrations 058 + 061). One named preset
// per PLAN_CATEGORIES entry (see mobile/lib/planCategories.ts — duplicated
// here rather than shared, since api-server and mobile are separate packages
// with no shared-constants workspace) plus a handful of named presets and a
// fully custom option.
const NAMED_ROOM_PRESETS = [
  { key: "morning_prayer", label: "Morning Prayer", icon: "🙏", category: "prayer" },
  { key: "bible_qa", label: "Bible Q&A", icon: "📖", category: "identity_salvation" },
  { key: "kingdom_men", label: "Kingdom Men", icon: "🛡️", category: "ministry_leadership" },
  { key: "kingdom_women", label: "Kingdom Women", icon: "👑", category: "faith_kingdom" },
  { key: "new_believers", label: "New Believers Welcome", icon: "🌱", category: "spiritual_growth" },
];
const CATEGORY_ROOM_PRESETS = [
  { key: "faith_kingdom", label: "Faith & Kingdom Living", icon: "👑" },
  { key: "ministry_leadership", label: "Ministry & Leadership", icon: "🧭" },
  { key: "spiritual_growth", label: "Spiritual Growth", icon: "🌱" },
  { key: "family_relationships", label: "Family & Relationships", icon: "❤️" },
  { key: "identity_salvation", label: "Identity & Salvation", icon: "✝️" },
  { key: "marketplace_purpose", label: "Marketplace & Purpose", icon: "💼" },
  { key: "prayer", label: "Prayer", icon: "🙏" },
  { key: "holy_spirit", label: "Holy Spirit", icon: "🕊️" },
  { key: "healing_freedom", label: "Healing & Freedom", icon: "🩹" },
  { key: "church_community", label: "Church & Community", icon: "⛪" },
];
const ROOM_PRESETS = [
  ...NAMED_ROOM_PRESETS.map((p) => ({ ...p, roomType: "topic" as const })),
  ...CATEGORY_ROOM_PRESETS.map((c) => ({ key: `category_${c.key}`, label: c.label, icon: c.icon, roomType: "topic" as const, category: c.key })),
  { key: "custom", label: "Custom Room", icon: "✨", roomType: "open" as const, category: null as string | null },
];

function mapRoom(row: Record<string, unknown>, hostName: string) {
  return {
    id: row.id, name: row.name, description: row.description ?? null,
    roomType: row.room_type, category: row.category ?? null, languageCode: row.language_code ?? null,
    hostId: row.host_id, hostName, channelName: row.channel_name,
    maxParticipants: row.max_participants, currentParticipants: row.current_participants,
    isLive: row.is_live, speakingMode: row.speaking_mode, currentSpeakerId: row.current_speaker_id ?? null,
    createdAt: row.created_at,
  };
}

router.get("/calls/rooms/presets", (_req, res) => ok(res, ROOM_PRESETS));

// GET /calls/rooms — live rooms, most-populated first (Discover's LIVE NOW).
router.get("/calls/rooms", async (_req, res) => {
  const { data: rooms, error } = await supabaseWrite
    .from("p2p_break_rooms")
    .select("*")
    .eq("is_live", true)
    .order("current_participants", { ascending: false });
  if (error) return err(res, error.message, 500);

  const hostIds = Array.from(new Set((rooms ?? []).map((r) => r.host_id as string)));
  const { data: profiles } = hostIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id,full_name").in("id", hostIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return ok(res, (rooms ?? []).map((r) => mapRoom(r as Record<string, unknown>, nameById.get(r.host_id as string) ?? "Host")));
});

// GET /calls/rooms/:roomId — full detail + active roster, for room.tsx.
router.get("/calls/rooms/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return err(res, "Room not found", 404);

  const { data: participants } = await supabaseWrite
    .from("p2p_break_room_participants")
    .select("user_id, joined_at")
    .eq("room_id", roomId)
    .is("left_at", null);

  const userIds = (participants ?? []).map((p) => p.user_id as string);
  const { data: profiles } = userIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id,full_name,country").in("id", userIds)
    : { data: [] as { id: string; full_name: string; country: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return ok(res, {
    ...mapRoom(room as Record<string, unknown>, profileById.get(room.host_id as string)?.full_name ?? "Host"),
    participants: (participants ?? []).map((p) => ({
      userId: p.user_id,
      name: profileById.get(p.user_id as string)?.full_name ?? "Someone",
      country: profileById.get(p.user_id as string)?.country ?? null,
      joinedAt: p.joined_at,
    })),
  });
});

// POST /calls/rooms — create + auto-join the host, then fires (non-blocking)
// interest-matched notifications to users who've studied this category.
router.post("/calls/rooms", async (req, res) => {
  const { hostId, name, description, roomType, category, languageCode, speakingMode } = req.body as {
    hostId?: string; name?: string; description?: string; roomType?: string;
    category?: string | null; languageCode?: string | null; speakingMode?: string;
  };
  if (!hostId || !name) return err(res, "hostId and name required");

  const roomId = crypto.randomUUID();
  const channelName = `room_${roomId}`;
  const { data: room, error } = await supabaseWrite
    .from("p2p_break_rooms")
    .insert({
      id: roomId, name: name.trim(), description: description?.trim() || null,
      room_type: roomType || "open", category: category || null, language_code: languageCode || null,
      host_id: hostId, channel_name: channelName,
      speaking_mode: speakingMode === "structured" ? "structured" : "open",
      current_participants: 1,
    })
    .select("*")
    .single();
  if (error || !room) return err(res, error?.message ?? "Failed to create room", 500);

  await supabaseWrite.from("p2p_break_room_participants").insert({ room_id: roomId, user_id: hostId });

  const { data: hostProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", hostId).maybeSingle();
  void notifyInterestedUsers({ id: roomId, name: room.name as string, category: room.category as string | null, channelName });

  return ok(res, mapRoom(room as Record<string, unknown>, (hostProfile?.full_name as string) ?? "Host"));
});

// POST /calls/rooms/:roomId/join — respects the max-participants cap and any
// active 24h removal block before letting a user (re)join.
router.post("/calls/rooms/:roomId/join", async (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) return err(res, "userId required");

  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room || !room.is_live) return err(res, "Room is not live", 404);

  const { data: block } = await supabaseWrite
    .from("p2p_break_room_blocks").select("blocked_until").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
  if (block && new Date(block.blocked_until as string) > new Date()) {
    return err(res, "You've been removed from this room", 403);
  }
  if ((room.current_participants as number) >= (room.max_participants as number)) {
    return err(res, "Room is full", 409);
  }

  await supabaseWrite.from("p2p_break_room_participants").upsert(
    { room_id: roomId, user_id: userId, joined_at: new Date().toISOString(), left_at: null },
    { onConflict: "room_id,user_id" }
  );
  await supabaseWrite.from("p2p_break_rooms").update({ current_participants: (room.current_participants as number) + 1 }).eq("id", roomId);

  return ok(res, {
    channelName: room.channel_name, speakingMode: room.speaking_mode,
    currentSpeakerId: room.current_speaker_id ?? null, hostId: room.host_id,
  });
});

// POST /calls/rooms/:roomId/leave — auto-ends the room only if the host was
// the one leaving and no one else is left; a lone abandoned room (host gone,
// others still in it) is instead caught by the 5-minute sweep in breakRooms.ts.
router.post("/calls/rooms/:roomId/leave", async (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) return err(res, "userId required");

  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return err(res, "Room not found", 404);

  await supabaseWrite
    .from("p2p_break_room_participants").update({ left_at: new Date().toISOString() })
    .eq("room_id", roomId).eq("user_id", userId).is("left_at", null);
  const nextCount = Math.max(0, (room.current_participants as number) - 1);
  await supabaseWrite.from("p2p_break_rooms").update({ current_participants: nextCount }).eq("id", roomId);

  if (userId === room.host_id && nextCount <= 0) {
    await supabaseWrite.from("p2p_break_rooms").update({ is_live: false, ended_at: new Date().toISOString() }).eq("id", roomId);
  }

  return ok(res, { left: true });
});

// DELETE /calls/rooms/:roomId — host-only manual end.
router.delete("/calls/rooms/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { hostId } = req.body as { hostId?: string };
  if (!hostId) return err(res, "hostId required");

  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("host_id").eq("id", roomId).maybeSingle();
  if (!room) return err(res, "Room not found", 404);
  if (room.host_id !== hostId) return err(res, "Only the host can end this room", 403);

  await supabaseWrite.from("p2p_break_rooms").update({ is_live: false, ended_at: new Date().toISOString() }).eq("id", roomId);
  return ok(res, { ended: true });
});

// POST /calls/rooms/:roomId/flag — anonymous to other participants (only the
// service-role write path ever sees flagger_id); 3 flags auto-ends the room
// and notifies moderator/admin-role profiles.
router.post("/calls/rooms/:roomId/flag", async (req, res) => {
  const { roomId } = req.params;
  const { flaggerId, reason } = req.body as { flaggerId?: string; reason?: string };
  if (!flaggerId || !reason) return err(res, "flaggerId and reason required");

  await supabaseWrite.from("p2p_break_room_flags").insert({ room_id: roomId, flagger_id: flaggerId, reason });
  const { count } = await supabaseWrite
    .from("p2p_break_room_flags").select("id", { count: "exact", head: true }).eq("room_id", roomId);

  if ((count ?? 0) >= 3) {
    const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("name").eq("id", roomId).maybeSingle();
    await supabaseWrite.from("p2p_break_rooms").update({ is_live: false, ended_at: new Date().toISOString() }).eq("id", roomId);
    await notifyModerators(roomId, (room?.name as string) ?? "A Break Room", count ?? 0);
    return ok(res, { flagged: true, roomEnded: true });
  }
  return ok(res, { flagged: true, roomEnded: false });
});

// POST /calls/rooms/:roomId/remove — host removes a participant and blocks
// them from rejoining this specific room for 24h.
router.post("/calls/rooms/:roomId/remove", async (req, res) => {
  const { roomId } = req.params;
  const { hostId, userId } = req.body as { hostId?: string; userId?: string };
  if (!hostId || !userId) return err(res, "hostId and userId required");

  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return err(res, "Room not found", 404);
  if (room.host_id !== hostId) return err(res, "Only the host can remove participants", 403);

  const blockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabaseWrite
    .from("p2p_break_room_blocks")
    .upsert({ room_id: roomId, user_id: userId, blocked_until: blockedUntil }, { onConflict: "room_id,user_id" });
  await supabaseWrite
    .from("p2p_break_room_participants").update({ left_at: new Date().toISOString() })
    .eq("room_id", roomId).eq("user_id", userId).is("left_at", null);
  const nextCount = Math.max(0, (room.current_participants as number) - 1);
  await supabaseWrite.from("p2p_break_rooms").update({ current_participants: nextCount }).eq("id", roomId);

  return ok(res, { removed: true });
});

// POST /calls/rooms/:roomId/set-speaker — host grants/revokes the floor in a
// structured room; room.tsx watches current_speaker_id over realtime and
// unmutes/mutes locally based on it (Agora RTC has no cross-client mute).
router.post("/calls/rooms/:roomId/set-speaker", async (req, res) => {
  const { roomId } = req.params;
  const { hostId, speakerId } = req.body as { hostId?: string; speakerId?: string | null };
  if (!hostId) return err(res, "hostId required");

  const { data: room } = await supabaseWrite.from("p2p_break_rooms").select("host_id").eq("id", roomId).maybeSingle();
  if (!room) return err(res, "Room not found", 404);
  if (room.host_id !== hostId) return err(res, "Only the host can set the speaker", 403);

  await supabaseWrite.from("p2p_break_rooms").update({ current_speaker_id: speakerId || null }).eq("id", roomId);
  return ok(res, { currentSpeakerId: speakerId || null });
});

export default router;