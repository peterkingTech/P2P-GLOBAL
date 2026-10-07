import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";
import { getAccountStatus, isEffectivelyDeactivated, type AccountStatusRow } from "../lib/accountStatus";
import { inLiveCallOrSession, leadsGroupWithOthers, precheckFailed } from "../lib/accountSafety";
import { cancelDeletion, getDeletionBlockers, isDeletionEnabled, scheduleDeletion, DELETION_GRACE_DAYS } from "../lib/accountDeletion";
import { logger } from "../lib/logger";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Account status writes and session revocation need the service-role key —
// the mobile client only ever holds the anon key, so this goes through the
// API, same pattern as every other privileged write in this server.
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const router = Router();

const HOUR_MS = 60 * 60 * 1000;
const MIN_BREAK_MS = HOUR_MS;
const MAX_BREAK_MS = 366 * 24 * HOUR_MS;
const STAFF_ROLES = new Set(["super_admin", "regional_admin", "moderator"]);

// Identity only from the verified session (verifyCaller, the same mechanism
// contact.ts/circles.ts/calls.ts use). A body userId is tolerated for older
// app builds but must be the caller's own — it never decides whose account
// is acted on. Same 403 whether or not that other id exists.
async function callerOrReject(req: import("express").Request, res: import("express").Response): Promise<string | null> {
  const callerId = await verifyCaller(req);
  if (!callerId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const { userId } = (req.body ?? {}) as { userId?: string };
  if (userId !== undefined && userId !== callerId) { res.status(403).json({ error: "Forbidden" }); return null; }
  return callerId;
}

function statusPayload(row: AccountStatusRow | null) {
  if (row?.status === "deletion_scheduled") {
    return { status: "deletion_scheduled", deactivatedAt: null, deactivatedUntil: null, deletionScheduledFor: row.deletion_scheduled_for ?? null };
  }
  const deactivated = isEffectivelyDeactivated(row);
  return {
    status: deactivated ? "deactivated" : "active",
    deactivatedAt: deactivated ? row!.deactivated_at : null,
    deactivatedUntil: deactivated ? row!.deactivated_until : null,
    deletionScheduledFor: null,
  };
}

// Staff accounts (official accounts and admin roles) keep departments and
// moderation staffed. Note: admin_is_active defaults to true on every
// profile, so it is not an "is admin" flag — the role is.
async function isStaff(userId: string): Promise<boolean> {
  const { data: profile, error } = await supabaseWrite
    .from("p2p_profiles").select("is_official_account, role").eq("id", userId).maybeSingle();
  if (error) precheckFailed("p2p_profiles");
  const role = String(profile?.role ?? "");
  return !!profile?.is_official_account || STAFF_ROLES.has(role) || role.startsWith("admin_");
}

// POST /account/delete — retired. It used to delete immediately; deletion is
// now requested and runs after a grace period (POST /account/deletion/request).
// Authentication and ownership are still checked first, so the response
// reveals nothing to anyone else, and this path can never delete anything.
router.post("/delete", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;
  return res.status(410).json({ error: "Please update the app to delete your account.", code: "USE_DELETION_REQUEST" });
});

// ── Account status & reversible deactivation ("take a break") ──────────────
// Deactivation never deletes or moves anything: it records a status row
// (migration 173) that the app reads to show the "taking a break" screen,
// and that the push dispatcher and pastoral-care scan read to stay quiet.

// GET /account/status — the caller's own status.
router.get("/status", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.json(statusPayload(await getAccountStatus(callerId)));
  } catch {
    return res.status(500).json({ error: "Couldn't load your account status. Please try again." });
  }
});

// POST /account/deactivate — { until?: ISO date | null } (null/absent = until
// the user reactivates). Reversible; deletes nothing.
router.post("/deactivate", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;

  const { until } = (req.body ?? {}) as { until?: string | null };
  let untilIso: string | null = null;
  if (until !== undefined && until !== null) {
    const t = new Date(until).getTime();
    if (!Number.isFinite(t)) return res.status(400).json({ error: "Please choose a valid date.", code: "INVALID_DATE" });
    if (t < Date.now() + MIN_BREAK_MS) return res.status(400).json({ error: "Please choose a date in the future.", code: "INVALID_DATE" });
    if (t > Date.now() + MAX_BREAK_MS) return res.status(400).json({ error: "Please choose a date within the next year, or take a break until you reactivate.", code: "INVALID_DATE" });
    untilIso = new Date(t).toISOString();
  }

  try {
    const current = await getAccountStatus(callerId);
    if (current && current.status !== "active" && current.status !== "deactivated") {
      return res.status(409).json({ error: "Your account can't be paused right now. Please contact P2P Support.", code: "STATUS_LOCKED" });
    }
    if (await isStaff(callerId)) {
      return res.status(409).json({ error: "Official and admin accounts can't be paused here. Please speak with another admin.", code: "ADMIN_ACCOUNT" });
    }
    if (await inLiveCallOrSession(callerId)) {
      return res.status(409).json({ error: "You're in a call or live session right now. Please leave it first, then take your break.", code: "ACTIVE_CALL" });
    }
    if (await leadsGroupWithOthers(callerId)) {
      return res.status(409).json({ error: "You're leading a family or circle that others are part of. Taking a break isn't available yet for leaders — please contact P2P Support and we'll help you plan it.", code: "LEADS_GROUP" });
    }
  } catch {
    return res.status(500).json({ error: "Couldn't check your account right now. Please try again later." });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseWrite
    .from("p2p_account_status")
    .upsert({ user_id: callerId, status: "deactivated", deactivated_at: now, deactivated_until: untilIso, updated_at: now }, { onConflict: "user_id" })
    .select("user_id, status, deactivated_at, deactivated_until, reactivated_at, deletion_scheduled_for")
    .single();
  if (error) return res.status(500).json({ error: "Couldn't pause your account. Please try again later." });
  return res.json(statusPayload(data as AccountStatusRow));
});

// POST /account/reactivate — ends a break. Idempotent: an active account
// stays active. A scheduled deletion is ended with /deletion/cancel instead.
router.post("/reactivate", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;
  try {
    const current = await getAccountStatus(callerId);
    if (!current || current.status === "active") return res.json(statusPayload(current));
    if (current.status === "deletion_scheduled") {
      return res.status(409).json({ error: "Your account is scheduled for deletion. Cancel the deletion to keep your account.", code: "DELETION_SCHEDULED" });
    }
    if (current.status !== "deactivated") {
      return res.status(409).json({ error: "Please contact P2P Support to restore your account.", code: "STATUS_LOCKED" });
    }
  } catch {
    return res.status(500).json({ error: "Couldn't load your account status. Please try again." });
  }
  const now = new Date().toISOString();
  const { data, error } = await supabaseWrite
    .from("p2p_account_status")
    .update({ status: "active", deactivated_at: null, deactivated_until: null, reactivated_at: now, updated_at: now })
    .eq("user_id", callerId)
    .select("user_id, status, deactivated_at, deactivated_until, reactivated_at, deletion_scheduled_for")
    .single();
  if (error) return res.status(500).json({ error: "Couldn't reactivate your account. Please try again later." });
  return res.json(statusPayload(data as AccountStatusRow));
});

// ── Permanent deletion (migration 175, lib/accountDeletion.ts) ─────────────

const BLOCKER_MESSAGES: Record<string, string> = {
  staff_account: "Official and admin accounts can't be deleted here. Please speak with another admin.",
  leads_family: "You're the Shepherd of a family that others are part of. Please hand over leadership, or contact P2P Support, before deleting your account.",
  leads_circle: "You're leading a circle that others are part of. Please hand over leadership, or contact P2P Support, before deleting your account.",
};
const DEFAULT_BLOCKER_MESSAGE = "Your account is connected to records other people rely on (such as mentoring, study sessions or evaluations). Please contact P2P Support and we'll help you delete it.";

const REASON_CODES = new Set([
  "need_break", "too_busy", "not_finding_what_i_need", "family_or_community_difficulty", "different_direction",
  "privacy", "technical_problems", "uncomfortable", "want_to_talk", "other",
]);

// POST /account/deletion/request — { confirm: "DELETE", reasonCode? }.
// Schedules deletion of the CALLER's account after the grace period, then
// signs them out everywhere. Idempotent.
router.post("/deletion/request", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;
  if (!isDeletionEnabled()) return res.status(404).json({ error: "Not available.", code: "DELETION_DISABLED" });

  const { confirm, reasonCode } = (req.body ?? {}) as { confirm?: string; reasonCode?: string };
  if (confirm !== "DELETE") return res.status(400).json({ error: "Please confirm by typing DELETE.", code: "CONFIRMATION_REQUIRED" });
  const reason = reasonCode && REASON_CODES.has(reasonCode) ? reasonCode : null;

  try {
    const current = await getAccountStatus(callerId);
    if (current?.status === "deletion_scheduled") return res.json(statusPayload(current));
    const blockers = await getDeletionBlockers(callerId);
    if (blockers.length) {
      return res.status(409).json({ error: BLOCKER_MESSAGES[blockers[0]] ?? DEFAULT_BLOCKER_MESSAGE, code: "DELETION_BLOCKED", blockers });
    }
    if (await inLiveCallOrSession(callerId)) {
      return res.status(409).json({ error: "You're in a call or live session right now. Please leave it first.", code: "ACTIVE_CALL" });
    }
    const log = await scheduleDeletion(callerId, reason);
    // Sign out every device; signing in again during the grace period shows
    // the option to cancel. Best effort — the request already stands.
    const token = req.headers.authorization?.slice(7);
    if (token) {
      const { error: soErr } = await supabaseWrite.auth.admin.signOut(token, "global");
      if (soErr) logger.warn({ err: soErr }, "deletion request: global sign-out failed");
    }
    return res.json({ status: "deletion_scheduled", deletionScheduledFor: log.scheduled_for, graceDays: DELETION_GRACE_DAYS });
  } catch (e) {
    logger.error({ err: e }, "deletion request failed");
    return res.status(500).json({ error: "Couldn't schedule the deletion. Please try again later." });
  }
});

// POST /account/deletion/cancel — keeps the account. Always available, even
// if requests are switched off, so nobody is stuck with a scheduled deletion.
router.post("/deletion/cancel", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;
  try {
    const result = await cancelDeletion(callerId);
    if (result === "too_late") return res.status(409).json({ error: "This deletion has already been carried out.", code: "TOO_LATE" });
    return res.json({ ...statusPayload(await getAccountStatus(callerId)), result });
  } catch (e) {
    logger.error({ err: e }, "deletion cancel failed");
    return res.status(500).json({ error: "Couldn't cancel the deletion. Please try again." });
  }
});

export default router;
