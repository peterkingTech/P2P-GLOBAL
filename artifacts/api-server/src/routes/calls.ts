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

export default router;