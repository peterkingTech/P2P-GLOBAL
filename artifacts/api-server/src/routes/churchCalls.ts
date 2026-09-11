import crypto from "node:crypto";
import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// Same role sets churches.ts already established (migration 072) — copied
// rather than imported, matching this codebase's existing convention of
// each route file owning its own small local auth helpers (family.ts and
// familyWorship.ts each define their own membership check rather than
// cross-importing one from the other).
const LEADERSHIP_ROLES = ["senior_pastor", "discipleship_pastor", "small_group_leader"];
const PASTOR_ROLES = ["senior_pastor", "discipleship_pastor"];
const VALID_PURPOSES = ["meeting", "teaching", "bible_study", "prayer", "leadership", "small_group", "fellowship", "church_gathering", "other"] as const;

async function getChurchMembership(churchId: string, userId: string) {
  const { data } = await db
    .from("p2p_church_members").select("role, is_active")
    .eq("church_id", churchId).eq("user_id", userId).maybeSingle();
  return data as { role: string; is_active: boolean } | null;
}
async function isActiveChurchMember(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active;
}
async function isChurchLeadership(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active && LEADERSHIP_ROLES.includes(m.role);
}
async function isChurchPastor(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active && PASTOR_ROLES.includes(m.role);
}
async function isActiveCohortMember(cohortId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("p2p_church_cohort_members").select("id").eq("cohort_id", cohortId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return !!data;
}
// Stage 2 — active-participant boundary for chat/notes, mirrors
// familyWorship.ts's isActiveParticipant() exactly.
async function isActiveCallParticipant(callId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_church_call_participants").select("id").eq("call_id", callId).eq("user_id", userId).is("left_at", null).maybeSingle();
  return !!data;
}
// Host or any church pastor — the same authorization tier already used by
// /end, reused for every other moderation action (mute/video-disable/
// remove/scripture/lesson/media/host-summary/continuity-notes) so there is
// exactly one "who may moderate this call" rule, not one per action.
async function isHostOrPastor(call: Record<string, unknown>, userId: string): Promise<boolean> {
  if (call.host_id === userId) return true;
  return isChurchPastor(call.church_id as string, userId);
}

// Stage 5 — one row per real, already-authorized state transition (never
// per-tick) — mirrors familyWorship.ts's logSessionEvent() exactly.
async function logCallEvent(callId: string, churchId: string, eventType: string, eventData?: Record<string, unknown>) {
  await db.from("p2p_church_call_events").insert({ call_id: callId, church_id: churchId, event_type: eventType, event_data: eventData ?? null });
}

// Stage 4 — read-only lookup against the existing curriculum tables,
// mirrors familyWorship.ts's resolveLessonContext() exactly. Never writes
// p2p_lesson_progress; never duplicates lesson/module/curriculum data.
async function resolveLessonContext(lessonId: string) {
  const { data: lessonRow } = await db.from("p2p_lessons").select("id,title,module_id,order_index,status").eq("id", lessonId).maybeSingle();
  if (!lessonRow || lessonRow.status !== "published") return null;
  const { data: moduleRow } = await db.from("p2p_modules").select("id,title,curriculum_id,order_index").eq("id", lessonRow.module_id as string).maybeSingle();
  if (!moduleRow) return null;
  const { data: curriculumRow } = await db.from("p2p_curriculums").select("id,title").eq("id", moduleRow.curriculum_id as string).maybeSingle();
  return {
    lessonId: lessonRow.id, lessonTitle: lessonRow.title,
    moduleId: moduleRow.id, moduleTitle: moduleRow.title,
    curriculumId: curriculumRow?.id ?? null, curriculumTitle: curriculumRow?.title ?? null,
  };
}

function scriptureReferenceLabel(s: Record<string, unknown> | null | undefined): string | null {
  if (!s || !s.book || !s.chapter || s.startVerse === undefined) return null;
  const verses = s.startVerse === s.endVerse ? `${s.startVerse}` : `${s.startVerse}-${s.endVerse}`;
  return `${s.book} ${s.chapter}:${verses}`;
}

function mapCall(row: Record<string, unknown>) {
  return {
    id: row.id, churchId: row.church_id, hostId: row.host_id, title: row.title,
    purpose: row.purpose, scope: row.scope, cohortId: row.cohort_id ?? null,
    channelName: row.channel_name, status: row.status,
    startedAt: row.started_at, endedAt: row.ended_at, createdAt: row.created_at,
    // Stage 3
    scheduledStartAt: row.scheduled_start_at ?? null,
    expectedDurationMinutes: row.expected_duration_minutes ?? null,
    description: row.description ?? null,
    // Stage 4
    lessonId: row.lesson_id ?? null,
    scriptureReference: row.scripture_reference ?? null,
    media: row.media_provider ? { provider: row.media_provider, id: row.media_id, url: row.media_url ?? null } : null,
    // Stage 5
    hostSummary: row.host_summary ?? null,
    continuityNotes: row.continuity_notes ?? null,
  };
}

async function notifyChurchCallRecipients(call: Record<string, unknown>, title: string, message: string, notificationType: string) {
  const recipientIds = call.scope === "cohort" && call.cohort_id
    ? (await db.from("p2p_church_cohort_members").select("user_id").eq("cohort_id", call.cohort_id as string).eq("status", "active")).data?.map((m) => m.user_id as string) ?? []
    : (await db.from("p2p_church_members").select("user_id").eq("church_id", call.church_id as string).eq("is_active", true)).data?.map((m) => m.user_id as string) ?? [];
  const others = recipientIds.filter((id) => id !== call.host_id);
  if (!others.length) return;
  await db.from("p2p_notifications").insert(
    others.map((uid) => ({
      user_id: uid, title, message, notification_type: notificationType,
      // Minimal, safe metadata only — never a token/certificate/private
      // content (Stage 3's explicit notification-security requirement).
      data: { callId: call.id, churchId: call.church_id },
    }))
  );
}

// POST /churches/:churchId/calls — start a Church Call. Only church
// leadership (senior_pastor/discipleship_pastor/small_group_leader) may
// start a church-wide call; a cohort-scoped call may also be started by
// that specific cohort's own leader_id even if they hold no formal
// leadership role in p2p_church_members (a cohort can be led by a regular
// member) — the same "ownership is a distinct axis from role" principle
// churches.ts already established for isCreator().
router.post("/churches/:churchId/calls", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  const { title, purpose, scope, cohortId } = req.body as { title?: string; purpose?: string; scope?: string; cohortId?: string };

  if (!title?.trim()) return err(res, "title is required");
  const resolvedPurpose = purpose && (VALID_PURPOSES as readonly string[]).includes(purpose) ? purpose : "meeting";
  const resolvedScope = scope === "cohort" ? "cohort" : "church";

  let cohort: { id: string; leader_id: string | null; church_id: string } | null = null;
  if (resolvedScope === "cohort") {
    if (!cohortId) return err(res, "cohortId is required for a cohort-scoped call");
    const { data } = await db.from("p2p_church_cohorts").select("id,leader_id,church_id").eq("id", cohortId).maybeSingle();
    if (!data || data.church_id !== churchId) return err(res, "Cohort not found", 404);
    cohort = data as { id: string; leader_id: string | null; church_id: string };
  }

  const leadership = await isChurchLeadership(churchId, userId);
  const isCohortLeader = resolvedScope === "cohort" && cohort?.leader_id === userId;
  if (!leadership && !isCohortLeader) {
    return err(res, "Only church leadership or this group's leader can start a call", 403);
  }

  const callId = crypto.randomUUID();
  const { data: call, error } = await db.from("p2p_church_calls").insert({
    id: callId, church_id: churchId, host_id: userId, title: title.trim(), purpose: resolvedPurpose,
    scope: resolvedScope, cohort_id: cohort?.id ?? null, channel_name: `church_call_${callId}`, status: "live",
    started_at: new Date().toISOString(),
  }).select().single();
  if (error || !call) return err(res, error?.message ?? "Failed to start the call", 500);

  await db.from("p2p_church_call_participants").insert({ call_id: callId, user_id: userId });
  await logCallEvent(callId, churchId, "started", { title: title.trim(), purpose: resolvedPurpose });

  // Multi-recipient notification — the existing p2p_notifications insert-
  // per-recipient pattern already proven for Family Gathering's own
  // start-of-session invite (familyWorship.ts's /worship/start) and Study
  // Together's group-call invitations; no new push infrastructure needed,
  // pushDispatch.ts already delivers any notification_type.
  const { data: hostProfile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  const hostName = (hostProfile?.full_name as string) ?? "Someone";
  await notifyChurchCallRecipients(
    call as Record<string, unknown>, "📞 Church Call", `${hostName} started "${title.trim()}" — tap to join.`, "church_call_started"
  );

  return ok(res, mapCall(call as Record<string, unknown>));
});

// POST /churches/:churchId/calls/schedule — Stage 3. Same authorization as
// starting a live call (church leadership or the specific cohort's own
// leader). Creates a status='scheduled' row — no channel_name yet (Agora
// channels are only ever created for a call that's actually about to go
// live, matching the "never mint infrastructure ahead of need" pattern
// already used everywhere else in this codebase).
router.post("/churches/:churchId/calls/schedule", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  const { title, purpose, scope, cohortId, scheduledStartAt, expectedDurationMinutes, description } = req.body as {
    title?: string; purpose?: string; scope?: string; cohortId?: string;
    scheduledStartAt?: string; expectedDurationMinutes?: number; description?: string;
  };

  if (!title?.trim()) return err(res, "title is required");
  if (!scheduledStartAt || Number.isNaN(Date.parse(scheduledStartAt))) return err(res, "scheduledStartAt must be a valid ISO date-time");
  // Server is the sole authority on "is this in the future" — never trust
  // client-computed timezone math (Stage 3's explicit requirement).
  if (Date.parse(scheduledStartAt) <= Date.now()) return err(res, "scheduledStartAt must be in the future");
  if (expectedDurationMinutes !== undefined && (typeof expectedDurationMinutes !== "number" || expectedDurationMinutes <= 0 || expectedDurationMinutes > 600)) {
    return err(res, "expectedDurationMinutes must be a positive number of minutes (max 600)");
  }
  if (description !== undefined && description !== null && description.length > 1000) return err(res, "description is too long (1000 characters max)");
  const resolvedPurpose = purpose && (VALID_PURPOSES as readonly string[]).includes(purpose) ? purpose : "meeting";
  const resolvedScope = scope === "cohort" ? "cohort" : "church";

  let cohort: { id: string; leader_id: string | null; church_id: string } | null = null;
  if (resolvedScope === "cohort") {
    if (!cohortId) return err(res, "cohortId is required for a cohort-scoped call");
    const { data } = await db.from("p2p_church_cohorts").select("id,leader_id,church_id").eq("id", cohortId).maybeSingle();
    if (!data || data.church_id !== churchId) return err(res, "Cohort not found", 404);
    cohort = data as { id: string; leader_id: string | null; church_id: string };
  }

  const leadership = await isChurchLeadership(churchId, userId);
  const isCohortLeader = resolvedScope === "cohort" && cohort?.leader_id === userId;
  if (!leadership && !isCohortLeader) {
    return err(res, "Only church leadership or this group's leader can schedule a call", 403);
  }

  const { data: call, error } = await db.from("p2p_church_calls").insert({
    church_id: churchId, host_id: userId, title: title.trim(), purpose: resolvedPurpose,
    scope: resolvedScope, cohort_id: cohort?.id ?? null, status: "scheduled",
    scheduled_start_at: scheduledStartAt, expected_duration_minutes: expectedDurationMinutes ?? null,
    description: description?.trim() || null,
  }).select().single();
  if (error || !call) return err(res, error?.message ?? "Failed to schedule the call", 500);

  return ok(res, mapCall(call as Record<string, unknown>));
});

// POST /churches/calls/:callId/start — Stage 3. Transitions a scheduled
// call into a live one — the SAME row (per the mandate's explicit "should
// not create a second live-call record"), not a new p2p_church_calls
// insert. Same authorization as scheduling it.
router.post("/churches/calls/:callId/start", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (call.status !== "scheduled") return err(res, "This call has already been started or has ended", 409);

  const leadership = await isChurchLeadership(call.church_id as string, userId);
  const isCohortLeader = call.scope === "cohort" && call.cohort_id
    ? (await db.from("p2p_church_cohorts").select("leader_id").eq("id", call.cohort_id as string).maybeSingle()).data?.leader_id === userId
    : false;
  if (call.host_id !== userId && !leadership && !isCohortLeader) {
    return err(res, "Only the scheduling host or church leadership can start this call", 403);
  }

  const { data: updated, error } = await db.from("p2p_church_calls").update({
    status: "live", host_id: userId, channel_name: `church_call_${call.id}`, started_at: new Date().toISOString(),
  }).eq("id", call.id).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to start the call", 500);

  await db.from("p2p_church_call_participants").upsert(
    { call_id: call.id, user_id: userId, joined_at: new Date().toISOString(), left_at: null },
    { onConflict: "call_id,user_id" }
  );
  await logCallEvent(call.id as string, call.church_id as string, "started", { title: call.title, purpose: call.purpose });

  const { data: hostProfile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  const hostName = (hostProfile?.full_name as string) ?? "Someone";
  await notifyChurchCallRecipients(
    updated as Record<string, unknown>, "📞 Church Call", `"${(call.title as string).trim()}" has started — tap to join.`, "church_call_started"
  );

  return ok(res, mapCall(updated as Record<string, unknown>));
});

// GET /churches/:churchId/calls — Live Now + Upcoming + Recent Calls.
// Church-membership gated (any active member sees the list, matching
// Family Gathering's own GET /worship/history pattern — the list itself is
// not scope-filtered, only joining is; seeing that a cohort's call exists
// is not sensitive).
router.get("/churches/:churchId/calls", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  if (!(await isActiveChurchMember(churchId, userId))) return err(res, "You're not a member of this church", 403);

  const [{ data: live }, { data: upcoming }, { data: recent }] = await Promise.all([
    db.from("p2p_church_calls").select("*").eq("church_id", churchId).eq("status", "live").order("started_at", { ascending: false }),
    db.from("p2p_church_calls").select("*").eq("church_id", churchId).eq("status", "scheduled").gte("scheduled_start_at", new Date().toISOString()).order("scheduled_start_at", { ascending: true }).limit(20),
    db.from("p2p_church_calls").select("*").eq("church_id", churchId).eq("status", "ended").order("ended_at", { ascending: false }).limit(20),
  ]);
  return ok(res, { live: (live ?? []).map(mapCall), upcoming: (upcoming ?? []).map(mapCall), recent: (recent ?? []).map(mapCall) });
});

// GET /churches/calls/:callId — call detail + current participants
// (including Stage 2's host-moderation flags, so a client can self-apply
// mic/video-disabled state on load/rejoin) + Stage 4 lesson context. Any
// active member of the call's own church may view it (list/detail are not
// scope-gated, only joining is — see the route above).
router.get("/churches/calls/:callId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isActiveChurchMember(call.church_id as string, userId))) return err(res, "You're not a member of this church", 403);

  const { data: participantRows } = await db
    .from("p2p_church_call_participants").select("user_id,joined_at,mic_disabled_by_host,video_disabled_by_host").eq("call_id", call.id as string).is("left_at", null);
  const participantIds = (participantRows ?? []).map((p) => p.user_id as string);
  const { data: profiles } = participantIds.length
    ? await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", participantIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const lesson = call.lesson_id ? await resolveLessonContext(call.lesson_id as string) : null;

  return ok(res, {
    call: mapCall(call as Record<string, unknown>),
    lesson,
    participants: (participantRows ?? []).map((p) => ({
      userId: p.user_id as string,
      name: profileById.get(p.user_id as string)?.full_name ?? "Someone",
      photoUrl: profileById.get(p.user_id as string)?.photo_url ?? null,
      micDisabledByHost: !!p.mic_disabled_by_host,
      videoDisabledByHost: !!p.video_disabled_by_host,
    })),
  });
});

// POST /churches/calls/:callId/join — authorization is scope-specific:
// 'church' scope needs active church membership; 'cohort' scope needs
// active membership in that specific cohort, OR church leadership (a
// pastor should always be able to sit in on any group's call).
router.post("/churches/calls/:callId/join", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (call.status !== "live") return err(res, "This call has ended", 409);

  if (call.scope === "cohort") {
    const cohortOk = call.cohort_id && await isActiveCohortMember(call.cohort_id as string, userId);
    const leaderOk = await isChurchLeadership(call.church_id as string, userId);
    if (!cohortOk && !leaderOk) return err(res, "You're not authorized to join this call", 403);
  } else {
    if (!(await isActiveChurchMember(call.church_id as string, userId))) return err(res, "You're not a member of this church", 403);
  }

  await db.from("p2p_church_call_participants").upsert(
    { call_id: call.id, user_id: userId, joined_at: new Date().toISOString(), left_at: null },
    { onConflict: "call_id,user_id" }
  );
  return ok(res, mapCall(call as Record<string, unknown>));
});

// POST /churches/calls/:callId/leave — leaving never ends the call for
// everyone. Investigated Break Rooms' own host-leaving behavior first
// (calls.ts's /calls/rooms/:roomId/leave): it auto-ends ONLY when the host
// leaves and no one else remains, otherwise the room is left host-less for
// a separate periodic sweep to eventually clean up. Church Calls mirrors
// the simple "auto-end if empty" half of that; it deliberately does not
// add a new sweep/cron job (real new infrastructure, not a "smallest
// additive change") — a host-less-but-populated call can still always be
// ended by any church pastor via the /end route below, which is a
// sufficient safety valve.
router.post("/churches/calls/:callId/leave", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);

  await db.from("p2p_church_call_participants")
    .update({ left_at: new Date().toISOString() }).eq("call_id", call.id).eq("user_id", userId).is("left_at", null);

  if (userId === call.host_id) {
    const { count } = await db.from("p2p_church_call_participants").select("id", { count: "exact", head: true }).eq("call_id", call.id).is("left_at", null);
    if (!count || count === 0) {
      await endCallInternal(call as Record<string, unknown>);
    }
  }
  return ok(res, { left: true });
});

// POST /churches/calls/:callId/end — the host, or any church pastor
// (senior_pastor/discipleship_pastor — the same PASTOR_ROLES tier
// churches.ts already uses for its most sensitive actions), may end a
// call. A small_group_leader is deliberately NOT included here even
// though they can START church-wide calls, matching the mandate's
// "Pastor/Admin: create/manage/end/moderate" vs. narrower leader
// permissions.
router.post("/churches/calls/:callId/end", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);

  const isHost = call.host_id === userId;
  const isPastor = await isChurchPastor(call.church_id as string, userId);
  if (!isHost && !isPastor) return err(res, "Only the host or a church pastor can end this call", 403);

  if (call.status === "ended") return ok(res, mapCall(call as Record<string, unknown>));

  const updated = await endCallInternal(call as Record<string, unknown>);
  if (!updated) return err(res, "Failed to end the call", 500);
  return ok(res, mapCall(updated));
});

async function endCallInternal(call: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { data: updated, error } = await db.from("p2p_church_calls")
    .update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", call.id as string).select().single();
  if (error || !updated) return null;
  await db.from("p2p_church_call_participants").update({ left_at: new Date().toISOString() }).eq("call_id", call.id as string).is("left_at", null);
  await logCallEvent(call.id as string, call.church_id as string, "ended", {});
  return updated as Record<string, unknown>;
}

// ── Stage 2 — Moderation ─────────────────────────────────────────────────
// Every action here is host/pastor-only, checked server-side, never
// trusting the client. Agora RTC (not RTM) genuinely has no mechanism for
// one participant's client to force-mute another's stream — this is a
// real architecture limit, documented in app/call/group.tsx's own code
// comments, not a shortcut. What IS made server-authorized: the disabled
// flag is persisted on p2p_church_call_participants, so (a) a client that
// honors it (as this app's own client always will) cannot be worked around
// by simply reconnecting, and (b) the flag is visible to every other
// participant via GET .../:callId, not just cosmetically signaled.

// POST /churches/calls/:callId/participants/:targetUserId/mic — { disabled }
router.post("/churches/calls/:callId/participants/:targetUserId/mic", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId, targetUserId } = req.params;
  const { disabled } = req.body as { disabled?: boolean };
  if (typeof disabled !== "boolean") return err(res, "disabled must be a boolean");
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);

  const { error } = await db.from("p2p_church_call_participants")
    .update({ mic_disabled_by_host: disabled }).eq("call_id", callId).eq("user_id", targetUserId).is("left_at", null);
  if (error) return err(res, error.message, 500);
  return ok(res, { userId: targetUserId, micDisabledByHost: disabled });
});

// POST /churches/calls/:callId/participants/:targetUserId/video — { disabled }
router.post("/churches/calls/:callId/participants/:targetUserId/video", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId, targetUserId } = req.params;
  const { disabled } = req.body as { disabled?: boolean };
  if (typeof disabled !== "boolean") return err(res, "disabled must be a boolean");
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);

  const { error } = await db.from("p2p_church_call_participants")
    .update({ video_disabled_by_host: disabled }).eq("call_id", callId).eq("user_id", targetUserId).is("left_at", null);
  if (error) return err(res, error.message, 500);
  return ok(res, { userId: targetUserId, videoDisabledByHost: disabled });
});

// POST /churches/calls/:callId/participants/:targetUserId/remove — marks
// the target's participant row left, which is what actually enforces the
// removal: calls.ts's church_call_ token branch requires an active
// (left_at is null) participant row before minting any token, and the
// chat/notes RLS above requires the same, so a removed participant is
// blocked from rejoining, chatting, or noting immediately — not just
// cosmetically signaled. The host cannot remove themselves this way
// (mirrors familyWorship.ts's /remove exactly).
router.post("/churches/calls/:callId/participants/:targetUserId/remove", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId, targetUserId } = req.params;
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);
  if (targetUserId === call.host_id) return err(res, "The host can't be removed this way", 400);

  await db.from("p2p_church_call_participants").update({ left_at: new Date().toISOString() })
    .eq("call_id", callId).eq("user_id", targetUserId).is("left_at", null);
  return ok(res, { removed: true });
});

// ── Stage 2 — Chat ───────────────────────────────────────────────────────
// Mirrors familyWorship.ts's messages endpoints exactly, scoped to
// p2p_church_call_messages/p2p_church_call_participants instead of the
// worship equivalents.

function mapMessage(row: Record<string, unknown>, authorName: string) {
  return { id: row.id, callId: row.call_id, userId: row.user_id, authorName, content: row.content, createdAt: row.created_at };
}

router.get("/churches/calls/:callId/messages", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  if (!(await isActiveCallParticipant(callId, userId))) return err(res, "You're not currently in this call", 403);

  const { data: messages, error } = await db.from("p2p_church_call_messages").select("*").eq("call_id", callId).order("created_at", { ascending: true }).limit(200);
  if (error) return err(res, error.message, 500);

  const userIds = Array.from(new Set((messages ?? []).map((m) => m.user_id as string)));
  const { data: profiles } = userIds.length ? await db.from("p2p_profiles").select("id,full_name").in("id", userIds) : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  return ok(res, (messages ?? []).map((m) => mapMessage(m as Record<string, unknown>, nameById.get(m.user_id as string) ?? "Someone")));
});

router.post("/churches/calls/:callId/messages", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { content } = req.body as { content?: string };
  if (!content?.trim()) return err(res, "content is required");
  if (content.length > 2000) return err(res, "Message is too long");
  if (!(await isActiveCallParticipant(callId, userId))) return err(res, "You're not currently in this call", 403);

  const { data: message, error } = await db.from("p2p_church_call_messages").insert({ call_id: callId, user_id: userId, content: content.trim() }).select().single();
  if (error || !message) return err(res, error?.message ?? "Failed to send message", 500);
  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapMessage(message as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// ── Stage 4 — Notes ──────────────────────────────────────────────────────
function mapNote(row: Record<string, unknown>, authorName: string) {
  return { id: row.id, callId: row.call_id, authorId: row.author_id, authorName, visibility: row.visibility, content: row.content, createdAt: row.created_at };
}

router.get("/churches/calls/:callId/notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  if (!(await isActiveCallParticipant(callId, userId))) return err(res, "You're not currently in this call", 403);

  const { data: notes, error } = await db.from("p2p_church_call_notes").select("*").eq("call_id", callId)
    .or(`visibility.eq.shared,author_id.eq.${userId}`).order("created_at", { ascending: true });
  if (error) return err(res, error.message, 500);

  const userIds = Array.from(new Set((notes ?? []).map((n) => n.author_id as string)));
  const { data: profiles } = userIds.length ? await db.from("p2p_profiles").select("id,full_name").in("id", userIds) : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  return ok(res, (notes ?? []).map((n) => mapNote(n as Record<string, unknown>, nameById.get(n.author_id as string) ?? "Someone")));
});

router.post("/churches/calls/:callId/notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { content, visibility } = req.body as { content?: string; visibility?: string };
  if (!content?.trim()) return err(res, "content is required");
  if (visibility !== undefined && !["shared", "private"].includes(visibility)) return err(res, "visibility must be 'shared' or 'private'");
  if (!(await isActiveCallParticipant(callId, userId))) return err(res, "You're not currently in this call", 403);

  const { data: note, error } = await db.from("p2p_church_call_notes").insert({ call_id: callId, author_id: userId, content: content.trim(), visibility: visibility ?? "shared" }).select().single();
  if (error || !note) return err(res, error?.message ?? "Failed to save note", 500);
  const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return ok(res, mapNote(note as Record<string, unknown>, (profile?.full_name as string) ?? "Someone"));
});

// ── Stage 4 — Scripture / Lesson / Media ─────────────────────────────────
// All host/pastor-only, all optional associations into existing systems.

router.put("/churches/calls/:callId/scripture", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { book, chapter, startVerse, endVerse, translation } = req.body as {
    book?: string; chapter?: number; startVerse?: number; endVerse?: number; translation?: string;
  };
  if (!book || !chapter || !startVerse || !translation) return err(res, "book, chapter, startVerse, and translation are required");
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);

  const scripture = { book, chapter, startVerse, endVerse: endVerse ?? startVerse, translation };
  const { error } = await db.from("p2p_church_calls").update({ scripture_reference: scripture, updated_at: new Date().toISOString() }).eq("id", callId);
  if (error) return err(res, error.message, 500);
  await logCallEvent(callId, call.church_id as string, "scripture_attached", { reference: scriptureReferenceLabel(scripture) });
  return ok(res, { scriptureReference: scripture });
});

router.put("/churches/calls/:callId/lesson", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { lessonId } = req.body as { lessonId?: string | null };
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);

  if (lessonId) {
    const lesson = await resolveLessonContext(lessonId);
    if (!lesson) return err(res, "Lesson not found or not published", 404);
    await db.from("p2p_church_calls").update({ lesson_id: lessonId, updated_at: new Date().toISOString() }).eq("id", callId);
    await logCallEvent(callId, call.church_id as string, "lesson_attached", { lessonId, lessonTitle: lesson.lessonTitle });
    return ok(res, { lesson });
  }
  await db.from("p2p_church_calls").update({ lesson_id: null, updated_at: new Date().toISOString() }).eq("id", callId);
  return ok(res, { lesson: null });
});

const VALID_MEDIA_PROVIDERS = ["youtube"] as const;
router.put("/churches/calls/:callId/media", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { callId } = req.params;
  const { provider, id, url } = req.body as { provider?: string | null; id?: string | null; url?: string | null };
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);

  if (provider) {
    if (!(VALID_MEDIA_PROVIDERS as readonly string[]).includes(provider)) return err(res, `provider must be one of: ${VALID_MEDIA_PROVIDERS.join(", ")}`);
    if (!id) return err(res, "id is required alongside provider");
    await db.from("p2p_church_calls").update({ media_provider: provider, media_id: id, media_url: url ?? null, updated_at: new Date().toISOString() }).eq("id", callId);
    await logCallEvent(callId, call.church_id as string, "media_attached", { provider, id });
    return ok(res, { media: { provider, id, url: url ?? null } });
  }
  await db.from("p2p_church_calls").update({ media_provider: null, media_id: null, media_url: null, updated_at: new Date().toISOString() }).eq("id", callId);
  return ok(res, { media: null });
});

// ── Stage 5 — Summary, Continuity, Journey ───────────────────────────────

// PUT /churches/calls/:callId/host-summary — manual, non-AI text.
router.put("/churches/calls/:callId/host-summary", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);
  const { summary } = req.body as { summary?: string };
  if (summary !== undefined && summary !== null && summary.length > 2000) return err(res, "Summary is too long (2000 characters max)");

  const { error } = await db.from("p2p_church_calls").update({ host_summary: summary?.trim() || null, updated_at: new Date().toISOString() }).eq("id", req.params.callId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// PUT /churches/calls/:callId/continuity-notes — manual, non-AI text.
router.put("/churches/calls/:callId/continuity-notes", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isHostOrPastor(call as Record<string, unknown>, userId))) return err(res, "Only the host or a church pastor can do that", 403);
  const { notes } = req.body as { notes?: string };
  if (notes !== undefined && notes !== null && notes.length > 2000) return err(res, "Notes are too long (2000 characters max)");

  const { error } = await db.from("p2p_church_calls").update({ continuity_notes: notes?.trim() || null, updated_at: new Date().toISOString() }).eq("id", req.params.callId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// GET /churches/calls/:callId/summary — the full Call Summary. No AI
// content anywhere: every field below is either a raw count, a real
// timeline event already logged by an already-authorized write, or the
// host's own manually-written text.
router.get("/churches/calls/:callId/summary", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: call } = await db.from("p2p_church_calls").select("*").eq("id", req.params.callId).maybeSingle();
  if (!call) return err(res, "Call not found", 404);
  if (!(await isActiveChurchMember(call.church_id as string, userId))) return err(res, "You're not a member of this church", 403);

  const callId = call.id as string;
  const [{ data: hostProfile }, { data: participantRows }, { data: events }, { data: messages }, { data: notes }, lesson] = await Promise.all([
    call.host_id ? db.from("p2p_profiles").select("id,full_name,photo_url").eq("id", call.host_id as string).maybeSingle() : Promise.resolve({ data: null }),
    db.from("p2p_church_call_participants").select("user_id,joined_at").eq("call_id", callId),
    db.from("p2p_church_call_events").select("event_type,event_data,created_at").eq("call_id", callId).order("created_at", { ascending: true }),
    db.from("p2p_church_call_messages").select("user_id").eq("call_id", callId),
    db.from("p2p_church_call_notes").select("author_id").eq("call_id", callId),
    call.lesson_id ? resolveLessonContext(call.lesson_id as string) : Promise.resolve(null),
  ]);

  const participantIds = (participantRows ?? []).map((p) => p.user_id as string);
  const { data: participantProfiles } = participantIds.length
    ? await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", participantIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null }[] };
  const profileById = new Map((participantProfiles ?? []).map((p) => [p.id as string, p]));
  const messageAuthors = new Set((messages ?? []).map((m) => m.user_id as string));
  const noteAuthors = new Set((notes ?? []).map((n) => n.author_id as string));

  return ok(res, {
    overview: {
      churchId: call.church_id, title: call.title, purpose: call.purpose,
      startedAt: call.started_at, endedAt: call.ended_at,
      durationSeconds: call.started_at && call.ended_at ? Math.max(0, Math.round((new Date(call.ended_at as string).getTime() - new Date(call.started_at as string).getTime()) / 1000)) : null,
      host: call.host_id ? { id: call.host_id, name: (hostProfile?.full_name as string) ?? "Someone", photoUrl: hostProfile?.photo_url ?? null } : null,
    },
    participation: {
      participantCount: participantIds.length,
      participants: participantIds.map((id) => ({ userId: id, name: profileById.get(id)?.full_name ?? "Someone", photoUrl: profileById.get(id)?.photo_url ?? null })),
    },
    scripture: { reference: call.scripture_reference ?? null, label: scriptureReferenceLabel(call.scripture_reference as Record<string, unknown> | null) },
    study: lesson,
    media: call.media_provider ? { provider: call.media_provider, id: call.media_id } : null,
    discussion: { messageCount: messages?.length ?? 0, contributorCount: messageAuthors.size },
    notes: { authorCount: noteAuthors.size },
    hostSummary: call.host_summary ?? null,
    continuityNotes: call.continuity_notes ?? null,
    timeline: (events ?? []).map((e) => ({ type: e.event_type, data: e.event_data, at: e.created_at })),
  });
});

// GET /churches/:churchId/calls/continue — Stage 5's "Previous Call" +
// "Next Scheduled Call" in one read. Pure lookup — no inferred spiritual
// progress, no scoring.
router.get("/churches/:churchId/calls/continue", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  if (!(await isActiveChurchMember(churchId, userId))) return err(res, "You're not a member of this church", 403);

  const [{ data: previous }, { data: next }] = await Promise.all([
    db.from("p2p_church_calls").select("*").eq("church_id", churchId).eq("status", "ended").order("ended_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("p2p_church_calls").select("*").eq("church_id", churchId).eq("status", "scheduled").gte("scheduled_start_at", new Date().toISOString()).order("scheduled_start_at", { ascending: true }).limit(1).maybeSingle(),
  ]);

  return ok(res, {
    previousCall: previous ? mapCall(previous as Record<string, unknown>) : null,
    nextScheduledCall: next ? mapCall(next as Record<string, unknown>) : null,
  });
});

// GET /churches/:churchId/calls/journey — aggregate counts only (calls by
// purpose, distinct Scripture references, distinct lessons covered). No
// spiritual scoring, no attendance leaderboards, no gamification — matches
// the mandate's explicit prohibition.
router.get("/churches/:churchId/calls/journey", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  if (!(await isActiveChurchMember(churchId, userId))) return err(res, "You're not a member of this church", 403);

  const { data: calls } = await db.from("p2p_church_calls").select("purpose,scripture_reference,lesson_id").eq("church_id", churchId).eq("status", "ended");
  const rows = calls ?? [];
  const byPurpose: Record<string, number> = {};
  for (const r of rows) byPurpose[r.purpose as string] = (byPurpose[r.purpose as string] ?? 0) + 1;
  const scriptureReferences = Array.from(new Set(rows.map((r) => scriptureReferenceLabel(r.scripture_reference as Record<string, unknown> | null)).filter((s): s is string => !!s)));
  const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string | null).filter((id): id is string => !!id)));

  return ok(res, { totalCalls: rows.length, byPurpose, scriptureReferences, lessonsCoveredCount: lessonIds.length });
});

export default router;
