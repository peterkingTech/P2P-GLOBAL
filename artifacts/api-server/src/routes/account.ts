import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";

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

export default router;
