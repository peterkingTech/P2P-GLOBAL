import { supabaseServiceRole as db } from "./supabase";

// Read-only safety checks shared by the account routes (deactivation,
// deletion request) and the scheduled deletion job. Nothing here touches the
// call architecture; it reads the call/session tables the way the call
// routes do.

const HOUR_MS = 60 * 60 * 1000;
// Calls/sessions whose rows were never closed (crashed clients) exist in
// production, so only recent activity counts as "in a call right now".
const RECENT_CALL_MS = 4 * HOUR_MS;
const RECENT_RING_MS = 2 * 60 * 1000;
const RECENT_SESSION_MS = 6 * HOUR_MS;
// Long calls: when the user is online (or was seen in the last 15 minutes —
// p2p_presence heartbeats every ~90s while the app is open), an unclosed
// call/session row counts as live for up to 24 hours instead of 4/6.
const LONG_WINDOW_MS = 24 * HOUR_MS;
const RECENTLY_SEEN_MS = 15 * 60 * 1000;

async function isRecentlyActive(userId: string): Promise<boolean> {
  const { data, error } = await db.from("p2p_presence").select("online_until, last_seen_at").eq("user_id", userId).maybeSingle();
  if (error) precheckFailed("p2p_presence");
  if (!data) return false;
  const now = Date.now();
  return new Date(data.online_until as string).getTime() > now
    || new Date(data.last_seen_at as string).getTime() > now - RECENTLY_SEEN_MS;
}

// Fail closed: if a check can't run, the caller must not proceed.
export function precheckFailed(table: string): never {
  throw new Error(`account pre-check failed on ${table}`);
}

async function countRecent(table: string, build: (q: any) => any): Promise<number> {
  const { count, error } = await build(db.from(table).select("id", { count: "exact", head: true }));
  if (error) precheckFailed(table);
  return count ?? 0;
}

export async function inLiveCallOrSession(userId: string): Promise<boolean> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const active = await isRecentlyActive(userId);
  const callWindow = active ? LONG_WINDOW_MS : RECENT_CALL_MS;
  const sessionWindow = active ? LONG_WINDOW_MS : RECENT_SESSION_MS;
  // 1:1 calls: a call log stays "initiated" until /calls/end settles it.
  if (await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(callWindow)).eq("initiated_by", userId))) return true;
  if (await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(callWindow)).contains("participants", JSON.stringify([userId])))) return true;
  // A call currently ringing to or from them.
  if (await countRecent("p2p_incoming_calls", (q) => q.eq("status", "ringing").gte("created_at", since(RECENT_RING_MS)).or(`caller_id.eq.${userId},recipient_id.eq.${userId}`))) return true;
  // Family worship / Study Together, Break Rooms, church calls: joined and not left.
  for (const table of ["p2p_family_worship_participants", "p2p_break_room_participants", "p2p_church_call_participants"]) {
    if (await countRecent(table, (q) => q.eq("user_id", userId).is("left_at", null).gte("joined_at", since(sessionWindow)))) return true;
  }
  // Circle group calls keep no per-person "joined" record, so a live call in
  // any circle they belong to or lead counts (conservative).
  const { data: memberRows, error: mErr } = await db.from("p2p_peer_circle_members").select("circle_id").eq("user_id", userId);
  if (mErr) precheckFailed("p2p_peer_circle_members");
  const { data: ledRows, error: lErr } = await db.from("p2p_peer_circles").select("id").eq("leader_id", userId);
  if (lErr) precheckFailed("p2p_peer_circles");
  const circleIds = [...new Set([...(memberRows ?? []).map((r) => r.circle_id as string), ...(ledRows ?? []).map((r) => r.id as string)])];
  if (circleIds.length && await countRecent("p2p_call_logs", (q) => q.eq("status", "initiated").gte("created_at", since(callWindow)).in("circle_id", circleIds))) return true;
  return false;
}

// Leading a family/circle that other people are in.
export async function leadsGroupWithOthers(userId: string): Promise<boolean> {
  const { data: fams, error: fErr } = await db.from("p2p_families").select("id").eq("shepherd_id", userId);
  if (fErr) precheckFailed("p2p_families");
  const famIds = (fams ?? []).map((f) => f.id as string);
  if (famIds.length && await countRecent("p2p_family_members", (q) => q.in("family_id", famIds).neq("user_id", userId).eq("status", "active"))) return true;
  const { data: circles, error: cErr } = await db.from("p2p_peer_circles").select("id").eq("leader_id", userId);
  if (cErr) precheckFailed("p2p_peer_circles");
  const circleIds = (circles ?? []).map((c) => c.id as string);
  if (circleIds.length && await countRecent("p2p_peer_circle_members", (q) => q.in("circle_id", circleIds).neq("user_id", userId).eq("status", "active"))) return true;
  return false;
}
