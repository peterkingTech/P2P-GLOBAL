import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { RtcTokenBuilder, RtcRole } from "agora-token";

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

function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}
function ok(res: import("express").Response, data: unknown) {
  return res.json(data);
}

// POST /calls/token — mint an Agora RTC token for a channel + numeric uid.
// No requireAuth middleware exists in this codebase (see discipleship.ts,
// circles.ts) — every route here trusts the caller-supplied identity the
// same way the rest of the API does.
router.post("/calls/token", async (req, res) => {
  try {
    const { channelName, uid } = req.body as { channelName?: string; uid?: number };
    if (!channelName || uid === undefined || uid === null) {
      return err(res, "channelName and uid required");
    }
    if (!APP_ID || !APP_CERTIFICATE) {
      return err(res, "Agora not configured on server", 500);
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
  } catch {
    return err(res, "Failed to generate token", 500);
  }
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
// are meant to be server-owned, not client-owned with a spoofable actor id.
router.post("/calls/start", async (req, res) => {
  const { channelName, callType, callerId, recipientId, conversationId } = req.body as {
    channelName?: string; callType?: string; callerId?: string; recipientId?: string; conversationId?: string;
  };
  if (!channelName || !callType || !callerId || !recipientId) {
    return err(res, "channelName, callType, callerId, recipientId required");
  }

  const { data: callLog, error: logErr } = await supabaseWrite
    .from("p2p_call_logs")
    .insert({
      channel_name: channelName, call_type: callType, initiated_by: callerId,
      participants: [callerId, recipientId], status: "initiated",
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
  if (incomingErr || !incomingCall) return err(res, incomingErr?.message ?? "Failed to create incoming call", 500);

  return ok(res, { callLogId: callLog.id as string, incomingCallId: incomingCall.id as string });
});

const CALL_TYPE_SUMMARY_LABEL: Record<string, string> = {
  audio: "Audio call", video: "Video call", pastoral: "Pastoral check-in", crisis: "Crisis call", group: "Group call",
};

// POST /calls/end — closes out the call_log row and, if this call belonged
// to a DM conversation, posts the read-only "📞 Audio call · 4m 32s" system
// message (sender_id = null; see migration 059 and the same RLS reasoning
// as /calls/start).
router.post("/calls/end", async (req, res) => {
  const { callLogId, conversationId, callType, connected, durationSeconds } = req.body as {
    callLogId?: string; conversationId?: string | null; callType?: string; connected?: boolean; durationSeconds?: number;
  };
  if (!callLogId) return err(res, "callLogId required");

  const duration = Math.max(0, Math.round(durationSeconds ?? 0));
  const { error: updateErr } = await supabaseWrite
    .from("p2p_call_logs")
    .update({ status: connected ? "ended" : "missed", ended_at: new Date().toISOString(), duration_seconds: duration })
    .eq("id", callLogId);
  if (updateErr) return err(res, updateErr.message, 500);

  if (conversationId) {
    const label = CALL_TYPE_SUMMARY_LABEL[callType ?? ""] ?? "Call";
    const icon = callType === "video" ? "📹" : "📞";
    const body = connected ? `${icon} ${label} · ${formatDuration(duration)}` : `📞 Missed call · ${label}`;
    const { error: msgErr } = await supabaseWrite
      .from("p2p_messages")
      .insert({ conversation_id: conversationId, sender_id: null, body, message_type: "call_summary", call_log_id: callLogId });
    if (msgErr) return err(res, msgErr.message, 500);
  }

  return ok(res, { ended: true });
});

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default router;