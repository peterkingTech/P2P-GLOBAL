import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";

// Centralized push delivery for the existing p2p_notifications event
// system. Every one of this codebase's ~19 notification-insert call sites
// (officialMessages.ts, contact.ts, calls.ts, the new p2p_messages trigger,
// etc.) stays exactly as it is -- none of them know or care that a push
// will follow. This poller is the ONE place that turns a notification row
// into device deliveries, so adding a push to a new event type in the
// future never requires touching a dispatch call site, only the existing
// insert.
//
// Deliberately a poll loop (driven by the same node-cron scheduler
// index.ts already uses for every other periodic sweep -- Break Rooms,
// crisis calls, overdue reports), not a realtime subscription or a DB
// webhook: no new Postgres extension (pg_net) needs enabling, no outbound-
// from-Postgres network path needs trusting, and it survives an API server
// restart with zero missed events (anything inserted while the server was
// down is simply picked up on the next run). The tradeoff is delivery
// latency bounded by the cron cadence (index.ts runs this every minute,
// matching the crisis-call escalation sweep's cadence), not sub-second --
// an acceptable fit for this app's existing notification types, none of
// which are meant to feel like an instant-messenger typing indicator.
const BATCH_SIZE = 50;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PendingNotification = {
  id: string;
  user_id: string | null;
  title: string | null;
  message: string | null;
  notification_type: string | null;
  data: Record<string, unknown> | null;
};

type PushToken = { id: string; user_id: string; token: string };

async function fetchPending(): Promise<PendingNotification[]> {
  const { data, error } = await db
    .from("p2p_notifications")
    .select("id, user_id, title, message, notification_type, data")
    .is("pushed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    logger.error({ err: error }, "pushDispatch: failed to fetch pending notifications");
    return [];
  }
  return (data ?? []) as PendingNotification[];
}

async function markPushed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db.from("p2p_notifications").update({ pushed_at: new Date().toISOString() }).in("id", ids);
  if (error) logger.error({ err: error }, "pushDispatch: failed to mark notifications as pushed");
}

async function deactivateTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  const { error } = await db.from("p2p_push_tokens").update({ is_active: false }).in("token", tokens);
  if (error) logger.error({ err: error }, "pushDispatch: failed to deactivate stale tokens");
}

// One Expo push "message" per device token. Expo's relay fans out to FCM
// (Android) or APNs (iOS) transparently based on each token's own
// platform -- this is the "Expo-compatible delivery" the spec asks to
// prefer, and it's the reason a single dispatcher can serve both platforms
// without provider-specific branching here.
function buildExpoMessage(n: PendingNotification, to: string) {
  return {
    to,
    title: n.title ?? "P2P Global",
    body: n.message ?? "",
    data: { notificationId: n.id, notificationType: n.notification_type, ...(n.data ?? {}) },
    sound: "default" as const,
  };
}

async function sendExpoBatch(messages: ReturnType<typeof buildExpoMessage>[]): Promise<unknown[]> {
  if (!messages.length) return [];
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    logger.error({ status: res.status, body: json }, "pushDispatch: Expo push API request failed");
    return [];
  }
  // Expo's response shape: { data: [{ status: "ok" | "error", ... }, ...] }
  return (json as { data?: unknown[] })?.data ?? [];
}

export async function dispatchPendingPushes(): Promise<{ notifications: number; pushed: number; staleTokens: number }> {
  const pending = await fetchPending();
  if (!pending.length) return { notifications: 0, pushed: 0, staleTokens: 0 };

  const userIds = Array.from(new Set(pending.map((n) => n.user_id).filter((id): id is string => !!id)));
  const { data: tokenRows, error: tokenErr } = await db
    .from("p2p_push_tokens")
    .select("id, user_id, token")
    .in("user_id", userIds)
    .eq("is_active", true);
  if (tokenErr) {
    logger.error({ err: tokenErr }, "pushDispatch: failed to fetch push tokens");
    return { notifications: pending.length, pushed: 0, staleTokens: 0 };
  }
  const tokensByUser = new Map<string, PushToken[]>();
  for (const row of (tokenRows ?? []) as PushToken[]) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row);
    tokensByUser.set(row.user_id, list);
  }

  const messages: ReturnType<typeof buildExpoMessage>[] = [];
  const messageTokens: string[] = []; // parallel array: which token each message went to
  for (const n of pending) {
    const tokens = n.user_id ? (tokensByUser.get(n.user_id) ?? []) : [];
    for (const t of tokens) {
      messages.push(buildExpoMessage(n, t.token));
      messageTokens.push(t.token);
    }
  }

  const tickets = await sendExpoBatch(messages);
  const staleTokens: string[] = [];
  tickets.forEach((ticket, i) => {
    const t = ticket as { status?: string; details?: { error?: string } };
    if (t?.status === "error" && t.details?.error === "DeviceNotRegistered") {
      staleTokens.push(messageTokens[i]);
    }
  });
  await deactivateTokens(staleTokens);

  // Marked as pushed regardless of individual ticket outcome (including
  // users with zero active devices) -- this is a best-effort fan-out, not
  // a guaranteed-delivery queue, so it never retries indefinitely and spams
  // a device once connectivity returns. A notification with no devices
  // still exists and is still readable in-app; it simply had nothing to
  // push to at send time.
  await markPushed(pending.map((n) => n.id));

  return { notifications: pending.length, pushed: messages.length, staleTokens: staleTokens.length };
}