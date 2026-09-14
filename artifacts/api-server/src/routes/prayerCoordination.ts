import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { isValidTimezone, computeOnceOccurrence, computeWeeklyOccurrencesInWindow, occurrenceContains } from "../lib/prayerTime";

// Prayer 2.0 Stage 1 — backend/data foundation only (no UI in this stage).
// New, clearly-separated namespace (p2p_prayer_coord_*, migration 138) —
// does not read from or write to any of the three existing prayer systems
// (p2p_prayer_requests, p2p_prayer_wall_posts, p2p_family_prayer_requests).
// Every mutating endpoint re-derives identity via verifyCaller() and does
// a fresh DB-derived ownership check before acting — RLS (migration 138)
// is a backstop, not the primary authorization path, matching every other
// route file in this codebase.

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

async function notify(userId: string, title: string, message: string, notificationType: string, data: Record<string, unknown> = {}) {
  await db.from("p2p_notifications").insert({ user_id: userId, title, message, notification_type: notificationType, data });
}

async function profileName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? "Someone";
}

function mapRequest(row: Record<string, unknown>) {
  return {
    id: row.id, userId: row.user_id, title: row.title, prayerPoint: row.prayer_point,
    category: row.category, scriptureReference: row.scripture_reference, isAnonymous: row.is_anonymous,
    visibility: row.visibility, prayerMode: row.prayer_mode, status: row.status,
    expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
    progressNote: row.progress_note ?? null, progressNoteType: row.progress_note_type ?? null,
    progressUpdatedAt: row.progress_updated_at ?? null, answerNote: row.answer_note ?? null,
    missionId: row.mission_id ?? null,
  };
}
function mapCommitment(row: Record<string, unknown>) {
  return {
    id: row.id, userId: row.user_id, requestId: row.request_id, status: row.status,
    reminderAt: row.reminder_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
// Purely informational, zero scoring weight (see migration 139's comment) —
// a failure here is logged but never blocks the real action that caused it.
async function logActivity(userId: string, eventType: string, metadata: Record<string, unknown> = {}) {
  await db.from("p2p_user_activity_events").insert({ user_id: userId, event_type: eventType, metadata });
}
function mapAvailability(row: Record<string, unknown>) {
  return {
    id: row.id, userId: row.user_id, timezone: row.timezone, recurrence: row.recurrence,
    specificDate: row.specific_date, dayOfWeek: row.day_of_week, startTime: row.start_time, endTime: row.end_time,
    visibility: row.visibility, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapInvitation(
  row: Record<string, unknown>,
  timezones?: { requesterTimezone: string | null; recipientTimezone: string | null },
  names?: { requesterName: string; recipientName: string }
) {
  return {
    id: row.id, requesterId: row.requester_id, recipientId: row.recipient_id, requestId: row.request_id,
    proposedStartAt: row.proposed_start_at, proposedEndAt: row.proposed_end_at, message: row.message,
    status: row.status, respondedAt: row.responded_at, createdAt: row.created_at, updatedAt: row.updated_at,
    requesterTimezone: timezones?.requesterTimezone ?? null, recipientTimezone: timezones?.recipientTimezone ?? null,
    requesterName: names?.requesterName ?? null, recipientName: names?.recipientName ?? null,
  };
}
async function invitationNames(row: Record<string, unknown>) {
  const [requesterName, recipientName] = await Promise.all([
    profileName(row.requester_id as string), profileName(row.recipient_id as string),
  ]);
  return { requesterName, recipientName };
}

// Best-effort display helper only — NOT an authoritative timezone for the
// user (nothing in this schema claims to be; p2p_profiles.timezone exists
// but is unvalidated and unused elsewhere, per the Stage 0 forensic
// finding). Looks up that user's most recently updated availability slot
// and returns its timezone, purely so the UI can show "their local time"
// next to the viewer's own device-accurate local time — never used for
// any scheduling/authorization decision, only display.
async function recentTimezoneFor(userId: string): Promise<string | null> {
  const { data } = await db.from("p2p_prayer_coord_availability").select("timezone")
    .eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.timezone as string | undefined) ?? null;
}
async function invitationTimezones(row: Record<string, unknown>) {
  const [requesterTimezone, recipientTimezone] = await Promise.all([
    recentTimezoneFor(row.requester_id as string), recentTimezoneFor(row.recipient_id as string),
  ]);
  return { requesterTimezone, recipientTimezone };
}
function mapGathering(row: Record<string, unknown>, timezones?: { hostTimezone: string | null; recipientTimezone: string | null }) {
  return {
    id: row.id, invitationId: row.invitation_id, hostId: row.host_id, recipientId: row.recipient_id,
    requestId: row.request_id, scheduledStartAt: row.scheduled_start_at, scheduledEndAt: row.scheduled_end_at,
    status: row.status, prayerFocus: row.prayer_focus, scriptureReference: row.scripture_reference,
    channelName: row.channel_name, callLogId: row.call_log_id,
    actualStartAt: row.actual_start_at, actualEndAt: row.actual_end_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
    hostTimezone: timezones?.hostTimezone ?? null, recipientTimezone: timezones?.recipientTimezone ?? null,
  };
}
// Same best-effort display-only convention as invitationTimezones() above.
async function gatheringTimezones(row: Record<string, unknown>) {
  const [hostTimezone, recipientTimezone] = await Promise.all([
    recentTimezoneFor(row.host_id as string), recentTimezoneFor(row.recipient_id as string),
  ]);
  return { hostTimezone, recipientTimezone };
}

// ── Prayer Requests ────────────────────────────────────────────────────

router.post("/requests", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { title, prayerPoint, category, scriptureReference, isAnonymous, visibility, prayerMode, expiresAt, missionId } = req.body as {
    title?: string; prayerPoint?: string; category?: string | null; scriptureReference?: unknown;
    isAnonymous?: boolean; visibility?: string; prayerMode?: string; expiresAt?: string | null; missionId?: string | null;
  };
  if (!title?.trim()) return err(res, "title is required");
  if (!prayerPoint?.trim()) return err(res, "prayerPoint is required");
  if (visibility !== undefined && !["open", "private"].includes(visibility)) return err(res, "visibility must be open or private");
  if (prayerMode !== undefined && !["pray_for_me", "pray_with_me", "both"].includes(prayerMode)) return err(res, "prayerMode must be pray_for_me, pray_with_me, or both");
  if (missionId) {
    const { data: mission } = await db.from("p2p_missions").select("id").eq("id", missionId).maybeSingle();
    if (!mission) return err(res, "That mission could not be found", 404);
  }

  const { data, error } = await db.from("p2p_prayer_coord_requests").insert({
    user_id: userId, title: title.trim(), prayer_point: prayerPoint.trim(),
    category: category?.trim() || null, scripture_reference: scriptureReference ?? null,
    is_anonymous: !!isAnonymous, visibility: visibility ?? "open", prayer_mode: prayerMode ?? "both",
    expires_at: expiresAt ?? null, mission_id: missionId ?? null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create the prayer request", 500);
  return ok(res, mapRequest(data as Record<string, unknown>));
});

router.get("/requests/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapRequest));
});

// GET /requests/open — browse OTHER peers' open, unexpired, visibility='open'
// requests, so "commit to pray" (Stage 4) has something real to discover.
// Registered before "/requests/:id" — same route-ordering rule as
// "/invitations/mine" above (a literal path must precede a ":id" wildcard).
// Never lists a private request, never lists the caller's own (they already
// have "mine" for that), never lists an expired/cancelled/answered one.
router.get("/requests/open", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_requests").select("*")
    .eq("visibility", "open").eq("status", "open").neq("user_id", userId)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .order("created_at", { ascending: false }).limit(50);
  if (error) return err(res, error.message, 500);
  const withOwnerNames = await Promise.all((data ?? []).map(async (r) => ({
    ...mapRequest(r as Record<string, unknown>),
    ownerName: r.is_anonymous ? null : await profileName(r.user_id as string),
  })));
  return ok(res, withOwnerNames);
});

router.get("/requests/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("*").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);

  if (request.user_id !== userId) {
    const isOpenAndLive = request.visibility === "open" && request.status === "open"
      && (!request.expires_at || new Date(request.expires_at as string) > new Date());
    if (!isOpenAndLive) {
      const { data: invited } = await db.from("p2p_prayer_coord_invitations").select("id")
        .eq("request_id", request.id as string).eq("recipient_id", userId).maybeSingle();
      if (!invited) return err(res, "This prayer request is not available", 404);
    }
  }
  return ok(res, mapRequest(request as Record<string, unknown>));
});

router.put("/requests/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (request.user_id !== userId) return err(res, "Only the request's owner can edit it", 403);

  const { title, prayerPoint, category, scriptureReference, isAnonymous, visibility, prayerMode, expiresAt } = req.body as {
    title?: string; prayerPoint?: string; category?: string | null; scriptureReference?: unknown;
    isAnonymous?: boolean; visibility?: string; prayerMode?: string; expiresAt?: string | null;
  };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (prayerPoint !== undefined) { if (!prayerPoint.trim()) return err(res, "prayerPoint cannot be empty"); updates.prayer_point = prayerPoint.trim(); }
  if (category !== undefined) updates.category = category?.trim() || null;
  if (scriptureReference !== undefined) updates.scripture_reference = scriptureReference;
  if (isAnonymous !== undefined) updates.is_anonymous = !!isAnonymous;
  if (visibility !== undefined) {
    if (!["open", "private"].includes(visibility)) return err(res, "visibility must be open or private");
    updates.visibility = visibility;
  }
  if (prayerMode !== undefined) {
    if (!["pray_for_me", "pray_with_me", "both"].includes(prayerMode)) return err(res, "prayerMode must be pray_for_me, pray_with_me, or both");
    updates.prayer_mode = prayerMode;
  }
  if (expiresAt !== undefined) updates.expires_at = expiresAt;

  const { data, error } = await db.from("p2p_prayer_coord_requests").update(updates).eq("id", request.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update the prayer request", 500);
  return ok(res, mapRequest(data as Record<string, unknown>));
});

router.post("/requests/:id/cancel", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (request.user_id !== userId) return err(res, "Only the request's owner can cancel it", 403);

  const { data, error } = await db.from("p2p_prayer_coord_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", request.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to cancel the prayer request", 500);
  return ok(res, mapRequest(data as Record<string, unknown>));
});

// Prayer 2.0 Stage 4 — "How is this prayer going?" Never a forced answer;
// noteType is a soft, optional narrative label. Only 'no_longer_needed'
// also closes the request (status='cancelled') — every other noteType
// leaves status untouched, since the request is still genuinely open.
router.post("/requests/:id/follow-up", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id,status").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (request.user_id !== userId) return err(res, "Only the request's owner can update its progress", 403);

  const { noteType, note } = req.body as { noteType?: string; note?: string };
  if (!noteType || !["still_praying", "god_is_answering", "partially_answered", "no_longer_needed"].includes(noteType)) {
    return err(res, "noteType must be still_praying, god_is_answering, partially_answered, or no_longer_needed");
  }
  const updates: Record<string, unknown> = {
    progress_note_type: noteType, progress_note: note?.trim() || null,
    progress_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (noteType === "no_longer_needed" && request.status === "open") updates.status = "cancelled";

  const { data, error } = await db.from("p2p_prayer_coord_requests").update(updates).eq("id", request.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update this prayer's progress", 500);
  return ok(res, mapRequest(data as Record<string, unknown>));
});

// Marks the request answered with a short, private-by-default answer note.
// A full public Testimony (with video/moderation/visibility) is a
// deliberately separate, later concept — this only closes the loop on the
// request itself, exactly like the existing wall/family "mark answered"
// conventions this mirrors.
router.post("/requests/:id/answer", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (request.user_id !== userId) return err(res, "Only the request's owner can mark it answered", 403);

  const { answerNote } = req.body as { answerNote?: string };
  const { data, error } = await db.from("p2p_prayer_coord_requests").update({
    status: "answered", answer_note: answerNote?.trim() || null, updated_at: new Date().toISOString(),
  }).eq("id", request.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to mark this prayer answered", 500);
  return ok(res, mapRequest(data as Record<string, unknown>));
});

// ── Prayer Commitments ────────────────────────────────────────────────────
// "I will pray for this" — a real, tracked commitment, never a reaction.
router.post("/requests/:id/commit", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id,status").eq("id", req.params.id).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (request.status !== "open") return err(res, "This prayer request is no longer open");

  const { reminderAt } = req.body as { reminderAt?: string | null };
  const { data, error } = await db.from("p2p_prayer_coord_commitments")
    .upsert(
      { user_id: userId, request_id: request.id, status: "active", reminder_at: reminderAt ?? null, updated_at: new Date().toISOString() },
      { onConflict: "user_id,request_id" }
    ).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to record your commitment to pray", 500);

  await logActivity(userId, "prayer_offered", { prayer_id: request.id, recipient_id: request.user_id });
  return ok(res, mapCommitment(data as Record<string, unknown>));
});

router.get("/commitments/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_commitments").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapCommitment));
});

router.put("/commitments/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: commitment } = await db.from("p2p_prayer_coord_commitments").select("*").eq("id", req.params.id).maybeSingle();
  if (!commitment) return err(res, "Commitment not found", 404);
  if (commitment.user_id !== userId) return err(res, "Only your own commitment can be updated", 403);

  const { status } = req.body as { status?: string };
  if (!status || !["active", "completed", "continued", "released"].includes(status)) {
    return err(res, "status must be active, completed, continued, or released");
  }
  const { data, error } = await db.from("p2p_prayer_coord_commitments")
    .update({ status, updated_at: new Date().toISOString() }).eq("id", commitment.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update this commitment", 500);

  // A genuine, deliberate action (marking a real commitment fulfilled) —
  // never fired just for viewing a screen.
  if (status === "completed" && commitment.status !== "completed") {
    await logActivity(userId, "peer_prayer_supported", { commitmentId: commitment.id, requestId: commitment.request_id });
  }
  return ok(res, mapCommitment(data as Record<string, unknown>));
});

// ── Prayer Availability ──────────────────────────────────────────────────

router.post("/availability", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { timezone, recurrence, specificDate, dayOfWeek, startTime, endTime, visibility } = req.body as {
    timezone?: string; recurrence?: string; specificDate?: string; dayOfWeek?: number;
    startTime?: string; endTime?: string; visibility?: string;
  };
  if (!timezone || !isValidTimezone(timezone)) return err(res, "A valid IANA timezone is required (e.g. Europe/Berlin)");
  if (!startTime || !endTime) return err(res, "startTime and endTime are required");
  if (startTime >= endTime) return err(res, "endTime must be after startTime");
  const rec = recurrence ?? "once";
  if (!["once", "weekly"].includes(rec)) return err(res, "recurrence must be once or weekly");
  if (rec === "once") {
    if (!specificDate) return err(res, "specificDate is required for a one-off slot");
    if (dayOfWeek !== undefined) return err(res, "dayOfWeek must not be set for a one-off slot");
  } else {
    if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) return err(res, "dayOfWeek (0-6) is required for a weekly slot");
    if (specificDate) return err(res, "specificDate must not be set for a weekly slot");
  }
  if (visibility !== undefined && !["open", "private"].includes(visibility)) return err(res, "visibility must be open or private");

  const { data, error } = await db.from("p2p_prayer_coord_availability").insert({
    user_id: userId, timezone, recurrence: rec,
    specific_date: rec === "once" ? specificDate : null, day_of_week: rec === "weekly" ? dayOfWeek : null,
    start_time: startTime, end_time: endTime, visibility: visibility ?? "open",
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create the availability slot", 500);
  return ok(res, mapAvailability(data as Record<string, unknown>));
});

router.get("/availability/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_availability").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapAvailability));
});

async function loadOwnAvailability(id: string, userId: string) {
  const { data } = await db.from("p2p_prayer_coord_availability").select("*").eq("id", id).maybeSingle();
  if (!data) return { slot: null, authorized: false };
  return { slot: data, authorized: data.user_id === userId };
}

router.put("/availability/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { slot, authorized } = await loadOwnAvailability(req.params.id, userId);
  if (!slot) return err(res, "Availability slot not found", 404);
  if (!authorized) return err(res, "Only the slot's owner can edit it", 403);

  const { startTime, endTime, visibility, timezone } = req.body as {
    startTime?: string; endTime?: string; visibility?: string; timezone?: string;
  };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (timezone !== undefined) {
    if (!isValidTimezone(timezone)) return err(res, "A valid IANA timezone is required");
    updates.timezone = timezone;
  }
  const nextStart = startTime ?? (slot.start_time as string);
  const nextEnd = endTime ?? (slot.end_time as string);
  if (nextStart >= nextEnd) return err(res, "endTime must be after startTime");
  if (startTime !== undefined) updates.start_time = startTime;
  if (endTime !== undefined) updates.end_time = endTime;
  if (visibility !== undefined) {
    if (!["open", "private"].includes(visibility)) return err(res, "visibility must be open or private");
    updates.visibility = visibility;
  }

  const { data, error } = await db.from("p2p_prayer_coord_availability").update(updates).eq("id", slot.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update the availability slot", 500);
  return ok(res, mapAvailability(data as Record<string, unknown>));
});

router.post("/availability/:id/toggle", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { slot, authorized } = await loadOwnAvailability(req.params.id, userId);
  if (!slot) return err(res, "Availability slot not found", 404);
  if (!authorized) return err(res, "Only the slot's owner can change it", 403);

  const { data, error } = await db.from("p2p_prayer_coord_availability")
    .update({ is_active: !slot.is_active, updated_at: new Date().toISOString() }).eq("id", slot.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to toggle the availability slot", 500);
  return ok(res, mapAvailability(data as Record<string, unknown>));
});

router.delete("/availability/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { slot, authorized } = await loadOwnAvailability(req.params.id, userId);
  if (!slot) return err(res, "Availability slot not found", 404);
  if (!authorized) return err(res, "Only the slot's owner can delete it", 403);

  const { error } = await db.from("p2p_prayer_coord_availability").delete().eq("id", slot.id as string);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// GET /availability/available-now — other users' active, open slots whose
// current occurrence contains this instant. Never exposes a private slot
// or a disabled one; never exposes the caller's own slot as a "match."
router.get("/availability/available-now", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { data: slots, error } = await db.from("p2p_prayer_coord_availability").select("*")
    .eq("is_active", true).eq("visibility", "open").neq("user_id", userId);
  if (error) return err(res, error.message, 500);

  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);
  const matches: { userId: string; displayName: string; availabilityId: string; timezone: string; availableUntil: string }[] = [];

  for (const slot of slots ?? []) {
    let occurrence: { start: Date; end: Date } | null = null;
    if (slot.recurrence === "once") {
      const occ = computeOnceOccurrence(slot.specific_date as string, slot.start_time as string, slot.end_time as string, slot.timezone as string);
      if (occurrenceContains(occ, now)) occurrence = occ;
    } else {
      const occs = computeWeeklyOccurrencesInWindow(
        slot.day_of_week as number, slot.start_time as string, slot.end_time as string, slot.timezone as string, windowStart, windowEnd
      );
      occurrence = occs.find((o) => occurrenceContains(o, now)) ?? null;
    }
    if (occurrence) {
      matches.push({
        userId: slot.user_id as string, displayName: await profileName(slot.user_id as string),
        availabilityId: slot.id as string, timezone: slot.timezone as string, availableUntil: occurrence.end.toISOString(),
      });
    }
  }
  return ok(res, matches);
});

// ── Prayer Invitations ────────────────────────────────────────────────────

function isInvitationExpired(invitation: Record<string, unknown>): boolean {
  return invitation.status === "pending" && new Date(invitation.proposed_end_at as string) < new Date();
}

router.post("/invitations", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { recipientId, requestId, proposedStartAt, proposedEndAt, message } = req.body as {
    recipientId?: string; requestId?: string | null; proposedStartAt?: string; proposedEndAt?: string; message?: string;
  };
  if (!recipientId) return err(res, "recipientId is required");
  if (recipientId === userId) return err(res, "You cannot invite yourself");
  if (!proposedStartAt || !proposedEndAt) return err(res, "proposedStartAt and proposedEndAt are required");
  const start = new Date(proposedStartAt);
  const end = new Date(proposedEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return err(res, "proposedStartAt/proposedEndAt must be valid timestamps");
  if (end <= start) return err(res, "proposedEndAt must be after proposedStartAt");
  if (end < new Date()) return err(res, "This proposed time has already passed");

  const { data: recipientProfile } = await db.from("p2p_profiles").select("id").eq("id", recipientId).maybeSingle();
  if (!recipientProfile) return err(res, "That recipient could not be found", 404);

  if (requestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id,status").eq("id", requestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "Only a prayer request's own owner can invite people to it", 403);
    if (request.status !== "open") return err(res, "This prayer request is no longer open");
  }

  const { data, error } = await db.from("p2p_prayer_coord_invitations").insert({
    requester_id: userId, recipient_id: recipientId, request_id: requestId ?? null,
    proposed_start_at: start.toISOString(), proposed_end_at: end.toISOString(), message: message?.trim() || null,
  }).select().single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return err(res, "You already have a pending invitation to this person for this time", 409);
    return err(res, error.message, 500);
  }

  const requesterName = await profileName(userId);
  await notify(recipientId, "Prayer invitation", `${requesterName} would like to pray with you.`, "prayer_invitation_received", { invitationId: data.id });
  return ok(res, mapInvitation(data as Record<string, unknown>, await invitationTimezones(data as Record<string, unknown>), await invitationNames(data as Record<string, unknown>)));
});

// NOTE: "/invitations/mine" MUST be registered before "/invitations/:id" —
// Express matches routes in registration order, and ":id" would otherwise
// swallow the literal "mine" path segment as if it were an invitation id.
router.get("/invitations/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_invitations").select("*")
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  // Lazily settle any pending invitations whose proposed window has passed.
  const toExpire = (data ?? []).filter((i) => isInvitationExpired(i as Record<string, unknown>)).map((i) => i.id as string);
  if (toExpire.length) {
    await db.from("p2p_prayer_coord_invitations").update({ status: "expired", updated_at: new Date().toISOString() }).in("id", toExpire);
  }
  const settled = (data ?? []).map((i) => (toExpire.includes(i.id as string) ? { ...i, status: "expired" } : i));
  const enriched = await Promise.all(settled.map(async (i) => mapInvitation(
    i as Record<string, unknown>, await invitationTimezones(i as Record<string, unknown>), await invitationNames(i as Record<string, unknown>)
  )));
  return ok(res, enriched);
});

router.get("/invitations/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: invitation } = await db.from("p2p_prayer_coord_invitations").select("*").eq("id", req.params.id).maybeSingle();
  if (!invitation) return err(res, "Invitation not found", 404);
  if (invitation.requester_id !== userId && invitation.recipient_id !== userId) return err(res, "You are not part of this invitation", 403);

  if (isInvitationExpired(invitation as Record<string, unknown>)) {
    await db.from("p2p_prayer_coord_invitations").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", invitation.id as string);
    (invitation as Record<string, unknown>).status = "expired";
  }
  return ok(res, mapInvitation(
    invitation as Record<string, unknown>, await invitationTimezones(invitation as Record<string, unknown>), await invitationNames(invitation as Record<string, unknown>)
  ));
});

async function loadInvitationForParty(id: string, userId: string) {
  const { data } = await db.from("p2p_prayer_coord_invitations").select("*").eq("id", id).maybeSingle();
  if (!data) return { invitation: null, isRequester: false, isRecipient: false };
  return { invitation: data, isRequester: data.requester_id === userId, isRecipient: data.recipient_id === userId };
}

router.post("/invitations/:id/accept", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { invitation, isRecipient } = await loadInvitationForParty(req.params.id, userId);
  if (!invitation) return err(res, "Invitation not found", 404);
  if (!isRecipient) return err(res, "Only the invited recipient can accept this invitation", 403);
  if (isInvitationExpired(invitation)) {
    await db.from("p2p_prayer_coord_invitations").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", invitation.id as string);
    return err(res, "This invitation has expired", 409);
  }
  if (invitation.status !== "pending") return err(res, `This invitation is already ${invitation.status as string}`, 409);

  const { data: updated, error: updateErr } = await db.from("p2p_prayer_coord_invitations")
    .update({ status: "accepted", responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", invitation.id as string).eq("status", "pending").select().single();
  if (updateErr || !updated) return err(res, updateErr?.message ?? "Failed to accept the invitation (it may have just been settled)", 409);

  // Prayer 2.0 Stage 5 — carry the linked request's Scripture reference
  // (if any) onto the gathering, so it stays visible during the live
  // prayer call exactly like prayer_focus already does. Reuses the SAME
  // jsonb shape p2p_prayer_coord_requests.scripture_reference already
  // uses — never a second Scripture representation.
  let scriptureReference: unknown = null;
  if (updated.request_id) {
    const { data: linkedRequest } = await db.from("p2p_prayer_coord_requests").select("scripture_reference").eq("id", updated.request_id as string).maybeSingle();
    scriptureReference = linkedRequest?.scripture_reference ?? null;
  }

  const { data: gathering, error: gatherErr } = await db.from("p2p_prayer_coord_gatherings").insert({
    invitation_id: updated.id, host_id: updated.requester_id, recipient_id: updated.recipient_id,
    request_id: updated.request_id, scheduled_start_at: updated.proposed_start_at, scheduled_end_at: updated.proposed_end_at,
    prayer_focus: updated.message, scripture_reference: scriptureReference,
  }).select().single();
  if (gatherErr || !gathering) return err(res, gatherErr?.message ?? "Accepted, but failed to create the prayer gathering", 500);

  // Prayer 2.0 Stage 3 — channel_name is deterministic from the gathering's
  // own id (no hashing needed, unlike Direct Calls' peer-pair channel:
  // a gathering already uniquely identifies exactly these two people).
  // Authorization for this prefix is enforced in calls.ts's /calls/token
  // (see that file) against the participant rows inserted right below —
  // this migration/route never touches Agora App ID, token signing, UID
  // strategy, or the channel-naming/hashing logic itself.
  await db.from("p2p_prayer_coord_gatherings").update({ channel_name: `prayer_gathering_${gathering.id}` }).eq("id", gathering.id as string);
  gathering.channel_name = `prayer_gathering_${gathering.id}`;

  await db.from("p2p_prayer_coord_participants").insert([
    { gathering_id: gathering.id, user_id: updated.requester_id, role: "host" },
    { gathering_id: gathering.id, user_id: updated.recipient_id, role: "participant" },
  ]);

  const recipientName = await profileName(userId);
  await notify(updated.requester_id as string, "Invitation accepted", `${recipientName} accepted your prayer invitation.`, "prayer_invitation_accepted", { invitationId: updated.id, gatheringId: gathering.id });
  return ok(res, {
    invitation: mapInvitation(updated as Record<string, unknown>, await invitationTimezones(updated as Record<string, unknown>), await invitationNames(updated as Record<string, unknown>)),
    gathering: mapGathering(gathering as Record<string, unknown>, await gatheringTimezones(gathering as Record<string, unknown>)),
  });
});

router.post("/invitations/:id/decline", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { invitation, isRecipient } = await loadInvitationForParty(req.params.id, userId);
  if (!invitation) return err(res, "Invitation not found", 404);
  if (!isRecipient) return err(res, "Only the invited recipient can decline this invitation", 403);
  if (invitation.status !== "pending") return err(res, `This invitation is already ${invitation.status as string}`, 409);

  const { data, error } = await db.from("p2p_prayer_coord_invitations")
    .update({ status: "declined", responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", invitation.id as string).eq("status", "pending").select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to decline the invitation", 500);

  const recipientName = await profileName(userId);
  await notify(invitation.requester_id as string, "Invitation declined", `${recipientName} declined your prayer invitation.`, "prayer_invitation_declined", { invitationId: invitation.id });
  return ok(res, mapInvitation(data as Record<string, unknown>));
});

router.post("/invitations/:id/cancel", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { invitation, isRequester } = await loadInvitationForParty(req.params.id, userId);
  if (!invitation) return err(res, "Invitation not found", 404);
  if (!isRequester) return err(res, "Only the requester can cancel this invitation", 403);
  if (invitation.status !== "pending") return err(res, `This invitation is already ${invitation.status as string}`, 409);

  const { data, error } = await db.from("p2p_prayer_coord_invitations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", invitation.id as string).eq("status", "pending").select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to cancel the invitation", 500);

  await notify(invitation.recipient_id as string, "Invitation cancelled", "A prayer invitation was cancelled.", "prayer_invitation_cancelled", { invitationId: invitation.id });
  return ok(res, mapInvitation(data as Record<string, unknown>));
});

// ── Prayer Gatherings ─────────────────────────────────────────────────────

// A gathering that never went live and whose scheduled window has fully
// passed is "expired," not "scheduled" forever — same lazy-settle pattern
// as invitations (Stage 1). Never touches a gathering that already went
// live/completed/cancelled.
function isGatheringExpired(g: Record<string, unknown>): boolean {
  return g.status === "scheduled" && new Date(g.scheduled_end_at as string) < new Date();
}

router.get("/gatherings/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_prayer_coord_gatherings").select("*")
    .or(`host_id.eq.${userId},recipient_id.eq.${userId}`).order("scheduled_start_at", { ascending: true });
  if (error) return err(res, error.message, 500);

  const toExpire = (data ?? []).filter((g) => isGatheringExpired(g as Record<string, unknown>)).map((g) => g.id as string);
  if (toExpire.length) {
    await db.from("p2p_prayer_coord_gatherings").update({ status: "expired", updated_at: new Date().toISOString() }).in("id", toExpire);
  }
  const settled = (data ?? []).map((g) => (toExpire.includes(g.id as string) ? { ...g, status: "expired" } : g));
  const withTimezones = await Promise.all(settled.map(async (g) => mapGathering(g as Record<string, unknown>, await gatheringTimezones(g as Record<string, unknown>))));
  return ok(res, withTimezones);
});

async function loadGatheringForParty(id: string, userId: string) {
  const { data } = await db.from("p2p_prayer_coord_gatherings").select("*").eq("id", id).maybeSingle();
  if (!data) return { gathering: null, authorized: false };
  return { gathering: data, authorized: data.host_id === userId || data.recipient_id === userId };
}

router.get("/gatherings/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { gathering, authorized } = await loadGatheringForParty(req.params.id, userId);
  if (!gathering) return err(res, "Prayer gathering not found", 404);
  if (!authorized) return err(res, "You are not part of this prayer gathering", 403);

  if (isGatheringExpired(gathering as Record<string, unknown>)) {
    await db.from("p2p_prayer_coord_gatherings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", gathering.id as string);
    (gathering as Record<string, unknown>).status = "expired";
  }

  const { data: participants } = await db.from("p2p_prayer_coord_participants").select("*").eq("gathering_id", gathering.id as string);
  const enrichedParticipants = await Promise.all((participants ?? []).map(async (p) => ({
    id: p.id, userId: p.user_id, role: p.role, status: p.status, joinedAt: p.joined_at, leftAt: p.left_at,
    displayName: await profileName(p.user_id as string),
  })));
  return ok(res, {
    gathering: mapGathering(gathering as Record<string, unknown>, await gatheringTimezones(gathering as Record<string, unknown>)),
    participants: enrichedParticipants,
  });
});

router.post("/gatherings/:id/cancel", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { gathering, authorized } = await loadGatheringForParty(req.params.id, userId);
  if (!gathering) return err(res, "Prayer gathering not found", 404);
  if (!authorized) return err(res, "You are not part of this prayer gathering", 403);
  if (gathering.status !== "scheduled") return err(res, `This gathering is already ${gathering.status as string}`, 409);

  const { data, error } = await db.from("p2p_prayer_coord_gatherings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", gathering.id as string).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to cancel the gathering", 500);

  const otherPartyId = gathering.host_id === userId ? gathering.recipient_id as string : gathering.host_id as string;
  const cancellerName = await profileName(userId);
  await notify(otherPartyId, "Prayer gathering cancelled", `${cancellerName} cancelled your prayer gathering.`, "prayer_gathering_cancelled", { gatheringId: gathering.id });
  return ok(res, mapGathering(data as Record<string, unknown>));
});

// Prayer 2.0 Stage 3 — real participation tracking. These two endpoints are
// the ONLY place p2p_prayer_coord_participants.status/joined_at/left_at
// and the gathering's own status/actual_start_at/actual_end_at change after
// creation, and both are strictly self-scoped: a caller can only ever
// write their OWN participant row (never `req.body.userId`, never
// someone else's), derived solely from verifyCaller(). The mobile call
// screen calls /join the moment its OWN Agora onJoinChannelSuccess fires
// (a real SDK callback, not a button click) and /leave when the user
// actually leaves the channel — mirroring the same "client reports a real
// call-engine event, server records it as fact" trust model this codebase
// already uses for Direct Calls' own connectedAt/durationSeconds fields
// (see calls.ts's /calls/end) rather than inventing a stricter one.
router.post("/gatherings/:id/join", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { gathering, authorized } = await loadGatheringForParty(req.params.id, userId);
  if (!gathering) return err(res, "Prayer gathering not found", 404);
  if (!authorized) return err(res, "You are not part of this prayer gathering", 403);
  if (isGatheringExpired(gathering as Record<string, unknown>)) {
    await db.from("p2p_prayer_coord_gatherings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", gathering.id as string);
    return err(res, "This prayer gathering has expired", 409);
  }
  if (!["scheduled", "starting", "live"].includes(gathering.status as string)) {
    return err(res, `This gathering is already ${gathering.status as string}`, 409);
  }

  const { data: myRow } = await db.from("p2p_prayer_coord_participants").select("*")
    .eq("gathering_id", gathering.id as string).eq("user_id", userId).maybeSingle();
  if (!myRow) return err(res, "You are not a participant of this gathering", 403);

  // First join for THIS user only sets joined_at (a re-join after a brief
  // drop does not reset "when they first arrived"), but always clears
  // left_at and marks them joined again.
  await db.from("p2p_prayer_coord_participants").update({
    status: "joined", joined_at: myRow.joined_at ?? new Date().toISOString(), left_at: null,
  }).eq("id", myRow.id as string);

  // First participant to join anywhere in this gathering transitions it to
  // 'live' and stamps actual_start_at — backend-owned, never client-set.
  const wasAlreadyLive = gathering.status === "live";
  if (!wasAlreadyLive) {
    await db.from("p2p_prayer_coord_gatherings").update({
      status: "live", actual_start_at: (gathering.actual_start_at as string | null) ?? new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", gathering.id as string);
  }

  // "Ready to join" notification — only fires once, to whichever party
  // wasn't already present, never repeated on every reconnect.
  if (!wasAlreadyLive) {
    const otherPartyId = gathering.host_id === userId ? gathering.recipient_id as string : gathering.host_id as string;
    const arriverName = await profileName(userId);
    await notify(otherPartyId, "Prayer time", `${arriverName} is ready to pray — join now.`, "prayer_gathering_ready", { gatheringId: gathering.id });
  }

  const { data: refreshed } = await db.from("p2p_prayer_coord_gatherings").select("*").eq("id", gathering.id as string).single();
  return ok(res, mapGathering(refreshed as Record<string, unknown>, await gatheringTimezones(refreshed as Record<string, unknown>)));
});

router.post("/gatherings/:id/leave", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { gathering, authorized } = await loadGatheringForParty(req.params.id, userId);
  if (!gathering) return err(res, "Prayer gathering not found", 404);
  if (!authorized) return err(res, "You are not part of this prayer gathering", 403);

  const { data: myRow } = await db.from("p2p_prayer_coord_participants").select("*")
    .eq("gathering_id", gathering.id as string).eq("user_id", userId).maybeSingle();
  if (!myRow) return err(res, "You are not a participant of this gathering", 403);
  if (myRow.status !== "joined") return err(res, "You haven't joined this gathering yet", 400);

  await db.from("p2p_prayer_coord_participants").update({ status: "left", left_at: new Date().toISOString() }).eq("id", myRow.id as string);

  // Gathering completes once EVERY participant has left — not when the
  // first person leaves, and never merely because someone clicked a
  // button before ever joining (that path is /cancel, not /leave).
  const { data: allParticipants } = await db.from("p2p_prayer_coord_participants").select("status").eq("gathering_id", gathering.id as string);
  const allLeft = (allParticipants ?? []).every((p) => p.status !== "joined");
  if (allLeft && gathering.status === "live") {
    await db.from("p2p_prayer_coord_gatherings").update({
      status: "completed", actual_end_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", gathering.id as string);
    // Genuine, real completion of an actual prayer gathering — never fired
    // merely for opening a screen or accepting an invitation.
    await Promise.all([
      logActivity(gathering.host_id as string, "prayer_gathering_completed", { gatheringId: gathering.id }),
      logActivity(gathering.recipient_id as string, "prayer_gathering_completed", { gatheringId: gathering.id }),
    ]);
  }

  const { data: refreshed } = await db.from("p2p_prayer_coord_gatherings").select("*").eq("id", gathering.id as string).single();
  return ok(res, mapGathering(refreshed as Record<string, unknown>, await gatheringTimezones(refreshed as Record<string, unknown>)));
});

export default router;
