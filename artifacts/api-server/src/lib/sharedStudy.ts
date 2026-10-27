import { supabaseServiceRole as db } from "./supabase";
import { getEligibleStudyPartners } from "./studyPartnerAuth";
import { childUserIds } from "./minors";
import { canManageGroupLearning, isGroupMember } from "./groupLearning";
import { dispatchNotificationNow } from "./pushDispatch";

// Study Together — shared (asynchronous) studies (migration 216). Every rule
// here REUSES an existing one rather than defining a new relationship:
//   • who counts as a peer: getEligibleStudyPartners (Peer Guide, disciples,
//     groupmates — the live Study Together rule) plus accepted P2P
//     connections ("friends" are the same people, listed once);
//   • blocks: p2p_user_blocks either way;
//   • children (family role 'child'): never invited one-to-one, and never
//     invite anyone one-to-one — they study through their Family Circle;
//   • family / church leadership: canManageGroupLearning (Shepherd or
//     Co-Shepherd; church leadership roles);
//   • circles: the circle's leader_id and its active members;
//   • groups: the group's peer_guide_id and its members.
// Membership is re-checked on every request, so someone who leaves a family
// or circle loses access to its studies at once.

export type ContentType = "kingdom_story" | "lesson";
export type Destination = "peer" | "family" | "church" | "circle" | "group";
export const CONTENT_TYPES: readonly ContentType[] = ["kingdom_story", "lesson"];
export const DESTINATIONS: readonly Destination[] = ["peer", "family", "church", "circle", "group"];
export const GROUP_DESTINATIONS: readonly Destination[] = ["family", "church", "circle", "group"];
export const INVITE_DAYS = 14;
export const MAX_PEER_INVITES = 5;
export const MAX_GROUP_NOTIFY = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export class StudyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ── People ───────────────────────────────────────────────────────────────────

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [{ data: one }, { data: two }] = await Promise.all([
    db.from("p2p_user_blocks").select("blocker_id").eq("blocker_id", a).eq("blocked_id", b).limit(1),
    db.from("p2p_user_blocks").select("blocker_id").eq("blocker_id", b).eq("blocked_id", a).limit(1),
  ]);
  return !!(one?.length || two?.length);
}

export type PeerRelationship = "peer_guide" | "disciple" | "connection" | "friend";

/** Everyone the user may invite one-to-one, with how they know each other. */
export async function invitablePeers(userId: string): Promise<Map<string, PeerRelationship>> {
  const out = new Map<string, PeerRelationship>();
  if ((await childUserIds([userId])).has(userId)) return out;
  for (const [id, rel] of await getEligibleStudyPartners(db, userId)) out.set(id, rel);
  const [{ data: sent }, { data: received }] = await Promise.all([
    db.from("p2p_connection_requests").select("to_user_id").eq("from_user_id", userId).eq("request_type", "connect").eq("status", "accepted"),
    db.from("p2p_connection_requests").select("from_user_id").eq("to_user_id", userId).eq("request_type", "connect").eq("status", "accepted"),
  ]);
  for (const r of (sent ?? []) as { to_user_id: string }[]) if (!out.has(r.to_user_id)) out.set(r.to_user_id, "friend");
  for (const r of (received ?? []) as { from_user_id: string }[]) if (!out.has(r.from_user_id)) out.set(r.from_user_id, "friend");
  out.delete(userId);
  if (!out.size) return out;
  const ids = Array.from(out.keys());
  const children = await childUserIds(ids);
  const [{ data: iBlocked }, { data: blockedMe }] = await Promise.all([
    db.from("p2p_user_blocks").select("blocked_id").eq("blocker_id", userId).in("blocked_id", ids),
    db.from("p2p_user_blocks").select("blocker_id").eq("blocked_id", userId).in("blocker_id", ids),
  ]);
  for (const id of children) out.delete(id);
  for (const r of (iBlocked ?? []) as { blocked_id: string }[]) out.delete(r.blocked_id);
  for (const r of (blockedMe ?? []) as { blocker_id: string }[]) out.delete(r.blocker_id);
  return out;
}

// ── Groups ───────────────────────────────────────────────────────────────────

export async function isDestinationMember(type: Destination, groupId: string, userId: string): Promise<boolean> {
  if (type === "family" || type === "church") return isGroupMember(type, groupId, userId);
  if (type === "circle") {
    const { data: c } = await db.from("p2p_peer_circles").select("leader_id").eq("id", groupId).maybeSingle();
    if (!c) return false;
    if (c.leader_id === userId) return true;
    const { data } = await db.from("p2p_peer_circle_members").select("user_id").eq("circle_id", groupId).eq("user_id", userId).eq("status", "active").limit(1);
    return !!data?.length;
  }
  if (type === "group") {
    const { data: g } = await db.from("p2p_groups").select("peer_guide_id").eq("id", groupId).maybeSingle();
    if (!g) return false;
    if (g.peer_guide_id === userId) return true;
    const { data } = await db.from("p2p_group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).limit(1);
    return !!data?.length;
  }
  return false;
}

export async function canLeadDestination(type: Destination, groupId: string, userId: string): Promise<boolean> {
  if (type === "family" || type === "church") return canManageGroupLearning(type, groupId, userId);
  if (type === "circle") {
    const { data } = await db.from("p2p_peer_circles").select("leader_id").eq("id", groupId).maybeSingle();
    return data?.leader_id === userId;
  }
  if (type === "group") {
    const { data } = await db.from("p2p_groups").select("peer_guide_id").eq("id", groupId).maybeSingle();
    return data?.peer_guide_id === userId;
  }
  return false;
}

/** Active members' ids (for notifying them a group study started). */
export async function destinationMemberIds(type: Destination, groupId: string): Promise<string[]> {
  const ids = new Set<string>();
  if (type === "family") {
    const { data } = await db.from("p2p_family_members").select("user_id").eq("family_id", groupId).eq("status", "active");
    for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  } else if (type === "church") {
    const { data } = await db.from("p2p_church_members").select("user_id").eq("church_id", groupId).eq("is_active", true);
    for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  } else if (type === "circle") {
    const { data: c } = await db.from("p2p_peer_circles").select("leader_id").eq("id", groupId).maybeSingle();
    if (c?.leader_id) ids.add(c.leader_id as string);
    const { data } = await db.from("p2p_peer_circle_members").select("user_id").eq("circle_id", groupId).eq("status", "active");
    for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  } else if (type === "group") {
    const { data: g } = await db.from("p2p_groups").select("peer_guide_id").eq("id", groupId).maybeSingle();
    if (g?.peer_guide_id) ids.add(g.peer_guide_id as string);
    const { data } = await db.from("p2p_group_members").select("user_id").eq("group_id", groupId);
    for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  }
  return Array.from(ids);
}

export interface LedGroup { type: Destination; id: string; name: string }

/** Groups this user may start a group study in (leaders only). */
export async function groupsUserLeads(userId: string): Promise<LedGroup[]> {
  const out: LedGroup[] = [];
  const [{ data: fams }, { data: famRoles }, { data: church }, { data: circles }, { data: groups }] = await Promise.all([
    db.from("p2p_families").select("id,name").eq("shepherd_id", userId),
    db.from("p2p_family_members").select("family_id").eq("user_id", userId).eq("status", "active").eq("role", "co_shepherd"),
    db.from("p2p_church_members").select("church_id,role").eq("user_id", userId).eq("is_active", true),
    db.from("p2p_peer_circles").select("id,name").eq("leader_id", userId),
    db.from("p2p_groups").select("id,name").eq("peer_guide_id", userId),
  ]);
  const famIds = new Set<string>([...(fams ?? []).map((f) => f.id as string), ...(famRoles ?? []).map((f) => f.family_id as string)]);
  const famNames = new Map((fams ?? []).map((f) => [f.id as string, f.name as string]));
  const missing = [...famIds].filter((id) => !famNames.has(id));
  if (missing.length) {
    const { data } = await db.from("p2p_families").select("id,name").in("id", missing);
    for (const f of data ?? []) famNames.set(f.id as string, f.name as string);
  }
  for (const id of famIds) out.push({ type: "family", id, name: famNames.get(id) ?? "Family Circle" });
  for (const m of (church ?? []) as { church_id: string; role: string }[]) {
    if (await canManageGroupLearning("church", m.church_id, userId)) {
      const { data: ch } = await db.from("p2p_churches").select("name").eq("id", m.church_id).maybeSingle();
      out.push({ type: "church", id: m.church_id, name: (ch?.name as string) ?? "Church" });
    }
  }
  for (const c of circles ?? []) out.push({ type: "circle", id: c.id as string, name: (c.name as string) ?? "Circle" });
  for (const g of groups ?? []) out.push({ type: "group", id: g.id as string, name: (g.name as string) ?? "Group" });
  return out;
}

export async function destinationName(type: Destination, groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const table = type === "family" ? "p2p_families" : type === "church" ? "p2p_churches" : type === "circle" ? "p2p_peer_circles" : type === "group" ? "p2p_groups" : null;
  if (!table) return null;
  const { data } = await db.from(table).select("name").eq("id", groupId).maybeSingle();
  return (data?.name as string) ?? null;
}

// ── Content ──────────────────────────────────────────────────────────────────

export interface StudySection { id: string; number: number; title: string; questions: string[] }
export interface StudyContent { type: ContentType; id: string; title: string; subtitle: string | null; sections: StudySection[] }

/** Published content only; the sections are a story's chapters (with their reflection questions). */
export async function loadContent(type: ContentType, id: string): Promise<StudyContent | null> {
  if (!isUuid(id)) return null;
  if (type === "kingdom_story") {
    const { data: st } = await db.from("p2p_kingdom_stories").select("id,title,subtitle,status").eq("id", id).maybeSingle();
    if (!st || st.status !== "published") return null;
    const { data: chs } = await db.from("p2p_kingdom_story_chapters").select("id,chapter_number,title,reflections").eq("story_id", id).order("chapter_number", { ascending: true });
    return {
      type, id, title: st.title as string, subtitle: (st.subtitle as string) ?? null,
      sections: ((chs ?? []) as { id: string; chapter_number: number; title: string; reflections: string[] | null }[])
        .map((c) => ({ id: c.id, number: c.chapter_number, title: c.title, questions: (c.reflections ?? []).filter((q) => q && q.trim()) })),
    };
  }
  const { data: les } = await db.from("p2p_lessons").select("id,title,status").eq("id", id).maybeSingle();
  if (!les || les.status !== "published") return null;
  return { type, id, title: les.title as string, subtitle: null, sections: [] };
}

// ── Notifications (in-app row; push goes out now, the cron retries) ─────────

export async function notify(userIds: string[], n: { title: string; message: string; type: string; studyId: string }) {
  const rows = userIds.slice(0, MAX_GROUP_NOTIFY).map((user_id) => ({
    user_id, title: n.title, message: n.message, notification_type: n.type, data: { studyId: n.studyId },
  }));
  if (!rows.length) return;
  const { data } = await db.from("p2p_notifications").insert(rows).select("id");
  for (const r of (data ?? []) as { id: string }[]) void dispatchNotificationNow(r.id).catch(() => { /* the cron retries it */ });
}

export async function displayName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name as string) || "Someone";
}
