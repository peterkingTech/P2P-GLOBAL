import { supabaseServiceRole as db } from "./supabase";

// App-icon badge = unread chat MESSAGES only — the same rule as the app's
// Messages tab: messages from someone else, newer than the recipient's
// last_read_at for that chat, in chats they haven't muted. Never
// Notification Center items (prayer, lessons, circles, system…).
// Sent with each new-message push so the icon is right while the app is
// closed. Fail-soft: any error → no entry (the push then carries no badge
// and the phone keeps its current number), never a wrong number.

const MAX_SCAN = 2000; // newest unread candidates scanned per call
const MAX_BADGE = 999;

export async function unreadMessageCounts(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  try {
    const { data: members, error } = await db.from("p2p_conversation_members")
      .select("conversation_id,user_id,last_read_at").in("user_id", userIds);
    if (error || !members) return out;
    const { data: mutedRows } = await db.from("p2p_conversation_settings")
      .select("conversation_id,user_id").in("user_id", userIds).eq("is_muted", true);
    const muted = new Set(((mutedRows ?? []) as { conversation_id: string; user_id: string }[]).map((m) => `${m.user_id}:${m.conversation_id}`));
    const live = (members as { conversation_id: string; user_id: string; last_read_at: string | null }[])
      .filter((m) => !muted.has(`${m.user_id}:${m.conversation_id}`));
    for (const u of userIds) out.set(u, 0);
    if (!live.length) return out;

    const convIds = Array.from(new Set(live.map((m) => m.conversation_id)));
    const oldestRead = live.reduce((min, m) => Math.min(min, m.last_read_at ? Date.parse(m.last_read_at) : 0), Number.POSITIVE_INFINITY);
    let q = db.from("p2p_messages").select("conversation_id,sender_id,created_at").in("conversation_id", convIds)
      .order("created_at", { ascending: false }).limit(MAX_SCAN);
    if (Number.isFinite(oldestRead) && oldestRead > 0) q = q.gt("created_at", new Date(oldestRead).toISOString());
    const { data: msgs, error: msgErr } = await q;
    if (msgErr) return new Map();

    const byConv = new Map<string, { sender_id: string; at: number }[]>();
    for (const m of (msgs ?? []) as { conversation_id: string; sender_id: string; created_at: string }[]) {
      const list = byConv.get(m.conversation_id) ?? [];
      list.push({ sender_id: m.sender_id, at: Date.parse(m.created_at) });
      byConv.set(m.conversation_id, list);
    }
    for (const m of live) {
      const since = m.last_read_at ? Date.parse(m.last_read_at) : 0;
      const n = (byConv.get(m.conversation_id) ?? []).filter((x) => x.sender_id !== m.user_id && x.at > since).length;
      if (n) out.set(m.user_id, Math.min(MAX_BADGE, (out.get(m.user_id) ?? 0) + n));
    }
    return out;
  } catch {
    return new Map();
  }
}
