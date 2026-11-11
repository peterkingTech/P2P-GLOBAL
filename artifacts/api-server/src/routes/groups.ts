// Private groups and Communities (migration 245). Every operation is checked here (the community,
// invitation and link tables are API-only); group chat itself is an ordinary group conversation, so the
// database's membership rule (RLS) guards reading and posting, and its posting trigger enforces
// "admins only" and closed groups.
//   • Groups are private: only members see they exist. Nothing here lists a group to a non-member.
//   • A community's members are NOT members of its groups; each group keeps its own members.
//   • Family and Church appear as communities built from their existing records (no copies).
//
//   GET    /groups                         my groups + my communities (incl. Family/Church spaces)
//   POST   /groups                         { name, description?, communityId?, memberIds?, posting? }
//   GET    /groups/:id                     details (members only)
//   PATCH  /groups/:id                     admin: { name?, description?, photoUrl?, posting?, archived? }
//   POST   /groups/:id/members             admin: { userIds[] } (added now)
//   DELETE /groups/:id/members/:userId     admin removes · or yourself (leave)
//   POST   /groups/:id/admins              admin: { userId, admin }
//   POST   /groups/:id/invitations         admin: { userIds[] } → pending invitations
//   GET    /groups/invitations             my pending invitations (groups and communities)
//   POST   /groups/invitations/:id         { accept }
//   POST   /groups/:id/links · GET /groups/:id/links · DELETE /groups/:id/links/:linkId   (admin)
//   POST   /groups/join                    { token } (approval when the link asks for it)
//   GET    /groups/:id/requests · POST /groups/:id/requests/:requestId { approve }        (admin)
//   POST   /groups/communities             { name, description?, memberIds?, announcements? }
//   GET    /groups/communities/:id         members only
//   PATCH  /groups/communities/:id         admin: { name?, description?, photoUrl?, archived? }
//   POST   /groups/communities/:id/members · DELETE /groups/communities/:id/members/:userId
//   POST   /groups/communities/:id/admins  owner/admin: { userId, admin }
// Community invitations and links use the same endpoints with ?type=community.
import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { dispatchNotificationNow } from "../lib/pushDispatch";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEMBERS_PER_CALL = 100;
class GroupError extends Error { constructor(message: string, public status = 400) { super(message); } }
const ok = (res: Response, data: unknown) => res.json(data);
const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });
const fail = (res: Response, e: unknown) => (e instanceof GroupError ? err(res, e.message, e.status) : err(res, "That didn't work. Please try again.", 500));
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, MAX_MEMBERS_PER_CALL);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const NOT_FOUND = () => new GroupError("This group isn't available.", 404);

async function caller(req: Request, res: Response): Promise<string | null> {
  const id = await verifyCaller(req);
  if (!id) { err(res, "Please sign in.", 401); return null; }
  return id;
}
const event = (target_type: "group" | "community", target_id: string, actor_id: string, ev: string, subject_id: string | null = null, detail: Record<string, unknown> = {}) =>
  db.from("p2p_group_events").insert({ target_type, target_id, actor_id, subject_id, event: ev, detail });
async function notify(userIds: string[], title: string, message: string, type: string, data: Record<string, unknown>) {
  if (!userIds.length) return;
  const { data: rows } = await db.from("p2p_notifications").insert(userIds.map((u) => ({ user_id: u, title, message, notification_type: type, data }))).select("id");
  for (const n of (rows ?? []) as { id: string }[]) void dispatchNotificationNow(n.id).catch(() => {});
}
async function profilesExist(userIds: string[]) {
  if (!userIds.length) return;
  const rows = must(await db.from("p2p_profiles").select("id").in("id", userIds)) as { id: string }[];
  if (rows.length !== userIds.length) throw new GroupError("One of these people isn't a P2P participant.");
}
/** People who blocked the caller (or whom the caller blocked) can't be added or invited by them. */
async function blockedWith(userId: string): Promise<Set<string>> {
  const b = must(await db.from("p2p_user_blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)) as { blocker_id: string; blocked_id: string }[];
  return new Set(b.map((x) => (x.blocker_id === userId ? x.blocked_id : x.blocker_id)));
}

// ── Groups ─────────────────────────────────────────────────────────────────
type Group = { id: string; name: string | null; description: string | null; photo_url: string | null; community_id: string | null; created_by: string | null; created_at: string; archived_at: string | null; posting: string; is_announcements: boolean; conversation_type: string };
async function groupFor(id: string, userId: string): Promise<{ g: Group; role: "admin" | "member" }> {
  if (!UUID.test(id)) throw NOT_FOUND();
  const [g, m] = await Promise.all([
    db.from("p2p_conversations").select("id,name,description,photo_url,community_id,created_by,created_at,archived_at,posting,is_announcements,conversation_type").eq("id", id).eq("conversation_type", "private_group").maybeSingle(),
    db.from("p2p_conversation_members").select("role").eq("conversation_id", id).eq("user_id", userId).maybeSingle(),
  ]);
  // Not a member → exactly the same answer as "no such group" (nothing about it is revealed).
  if (!g.data || !m.data) throw NOT_FOUND();
  return { g: g.data as Group, role: (m.data as { role: string }).role === "admin" ? "admin" : "member" };
}
async function adminOf(id: string, userId: string) {
  const r = await groupFor(id, userId);
  if (r.role !== "admin") throw new GroupError("Only group administrators can do that.", 403);
  return r;
}
async function addGroupMembers(groupId: string, actor: string, userIds: string[], role: "admin" | "member" = "member") {
  if (!userIds.length) return [];
  const existing = new Set(((must(await db.from("p2p_conversation_members").select("user_id").eq("conversation_id", groupId).in("user_id", userIds)) as { user_id: string }[])).map((r) => r.user_id));
  const fresh = userIds.filter((u) => !existing.has(u));
  if (fresh.length) must(await db.from("p2p_conversation_members").insert(fresh.map((u) => ({ conversation_id: groupId, user_id: u, role }))));
  for (const u of fresh) await event("group", groupId, actor, "member_added", u);
  return fresh;
}

router.get("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const mine = must(await db.from("p2p_conversation_members").select("conversation_id,role").eq("user_id", userId)) as { conversation_id: string; role: string }[];
    const convIds = mine.map((m) => m.conversation_id);
    const convs = convIds.length ? (must(await db.from("p2p_conversations").select("id,name,description,photo_url,community_id,conversation_type,archived_at,posting,is_announcements,family_id,church_id,circle_id,type").in("id", convIds).eq("type", "group")) as Record<string, any>[]) : [];
    const roleOf = new Map(mine.map((m) => [m.conversation_id, m.role]));
    const counts = convs.length ? ((must(await db.from("p2p_conversation_members").select("conversation_id").in("conversation_id", convs.map((c) => c.id))) as { conversation_id: string }[])) : [];
    const memberCount = new Map<string, number>(); for (const c of counts) memberCount.set(c.conversation_id, (memberCount.get(c.conversation_id) ?? 0) + 1);
    const groups = convs.map((c) => ({ id: c.id, name: c.name, description: c.description, photoUrl: c.photo_url, kind: c.conversation_type, communityId: c.community_id,
      familyId: c.family_id, churchId: c.church_id, isAnnouncements: !!c.is_announcements, posting: c.posting, archived: !!c.archived_at, myRole: roleOf.get(c.id) ?? "member", members: memberCount.get(c.id) ?? 0 }));
    // Communities: created ones, plus Family and Church presented from their own records.
    const cm = must(await db.from("p2p_community_members").select("community_id,role").eq("user_id", userId)) as { community_id: string; role: string }[];
    const comms = cm.length ? (must(await db.from("p2p_communities").select("id,name,description,photo_url,archived_at").in("id", cm.map((x) => x.community_id))) as Record<string, any>[]) : [];
    const communities = comms.map((c) => ({ id: c.id, kind: "community", name: c.name, description: c.description, photoUrl: c.photo_url, archived: !!c.archived_at,
      myRole: cm.find((x) => x.community_id === c.id)?.role ?? "member", groupIds: groups.filter((g) => g.communityId === c.id).map((g) => g.id) }));
    const fams = must(await db.from("p2p_family_members").select("family_id,role,status").eq("user_id", userId).eq("status", "active")) as { family_id: string; role: string }[];
    const famRows = fams.length ? (must(await db.from("p2p_families").select("id,name").in("id", fams.map((f) => f.family_id))) as { id: string; name: string | null }[]) : [];
    for (const f of famRows) communities.push({ id: f.id, kind: "family", name: f.name || "My Family", description: null, photoUrl: null, archived: false,
      myRole: fams.find((x) => x.family_id === f.id)?.role === "shepherd" ? "admin" : "member", groupIds: groups.filter((g) => g.familyId === f.id).map((g) => g.id) });
    const chs = must(await db.from("p2p_church_members").select("church_id,role").eq("user_id", userId).eq("is_active", true)) as { church_id: string; role: string }[];
    const chRows = chs.length ? (must(await db.from("p2p_churches").select("id,name,logo_url").in("id", chs.map((x) => x.church_id))) as { id: string; name: string; logo_url: string | null }[]) : [];
    for (const ch of chRows) communities.push({ id: ch.id, kind: "church", name: ch.name, description: null, photoUrl: ch.logo_url, archived: false,
      myRole: ["senior_pastor", "discipleship_pastor", "small_group_leader"].includes(chs.find((x) => x.church_id === ch.id)?.role ?? "") ? "admin" : "member", groupIds: groups.filter((g) => g.churchId === ch.id).map((g) => g.id) });
    return ok(res, { groups, communities });
  } catch (e) { return fail(res, e); }
});

router.post("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = req.body ?? {};
    const name = text(b.name, 80);
    if (!name) throw new GroupError("Give the group a name.");
    const communityId = typeof b.communityId === "string" && UUID.test(b.communityId) ? b.communityId : null;
    let members = ids(b.memberIds).filter((u) => u !== userId);
    if (communityId) {
      const role = await communityRole(communityId, userId);
      if (role !== "owner" && role !== "admin") throw new GroupError("Only community administrators can create its groups.", 403);
      // A community's group can only hold that community's members.
      const inCommunity = new Set(((must(await db.from("p2p_community_members").select("user_id").eq("community_id", communityId)) as { user_id: string }[])).map((r) => r.user_id));
      if (members.some((u) => !inCommunity.has(u))) throw new GroupError("Add people to the community first.", 403);
    }
    await profilesExist(members);
    const blocked = await blockedWith(userId);
    members = members.filter((u) => !blocked.has(u));
    const g = must(await db.from("p2p_conversations").insert({ type: "group", conversation_type: "private_group", name, description: text(b.description, 1000) || null,
      created_by: userId, community_id: communityId, posting: b.posting === "admins" ? "admins" : "everyone", is_announcements: b.isAnnouncements === true && !!communityId }).select("id").single()) as { id: string };
    must(await db.from("p2p_conversation_members").insert({ conversation_id: g.id, user_id: userId, role: "admin" }));
    await event("group", g.id, userId, "created", null, { communityId });
    const added = await addGroupMembers(g.id, userId, members);
    await notify(added, "You were added to a group", name, "group_added", { kind: "group", conversationId: g.id });
    return ok(res, { id: g.id, added: added.length });
  } catch (e) { return fail(res, e); }
});

router.get("/invitations", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const inv = must(await db.from("p2p_group_invitations").select("id,target_type,target_id,invited_by,created_at").eq("invited_user_id", userId).eq("status", "pending").order("created_at", { ascending: false })) as Record<string, any>[];
    const gIds = inv.filter((i) => i.target_type === "group").map((i) => i.target_id), cIds = inv.filter((i) => i.target_type === "community").map((i) => i.target_id);
    const [gs, cs, who] = await Promise.all([
      gIds.length ? db.from("p2p_conversations").select("id,name,description").in("id", gIds) : Promise.resolve({ data: [] }),
      cIds.length ? db.from("p2p_communities").select("id,name,description").in("id", cIds) : Promise.resolve({ data: [] }),
      db.from("p2p_profiles").select("id,full_name").in("id", [...new Set(inv.map((i) => i.invited_by))]),
    ]);
    const nameOf = new Map([...(gs.data ?? []), ...(cs.data ?? [])].map((x: any) => [x.id, x]));
    const by = new Map(((who.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "P2P participant"]));
    // An invitee may see the name and description of what they were invited to — nothing else.
    return ok(res, { invitations: inv.map((i) => ({ id: i.id, type: i.target_type, targetId: i.target_id, name: (nameOf.get(i.target_id) as any)?.name ?? null,
      description: (nameOf.get(i.target_id) as any)?.description ?? null, invitedBy: by.get(i.invited_by) ?? "P2P participant", createdAt: i.created_at })) });
  } catch (e) { return fail(res, e); }
});

router.post("/invitations/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!UUID.test(req.params.id)) throw new GroupError("This invitation isn't available.", 404);
    const inv = must(await db.from("p2p_group_invitations").select("*").eq("id", req.params.id).eq("invited_user_id", userId).eq("status", "pending").maybeSingle()) as Record<string, any> | null;
    if (!inv) throw new GroupError("This invitation isn't available.", 404);
    const accept = req.body?.accept === true;
    if (accept) {
      // Still valid? (the group/community may have been closed, or the inviter lost their role)
      if (inv.target_type === "group") {
        const g = must(await db.from("p2p_conversations").select("archived_at").eq("id", inv.target_id).maybeSingle()) as { archived_at: string | null } | null;
        if (!g || g.archived_at) throw new GroupError("This group has closed.", 410);
        await addGroupMembers(inv.target_id, userId, [userId]);
      } else {
        const c = must(await db.from("p2p_communities").select("archived_at").eq("id", inv.target_id).maybeSingle()) as { archived_at: string | null } | null;
        if (!c || c.archived_at) throw new GroupError("This community has closed.", 410);
        await addCommunityMembers(inv.target_id, userId, [userId]);
      }
    }
    must(await db.from("p2p_group_invitations").update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", inv.id));
    await event(inv.target_type, inv.target_id, userId, accept ? "invitation_accepted" : "invitation_declined", userId);
    return ok(res, { status: accept ? "accepted" : "declined", type: inv.target_type, targetId: inv.target_id });
  } catch (e) { return fail(res, e); }
});

router.post("/join", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const token = text(req.body?.token, 200);
    const link = token ? (must(await db.from("p2p_group_invite_links").select("*").eq("token_hash", hash(token)).maybeSingle()) as Record<string, any> | null) : null;
    if (!link || link.revoked_at || (link.expires_at && Date.parse(link.expires_at) < Date.now()) || (link.max_uses && link.uses >= link.max_uses))
      throw new GroupError("This invite link isn't valid any more.", 410);
    // The group/community must still exist and be open.
    const target = must(await db.from(link.target_type === "group" ? "p2p_conversations" : "p2p_communities").select("archived_at").eq("id", link.target_id).maybeSingle()) as { archived_at: string | null } | null;
    if (!target || target.archived_at) throw new GroupError("This invite link isn't valid any more.", 410);
    // A link never gets round a block: someone the link's creator blocked (or who blocked them) can't use it.
    if ((await blockedWith(link.created_by)).has(userId)) throw new GroupError("This invite link isn't valid any more.", 410);
    // A community's group link only works for that community's members.
    if (link.target_type === "group") {
      const g = must(await db.from("p2p_conversations").select("community_id").eq("id", link.target_id).single()) as { community_id: string | null };
      if (g.community_id && !(await communityRole(g.community_id, userId))) throw new GroupError("Join the community first.", 403);
    }
    if (link.requires_approval) {
      await db.from("p2p_group_join_requests").insert({ target_type: link.target_type, target_id: link.target_id, user_id: userId, link_id: link.id });
      return ok(res, { status: "requested" });
    }
    if (link.target_type === "group") await addGroupMembers(link.target_id, userId, [userId]);
    else await addCommunityMembers(link.target_id, userId, [userId]);
    await db.from("p2p_group_invite_links").update({ uses: link.uses + 1 }).eq("id", link.id);
    return ok(res, { status: "joined", type: link.target_type, targetId: link.target_id });
  } catch (e) { return fail(res, e); }
});

// ── Communities ────────────────────────────────────────────────────────────
async function communityRole(id: string, userId: string): Promise<"owner" | "admin" | "member" | null> {
  if (!UUID.test(id)) return null;
  const m = must(await db.from("p2p_community_members").select("role").eq("community_id", id).eq("user_id", userId).maybeSingle()) as { role: "owner" | "admin" | "member" } | null;
  return m?.role ?? null;
}
async function communityAdmin(id: string, userId: string) {
  const r = await communityRole(id, userId);
  if (!r) throw new GroupError("This community isn't available.", 404);
  if (r === "member") throw new GroupError("Only community administrators can do that.", 403);
  return r;
}
async function addCommunityMembers(communityId: string, actor: string, userIds: string[]) {
  const existing = new Set(((must(await db.from("p2p_community_members").select("user_id").eq("community_id", communityId).in("user_id", userIds)) as { user_id: string }[])).map((r) => r.user_id));
  const fresh = userIds.filter((u) => !existing.has(u));
  if (fresh.length) must(await db.from("p2p_community_members").insert(fresh.map((u) => ({ community_id: communityId, user_id: u, role: "member", added_by: actor }))));
  for (const u of fresh) await event("community", communityId, actor, "member_added", u);
  // Every community member reads its Announcements (if it has one) — and only that group.
  const ann = must(await db.from("p2p_conversations").select("id").eq("community_id", communityId).eq("is_announcements", true)) as { id: string }[];
  for (const a of ann) await addGroupMembers(a.id, actor, fresh);
  return fresh;
}

router.post("/communities", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = req.body ?? {};
    const name = text(b.name, 80);
    if (!name) throw new GroupError("Give the community a name.");
    const blocked = await blockedWith(userId);
    const members = ids(b.memberIds).filter((u) => u !== userId && !blocked.has(u));
    await profilesExist(members);
    const c = must(await db.from("p2p_communities").insert({ name, description: text(b.description, 1000) || null, created_by: userId }).select("id").single()) as { id: string };
    must(await db.from("p2p_community_members").insert({ community_id: c.id, user_id: userId, role: "owner", added_by: userId }));
    await event("community", c.id, userId, "created");
    if (b.announcements === true) {
      const a = must(await db.from("p2p_conversations").insert({ type: "group", conversation_type: "private_group", name: "Announcements", created_by: userId, community_id: c.id, posting: "admins", is_announcements: true }).select("id").single()) as { id: string };
      must(await db.from("p2p_conversation_members").insert({ conversation_id: a.id, user_id: userId, role: "admin" }));
      await event("group", a.id, userId, "created", null, { communityId: c.id, announcements: true });
    }
    const added = await addCommunityMembers(c.id, userId, members);
    await notify(added, "You were added to a community", name, "community_added", { kind: "community", communityId: c.id });
    return ok(res, { id: c.id });
  } catch (e) { return fail(res, e); }
});

router.get("/communities/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const role = await communityRole(req.params.id, userId);
    if (!role) throw new GroupError("This community isn't available.", 404);
    const c = must(await db.from("p2p_communities").select("id,name,description,photo_url,created_at,archived_at").eq("id", req.params.id).single()) as Record<string, any>;
    const [mem, groups, myGroups] = await Promise.all([
      db.from("p2p_community_members").select("user_id,role,joined_at").eq("community_id", req.params.id),
      db.from("p2p_conversations").select("id,name,description,is_announcements,posting,archived_at").eq("community_id", req.params.id),
      db.from("p2p_conversation_members").select("conversation_id,role").eq("user_id", userId),
    ]);
    const ms = (mem.data ?? []) as { user_id: string; role: string; joined_at: string }[];
    const prof = ms.length ? ((await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", ms.map((m) => m.user_id))).data ?? []) as { id: string; full_name: string | null; photo_url: string | null }[] : [];
    const nameOf = new Map(prof.map((p) => [p.id, p]));
    const inGroup = new Map(((myGroups.data ?? []) as { conversation_id: string; role: string }[]).map((x) => [x.conversation_id, x.role]));
    const admin = role !== "member";
    return ok(res, {
      id: c.id, name: c.name, description: c.description, photoUrl: c.photo_url, archived: !!c.archived_at, myRole: role,
      members: ms.map((m) => ({ id: m.user_id, role: m.role, name: nameOf.get(m.user_id)?.full_name || "P2P participant", photoUrl: nameOf.get(m.user_id)?.photo_url ?? null })),
      // Members see the groups they belong to; administrators see every group in the community.
      groups: ((groups.data ?? []) as Record<string, any>[]).filter((g) => admin || inGroup.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, description: g.description, isAnnouncements: g.is_announcements, posting: g.posting, archived: !!g.archived_at, member: inGroup.has(g.id), myRole: inGroup.get(g.id) ?? null })),
    });
  } catch (e) { return fail(res, e); }
});

router.patch("/communities/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await communityAdmin(req.params.id, userId);
    const b = req.body ?? {}, patch: Record<string, unknown> = {};
    if (typeof b.name === "string") { const n = text(b.name, 80); if (!n) throw new GroupError("Give the community a name."); patch.name = n; }
    if (typeof b.description === "string") patch.description = text(b.description, 1000) || null;
    if (typeof b.photoUrl === "string" || b.photoUrl === null) patch.photo_url = b.photoUrl || null;
    if (typeof b.archived === "boolean") patch.archived_at = b.archived ? new Date().toISOString() : null;
    must(await db.from("p2p_communities").update(patch).eq("id", req.params.id));
    if (typeof b.archived === "boolean") must(await db.from("p2p_conversations").update({ archived_at: b.archived ? new Date().toISOString() : null }).eq("community_id", req.params.id));
    await event("community", req.params.id, userId, "updated", null, { fields: Object.keys(patch) });
    return ok(res, { saved: true });
  } catch (e) { return fail(res, e); }
});

router.post("/communities/:id/members", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await communityAdmin(req.params.id, userId);
    const blocked = await blockedWith(userId);
    const want = ids(req.body?.userIds).filter((u) => !blocked.has(u));
    await profilesExist(want);
    const c = must(await db.from("p2p_communities").select("name,archived_at").eq("id", req.params.id).single()) as { name: string; archived_at: string | null };
    if (c.archived_at) throw new GroupError("This community has closed.", 410);
    const added = await addCommunityMembers(req.params.id, userId, want);
    await notify(added, "You were added to a community", c.name, "community_added", { kind: "community", communityId: req.params.id });
    return ok(res, { added: added.length });
  } catch (e) { return fail(res, e); }
});

router.delete("/communities/:id/members/:userId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const target = req.params.userId === "me" ? userId : String(req.params.userId);
    const self = target === userId;
    const myRole = self ? await communityRole(req.params.id, userId) : await communityAdmin(req.params.id, userId);
    if (!myRole) throw new GroupError("This community isn't available.", 404);
    const theirs = await communityRole(req.params.id, target);
    if (!theirs) return ok(res, { removed: false });
    if (theirs === "owner" && !self) throw new GroupError("The community owner can't be removed.", 403);
    if (theirs === "owner") {
      const owners = must(await db.from("p2p_community_members").select("user_id").eq("community_id", req.params.id).eq("role", "owner")) as unknown[];
      if (owners.length < 2) throw new GroupError("Make someone else an owner before leaving.", 409);
    }
    must(await db.from("p2p_community_members").delete().eq("community_id", req.params.id).eq("user_id", target));
    // Leaving a community also leaves its groups (their content stays with the group).
    const gs = must(await db.from("p2p_conversations").select("id").eq("community_id", req.params.id)) as { id: string }[];
    if (gs.length) must(await db.from("p2p_conversation_members").delete().eq("user_id", target).in("conversation_id", gs.map((g) => g.id)));
    await event("community", req.params.id, userId, self ? "left" : "member_removed", target);
    return ok(res, { removed: true });
  } catch (e) { return fail(res, e); }
});

router.post("/communities/:id/admins", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const mine = await communityAdmin(req.params.id, userId);
    const target = typeof req.body?.userId === "string" && UUID.test(req.body.userId) ? req.body.userId : null;
    if (!target || !(await communityRole(req.params.id, target))) throw new GroupError("Choose a community member.");
    if ((await communityRole(req.params.id, target)) === "owner" && mine !== "owner") throw new GroupError("Only an owner can change an owner.", 403);
    const role = req.body?.admin === true ? "admin" : "member";
    must(await db.from("p2p_community_members").update({ role }).eq("community_id", req.params.id).eq("user_id", target).neq("role", "owner"));
    await event("community", req.params.id, userId, role === "admin" ? "admin_added" : "admin_removed", target);
    return ok(res, { role });
  } catch (e) { return fail(res, e); }
});

// ── One group (members only) ───────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { g, role } = await groupFor(req.params.id, userId);
    const mem = must(await db.from("p2p_conversation_members").select("user_id,role,joined_at").eq("conversation_id", g.id)) as { user_id: string; role: string; joined_at: string }[];
    const prof = (must(await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", mem.map((m) => m.user_id))) as { id: string; full_name: string | null; photo_url: string | null }[]);
    const nameOf = new Map(prof.map((p) => [p.id, p]));
    const community = g.community_id ? (must(await db.from("p2p_communities").select("id,name").eq("id", g.community_id).maybeSingle()) as { id: string; name: string } | null) : null;
    return ok(res, {
      id: g.id, name: g.name, description: g.description, photoUrl: g.photo_url, createdAt: g.created_at, archived: !!g.archived_at, posting: g.posting,
      isAnnouncements: g.is_announcements, community, myRole: role,
      members: mem.map((m) => ({ id: m.user_id, role: m.role, name: nameOf.get(m.user_id)?.full_name || "P2P participant", photoUrl: nameOf.get(m.user_id)?.photo_url ?? null, isMe: m.user_id === userId }))
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1)),
    });
  } catch (e) { return fail(res, e); }
});

router.patch("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await adminOf(req.params.id, userId);
    const b = req.body ?? {}, patch: Record<string, unknown> = {};
    if (typeof b.name === "string") { const n = text(b.name, 80); if (!n) throw new GroupError("Give the group a name."); patch.name = n; }
    if (typeof b.description === "string") patch.description = text(b.description, 1000) || null;
    if (typeof b.photoUrl === "string" || b.photoUrl === null) patch.photo_url = b.photoUrl || null;
    if (b.posting === "admins" || b.posting === "everyone") patch.posting = b.posting;
    if (typeof b.archived === "boolean") patch.archived_at = b.archived ? new Date().toISOString() : null;
    must(await db.from("p2p_conversations").update(patch).eq("id", req.params.id).eq("conversation_type", "private_group"));
    await event("group", req.params.id, userId, "updated", null, { fields: Object.keys(patch) });
    return ok(res, { saved: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/members", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { g } = await adminOf(req.params.id, userId);
    if (g.archived_at) throw new GroupError("This group has closed.", 410);
    const blocked = await blockedWith(userId);
    let want = ids(req.body?.userIds).filter((u) => !blocked.has(u));
    await profilesExist(want);
    if (g.community_id) {
      const inCommunity = new Set(((must(await db.from("p2p_community_members").select("user_id").eq("community_id", g.community_id)) as { user_id: string }[])).map((r) => r.user_id));
      if (want.some((u) => !inCommunity.has(u))) throw new GroupError("Add people to the community first.", 403);
    }
    const added = await addGroupMembers(g.id, userId, want);
    await notify(added, "You were added to a group", g.name ?? "Group", "group_added", { kind: "group", conversationId: g.id });
    return ok(res, { added: added.length });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/members/:userId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const target = req.params.userId;
    const self = target === userId;
    const { g, role } = self ? await groupFor(req.params.id, userId) : await adminOf(req.params.id, userId);
    const theirs = must(await db.from("p2p_conversation_members").select("role").eq("conversation_id", g.id).eq("user_id", target).maybeSingle()) as { role: string } | null;
    if (!theirs) return ok(res, { removed: false });
    if (theirs.role === "admin") {
      const admins = must(await db.from("p2p_conversation_members").select("user_id").eq("conversation_id", g.id).eq("role", "admin")) as unknown[];
      if (admins.length < 2) throw new GroupError(self ? "Make someone else an administrator before leaving." : "A group needs at least one administrator.", 409);
    }
    if (!self && role !== "admin") throw new GroupError("Only group administrators can do that.", 403);
    // Removing the membership row ends access to all future content at once (RLS).
    must(await db.from("p2p_conversation_members").delete().eq("conversation_id", g.id).eq("user_id", target));
    await event("group", g.id, userId, self ? "left" : "member_removed", target);
    return ok(res, { removed: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/admins", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { g } = await adminOf(req.params.id, userId);
    const target = typeof req.body?.userId === "string" && UUID.test(req.body.userId) ? req.body.userId : null;
    const theirs = target ? (must(await db.from("p2p_conversation_members").select("role").eq("conversation_id", g.id).eq("user_id", target).maybeSingle()) as { role: string } | null) : null;
    if (!theirs) throw new GroupError("Choose a group member.");
    const role = req.body?.admin === true ? "admin" : "member";
    if (role === "member" && theirs.role === "admin") {
      const admins = must(await db.from("p2p_conversation_members").select("user_id").eq("conversation_id", g.id).eq("role", "admin")) as unknown[];
      if (admins.length < 2) throw new GroupError("A group needs at least one administrator.", 409);
    }
    must(await db.from("p2p_conversation_members").update({ role }).eq("conversation_id", g.id).eq("user_id", target));
    await event("group", g.id, userId, role === "admin" ? "admin_added" : "admin_removed", target);
    return ok(res, { role });
  } catch (e) { return fail(res, e); }
});

// ── Invitations and links (groups, or communities with ?type=community) ─────
async function targetAdmin(req: Request, userId: string): Promise<{ type: "group" | "community"; id: string; name: string; communityId: string | null }> {
  const id = String(req.params.id);
  if (req.query.type === "community") {
    await communityAdmin(id, userId);
    const c = must(await db.from("p2p_communities").select("name,archived_at").eq("id", id).single()) as { name: string; archived_at: string | null };
    if (c.archived_at) throw new GroupError("This community has closed.", 410);
    return { type: "community", id, name: c.name, communityId: null };
  }
  const { g } = await adminOf(id, userId);
  if (g.archived_at) throw new GroupError("This group has closed.", 410);
  return { type: "group", id: g.id, name: g.name ?? "Group", communityId: g.community_id };
}

router.post("/:id/invitations", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    const blocked = await blockedWith(userId);
    const want = ids(req.body?.userIds).filter((u) => u !== userId && !blocked.has(u));
    await profilesExist(want);
    if (t.communityId) {
      const inCommunity = new Set(((must(await db.from("p2p_community_members").select("user_id").eq("community_id", t.communityId)) as { user_id: string }[])).map((r) => r.user_id));
      if (want.some((u) => !inCommunity.has(u))) throw new GroupError("Invite people to the community first.", 403);
    }
    const already = t.type === "group"
      ? new Set(((must(await db.from("p2p_conversation_members").select("user_id").eq("conversation_id", t.id)) as { user_id: string }[])).map((r) => r.user_id))
      : new Set(((must(await db.from("p2p_community_members").select("user_id").eq("community_id", t.id)) as { user_id: string }[])).map((r) => r.user_id));
    const pending = new Set(((must(await db.from("p2p_group_invitations").select("invited_user_id").eq("target_type", t.type).eq("target_id", t.id).eq("status", "pending")) as { invited_user_id: string }[])).map((r) => r.invited_user_id));
    const fresh = want.filter((u) => !already.has(u) && !pending.has(u));
    if (fresh.length) {
      const rows = must(await db.from("p2p_group_invitations").insert(fresh.map((u) => ({ target_type: t.type, target_id: t.id, invited_user_id: u, invited_by: userId }))).select("id,invited_user_id")) as { id: string; invited_user_id: string }[];
      for (const r of rows) await notify([r.invited_user_id], t.type === "group" ? "Group invitation" : "Community invitation", t.name,
        t.type === "group" ? "group_invitation" : "community_invitation", { kind: "group_invitation", invitationId: r.id, type: t.type });
      await event(t.type, t.id, userId, "invited", null, { count: fresh.length });
    }
    return ok(res, { invited: fresh.length });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/links", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    const hours = Number(req.body?.expiresInHours);
    const maxUses = Number(req.body?.maxUses);
    const token = randomBytes(18).toString("base64url");
    const row = must(await db.from("p2p_group_invite_links").insert({
      target_type: t.type, target_id: t.id, token_hash: hash(token), created_by: userId,
      expires_at: Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + Math.min(hours, 24 * 90) * 3600_000).toISOString() : new Date(Date.now() + 7 * 86_400_000).toISOString(),
      max_uses: Number.isInteger(maxUses) && maxUses > 0 ? Math.min(maxUses, 1000) : null, requires_approval: req.body?.requiresApproval === true,
    }).select("id,expires_at,max_uses,requires_approval").single()) as Record<string, any>;
    await event(t.type, t.id, userId, "link_created", null, { linkId: row.id });
    // The token is shown once; only its hash is stored.
    return ok(res, { id: row.id, token, expiresAt: row.expires_at, maxUses: row.max_uses, requiresApproval: row.requires_approval });
  } catch (e) { return fail(res, e); }
});

router.get("/:id/links", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    const rows = must(await db.from("p2p_group_invite_links").select("id,created_at,expires_at,max_uses,uses,requires_approval,revoked_at").eq("target_type", t.type).eq("target_id", t.id).order("created_at", { ascending: false })) as Record<string, any>[];
    return ok(res, { links: rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, requiresApproval: r.requires_approval, revoked: !!r.revoked_at })) });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/links/:linkId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    if (!UUID.test(req.params.linkId)) throw new GroupError("This link isn't available.", 404);
    must(await db.from("p2p_group_invite_links").update({ revoked_at: new Date().toISOString() }).eq("id", req.params.linkId).eq("target_type", t.type).eq("target_id", t.id));
    await event(t.type, t.id, userId, "link_revoked", null, { linkId: req.params.linkId });
    return ok(res, { revoked: true });
  } catch (e) { return fail(res, e); }
});

router.get("/:id/requests", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    const rows = must(await db.from("p2p_group_join_requests").select("id,user_id,created_at").eq("target_type", t.type).eq("target_id", t.id).eq("status", "pending")) as { id: string; user_id: string; created_at: string }[];
    const prof = rows.length ? ((await db.from("p2p_profiles").select("id,full_name").in("id", rows.map((r) => r.user_id))).data ?? []) as { id: string; full_name: string | null }[] : [];
    return ok(res, { requests: rows.map((r) => ({ id: r.id, userId: r.user_id, name: prof.find((p) => p.id === r.user_id)?.full_name || "P2P participant", createdAt: r.created_at })) });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/requests/:requestId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const t = await targetAdmin(req, userId);
    const r = UUID.test(req.params.requestId) ? (must(await db.from("p2p_group_join_requests").select("*").eq("id", req.params.requestId).eq("target_type", t.type).eq("target_id", t.id).eq("status", "pending").maybeSingle()) as Record<string, any> | null) : null;
    if (!r) throw new GroupError("This request isn't available.", 404);
    const approve = req.body?.approve === true;
    if (approve) {
      if (t.type === "group") await addGroupMembers(t.id, userId, [r.user_id]); else await addCommunityMembers(t.id, userId, [r.user_id]);
      if (r.link_id) { const l = must(await db.from("p2p_group_invite_links").select("uses").eq("id", r.link_id).maybeSingle()) as { uses: number } | null; if (l) await db.from("p2p_group_invite_links").update({ uses: l.uses + 1 }).eq("id", r.link_id); }
    }
    must(await db.from("p2p_group_join_requests").update({ status: approve ? "approved" : "declined", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", r.id));
    return ok(res, { status: approve ? "approved" : "declined" });
  } catch (e) { return fail(res, e); }
});

export default router;
