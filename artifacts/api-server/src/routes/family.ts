import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const MANAGED_ROLES = ["co_shepherd", "adult", "teen", "child"] as const;

function mapFamily(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, shepherdId: row.shepherd_id, createdAt: row.created_at };
}

function mapMember(row: Record<string, unknown>, profile?: { full_name: string; photo_url: string | null; username: string | null }) {
  return {
    id: row.id, familyId: row.family_id, userId: row.user_id, role: row.role, status: row.status,
    joinedAt: row.joined_at, name: profile?.full_name ?? "Family member", avatarUrl: profile?.photo_url ?? null,
    username: profile?.username ?? null,
  };
}

async function getActiveMembership(userId: string) {
  const { data } = await db.from("p2p_family_members").select("*").eq("user_id", userId).eq("status", "active").maybeSingle();
  return data as Record<string, unknown> | null;
}

async function isShepherdOrCoShepherd(familyId: string, userId: string): Promise<boolean> {
  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", familyId).maybeSingle();
  if (family?.shepherd_id === userId) return true;
  const { data: member } = await db
    .from("p2p_family_members").select("role").eq("family_id", familyId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return member?.role === "co_shepherd";
}

// GET /family/mine — the caller's family (roster + pending invitations they
// can act on), or null with any invitations awaiting their own response.
router.get("/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const membership = await getActiveMembership(userId);
  const { data: myInvitations } = await db
    .from("p2p_family_invitations").select("*").eq("invited_user_id", userId).eq("status", "pending");

  if (!membership) {
    return ok(res, { family: null, members: [], myRole: null, pendingInvitations: myInvitations ?? [] });
  }

  const familyId = membership.family_id as string;
  const { data: family } = await db.from("p2p_families").select("*").eq("id", familyId).maybeSingle();
  if (!family) return err(res, "Family not found", 404);

  const { data: members } = await db
    .from("p2p_family_members").select("*").eq("family_id", familyId).eq("status", "active").order("joined_at", { ascending: true });
  const userIds = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = userIds.length
    ? await db.from("p2p_profiles").select("id,full_name,photo_url,username").in("id", userIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null; username: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const canManage = await isShepherdOrCoShepherd(familyId, userId);
  const { data: pendingRosterInvitations } = canManage
    ? await db.from("p2p_family_invitations").select("*").eq("family_id", familyId).eq("status", "pending")
    : { data: [] as Record<string, unknown>[] };

  return ok(res, {
    family: mapFamily(family as Record<string, unknown>),
    members: (members ?? []).map((m) => mapMember(m as Record<string, unknown>, profileById.get(m.user_id as string))),
    myRole: membership.role,
    canManage,
    pendingInvitations: canManage ? pendingRosterInvitations : (myInvitations ?? []),
  });
});

// POST /family — create a new family. The creator becomes shepherd + first member.
router.post("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { name } = req.body as { name?: string };
  if (!name?.trim()) return err(res, "name is required");

  const existing = await getActiveMembership(userId);
  if (existing) return err(res, "You already belong to a family", 409);

  const { data: family, error } = await db.from("p2p_families").insert({ name: name.trim(), shepherd_id: userId }).select().single();
  if (error || !family) return err(res, error?.message ?? "Failed to create family", 500);

  const { error: memberError } = await db
    .from("p2p_family_members").insert({ family_id: family.id, user_id: userId, role: "shepherd", status: "active" });
  if (memberError) return err(res, memberError.message, 500);

  return ok(res, mapFamily(family as Record<string, unknown>));
});

// POST /family/:familyId/invite — { username, role } — shepherd/co_shepherd only.
router.post("/:familyId/invite", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const { username, role } = req.body as { username?: string; role?: string };
  if (!username?.trim()) return err(res, "username is required");
  const invitedRole = MANAGED_ROLES.includes(role as (typeof MANAGED_ROLES)[number]) ? role! : "adult";

  if (!(await isShepherdOrCoShepherd(familyId, userId))) {
    return err(res, "Only the Family Shepherd or a Co-Shepherd can send invitations", 403);
  }

  const { data: targetProfile } = await db
    .from("p2p_profiles").select("id,full_name").ilike("username", username.trim().replace(/^@/, "")).maybeSingle();
  if (!targetProfile) return err(res, `No account found for @${username}`, 404);

  const existingMembership = await getActiveMembership(targetProfile.id as string);
  if (existingMembership) return err(res, `${targetProfile.full_name} already belongs to a family`, 409);

  const { data: family } = await db.from("p2p_families").select("name").eq("id", familyId).maybeSingle();
  const { data: invitation, error } = await db
    .from("p2p_family_invitations")
    .upsert(
      { family_id: familyId, invited_by: userId, invited_user_id: targetProfile.id, role: invitedRole, status: "pending", responded_at: null },
      { onConflict: "family_id,invited_user_id" }
    )
    .select().single();
  if (error) return err(res, error.message, 500);

  await db.from("p2p_notifications").insert({
    user_id: targetProfile.id,
    title: "Family invitation",
    message: `You've been invited to join ${(family?.name as string) ?? "a family"} on P2P Global.`,
    notification_type: "family_invitation",
    data: { familyId, invitationId: invitation.id },
  });

  return ok(res, { id: invitation.id, status: invitation.status });
});

// POST /family/invitations/:invitationId/respond — { action: 'accept'|'decline' }
router.post("/invitations/:invitationId/respond", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { invitationId } = req.params;
  const { action } = req.body as { action?: "accept" | "decline" };
  if (action !== "accept" && action !== "decline") return err(res, "action must be 'accept' or 'decline'");

  const { data: invitation } = await db.from("p2p_family_invitations").select("*").eq("id", invitationId).maybeSingle();
  if (!invitation) return err(res, "Invitation not found", 404);
  if (invitation.invited_user_id !== userId) return err(res, "This invitation isn't yours to respond to", 403);
  if (invitation.status !== "pending") return err(res, "This invitation has already been responded to", 409);

  if (action === "accept") {
    const existing = await getActiveMembership(userId);
    if (existing) return err(res, "You already belong to a family — leave it before accepting a new invitation", 409);

    const { error: memberError } = await db.from("p2p_family_members").upsert(
      { family_id: invitation.family_id, user_id: userId, role: invitation.role, status: "active", joined_at: new Date().toISOString() },
      { onConflict: "family_id,user_id" }
    );
    // The partial unique index (one active family per user) is the hard
    // backstop against a race between the check above and this write —
    // surface it as a normal conflict, not a 500.
    if (memberError) return err(res, "You already belong to a family", 409);
  }

  await db.from("p2p_family_invitations")
    .update({ status: action === "accept" ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .eq("id", invitationId);

  return ok(res, { status: action === "accept" ? "accepted" : "declined" });
});

// PUT /family/:familyId/members/:userId/role — shepherd-only.
router.put("/:familyId/members/:userId/role", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return err(res, "Unauthorized", 401);
  const { familyId, userId } = req.params;
  const { role } = req.body as { role?: string };
  if (!role || !MANAGED_ROLES.includes(role as (typeof MANAGED_ROLES)[number])) {
    return err(res, `role must be one of: ${MANAGED_ROLES.join(", ")}`);
  }

  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", familyId).maybeSingle();
  if (!family) return err(res, "Family not found", 404);
  if (family.shepherd_id !== callerId) return err(res, "Only the Family Shepherd can change member roles", 403);
  if (userId === family.shepherd_id) return err(res, "The Family Shepherd's own role can't be changed here", 400);

  const { error } = await db.from("p2p_family_members").update({ role }).eq("family_id", familyId).eq("user_id", userId).eq("status", "active");
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true, role });
});

// DELETE /family/:familyId/members/:userId — a member leaves on their own,
// or the Shepherd/Co-Shepherd removes someone. The Shepherd can't remove
// themselves this way (no transfer-shepherd flow exists yet, so that would
// orphan the family).
router.delete("/:familyId/members/:userId", async (req, res) => {
  const callerId = await verifyCaller(req);
  if (!callerId) return err(res, "Unauthorized", 401);
  const { familyId, userId } = req.params;

  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", familyId).maybeSingle();
  if (!family) return err(res, "Family not found", 404);
  if (userId === family.shepherd_id) return err(res, "The Family Shepherd can't be removed", 400);

  const isSelf = callerId === userId;
  if (!isSelf && !(await isShepherdOrCoShepherd(familyId, callerId))) {
    return err(res, "Only the Family Shepherd or a Co-Shepherd can remove another member", 403);
  }

  const { error } = await db.from("p2p_family_members").update({ status: "left" }).eq("family_id", familyId).eq("user_id", userId).eq("status", "active");
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// GET /family/:familyId/prayer-requests — shared ('family') requests plus
// the caller's own private ones. A private request from someone else never
// appears here — enforced by the query shape, not just RLS, so it can't
// accidentally leak even if a future caller forgets the visibility filter.
router.get("/:familyId/prayer-requests", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const membership = await getActiveMembership(userId);
  if (membership?.family_id !== familyId) return err(res, "You're not a member of this family", 403);

  const { data, error } = await db
    .from("p2p_family_prayer_requests").select("*").eq("family_id", familyId)
    .or(`visibility.eq.family,user_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, data ?? []);
});

// POST /family/:familyId/prayer-requests — { content, visibility }
router.post("/:familyId/prayer-requests", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const { content, visibility } = req.body as { content?: string; visibility?: "private" | "family" };
  if (!content?.trim()) return err(res, "content is required");

  const membership = await getActiveMembership(userId);
  if (membership?.family_id !== familyId) return err(res, "You're not a member of this family", 403);

  const { data, error } = await db.from("p2p_family_prayer_requests").insert({
    family_id: familyId, user_id: userId, content: content.trim(), visibility: visibility === "private" ? "private" : "family",
  }).select().single();
  if (error) return err(res, error.message, 500);
  return ok(res, data);
});

// PUT /family/:familyId/prayer-requests/:id/status — { status: 'prayed'|'answered' }.
// Any active family member can mark a shared request 'prayed'; only the
// request's own author can declare it 'answered' (avoids one member
// speaking for another's answered prayer).
router.put("/:familyId/prayer-requests/:id/status", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId, id } = req.params;
  const { status } = req.body as { status?: "prayed" | "answered" };
  if (status !== "prayed" && status !== "answered") return err(res, "status must be 'prayed' or 'answered'");

  const { data: request } = await db.from("p2p_family_prayer_requests").select("*").eq("id", id).eq("family_id", familyId).maybeSingle();
  if (!request) return err(res, "Prayer request not found", 404);
  if (status === "answered" && request.user_id !== userId) return err(res, "Only the person who shared this request can mark it answered", 403);
  if (status === "prayed") {
    const membership = await getActiveMembership(userId);
    if (membership?.family_id !== familyId) return err(res, "You're not a member of this family", 403);
  }

  const { error } = await db.from("p2p_family_prayer_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true, status });
});

export default router;