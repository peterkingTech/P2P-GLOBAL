import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";
import { getAccountStatus, isEffectivelyDeactivated, type AccountStatusRow } from "../lib/accountStatus";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Deleting an auth user requires the service-role key — the mobile client
// only ever holds the anon key, so this has to go through the API, same
// pattern as every other privileged write in this server (see discipleship.ts).
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const router = Router();

// Rows that point at the user from a table whose FK CASCADEs (or blocks) on
// delete — records that belong to, or are shared with, OTHER people. Until
// the full deletion redesign (reassignment, anonymisation, one transaction)
// exists, any hit here means deleting this account would destroy someone
// else's data or fail half-way, so the request is refused. Read-only counts.
type Check = { table: string; column: string };
const SHARED_DATA_CHECKS: Check[] = [
  // Call history is always shared with the other party (CASCADE).
  { table: "p2p_call_logs", column: "initiated_by" },
  { table: "p2p_incoming_calls", column: "caller_id" },
  { table: "p2p_incoming_calls", column: "recipient_id" },
  { table: "p2p_call_invitations", column: "inviter_id" },
  { table: "p2p_call_invitations", column: "invitee_id" },
  // Other people's growth/evaluation records (CASCADE).
  { table: "p2p_peer_circle_evaluations", column: "evaluator_id" },
  { table: "p2p_peer_circle_evaluations", column: "submitter_id" },
  { table: "p2p_peer_confirmations", column: "actor_user_id" },
  { table: "p2p_peer_confirmations", column: "confirmer_user_id" },
  { table: "p2p_admin_interaction_feedback", column: "peer_user_id" },
  { table: "p2p_admin_interaction_feedback", column: "admin_user_id" },
  // Prayer gatherings/invitations involve a second person (CASCADE).
  { table: "p2p_prayer_coord_gatherings", column: "host_id" },
  { table: "p2p_prayer_coord_gatherings", column: "recipient_id" },
  { table: "p2p_prayer_coord_invitations", column: "requester_id" },
  { table: "p2p_prayer_coord_invitations", column: "recipient_id" },
  // Invitations sent to other people (CASCADE).
  { table: "p2p_family_invitations", column: "invited_by" },
  { table: "p2p_invitations", column: "inviter_id" },
  // NO ACTION FKs — a row here makes the profile/auth delete fail part-way,
  // which is how the existing half-deleted accounts were produced.
  { table: "p2p_admin_roles", column: "user_id" },
  { table: "p2p_churches", column: "created_by" },
  { table: "p2p_content_approvals", column: "submitted_by" },
  { table: "p2p_content_approvals", column: "reviewed_by" },
  { table: "p2p_discipleship_links", column: "mentor_id" },
  { table: "p2p_discipleship_links", column: "disciple_id" },
  { table: "p2p_discipleship_links", column: "assigned_by" },
  { table: "p2p_evaluation_reassignments", column: "new_evaluator_id" },
  { table: "p2p_evaluation_reassignments", column: "previous_evaluator_id" },
  { table: "p2p_lesson_evaluations", column: "reassigned_from" },
  { table: "p2p_peer_confirmation_audit", column: "performed_by" },
  { table: "p2p_regions", column: "regional_leader_id" },
  { table: "p2p_session_attendance", column: "user_id" },
  { table: "p2p_session_notes", column: "author_id" },
  { table: "p2p_sessions", column: "mentor_id" },
  { table: "p2p_sessions", column: "participant_id" },
  { table: "p2p_study_session_participants", column: "user_id" },
  { table: "p2p_study_sessions", column: "leader_id" },
  { table: "p2p_study_sessions", column: "created_by" },
  { table: "p2p_user_flags", column: "user_id" },
  { table: "p2p_completion_letters", column: "learner_id" },
  { table: "p2p_completion_letters", column: "peer_guide_id" },
  { table: "p2p_content_status_log", column: "changed_by" },
  { table: "p2p_languages", column: "ui_reviewed_by" },
  { table: "p2p_lesson_blocks", column: "created_by" },
  { table: "p2p_lessons", column: "last_edited_by" },
  { table: "p2p_peer_circle_join_requests", column: "responded_by" },
  { table: "p2p_peer_circle_sessions", column: "created_by" },
  { table: "p2p_user_fruits", column: "awarded_by_user_id" },
];

// Fail closed: if a pre-check can't run, we can't prove nothing is shared.
function precheckFailed(table: string): never {
  throw new Error(`deletion pre-check failed on ${table}`);
}

async function hasRows(table: string, column: string, value: string): Promise<boolean> {
  const { count, error } = await supabaseWrite.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (error) precheckFailed(table);
  return (count ?? 0) > 0;
}

// Groups the user owns that CASCADE-delete wholesale (family → every
// member's records; circle → its members, sessions and group chat; hosted
// worship sessions and break rooms → other participants' rows). Blocked
// whenever anyone besides the user is in them.
async function ownsSharedGroup(userId: string): Promise<boolean> {
  const idsWhere = async (table: string, column: string): Promise<string[]> => {
    const { data, error } = await supabaseWrite.from(table).select("id").eq(column, userId);
    if (error) precheckFailed(table);
    return (data ?? []).map((r: { id: string }) => r.id);
  };
  const othersIn = async (table: string, groupColumn: string, groupIds: string[]): Promise<boolean> => {
    if (!groupIds.length) return false;
    const { count, error } = await supabaseWrite.from(table)
      .select("*", { count: "exact", head: true }).in(groupColumn, groupIds).neq("user_id", userId);
    if (error) precheckFailed(table);
    return (count ?? 0) > 0;
  };

  const familyIds = await idsWhere("p2p_families", "shepherd_id");
  if (await othersIn("p2p_family_members", "family_id", familyIds)) return true;

  const circleIds = await idsWhere("p2p_peer_circles", "leader_id");
  if (await othersIn("p2p_peer_circle_members", "circle_id", circleIds)) return true;
  if (await othersIn("p2p_peer_circle_join_requests", "circle_id", circleIds)) return true;

  const { data: hosted, error: hostedErr } = await supabaseWrite
    .from("p2p_family_worship_sessions").select("id, family_id").eq("host_id", userId);
  if (hostedErr) precheckFailed("p2p_family_worship_sessions");
  if (await othersIn("p2p_family_worship_participants", "session_id", (hosted ?? []).map((s) => s.id as string))) return true;
  const hostedFamilyIds = [...new Set((hosted ?? []).map((s) => s.family_id as string))];
  if (await othersIn("p2p_family_members", "family_id", hostedFamilyIds)) return true;

  const roomIds = await idsWhere("p2p_break_rooms", "host_id");
  if (await othersIn("p2p_break_room_participants", "room_id", roomIds)) return true;

  return false;
}

// POST /account/delete — deletes the CALLER's own profile row and auth user.
// Identity comes only from the verified Supabase session (verifyCaller, the
// same mechanism contact.ts/circles.ts/calls.ts use). A userId in the body is
// tolerated for older app builds but must match the caller — it never
// decides whose account is deleted.
router.post("/delete", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return res.status(401).json({ error: "Unauthorized" });

  const { userId } = (req.body ?? {}) as { userId?: string };
  // Same response whether or not that other id exists — reveals nothing.
  if (userId !== undefined && userId !== callerId) return res.status(403).json({ error: "Forbidden" });

  try {
    const { data: profile, error: profileErr } = await supabaseWrite
      .from("p2p_profiles").select("is_official_account, admin_is_active").eq("id", callerId).maybeSingle();
    if (profileErr) precheckFailed("p2p_profiles");

    let blocked = !!(profile?.is_official_account || profile?.admin_is_active) || (await ownsSharedGroup(callerId));
    for (const c of SHARED_DATA_CHECKS) {
      if (blocked) break;
      blocked = await hasRows(c.table, c.column, callerId);
    }
    if (blocked) {
      return res.status(409).json({
        error: "Your account is connected to other people's records (such as a family, circle, calls or shared growth records), so it can't be deleted automatically yet. Please contact P2P Support and we'll help you.",
        code: "DELETION_REQUIRES_SUPPORT",
      });
    }
  } catch {
    return res.status(500).json({ error: "Couldn't verify your account for deletion. Please try again later." });
  }

  // Stop if the profile delete fails, instead of carrying on to delete the
  // login and leaving another half-deleted account behind.
  const { error: profileDeleteErr } = await supabaseWrite.from("p2p_profiles").delete().eq("id", callerId);
  if (profileDeleteErr) return res.status(500).json({ error: "Couldn't delete your account. Please try again later." });

  const { error } = await supabaseWrite.auth.admin.deleteUser(callerId);
  if (error) return res.status(500).json({ error: "Couldn't delete your account. Please try again later." });
  return res.json({ deleted: true });
});

// ── Account status & reversible deactivation ("take a break") ──────────────
// Deactivation never deletes or moves anything: it records a status row
// (migration 173) that the app reads to show the "taking a break" screen,
// and that the push dispatcher and pastoral-care scan read to stay quiet.
// Progress, memberships, leadership, messages, calls history, push tokens
// and storage are all left exactly as they are.

const HOUR_MS = 60 * 60 * 1000;
// Calls/sessions whose rows were never closed (crashed clients) exist in
// production, so only recent activity counts as "in a call right now".
const RECENT_CALL_MS = 4 * HOUR_MS;
const RECENT_RING_MS = 2 * 60 * 1000;
const RECENT_SESSION_MS = 6 * HOUR_MS;
const MIN_BREAK_MS = HOUR_MS;
const STAFF_ROLES = new Set(["super_admin", "regional_admin", "moderator"]);
const MAX_BREAK_MS = 366 * 24 * HOUR_MS;

function statusPayload(row: AccountStatusRow | null) {
  const deactivated = isEffectivelyDeactivated(row);
  return {
    status: deactivated ? "deactivated" : "active",
    deactivatedAt: deactivated ? row!.deactivated_at : null,
    deactivatedUntil: deactivated ? row!.deactivated_until : null,
  };
}

// Same rule as /account/delete: identity only from the verified session; a
// body userId is tolerated but must be the caller's own.
async function callerOrReject(req: import("express").Request, res: import("express").Response): Promise<string | null> {
  const callerId = await verifyCaller(req);
  if (!callerId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const { userId } = (req.body ?? {}) as { userId?: string };
  if (userId !== undefined && userId !== callerId) { res.status(403).json({ error: "Forbidden" }); return null; }
  return callerId;
}

async function countRecent(table: string, build: (q: any) => any): Promise<number> {
  const { count, error } = await build(supabaseWrite.from(table).select("id", { count: "exact", head: true }));
  if (error) precheckFailed(table);
  return count ?? 0;
}

// Read-only. Uses the call/session tables exactly as the call routes do;
// nothing in the call architecture is touched.
async function inLiveCallOrSession(userId: string): Promise<boolean> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  // 1:1 calls: a call log stays "initiated" until /calls/end settles it.
  if (await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(RECENT_CALL_MS)).eq("initiated_by", userId))) return true;
  if (await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(RECENT_CALL_MS)).contains("participants", JSON.stringify([userId])))) return true;
  // A call currently ringing to or from them.
  if (await countRecent("p2p_incoming_calls", (q) => q.eq("status", "ringing").gte("created_at", since(RECENT_RING_MS)).or(`caller_id.eq.${userId},recipient_id.eq.${userId}`))) return true;
  // Family worship / Study Together, Break Rooms, church calls: joined and not left.
  for (const table of ["p2p_family_worship_participants", "p2p_break_room_participants", "p2p_church_call_participants"]) {
    if (await countRecent(table, (q) => q.eq("user_id", userId).is("left_at", null).gte("joined_at", since(RECENT_SESSION_MS)))) return true;
  }
  // Circle group calls keep no per-person "joined" record, so a live call in
  // any circle they belong to or lead counts (conservative).
  const { data: memberRows, error: mErr } = await supabaseWrite.from("p2p_peer_circle_members").select("circle_id").eq("user_id", userId);
  if (mErr) precheckFailed("p2p_peer_circle_members");
  const { data: ledRows, error: lErr } = await supabaseWrite.from("p2p_peer_circles").select("id").eq("leader_id", userId);
  if (lErr) precheckFailed("p2p_peer_circles");
  const circleIds = [...new Set([...(memberRows ?? []).map((r) => r.circle_id as string), ...(ledRows ?? []).map((r) => r.id as string)])];
  if (circleIds.length && await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(RECENT_CALL_MS)).in("circle_id", circleIds))) return true;
  return false;
}

// Leading a family/circle that other people are in: a break would leave them
// without their Shepherd/leader, and Stage 1 deliberately doesn't hand
// leadership over automatically — so it's refused with a clear reason.
async function leadsGroupWithOthers(userId: string): Promise<boolean> {
  const { data: fams, error: fErr } = await supabaseWrite.from("p2p_families").select("id").eq("shepherd_id", userId);
  if (fErr) precheckFailed("p2p_families");
  const famIds = (fams ?? []).map((f) => f.id as string);
  if (famIds.length && await countRecent("p2p_family_members", (q) => q.in("family_id", famIds).neq("user_id", userId).eq("status", "active"))) return true;
  const { data: circles, error: cErr } = await supabaseWrite.from("p2p_peer_circles").select("id").eq("leader_id", userId);
  if (cErr) precheckFailed("p2p_peer_circles");
  const circleIds = (circles ?? []).map((c) => c.id as string);
  if (circleIds.length && await countRecent("p2p_peer_circle_members", (q) => q.in("circle_id", circleIds).neq("user_id", userId).eq("status", "active"))) return true;
  return false;
}

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
    // Staff accounts (official accounts and admin roles) keep departments and
    // moderation staffed, so they can't pause themselves here. Note:
    // admin_is_active defaults to true on every profile, so it is not an
    // "is admin" flag — the role is.
    const { data: profile, error: pErr } = await supabaseWrite
      .from("p2p_profiles").select("is_official_account, role").eq("id", callerId).maybeSingle();
    if (pErr) precheckFailed("p2p_profiles");
    const role = String(profile?.role ?? "");
    if (profile?.is_official_account || STAFF_ROLES.has(role) || role.startsWith("admin_")) {
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
    .select("user_id, status, deactivated_at, deactivated_until, reactivated_at")
    .single();
  if (error) return res.status(500).json({ error: "Couldn't pause your account. Please try again later." });
  return res.json(statusPayload(data as AccountStatusRow));
});

// POST /account/reactivate — ends a break. Idempotent: an active account
// stays active.
router.post("/reactivate", async (req, res) => {
  const callerId = await callerOrReject(req, res);
  if (!callerId) return;
  try {
    const current = await getAccountStatus(callerId);
    if (!current || current.status === "active") return res.json(statusPayload(current));
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
    .select("user_id, status, deactivated_at, deactivated_until, reactivated_at")
    .single();
  if (error) return res.status(500).json({ error: "Couldn't reactivate your account. Please try again later." });
  return res.json(statusPayload(data as AccountStatusRow));
});

export default router;
