import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const MANAGED_ROLES = ["co_shepherd", "adult", "teen", "child"] as const;

function mapFamily(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, shepherdId: row.shepherd_id, createdAt: row.created_at,
    // Custom Study Plans — study_source/active_study_plan_id (migration 137)
    // default to 'p2p_curriculum'/null for every existing family; only
    // PUT /family/:familyId/study-source (routes/familyStudyPlans.ts) ever
    // changes them.
    studySource: row.study_source ?? "p2p_curriculum",
    activeStudyPlanId: row.active_study_plan_id ?? null,
  };
}

function mapMember(row: Record<string, unknown>, profile?: { full_name: string; photo_url: string | null; username: string | null }) {
  return {
    id: row.id, familyId: row.family_id, userId: row.user_id, role: row.role, status: row.status,
    joinedAt: row.joined_at, name: profile?.full_name ?? "Family member", avatarUrl: profile?.photo_url ?? null,
    username: profile?.username ?? null,
  };
}

// A user may belong to many families at once (migration 126) — this
// returns ALL of the caller's active memberships, never just one.
async function getActiveMemberships(userId: string) {
  const { data } = await db.from("p2p_family_members").select("*").eq("user_id", userId).eq("status", "active");
  return (data ?? []) as Record<string, unknown>[];
}

// The family-scoped membership check every family-specific route should
// use: "is this user an active member of THIS SPECIFIC family" — never
// "what is the user's one family," which stopped being a meaningful
// question once multi-family membership shipped.
async function getMembership(userId: string, familyId: string) {
  const { data } = await db
    .from("p2p_family_members").select("*").eq("user_id", userId).eq("family_id", familyId).eq("status", "active").maybeSingle();
  return data as Record<string, unknown> | null;
}

async function isShepherdOrCoShepherd(familyId: string, userId: string): Promise<boolean> {
  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", familyId).maybeSingle();
  if (family?.shepherd_id === userId) return true;
  const { data: member } = await db
    .from("p2p_family_members").select("role").eq("family_id", familyId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return member?.role === "co_shepherd";
}

// GET /family/mine — every family the caller actively belongs to (a
// summary per family, not each family's full roster — see GET /:familyId
// for that), plus any invitations awaiting the caller's own response.
// "My Family" now represents the user's family relationships, plural.
router.get("/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const memberships = await getActiveMemberships(userId);
  const { data: myInvitations } = await db
    .from("p2p_family_invitations").select("*").eq("invited_user_id", userId).eq("status", "pending");

  if (memberships.length === 0) {
    return ok(res, { families: [], pendingInvitations: myInvitations ?? [] });
  }

  const familyIds = memberships.map((m) => m.family_id as string);
  const { data: families } = await db.from("p2p_families").select("*").in("id", familyIds);
  const familyById = new Map((families ?? []).map((f) => [f.id as string, f]));

  // One cheap count query per family for the summary card — this list is
  // never large enough (a person's own families) to warrant batching this
  // into a single grouped query.
  const summaries = await Promise.all(
    memberships.map(async (m) => {
      const familyId = m.family_id as string;
      const family = familyById.get(familyId);
      if (!family) return null;
      const { count } = await db
        .from("p2p_family_members").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("status", "active");
      return {
        family: mapFamily(family as Record<string, unknown>),
        myRole: m.role,
        memberCount: count ?? 0,
      };
    })
  );

  return ok(res, {
    families: summaries.filter((s): s is NonNullable<typeof s> => s !== null),
    pendingInvitations: myInvitations ?? [],
  });
});

// GET /family/:familyId — one specific family's full detail: roster,
// caller's role in THIS family, and (if the caller can manage it) the
// roster invitations awaiting response. This is the family-scoped read
// every per-family screen (Members, Prayer, Family Media) should use
// instead of assuming "my one family" — a caller who belongs to several
// families asks for each one explicitly, by id.
router.get("/:familyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;

  const membership = await getMembership(userId, familyId);
  if (!membership) return err(res, "You're not a member of this Family Gathering", 403);

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

  // At most one non-ended session per family (idx_p2p_family_worship_sessions_one_live_per_family),
  // so this is a cheap, indexed lookup — lets the client say "Join Family Gathering" instead of
  // "Start Gathering" when one is already in progress, without a second screen-load round trip.
  const { data: activeSession } = await db
    .from("p2p_family_worship_sessions").select("id").eq("family_id", familyId).neq("status", "ended").maybeSingle();

  return ok(res, {
    family: mapFamily(family as Record<string, unknown>),
    members: (members ?? []).map((m) => mapMember(m as Record<string, unknown>, profileById.get(m.user_id as string))),
    myRole: membership.role,
    canManage,
    pendingInvitations: pendingRosterInvitations ?? [],
    activeSessionId: activeSession?.id ?? null,
  });
});

// POST /family — create a new family. The creator becomes shepherd + first member.
router.post("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { name } = req.body as { name?: string };
  if (!name?.trim()) return err(res, "name is required");

  // A user may belong to (and lead) multiple families — no longer blocked
  // by any existing membership elsewhere (migration 126).
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

  // Only block a duplicate invite into THIS SAME family — belonging to any
  // other family is no longer a reason to reject (migration 126). The
  // upsert below on (family_id, invited_user_id) would silently resend a
  // pending invite anyway, but an already-active membership in this exact
  // family deserves a clear message rather than a resent invite.
  const existingMembership = await getMembership(targetProfile.id as string, familyId);
  if (existingMembership) return err(res, `${targetProfile.full_name} is already a member of this family`, 409);

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
    // Accepting adds this family alongside any others the user already
    // belongs to — no longer blocked by, and never replaces, an existing
    // membership elsewhere (migration 126). unique(family_id, user_id) is
    // still the hard backstop against a double-accept race into this SAME
    // family (e.g. two concurrent taps) — surfaced as a normal conflict.
    const { error: memberError } = await db.from("p2p_family_members").upsert(
      { family_id: invitation.family_id, user_id: userId, role: invitation.role, status: "active", joined_at: new Date().toISOString() },
      { onConflict: "family_id,user_id" }
    );
    if (memberError) return err(res, "Couldn't join this family", 409);
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
  if (!(await getMembership(userId, familyId))) return err(res, "You're not a member of this Family Gathering", 403);

  const { data, error } = await db
    .from("p2p_family_prayer_requests").select("*").eq("family_id", familyId)
    .or(`visibility.eq.family,user_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, data ?? []);
});

// POST /family/:familyId/prayer-requests — { content, visibility, scriptureReference? }
// scriptureReference is the same structured {translation, book, chapter,
// startVerse, endVerse} shape used by p2p_family_worship_sessions'
// current_scripture — never a second copy of translation text.
router.post("/:familyId/prayer-requests", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const { content, visibility, scriptureReference } = req.body as {
    content?: string; visibility?: "private" | "family";
    scriptureReference?: { translation?: string; book?: string; chapter?: number; startVerse?: number; endVerse?: number } | null;
  };
  if (!content?.trim()) return err(res, "content is required");
  if (scriptureReference && (!scriptureReference.book || !scriptureReference.chapter || !scriptureReference.translation)) {
    return err(res, "scriptureReference requires book, chapter, and translation");
  }

  if (!(await getMembership(userId, familyId))) return err(res, "You're not a member of this Family Gathering", 403);

  const { data, error } = await db.from("p2p_family_prayer_requests").insert({
    family_id: familyId, user_id: userId, content: content.trim(), visibility: visibility === "private" ? "private" : "family",
    scripture_reference: scriptureReference ?? null,
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
    if (!(await getMembership(userId, familyId))) return err(res, "You're not a member of this Family Gathering", 403);
  }

  const { error } = await db.from("p2p_family_prayer_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true, status });
});

export default router;