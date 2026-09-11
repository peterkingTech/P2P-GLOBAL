import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { logger } from "../lib/logger";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const VALID_MODES = ["worship", "scripture", "prayer", "sharing", "silent_prayer", "teaching"] as const;
const VALID_PROVIDERS = ["youtube"] as const;
const VALID_MEDIA_PERMISSIONS = ["guide_only", "trusted", "everyone"] as const;
const VALID_PRESENCE_STATUSES = ["joined", "listening", "praying", "away"] as const;

// Server-side mirror of the mobile client's lib/familyApi.ts
// formatScriptureReference() — WorshipScripture is {translation,
// translationName?, book, chapter, startVerse, endVerse}, never a
// pre-formatted `.reference` string. The pre-existing endSessionInternal
// read a non-existent `.reference` field (always null in production);
// this is the actual fix, reused everywhere a human-readable reference
// is needed server-side.
function scriptureReferenceLabel(s: Record<string, unknown> | null | undefined): string | null {
  if (!s || !s.book || !s.chapter || s.startVerse === undefined) return null;
  const verses = s.startVerse === s.endVerse ? `${s.startVerse}` : `${s.startVerse}-${s.endVerse}`;
  return `${s.book} ${s.chapter}:${verses}`;
}

// Resolves a lesson id to the lesson/module/curriculum titles the Study
// section and Continue Study need for display — a read-only lookup against
// the existing curriculum tables (p2p_lessons/p2p_modules/p2p_curriculums),
// never a duplicate of them. Returns { data: null } (not an error) when the
// lesson has since been unpublished/removed, so a Gathering's history
// display degrades to "no lesson" rather than breaking.
async function resolveLessonContext(lessonId: string) {
  const { data: lessonRow } = await db.from("p2p_lessons").select("id,title,module_id,order_index,status").eq("id", lessonId).maybeSingle();
  if (!lessonRow || lessonRow.status !== "published") return { data: null };
  const { data: moduleRow } = await db.from("p2p_modules").select("id,title,curriculum_id,order_index").eq("id", lessonRow.module_id as string).maybeSingle();
  if (!moduleRow) return { data: null };
  const { data: curriculumRow } = await db.from("p2p_curriculums").select("id,title").eq("id", moduleRow.curriculum_id as string).maybeSingle();
  return {
    data: {
      lessonId: lessonRow.id, lessonTitle: lessonRow.title, lessonOrderIndex: lessonRow.order_index,
      moduleId: moduleRow.id, moduleTitle: moduleRow.title, moduleOrderIndex: moduleRow.order_index,
      curriculumId: curriculumRow?.id ?? null, curriculumTitle: curriculumRow?.title ?? null,
    },
  };
}

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
    lessonId: row.lesson_id ?? null,
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

// Session Summary's timeline/Scripture-list/media-list source — one row per
// real, already-authorized state transition (never per-tick; every call
// site below is a write the handler had to check Guide/host authorization
// for anyway, so this just logs what that same write already decided).
async function logSessionEvent(sessionId: string, familyId: string, eventType: string, eventData?: Record<string, unknown>) {
  const { error } = await db.from("p2p_family_worship_session_events")
    .insert({ session_id: sessionId, family_id: familyId, event_type: eventType, event_data: eventData ?? null });
  if (error) {
    logger.error({ sessionId, eventType, err: error }, "Failed to log worship session event");
  }
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
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this Family Gathering", 403);

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
  await logSessionEvent(sessionId, familyId, "started");

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
  if (!isMember) return err(res, "You're not a member of this Family Gathering", 403);

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
  if (!isMember) return err(res, "You're not a member of this Family Gathering", 403);
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
  if (!isMember) return err(res, "You're not a member of this Family Gathering", 403);
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
  // Prayer: focusing a request is a Guide-only room-flow decision, same
  // category as mode and Scripture changes — not gated by Media Permissions.
  const bodyHasPrayerFocusChange = req.body?.focusPrayerRequestId !== undefined;
  if (bodyHasPrayerFocusChange && session.host_id !== userId) {
    return err(res, "Only the current Guide can control Prayer", 403);
  }
  // Attaching a Study Workspace lesson is a Guide-only continuity decision,
  // same category as mode/Scripture/Prayer-focus — never gated by Media
  // Permissions. This only links to the existing curriculum's lesson id;
  // it never writes p2p_lesson_progress or implies completion.
  const bodyHasLessonChange = req.body?.lessonId !== undefined;
  if (bodyHasLessonChange && session.host_id !== userId) {
    return err(res, "Only the current Guide can attach a lesson", 403);
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
    lessonId?: string | null;
  };

  if (body.currentScripture !== undefined && body.currentScripture !== null) {
    const s = body.currentScripture;
    if (!s.book || !s.chapter || !s.translation) return err(res, "currentScripture requires book, chapter, and translation");
  }

  // A lesson attached to a Gathering must be a real, published lesson —
  // resolved here (not just FK-validated) so the friendly title can be
  // logged in the session timeline without a second round trip.
  let attachedLessonTitle: string | null = null;
  if (bodyHasLessonChange && body.lessonId) {
    const { data: lesson } = await db.from("p2p_lessons").select("id,title,status").eq("id", body.lessonId).maybeSingle();
    if (!lesson || lesson.status !== "published") return err(res, "That lesson wasn't found", 404);
    attachedLessonTitle = lesson.title as string;
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
  if (bodyHasLessonChange) update.lesson_id = body.lessonId;

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

  // Session Summary timeline/Scripture-list/media-list source (see
  // logSessionEvent) — logged only for the actual transitions this
  // request just made, using the same authorization this handler already
  // enforced above (mode/Scripture changes are Guide-only; media honors
  // canControlMedia) rather than re-deriving anything.
  if (body.currentMode) await logSessionEvent(session.id as string, session.family_id as string, "mode_changed", { mode: body.currentMode });
  if (body.currentScripture) await logSessionEvent(session.id as string, session.family_id as string, "scripture_changed", { reference: scriptureReferenceLabel(body.currentScripture as Record<string, unknown>) });
  if (body.mediaId && (body.mediaProvider !== undefined || body.mediaId !== session.media_id)) {
    await logSessionEvent(session.id as string, session.family_id as string, "media_played", { provider: body.mediaProvider ?? session.media_provider, id: body.mediaId });
  }
  if (bodyHasLessonChange && body.lessonId) {
    await logSessionEvent(session.id as string, session.family_id as string, "lesson_attached", { lessonId: body.lessonId, lessonTitle: attachedLessonTitle });
  }

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

  const { data: history, error: historyError } = await db.from("p2p_family_worship_history").insert({
    family_id: session.family_id, session_id: session.id, duration_seconds: durationSeconds,
    modes_visited: session.modes_visited ?? [], participant_count: participantCount ?? 0,
    // Fixed: current_scripture never had a `.reference` field (it's
    // {book,chapter,startVerse,endVerse,translation}) — the old code read
    // a property that never existed, so this was always null before.
    scripture_reference: scriptureReferenceLabel(session.current_scripture as Record<string, unknown> | null),
    media_provider: session.media_provider ?? null, media_id: session.media_id ?? null,
    prayer_request_count: prayerRequestCount ?? 0, notes_count: notesCount ?? 0,
    guide_id: session.host_id ?? null, started_at: session.started_at ?? null, ended_at: endedAt.toISOString(),
    lesson_id: session.lesson_id ?? null,
  }).select().single();
  if (historyError) {
    logger.error({ sessionId: session.id, err: historyError }, "Failed to write worship history/summary row on session end");
  }

  // The explicit, minimal "clean integration point" for a future family
  // tree — deliberately not touching the existing per-user tree_growth_score
  // system, and deliberately not surfacing any numeric "points" to the user.
  await db.from("p2p_family_journey_events").insert({
    family_id: session.family_id, event_type: "worship_session_completed", source_id: history?.id ?? null,
  });
  await logSessionEvent(session.id as string, session.family_id as string, "ended");
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
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this Family Gathering", 403);

  const { data, error } = await db.from("p2p_family_worship_history").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50);
  if (error) return err(res, error.message, 500);
  const rows = data ?? [];

  // One batched title lookup for the whole list (never per-row) — the
  // history list itself never duplicates lesson data, only its title.
  const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string | null).filter((id): id is string => !!id)));
  const titleByLessonId = new Map<string, string>();
  if (lessonIds.length) {
    const { data: lessonRows } = await db.from("p2p_lessons").select("id,title").in("id", lessonIds);
    for (const l of lessonRows ?? []) titleByLessonId.set(l.id as string, l.title as string);
  }

  return ok(res, rows.map((r) => ({ ...r, lesson_title: r.lesson_id ? titleByLessonId.get(r.lesson_id as string) ?? null : null })));
});

// GET /family/worship/history/:historyId — the full Session Summary. Family
// membership is the authorization boundary (matching p2p_family_worship_
// history's own RLS) — deliberately NOT "were you a participant of this
// specific past session", so any family member can see the Gathering's
// summary/aggregates even if they personally missed it, the same way
// GET /worship/history already works. Raw message/note CONTENT is never
// returned here — only counts and, for notes/prayer, the existing
// visibility rules (shared vs private) already enforced by those tables'
// own RLS are respected by construction: this route never selects content
// columns from p2p_family_worship_notes or p2p_family_worship_messages,
// only ids (for distinct-author counting) and, for messages, nothing
// private exists to leak in the first place.
router.get("/worship/history/:historyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: history } = await db.from("p2p_family_worship_history").select("*").eq("id", req.params.historyId).maybeSingle();
  if (!history) return err(res, "Session summary not found", 404);
  if (!(await isActiveFamilyMember(history.family_id as string, userId))) return err(res, "You're not a member of this Family Gathering", 403);

  const sessionId = history.session_id as string;
  const startedAt = history.started_at as string | null;
  const endedAt = history.ended_at as string | null;

  const [
    { data: guideProfile },
    { data: participantRows },
    { data: events },
    { data: messages },
    { data: notes },
    { data: prayerRequests },
    { data: lesson },
  ] = await Promise.all([
    history.guide_id ? db.from("p2p_profiles").select("id,full_name,photo_url").eq("id", history.guide_id as string).maybeSingle() : Promise.resolve({ data: null }),
    db.from("p2p_family_worship_participants").select("user_id,joined_at").eq("session_id", sessionId),
    db.from("p2p_family_worship_session_events").select("event_type,event_data,created_at").eq("session_id", sessionId).order("created_at", { ascending: true }),
    db.from("p2p_family_worship_messages").select("user_id").eq("session_id", sessionId),
    db.from("p2p_family_worship_notes").select("author_id").eq("session_id", sessionId),
    // Family-visible only ("respect existing visibility... never expose
    // private content" — Stage 2 spec) — id+content are needed here (not
    // just for counting) so an explicitly-answered prayer's own text can
    // be shown, exactly like the family Prayer screen already shows it.
    startedAt && endedAt
      ? db.from("p2p_family_prayer_requests").select("id,user_id,visibility,status,scripture_reference,content")
          .eq("family_id", history.family_id as string).eq("visibility", "family").gte("created_at", startedAt).lte("created_at", endedAt)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    history.lesson_id ? resolveLessonContext(history.lesson_id as string) : Promise.resolve({ data: null }),
  ]);

  const participantIds = (participantRows ?? []).map((p) => p.user_id as string);
  const { data: participantProfiles } = participantIds.length
    ? await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", participantIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null }[] };
  const profileById = new Map((participantProfiles ?? []).map((p) => [p.id as string, p]));

  const scriptureReferences = Array.from(new Set(
    (events ?? []).filter((e) => e.event_type === "scripture_changed" && (e.event_data as Record<string, unknown> | null)?.reference)
      .map((e) => (e.event_data as Record<string, unknown>).reference as string)
  ));
  const mediaSeen = new Set<string>();
  const mediaItems: { provider: string; id: string }[] = [];
  for (const e of events ?? []) {
    if (e.event_type !== "media_played") continue;
    const d = e.event_data as Record<string, unknown> | null;
    if (!d?.id) continue;
    const key = `${d.provider}:${d.id}`;
    if (mediaSeen.has(key)) continue;
    mediaSeen.add(key);
    mediaItems.push({ provider: d.provider as string, id: d.id as string });
  }

  const messageAuthors = new Set((messages ?? []).map((m) => m.user_id as string));
  const noteAuthors = new Set((notes ?? []).map((n) => n.author_id as string));
  const prayerAuthors = new Set((prayerRequests ?? []).map((p) => p.user_id as string));
  const contributors = new Set([...messageAuthors, ...noteAuthors, ...prayerAuthors]);

  return ok(res, {
    id: history.id, familyId: history.family_id, sessionId,
    durationSeconds: history.duration_seconds, startedAt, endedAt,
    modesVisited: history.modes_visited ?? [],
    guide: history.guide_id ? { id: history.guide_id, name: (guideProfile?.full_name as string) ?? "Someone", photoUrl: guideProfile?.photo_url ?? null } : null,
    guideSummary: history.guide_summary ?? null,
    continuityNotes: history.continuity_notes ?? null,
    study: lesson,
    participants: participantIds.map((id) => ({ userId: id, name: profileById.get(id)?.full_name ?? "Family member", photoUrl: profileById.get(id)?.photo_url ?? null })),
    participation: { participantCount: history.participant_count, contributorCount: contributors.size },
    scripture: { references: scriptureReferences },
    media: { items: mediaItems },
    prayer: {
      requestCount: prayerRequests?.length ?? 0, contributorCount: prayerAuthors.size,
      scriptureLinkedCount: (prayerRequests ?? []).filter((p) => p.scripture_reference).length,
      answeredCount: (prayerRequests ?? []).filter((p) => p.status === "answered").length,
      // Only the request's own explicit "answered" status is shown, never
      // inferred — "Do not infer that a prayer was answered" (Stage 2 spec).
      answeredPrayers: (prayerRequests ?? [])
        .filter((p) => p.status === "answered")
        .map((p) => ({ id: p.id, content: p.content })),
    },
    share: { messageCount: messages?.length ?? 0, contributorCount: messageAuthors.size },
    notes: { authorCount: noteAuthors.size },
    timeline: (events ?? []).map((e) => ({ type: e.event_type, data: e.event_data, at: e.created_at })),
  });
});

// PUT /family/worship/history/:historyId/guide-summary — the one manually-
// written, optional field this feature adds. Editable by whoever led this
// specific Gathering (guide_id) or the family's current Shepherd — the
// same two roles already authorized to end a Gathering (POST .../end),
// not a new permission tier.
router.put("/worship/history/:historyId/guide-summary", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: history } = await db.from("p2p_family_worship_history").select("family_id,guide_id").eq("id", req.params.historyId).maybeSingle();
  if (!history) return err(res, "Session summary not found", 404);
  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", history.family_id as string).maybeSingle();
  if (history.guide_id !== userId && family?.shepherd_id !== userId) {
    return err(res, "Only the Guide who led this Gathering or the Family Shepherd can write its summary", 403);
  }
  const { summary } = req.body as { summary?: string };
  if (summary !== undefined && summary !== null && summary.length > 2000) return err(res, "Summary is too long (2000 characters max)");

  const { error } = await db.from("p2p_family_worship_history")
    .update({ guide_summary: summary?.trim() || null, updated_at: new Date().toISOString() }).eq("id", req.params.historyId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// PUT /family/worship/history/:historyId/continuity-notes — the Guide's
// optional "next time we should..." note (Stage 2 §13). Deliberately the
// same authorization as guide-summary above (guide_id or family Shepherd)
// and the same manual-text-only shape — no AI, no task/project system.
router.put("/worship/history/:historyId/continuity-notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: history } = await db.from("p2p_family_worship_history").select("family_id,guide_id").eq("id", req.params.historyId).maybeSingle();
  if (!history) return err(res, "Session summary not found", 404);
  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", history.family_id as string).maybeSingle();
  if (history.guide_id !== userId && family?.shepherd_id !== userId) {
    return err(res, "Only the Guide who led this Gathering or the Family Shepherd can write its continuity notes", 403);
  }
  const { notes } = req.body as { notes?: string };
  if (notes !== undefined && notes !== null && notes.length > 2000) return err(res, "Notes are too long (2000 characters max)");

  const { error } = await db.from("p2p_family_worship_history")
    .update({ continuity_notes: notes?.trim() || null, updated_at: new Date().toISOString() }).eq("id", req.params.historyId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// GET /family/worship/continue-study?familyId=... — Stage 2's "Previous
// Gathering" + "Continue Study" + "Discipleship Journey" data in one call
// (one family-scoped read, not recomputed per-field — see §23 performance).
// Deliberately does NOT touch p2p_lesson_progress: "next lesson" here is
// pure curriculum sequence (module.order_index, lesson.order_index) after
// whichever lesson the family's last Gathering was actually about — never
// gated on any individual's personal completion, and never assumes an
// unrelated Gathering (no lesson_id) continues anything (§15).
router.get("/worship/continue-study", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.query as { familyId?: string };
  if (!familyId) return err(res, "familyId is required");
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this Family Gathering", 403);

  const { data: lastHistory } = await db.from("p2p_family_worship_history").select("*")
    .eq("family_id", familyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastHistory) return ok(res, { previousGathering: null, continueStudy: null, discipleshipJourney: null });

  const { data: scriptureEvents } = await db.from("p2p_family_worship_session_events")
    .select("event_data").eq("session_id", lastHistory.session_id as string).eq("event_type", "scripture_changed");
  const scriptureReferences = Array.from(new Set(
    (scriptureEvents ?? []).map((e) => (e.event_data as Record<string, unknown> | null)?.reference as string | undefined).filter(Boolean)
  ));

  const previousGathering = {
    historyId: lastHistory.id, createdAt: lastHistory.created_at, durationSeconds: lastHistory.duration_seconds,
    participantCount: lastHistory.participant_count, scriptureReferences,
    guideSummary: lastHistory.guide_summary ?? null, continuityNotes: lastHistory.continuity_notes ?? null,
    lessonTitle: null as string | null, moduleTitle: null as string | null, curriculumTitle: null as string | null,
  };

  let continueStudy: Record<string, unknown> | null = null;
  let discipleshipJourney: Record<string, unknown> | null = null;

  if (lastHistory.lesson_id) {
    const { data: lessonCtx } = await resolveLessonContext(lastHistory.lesson_id as string);
    if (lessonCtx) {
      previousGathering.lessonTitle = lessonCtx.lessonTitle as string;
      previousGathering.moduleTitle = lessonCtx.moduleTitle as string;
      previousGathering.curriculumTitle = lessonCtx.curriculumTitle as string | null;

      // Next lesson: first try the next published lesson within the same
      // module; if this was the module's last lesson, try the first
      // published lesson of the next module in the same curriculum.
      const { data: nextInModule } = await db.from("p2p_lessons").select("id,title")
        .eq("module_id", lessonCtx.moduleId as string).eq("status", "published")
        .gt("order_index", lessonCtx.lessonOrderIndex as number).order("order_index", { ascending: true }).limit(1).maybeSingle();

      let nextLesson: { id: string; title: string } | null = nextInModule ? { id: nextInModule.id as string, title: nextInModule.title as string } : null;
      let nextModuleTitle: string | null = lessonCtx.moduleTitle as string;

      if (!nextLesson && lessonCtx.curriculumId) {
        const { data: nextModule } = await db.from("p2p_modules").select("id,title")
          .eq("curriculum_id", lessonCtx.curriculumId as string)
          .gt("order_index", lessonCtx.moduleOrderIndex as number).order("order_index", { ascending: true }).limit(1).maybeSingle();
        if (nextModule) {
          const { data: firstLesson } = await db.from("p2p_lessons").select("id,title")
            .eq("module_id", nextModule.id as string).eq("status", "published").order("order_index", { ascending: true }).limit(1).maybeSingle();
          if (firstLesson) {
            nextLesson = { id: firstLesson.id as string, title: firstLesson.title as string };
            nextModuleTitle = nextModule.title as string;
          }
        }
      }

      continueStudy = nextLesson ? {
        curriculumTitle: lessonCtx.curriculumTitle,
        previousLessonId: lessonCtx.lessonId, previousLessonTitle: lessonCtx.lessonTitle,
        nextLessonId: nextLesson.id, nextLessonTitle: nextLesson.title, nextModuleTitle,
      } : null;

      // Discipleship Journey — every published lesson of the SAME
      // curriculum, in order, each marked purely by "did a family Gathering
      // ever cover this lesson" (never by personal p2p_lesson_progress) so
      // this stays a family-memory view, not a duplicate progress system.
      if (lessonCtx.curriculumId) {
        const { data: allModules } = await db.from("p2p_modules").select("id,order_index")
          .eq("curriculum_id", lessonCtx.curriculumId as string).order("order_index", { ascending: true });
        const moduleIds = (allModules ?? []).map((m) => m.id as string);
        const allLessons = moduleIds.length
          ? await (async () => {
              const { data } = await db.from("p2p_lessons").select("id,title,module_id,order_index").in("module_id", moduleIds).eq("status", "published");
              return data ?? [];
            })()
          : [];
        const moduleOrderById = new Map((allModules ?? []).map((m) => [m.id as string, m.order_index as number]));
        allLessons.sort((a, b) => {
          const mo = (moduleOrderById.get(a.module_id as string) ?? 0) - (moduleOrderById.get(b.module_id as string) ?? 0);
          return mo !== 0 ? mo : (a.order_index as number) - (b.order_index as number);
        });

        const { data: coveredRows } = await db.from("p2p_family_worship_history").select("lesson_id").eq("family_id", familyId).not("lesson_id", "is", null);
        const coveredIds = new Set((coveredRows ?? []).map((r) => r.lesson_id as string));
        const nextId = continueStudy?.nextLessonId as string | undefined;

        discipleshipJourney = {
          curriculumTitle: lessonCtx.curriculumTitle,
          lessons: allLessons.map((l) => ({
            id: l.id, title: l.title,
            status: coveredIds.has(l.id as string) ? "done" : l.id === nextId ? "current" : "upcoming",
          })),
        };
      }
    }
  }

  return ok(res, { previousGathering, continueStudy, discipleshipJourney });
});

// GET /family/worship/journey?familyId=... — Stage 2's family-memory
// aggregate (Scripture Journey / Prayer Journey / Media Journey / totals).
// All-time totals computed from existing p2p_family_worship_history,
// p2p_family_worship_session_events, and p2p_family_prayer_requests rows
// only — no new tables, no rankings, no "spiritual points" (§18/§9).
router.get("/worship/journey", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.query as { familyId?: string };
  if (!familyId) return err(res, "familyId is required");
  if (!(await isActiveFamilyMember(familyId, userId))) return err(res, "You're not a member of this Family Gathering", 403);

  const [
    { count: gatheringCount },
    { data: lessonRows },
    { data: scriptureEvents },
    { data: mediaEvents },
    { data: prayerRows },
  ] = await Promise.all([
    db.from("p2p_family_worship_history").select("id", { count: "exact", head: true }).eq("family_id", familyId),
    db.from("p2p_family_worship_history").select("lesson_id").eq("family_id", familyId).not("lesson_id", "is", null),
    db.from("p2p_family_worship_session_events").select("event_data").eq("family_id", familyId).eq("event_type", "scripture_changed").limit(500),
    db.from("p2p_family_worship_session_events").select("event_data").eq("family_id", familyId).eq("event_type", "media_played").limit(500),
    db.from("p2p_family_prayer_requests").select("id,content,status,updated_at").eq("family_id", familyId).eq("visibility", "family"),
  ]);

  const lessonsCompleted = new Set((lessonRows ?? []).map((r) => r.lesson_id as string)).size;
  const scriptureReferences = Array.from(new Set(
    (scriptureEvents ?? []).map((e) => (e.event_data as Record<string, unknown> | null)?.reference as string | undefined).filter(Boolean)
  ));
  const mediaSeen = new Set<string>();
  const mediaItems: { provider: string; id: string }[] = [];
  for (const e of mediaEvents ?? []) {
    const d = e.event_data as Record<string, unknown> | null;
    if (!d?.id) continue;
    const key = `${d.provider}:${d.id}`;
    if (mediaSeen.has(key)) continue;
    mediaSeen.add(key);
    mediaItems.push({ provider: d.provider as string, id: d.id as string });
  }
  const answered = (prayerRows ?? []).filter((p) => p.status === "answered");
  const recentAnswered = [...answered]
    .sort((a, b) => new Date(b.updated_at as string).getTime() - new Date(a.updated_at as string).getTime())
    .slice(0, 5).map((p) => ({ id: p.id, content: p.content }));

  return ok(res, {
    gatheringCount: gatheringCount ?? 0,
    lessonsCoveredCount: lessonsCompleted,
    scripture: { count: scriptureReferences.length, references: scriptureReferences },
    media: { count: mediaItems.length, items: mediaItems },
    prayer: { count: (prayerRows ?? []).length, answeredCount: answered.length, recentAnswered },
  });
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