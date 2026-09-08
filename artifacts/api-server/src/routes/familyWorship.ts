import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const VALID_MODES = ["worship", "scripture", "prayer", "sharing", "silent_prayer", "teaching"] as const;
const VALID_PROVIDERS = ["youtube"] as const;
const VALID_MEDIA_PERMISSIONS = ["guide_only", "trusted", "everyone"] as const;
const VALID_PRESENCE_STATUSES = ["joined", "listening", "praying", "away"] as const;

function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id, familyId: row.family_id, hostId: row.host_id, status: row.status, currentMode: row.current_mode,
    mediaProvider: row.media_provider ?? null,
    mediaType: row.media_type ?? null, mediaId: row.media_id ?? null, mediaUrl: row.media_url ?? null,
    playbackBasePositionMs: Number(row.playback_base_position_ms ?? 0),
    playbackBaseServerTime: row.playback_base_server_time, playbackRate: Number(row.playback_rate ?? 1),
    isPlaying: row.is_playing ?? false, currentScripture: row.current_scripture ?? null,
    channelName: row.channel_name, startedAt: row.started_at, endedAt: row.ended_at,
    mediaPermission: row.media_permission ?? "guide_only",
    trustedUserIds: row.trusted_user_ids ?? [],
    autoAdvance: row.auto_advance ?? false,
    currentFocusPrayerRequestId: row.current_focus_prayer_request_id ?? null,
    prayerTimerDurationSeconds: row.prayer_timer_duration_seconds ?? null,
    prayerTimerStartedAt: row.prayer_timer_started_at ?? null,
  };
}

// Media Permissions — the server-side authority behind "Guide Only /
// Guide + trusted participants / Everyone". Called on every mutating
// media action (state PUT, queue add/remove/reorder/next) so a client
// can never escalate itself by just not showing a disabled button — this
// is re-checked here regardless of what the client sent or displayed.
function canControlMedia(session: Record<string, unknown>, userId: string): boolean {
  if (session.host_id === userId) return true;
  const permission = (session.media_permission as string) ?? "guide_only";
  if (permission === "everyone") return true; // caller is already confirmed an active participant by every call site
  if (permission === "trusted") return ((session.trusted_user_ids as string[]) ?? []).includes(userId);
  return false;
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
        user_id: m.user_id, title: "📺 Family Media",
        message: `${(hostProfile?.full_name as string) ?? "Someone"} started Family Media.`,
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

// PUT /family/worship/sessions/:sessionId/presence — { presenceStatus } —
// self-only, backed by migration 116's existing "Users manage their own
// participation row" policy (auth.uid() = user_id). Prayer participation
// ("I'm praying") is just this: no new signal, the 'praying' value the
// enum already reserved. Broadcasting it for instant delivery to other
// clients is the caller's job (same persist+broadcast pattern as chat).
router.put("/worship/sessions/:sessionId/presence", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { presenceStatus } = req.body as { presenceStatus?: string };
  if (!presenceStatus || !VALID_PRESENCE_STATUSES.includes(presenceStatus as (typeof VALID_PRESENCE_STATUSES)[number])) {
    return err(res, `presenceStatus must be one of: ${VALID_PRESENCE_STATUSES.join(", ")}`);
  }
  const { error } = await db.from("p2p_family_worship_participants")
    .update({ presence_status: presenceStatus }).eq("session_id", req.params.sessionId).eq("user_id", userId).is("left_at", null);
  if (error) return err(res, error.message, 500);
  return ok(res, { presenceStatus });
});

// PUT /family/worship/sessions/:sessionId/state — gated by Media
// Permissions (canControlMedia), not just the host. currentMode (switching
// to Scripture/Prayer/etc.) stays Guide-only regardless of the media
// permission tier — that's a room-flow decision, not a "who can touch
// what's playing" one. Handles PLAY/PAUSE/SEEK/MEDIA_CHANGED/MODE_CHANGED
// as one state write; the mobile client broadcasts the specific event
// name on its private realtime channel after this succeeds, this endpoint
// just owns the source-of-truth row (and re-anchors the server playback
// clock whenever position/play state actually changes, per the sync
// formula).
router.put("/worship/sessions/:sessionId/state", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session, isMember } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!isMember) return err(res, "You're not a member of this family", 403);
  const bodyHasModeChange = req.body?.currentMode !== undefined;
  if (bodyHasModeChange && session.host_id !== userId) {
    return err(res, "Only the current Guide can change the Gathering's mode", 403);
  }
  // Scripture selection/navigation is Guide-only, same as mode changes —
  // checked independently of currentMode (a Guide already in Scripture
  // mode navigating to the next passage sends currentScripture without
  // currentMode, which must not fall through to the Media Permissions
  // tier below; Scripture was never part of that tier's grant).
  const bodyHasScriptureChange = req.body?.currentScripture !== undefined;
  if (bodyHasScriptureChange && session.host_id !== userId) {
    return err(res, "Only the current Guide can select Scripture", 403);
  }
  // Prayer Space: focusing a request and starting/stopping the shared
  // timer are Guide-only room-flow decisions, same category as mode and
  // Scripture changes — not gated by Media Permissions.
  const bodyHasPrayerFocusChange = req.body?.focusPrayerRequestId !== undefined;
  const bodyHasPrayerTimerChange = req.body?.prayerTimerDurationSeconds !== undefined;
  if ((bodyHasPrayerFocusChange || bodyHasPrayerTimerChange) && session.host_id !== userId) {
    return err(res, "Only the current Guide can control Prayer Space", 403);
  }
  const bodyHasMediaChange =
    req.body?.mediaProvider !== undefined || req.body?.mediaType !== undefined || req.body?.mediaId !== undefined ||
    req.body?.mediaUrl !== undefined || req.body?.isPlaying !== undefined || req.body?.positionMs !== undefined ||
    req.body?.playbackRate !== undefined;
  if (bodyHasMediaChange && !canControlMedia(session as Record<string, unknown>, userId)) {
    return err(res, "You don't have permission to control Shared Media right now", 403);
  }

  const body = req.body as {
    status?: string; currentMode?: string; mediaProvider?: "youtube" | null;
    mediaType?: "video" | "audio" | null; mediaId?: string | null; mediaUrl?: string | null;
    isPlaying?: boolean; positionMs?: number; playbackRate?: number;
    currentScripture?: { translation?: string; translationName?: string; book?: string; chapter?: number; startVerse?: number; endVerse?: number } | null;
    focusPrayerRequestId?: string | null;
    prayerTimerDurationSeconds?: number | null;
  };

  if (body.currentScripture !== undefined && body.currentScripture !== null) {
    const s = body.currentScripture;
    if (!s.book || !s.chapter || !s.translation) return err(res, "currentScripture requires book, chapter, and translation");
  }

  // A focused prayer request must belong to this family and must not be
  // 'private' — the Guide focusing a request can never surface someone
  // else's private prayer to the whole Gathering, even by mistake.
  if (bodyHasPrayerFocusChange && body.focusPrayerRequestId) {
    const { data: request } = await db
      .from("p2p_family_prayer_requests").select("family_id,visibility").eq("id", body.focusPrayerRequestId).maybeSingle();
    if (!request || request.family_id !== session.family_id) return err(res, "That prayer request wasn't found", 404);
    if (request.visibility !== "family") return err(res, "Only a shared prayer request can be focused", 400);
  }
  if (bodyHasPrayerTimerChange && body.prayerTimerDurationSeconds !== null) {
    if (!Number.isFinite(body.prayerTimerDurationSeconds) || (body.prayerTimerDurationSeconds as number) <= 0) {
      return err(res, "prayerTimerDurationSeconds must be a positive number of seconds");
    }
  }

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
  if (bodyHasPrayerFocusChange) update.current_focus_prayer_request_id = body.focusPrayerRequestId;
  // Setting a duration (re)starts the timer, anchored to now — same
  // "recompute from a fixed point" idea as the media playback clock.
  // Sending null explicitly stops/clears it.
  if (bodyHasPrayerTimerChange) {
    update.prayer_timer_duration_seconds = body.prayerTimerDurationSeconds;
    update.prayer_timer_started_at = body.prayerTimerDurationSeconds === null ? null : new Date().toISOString();
  }

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

// PUT /family/worship/sessions/:sessionId/media-permission — { mediaPermission, autoAdvance? }
// Guide-only — changing WHO can control media is itself a media-control-
// adjacent decision, restricted to the Guide (not "trusted" participants,
// who could otherwise grant themselves everyone-level access).
router.put("/worship/sessions/:sessionId/media-permission", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (session.host_id !== userId) return err(res, "Only the current Guide can change Media Permissions", 403);

  const { mediaPermission, autoAdvance } = req.body as { mediaPermission?: string; autoAdvance?: boolean };
  const update: Record<string, unknown> = {};
  if (mediaPermission !== undefined) {
    if (!VALID_MEDIA_PERMISSIONS.includes(mediaPermission as (typeof VALID_MEDIA_PERMISSIONS)[number])) {
      return err(res, `mediaPermission must be one of: ${VALID_MEDIA_PERMISSIONS.join(", ")}`);
    }
    update.media_permission = mediaPermission;
  }
  if (autoAdvance !== undefined) update.auto_advance = autoAdvance;
  if (Object.keys(update).length === 0) return err(res, "Nothing to update");

  const { data: updated, error } = await db.from("p2p_family_worship_sessions").update(update).eq("id", session.id).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update", 500);
  return ok(res, mapSession(updated as Record<string, unknown>));
});

// POST /family/worship/sessions/:sessionId/trusted — { userId, trusted } —
// Guide-only. Adds/removes one user from the trusted list; only meaningful
// when mediaPermission is "trusted", but stored independently so toggling
// the tier back and forth doesn't lose who was trusted.
router.post("/worship/sessions/:sessionId/trusted", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, callerId);
  if (!session) return err(res, "Session not found", 404);
  if (session.host_id !== callerId) return err(res, "Only the current Guide can manage trusted Companions", 403);

  const { userId: targetUserId, trusted } = req.body as { userId?: string; trusted?: boolean };
  if (!targetUserId || trusted === undefined) return err(res, "userId and trusted are required");

  const current = (session.trusted_user_ids as string[]) ?? [];
  const next = trusted ? Array.from(new Set([...current, targetUserId])) : current.filter((id) => id !== targetUserId);

  const { data: updated, error } = await db.from("p2p_family_worship_sessions").update({ trusted_user_ids: next }).eq("id", session.id).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update", 500);
  return ok(res, mapSession(updated as Record<string, unknown>));
});

function mapQueueItem(row: Record<string, unknown>, addedByName: string) {
  return {
    id: row.id, sessionId: row.session_id, mediaProvider: row.media_provider, mediaId: row.media_id,
    title: row.title ?? null, thumbnailUrl: row.thumbnail_url ?? null,
    addedBy: row.added_by, addedByName, position: row.position, createdAt: row.created_at,
  };
}

async function mapQueueItems(rows: Record<string, unknown>[]) {
  const userIds = Array.from(new Set(rows.map((r) => r.added_by as string)));
  const { data: profiles } = userIds.length
    ? await db.from("p2p_profiles").select("id,full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  return rows.map((r) => mapQueueItem(r, nameById.get(r.added_by as string) ?? "Someone"));
}

// GET /family/worship/sessions/:sessionId/queue — Media Shelf, any active participant can view.
router.get("/worship/sessions/:sessionId/queue", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { sessionId } = req.params;
  if (!(await isActiveParticipant(sessionId, userId))) return err(res, "You're not currently in this session", 403);

  const { data, error } = await db.from("p2p_family_worship_queue").select("*").eq("session_id", sessionId).order("position", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, await mapQueueItems((data ?? []) as Record<string, unknown>[]));
});

// POST /family/worship/sessions/:sessionId/queue — { mediaProvider, mediaId, title?, thumbnailUrl? }
router.post("/worship/sessions/:sessionId/queue", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!canControlMedia(session as Record<string, unknown>, userId)) return err(res, "You don't have permission to add to the Media Shelf", 403);

  const { mediaProvider, mediaId, title, thumbnailUrl } = req.body as { mediaProvider?: string; mediaId?: string; title?: string; thumbnailUrl?: string };
  if (!mediaProvider || !VALID_PROVIDERS.includes(mediaProvider as (typeof VALID_PROVIDERS)[number])) return err(res, `mediaProvider must be one of: ${VALID_PROVIDERS.join(", ")}`);
  if (!mediaId) return err(res, "mediaId is required");

  const { data: last } = await db.from("p2p_family_worship_queue").select("position").eq("session_id", session.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const nextPosition = ((last?.position as number) ?? -1) + 1;

  const { data: item, error } = await db.from("p2p_family_worship_queue").insert({
    session_id: session.id, media_provider: mediaProvider, media_id: mediaId,
    title: title ?? null, thumbnail_url: thumbnailUrl ?? null, added_by: userId, position: nextPosition,
  }).select().single();
  if (error || !item) return err(res, error?.message ?? "Failed to add to queue", 500);

  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapQueueItem(item as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// DELETE /family/worship/sessions/:sessionId/queue/:itemId — media-control
// permission OR the person who originally added it (suggesting something
// and then changing your mind shouldn't require Guide/trusted status).
router.delete("/worship/sessions/:sessionId/queue/:itemId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);

  const { data: item } = await db.from("p2p_family_worship_queue").select("added_by").eq("id", req.params.itemId).eq("session_id", session.id).maybeSingle();
  if (!item) return err(res, "Queue item not found", 404);
  if (item.added_by !== userId && !canControlMedia(session as Record<string, unknown>, userId)) {
    return err(res, "You don't have permission to remove this item", 403);
  }

  const { error } = await db.from("p2p_family_worship_queue").delete().eq("id", req.params.itemId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// PUT /family/worship/sessions/:sessionId/queue/reorder — { orderedItemIds: string[] }
router.put("/worship/sessions/:sessionId/queue/reorder", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!canControlMedia(session as Record<string, unknown>, userId)) return err(res, "You don't have permission to reorder the Media Shelf", 403);

  const { orderedItemIds } = req.body as { orderedItemIds?: string[] };
  if (!Array.isArray(orderedItemIds) || orderedItemIds.length === 0) return err(res, "orderedItemIds is required");

  for (let i = 0; i < orderedItemIds.length; i++) {
    await db.from("p2p_family_worship_queue").update({ position: i }).eq("id", orderedItemIds[i]).eq("session_id", session.id);
  }
  const { data, error } = await db.from("p2p_family_worship_queue").select("*").eq("session_id", session.id).order("position", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, await mapQueueItems((data ?? []) as Record<string, unknown>[]));
});

// POST /family/worship/sessions/:sessionId/queue/next — pulls the front of
// the Media Shelf and makes it the current Shared Media (same re-anchor
// logic as PUT .../state's MEDIA_CHANGED path), then removes it from the
// queue. Used both for an explicit "Play Next" tap and for automatic
// advance (client-triggered only by the Guide's own client when a video
// ends and auto_advance is on — this endpoint itself doesn't care who
// triggers it beyond the normal media-control permission check, so a
// trusted/everyone-tier Companion could also legitimately advance).
router.post("/worship/sessions/:sessionId/queue/next", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  if (!canControlMedia(session as Record<string, unknown>, userId)) return err(res, "You don't have permission to control Shared Media right now", 403);

  const { data: next } = await db.from("p2p_family_worship_queue").select("*").eq("session_id", session.id).order("position", { ascending: true }).limit(1).maybeSingle();
  if (!next) return err(res, "The Media Shelf is empty", 404);

  const { data: updatedSession, error } = await db.from("p2p_family_worship_sessions").update({
    media_provider: next.media_provider, media_id: next.media_id, media_type: null, media_url: null,
    is_playing: true, playback_base_position_ms: 0, playback_base_server_time: new Date().toISOString(),
  }).eq("id", session.id).select().single();
  if (error || !updatedSession) return err(res, error?.message ?? "Failed to advance", 500);

  await db.from("p2p_family_worship_queue").delete().eq("id", next.id);
  return ok(res, mapSession(updatedSession as Record<string, unknown>));
});

async function endSessionInternal(session: Record<string, unknown>) {
  const endedAt = new Date();
  const startedAt = session.started_at ? new Date(session.started_at as string) : endedAt;
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  await db.from("p2p_family_worship_sessions").update({ status: "ended", ended_at: endedAt.toISOString() }).eq("id", session.id as string);

  const { count: participantCount } = await db
    .from("p2p_family_worship_participants").select("id", { count: "exact", head: true }).eq("session_id", session.id as string);

  // Counts only, never content — "do not record sensitive information
  // unnecessarily". Prayer requests aren't session-scoped (they're a
  // standing family list), so this counts what was shared during this
  // Gathering's time window rather than joining through a foreign key.
  const { count: prayerRequestCount } = startedAt
    ? await db.from("p2p_family_prayer_requests").select("id", { count: "exact", head: true })
        .eq("family_id", session.family_id as string).gte("created_at", startedAt.toISOString()).lte("created_at", endedAt.toISOString())
    : { count: 0 };
  const { count: notesCount } = await db.from("p2p_family_worship_notes").select("id", { count: "exact", head: true }).eq("session_id", session.id as string);

  const { data: history } = await db.from("p2p_family_worship_history").insert({
    family_id: session.family_id, session_id: session.id, duration_seconds: durationSeconds,
    modes_visited: session.modes_visited ?? [], participant_count: participantCount ?? 0,
    scripture_reference: (session.current_scripture as Record<string, unknown> | null)?.reference ?? null,
    media_provider: session.media_provider ?? null, media_id: session.media_id ?? null,
    prayer_request_count: prayerRequestCount ?? 0, notes_count: notesCount ?? 0,
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

async function isActiveParticipant(sessionId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("p2p_family_worship_participants").select("id").eq("session_id", sessionId).eq("user_id", userId).is("left_at", null).maybeSingle();
  return !!data;
}

function mapMessage(row: Record<string, unknown>, authorName: string) {
  return { id: row.id, sessionId: row.session_id, userId: row.user_id, authorName, content: row.content, context: row.context ?? null, createdAt: row.created_at };
}

// GET /family/worship/sessions/:sessionId/messages — Together chat history
// for this Gathering. Active-participant-only, same boundary as everything
// else in this session (mirrors realtime.messages' RLS in migration 122,
// so a removed participant is blocked here AND on the broadcast channel).
router.get("/worship/sessions/:sessionId/messages", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { sessionId } = req.params;
  if (!(await isActiveParticipant(sessionId, userId))) return err(res, "You're not currently in this session", 403);

  const { data: messages, error } = await db
    .from("p2p_family_worship_messages").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }).limit(200);
  if (error) return err(res, error.message, 500);

  const userIds = Array.from(new Set((messages ?? []).map((m) => m.user_id as string)));
  const { data: profiles } = userIds.length
    ? await db.from("p2p_profiles").select("id,full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return ok(res, (messages ?? []).map((m) => mapMessage(m as Record<string, unknown>, nameById.get(m.user_id as string) ?? "Someone")));
});

// P2P Together Phase 7 — Conversation's "Scripture references / media
// references / questions" is exactly the context column migration 122
// reserved for this. Light validation only (a known type tag) — the
// payload shape itself is intentionally not deep-validated field-by-field,
// same "don't over-engineer" restraint as the rest of this phase.
const VALID_MESSAGE_CONTEXT_TYPES = ["scripture", "media", "question"] as const;

// POST /family/worship/sessions/:sessionId/messages — { content, context? }.
// Identity always from verifyCaller, never a client-supplied userId — the
// RLS in migration 122 enforces the same rule again independently at the
// DB layer.
router.post("/worship/sessions/:sessionId/messages", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { sessionId } = req.params;
  const { content, context } = req.body as { content?: string; context?: { type?: string } | null };
  if (!content?.trim()) return err(res, "content is required");
  if (content.length > 2000) return err(res, "Message is too long");
  if (context && !VALID_MESSAGE_CONTEXT_TYPES.includes(context.type as (typeof VALID_MESSAGE_CONTEXT_TYPES)[number])) {
    return err(res, `context.type must be one of: ${VALID_MESSAGE_CONTEXT_TYPES.join(", ")}`);
  }
  if (!(await isActiveParticipant(sessionId, userId))) return err(res, "You're not currently in this session", 403);

  const { data: message, error } = await db
    .from("p2p_family_worship_messages").insert({ session_id: sessionId, user_id: userId, content: content.trim(), context: context ?? null }).select().single();
  if (error || !message) return err(res, error?.message ?? "Failed to send message", 500);

  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapMessage(message as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// ── Shared / Private / Scripture-linked Notes ───────────────────────────────────
// Deliberately minimal CRUD — "prepare architecture... do not
// over-engineer". Same active-participant boundary as messages/queue.
const VALID_NOTE_VISIBILITY = ["shared", "private"] as const;

function mapNote(row: Record<string, unknown>, authorName: string) {
  return {
    id: row.id, sessionId: row.session_id, authorId: row.author_id, authorName,
    visibility: row.visibility, content: row.content, scriptureReference: row.scripture_reference ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// GET /family/worship/sessions/:sessionId/notes — shared notes plus the
// caller's own private ones (same "or" query shape as prayer-requests, so
// a private note from someone else can never leak even if a future caller
// forgets the visibility filter).
router.get("/worship/sessions/:sessionId/notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { sessionId } = req.params;
  if (!(await isActiveParticipant(sessionId, userId))) return err(res, "You're not currently in this session", 403);

  const { data: notes, error } = await db
    .from("p2p_family_worship_notes").select("*").eq("session_id", sessionId)
    .or(`visibility.eq.shared,author_id.eq.${userId}`)
    .order("created_at", { ascending: true });
  if (error) return err(res, error.message, 500);

  const userIds = Array.from(new Set((notes ?? []).map((n) => n.author_id as string)));
  const { data: profiles } = userIds.length
    ? await db.from("p2p_profiles").select("id,full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  return ok(res, (notes ?? []).map((n) => mapNote(n as Record<string, unknown>, nameById.get(n.author_id as string) ?? "Someone")));
});

// POST /family/worship/sessions/:sessionId/notes — { content, visibility?, scriptureReference? }
router.post("/worship/sessions/:sessionId/notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { sessionId } = req.params;
  const { content, visibility, scriptureReference } = req.body as {
    content?: string; visibility?: string;
    scriptureReference?: { translation?: string; book?: string; chapter?: number; startVerse?: number; endVerse?: number } | null;
  };
  if (!content?.trim()) return err(res, "content is required");
  if (visibility !== undefined && !VALID_NOTE_VISIBILITY.includes(visibility as (typeof VALID_NOTE_VISIBILITY)[number])) {
    return err(res, `visibility must be one of: ${VALID_NOTE_VISIBILITY.join(", ")}`);
  }
  if (scriptureReference && (!scriptureReference.book || !scriptureReference.chapter || !scriptureReference.translation)) {
    return err(res, "scriptureReference requires book, chapter, and translation");
  }
  if (!(await isActiveParticipant(sessionId, userId))) return err(res, "You're not currently in this session", 403);

  const { data: note, error } = await db.from("p2p_family_worship_notes").insert({
    session_id: sessionId, author_id: userId, content: content.trim(),
    visibility: visibility ?? "shared", scripture_reference: scriptureReference ?? null,
  }).select().single();
  if (error || !note) return err(res, error?.message ?? "Failed to save note", 500);

  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapNote(note as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// PUT /family/worship/sessions/:sessionId/notes/:noteId — author-only.
router.put("/worship/sessions/:sessionId/notes/:noteId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { content, visibility } = req.body as { content?: string; visibility?: string };
  const { data: existing } = await db.from("p2p_family_worship_notes").select("author_id").eq("id", req.params.noteId).eq("session_id", req.params.sessionId).maybeSingle();
  if (!existing) return err(res, "Note not found", 404);
  if (existing.author_id !== userId) return err(res, "Only the author can edit this note", 403);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (content !== undefined) {
    if (!content.trim()) return err(res, "content cannot be empty");
    update.content = content.trim();
  }
  if (visibility !== undefined) {
    if (!VALID_NOTE_VISIBILITY.includes(visibility as (typeof VALID_NOTE_VISIBILITY)[number])) return err(res, `visibility must be one of: ${VALID_NOTE_VISIBILITY.join(", ")}`);
    update.visibility = visibility;
  }

  const { data: note, error } = await db.from("p2p_family_worship_notes").update(update).eq("id", req.params.noteId).select().single();
  if (error || !note) return err(res, error?.message ?? "Failed to update note", 500);
  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapNote(note as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// DELETE /family/worship/sessions/:sessionId/notes/:noteId — author-only.
router.delete("/worship/sessions/:sessionId/notes/:noteId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_family_worship_notes").select("author_id").eq("id", req.params.noteId).eq("session_id", req.params.sessionId).maybeSingle();
  if (!existing) return err(res, "Note not found", 404);
  if (existing.author_id !== userId) return err(res, "Only the author can delete this note", 403);

  const { error } = await db.from("p2p_family_worship_notes").delete().eq("id", req.params.noteId);
  if (error) return err(res, error.message, 500);
  return ok(res, { deleted: true });
});

// POST /family/worship/sessions/:sessionId/remove — { userId } — Guide or
// Family Shepherd only (same authorization as /end). Marks the target's
// participant row left, which is what actually enforces the removal: RLS
// on both p2p_family_worship_messages and the signal broadcast channel
// (migration 121/122) require an active (left_at is null) participant row,
// so a removed participant is blocked from Expressions/Hand Up/Chat
// immediately, not just cosmetically signaled.
router.post("/worship/sessions/:sessionId/remove", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { session } = await getSessionAndCheckMembership(req.params.sessionId, userId);
  if (!session) return err(res, "Session not found", 404);
  const { userId: targetUserId } = req.body as { userId?: string };
  if (!targetUserId) return err(res, "userId is required");
  if (targetUserId === session.host_id) return err(res, "The current Guide can't remove themselves this way", 400);

  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", session.family_id as string).maybeSingle();
  if (session.host_id !== userId && family?.shepherd_id !== userId) {
    return err(res, "Only the Guide or the Family Shepherd can remove a participant", 403);
  }

  await db.from("p2p_family_worship_participants").update({ left_at: new Date().toISOString() })
    .eq("session_id", session.id).eq("user_id", targetUserId).is("left_at", null);
  return ok(res, { removed: true });
});

export default router;