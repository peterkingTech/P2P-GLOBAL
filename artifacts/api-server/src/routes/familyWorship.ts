import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const VALID_MODES = ["worship", "scripture", "prayer", "sharing", "silent_prayer", "thanksgiving"] as const;
const VALID_PROVIDERS = ["youtube"] as const;

function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id, familyId: row.family_id, hostId: row.host_id, status: row.status, currentMode: row.current_mode,
    mediaProvider: row.media_provider ?? null,
    mediaType: row.media_type ?? null, mediaId: row.media_id ?? null, mediaUrl: row.media_url ?? null,
    playbackBasePositionMs: Number(row.playback_base_position_ms ?? 0),
    playbackBaseServerTime: row.playback_base_server_time, playbackRate: Number(row.playback_rate ?? 1),
    isPlaying: row.is_playing ?? false, currentScripture: row.current_scripture ?? null,
    channelName: row.channel_name, startedAt: row.started_at, endedAt: row.ended_at,
  };
}

async function isActiveFamilyMember(familyId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_family_members").select("id").eq("family_id", familyId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return !!data;
}

async function getSessionAndCheckMembership(sessionId: string, userId: string) {
  const { data: session } = await db.from("p2p_family_worship_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) return { session: null, isMember: false };
  const isMember = await isActiveFamilyMember(session.family_id as string, userId);
  return { session, isMember };
}

// POST /family/worship/start — { familyId } — any active family member can
// lead worship (the Shepherd is the default/typical host per product spec,
// but isn't hard-required here — a Co-Shepherd or adult starting it when
// the Shepherd is away is a reasonable real-world case). If the family
// already has a live session, that one is returned instead of erroring.
router.post("/worship/start", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.body as { familyId?: string };
  if (!familyId) return err(res, "familyId is required");
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this family", 403);

  const { data: existing } = await db.from("p2p_family_worship_sessions").select("*").eq("family_id", familyId).neq("status", "ended").maybeSingle();
  if (existing) return ok(res, mapSession(existing as Record<string, unknown>));

  const sessionId = crypto.randomUUID();
  const { data: session, error } = await db
    .from("p2p_family_worship_sessions")
    .insert({
      id: sessionId, family_id: familyId, host_id: userId, status: "active", current_mode: "worship",
      channel_name: `family_worship_${sessionId}`, started_at: new Date().toISOString(),
      playback_base_server_time: new Date().toISOString(),
    })
    .select().single();
  if (error || !session) return err(res, error?.message ?? "Failed to start worship", 500);

  await db.from("p2p_family_worship_participants").insert({ session_id: sessionId, user_id: userId, presence_status: "joined" });

  const { data: hostProfile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  const { data: members } = await db.from("p2p_family_members").select("user_id").eq("family_id", familyId).eq("status", "active").neq("user_id", userId);
  if (members?.length) {
    await db.from("p2p_notifications").insert(
      members.map((m) => ({
        user_id: m.user_id, title: "🕊️ Family Worship",
        message: `${(hostProfile?.full_name as string) ?? "Someone"} started Family Worship.`,
        notification_type: "family_worship_invite",
        data: { sessionId, familyId, hostName: (hostProfile?.full_name as string) ?? "Someone" },
      }))
    );
  }

  return ok(res, mapSession(session as Record<string, unknown>));
});

// GET /family/worship/sessions/:sessionId — current state, for late-join /
// reconnect sync: the client derives playback position from
// playback_base_position_ms + (now - playback_base_server_time) * rate.
router.get("/worship/sessions/:sessionId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session, isMember } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!isMember) return err(res, "You're not a member of this family", 403);

  const { data: participants } = await db
    .from("p2p_family_worship_participants").select("user_id,joined_at,camera_on,mic_on,presence_status").eq("session_id", session.id).is("left_at", null);
  return ok(res, { ...mapSession(session as Record<string, unknown>), participants: participants ?? [] });
});

// POST /family/worship/sessions/:sessionId/join
router.post("/worship/sessions/:sessionId/join", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session, isMember } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!isMember) return err(res, "You're not a member of this family", 403);
  if (session.status === "ended") return err(res, "This worship session has ended", 410);

  await db.from("p2p_family_worship_participants").upsert(
    { session_id: session.id, user_id: userId, joined_at: new Date().toISOString(), left_at: null, presence_status: "joined" },
    { onConflict: "session_id,user_id" }
  );
  return ok(res, mapSession(session as Record<string, unknown>));
});

// POST /family/worship/sessions/:sessionId/leave — a participant leaving
// does not end the session (spec: don't collapse the gathering when one
// person drops, host included). The session only auto-ends once genuinely
// no one is left.
router.post("/worship/sessions/:sessionId/leave", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);

  await db.from("p2p_family_worship_participants").update({ left_at: new Date().toISOString() })
    .eq("session_id", session.id).eq("user_id", userId).is("left_at", null);

  const { count } = await db.from("p2p_family_worship_participants").select("id", { count: "exact", head: true }).eq("session_id", session.id).is("left_at", null);
  if ((count ?? 0) <= 0 && session.status !== "ended") {
    await endSessionInternal(session as Record<string, unknown>);
  }
  return ok(res, { left: true });
});

// PUT /family/worship/sessions/:sessionId/state — host-only. Handles
// PLAY/PAUSE/SEEK/MEDIA_CHANGED/MODE_CHANGED as one state write; the
// mobile client broadcasts the specific event name on its private realtime
// channel after this succeeds, this endpoint just owns the source-of-truth
// row (and re-anchors the server playback clock whenever position/play
// state actually changes, per the sync formula).
router.put("/worship/sessions/:sessionId/state", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (session.host_id !== userId) return err(res, "Only the current Worship Host can control this session", 403);

  const body = req.body as {
    status?: string; currentMode?: string; mediaProvider?: "youtube" | null;
    mediaType?: "video" | "audio" | null; mediaId?: string | null; mediaUrl?: string | null;
    isPlaying?: boolean; positionMs?: number; playbackRate?: number; currentScripture?: Record<string, unknown> | null;
  };

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (body.currentMode) {
    if (!VALID_MODES.includes(body.currentMode as (typeof VALID_MODES)[number])) return err(res, `currentMode must be one of: ${VALID_MODES.join(", ")}`);
    update.current_mode = body.currentMode;
    const visited = new Set([...(session.modes_visited as string[] ?? []), body.currentMode]);
    update.modes_visited = Array.from(visited);
  }
  if (body.mediaProvider !== undefined) {
    if (body.mediaProvider !== null && !VALID_PROVIDERS.includes(body.mediaProvider)) return err(res, `mediaProvider must be one of: ${VALID_PROVIDERS.join(", ")}`);
    update.media_provider = body.mediaProvider;
  }
  if (body.mediaType !== undefined) update.media_type = body.mediaType;
  if (body.mediaId !== undefined) update.media_id = body.mediaId;
  if (body.mediaUrl !== undefined) update.media_url = body.mediaUrl;
  if (body.currentScripture !== undefined) update.current_scripture = body.currentScripture;
  if (body.playbackRate !== undefined) update.playback_rate = body.playbackRate;

  // Any play/pause/seek/media-change re-anchors the server clock: position
  // and "now" move together, so every client recomputes from the same
  // fixed point rather than drifting relative to when they last polled.
  if (body.isPlaying !== undefined || body.positionMs !== undefined || body.mediaType !== undefined || body.mediaProvider !== undefined) {
    update.is_playing = body.isPlaying ?? session.is_playing;
    update.playback_base_position_ms = body.positionMs ?? session.playback_base_position_ms;
    update.playback_base_server_time = new Date().toISOString();
  }

  const { data: updated, error } = await db.from("p2p_family_worship_sessions").update(update).eq("id", session.id).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update session", 500);
  return ok(res, mapSession(updated as Record<string, unknown>));
});

// POST /family/worship/sessions/:sessionId/transfer-host — { newHostId } —
// only the current host or the family Shepherd may transfer, and only to
// someone actually present, so control can never land on an unauthorized
// or absent participant.
router.post("/worship/sessions/:sessionId/transfer-host", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  const { newHostId } = req.body as { newHostId?: string };
  if (!newHostId) return err(res, "newHostId is required");

  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", session.family_id as string).maybeSingle();
  if (session.host_id !== userId && family?.shepherd_id !== userId) {
    return err(res, "Only the current Worship Host or the Family Shepherd can transfer hosting", 403);
  }
  const { data: presentParticipant } = await db
    .from("p2p_family_worship_participants").select("id").eq("session_id", session.id).eq("user_id", newHostId).is("left_at", null).maybeSingle();
  if (!presentParticipant) return err(res, "That person isn't currently in the session", 400);

  await db.from("p2p_family_worship_sessions").update({ host_id: newHostId }).eq("id", session.id);
  return ok(res, { hostId: newHostId });
});

async function endSessionInternal(session: Record<string, unknown>) {
  const endedAt = new Date();
  const startedAt = session.started_at ? new Date(session.started_at as string) : endedAt;
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  await db.from("p2p_family_worship_sessions").update({ status: "ended", ended_at: endedAt.toISOString() }).eq("id", session.id as string);

  const { count: participantCount } = await db
    .from("p2p_family_worship_participants").select("id", { count: "exact", head: true }).eq("session_id", session.id as string);

  const { data: history } = await db.from("p2p_family_worship_history").insert({
    family_id: session.family_id, session_id: session.id, duration_seconds: durationSeconds,
    modes_visited: session.modes_visited ?? [], participant_count: participantCount ?? 0,
    scripture_reference: (session.current_scripture as Record<string, unknown> | null)?.reference ?? null,
  }).select().single();

  // The explicit, minimal "clean integration point" for a future family
  // tree — deliberately not touching the existing per-user tree_growth_score
  // system, and deliberately not surfacing any numeric "points" to the user.
  await db.from("p2p_family_journey_events").insert({
    family_id: session.family_id, event_type: "worship_session_completed", source_id: history?.id ?? null,
  });
}

// POST /family/worship/sessions/:sessionId/end — host or Family Shepherd only.
router.post("/worship/sessions/:sessionId/end", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (session.status === "ended") return ok(res, { ended: true });

  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", session.family_id as string).maybeSingle();
  if (session.host_id !== userId && family?.shepherd_id !== userId) {
    return err(res, "Only the current Worship Host or the Family Shepherd can end worship", 403);
  }

  await endSessionInternal(session as Record<string, unknown>);
  return ok(res, { ended: true });
});

// GET /family/worship/history?familyId=... — lightweight, summary-only history.
router.get("/worship/history", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.query as { familyId?: string };
  if (!familyId) return err(res, "familyId is required");
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this family", 403);

  const { data, error } = await db.from("p2p_family_worship_history").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50);
  if (error) return err(res, error.message, 500);
  return ok(res, data ?? []);
});

export default router;