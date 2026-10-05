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
  created_at?: string | null;
};

type PushToken = { id: string; user_id: string; token: string };

// An incoming call only rings for 30s (mobile incoming.tsx RING_TIMEOUT_MS).
// A ring push that would arrive after that announces a call that's already
// over, so it is neither sent late by the cron nor kept in transit by Expo.
const INCOMING_CALL_PUSH_TTL_SECONDS = 30;

function isStaleIncomingCall(n: PendingNotification): boolean {
  if (n.notification_type !== "incoming_call" || !n.created_at) return false;
  return Date.now() - new Date(n.created_at).getTime() > INCOMING_CALL_PUSH_TTL_SECONDS * 1000;
}

async function fetchPending(): Promise<PendingNotification[]> {
  const { data, error } = await db
    .from("p2p_notifications")
    .select("id, user_id, title, message, notification_type, data, created_at")
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
//
// Incoming calls route to the "calls" Android channel (registered client-
// side in lib/push.ts's registerForPushNotificationsAsync, MAX importance)
// instead of the "default" channel every other notification type uses --
// an incoming call needs to interrupt (heads-up, sound, vibration) the way
// an ordinary background message notification deliberately doesn't.
// `priority: "high"` is the equivalent instruction to FCM itself, so the
// message wakes a dozing device instead of waiting for the next batch.
function buildExpoMessage(n: PendingNotification, to: string) {
  const isIncomingCall = n.notification_type === "incoming_call";
  return {
    to,
    title: n.title ?? "P2P Global",
    body: n.message ?? "",
    data: { notificationId: n.id, notificationType: n.notification_type, ...(n.data ?? {}) },
    sound: "default" as const,
    // categoryId shows the Accept/Decline buttons (registered client-side in
    // lib/callNotifications.ts); ttl drops a ring push that can't be
    // delivered while the call is still ringing.
    ...(isIncomingCall
      ? { channelId: "calls", priority: "high" as const, categoryId: "incoming_call", ttl: INCOMING_CALL_PUSH_TTL_SECONDS }
      : {}),
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

// Stage 26A — immediate dispatch for latency-sensitive notification types
// (currently only incoming_call, called from calls.ts's /calls/start right
// after the p2p_notifications row is inserted). The once-per-minute cron
// below remains the ONLY dispatch path for every other notification type —
// this is additive, not a redesign of the notification system.
//
// Reuses the exact same pushed_at column the cron poller already uses as
// its sole "is this pending" signal — no new state, no second notion of
// "sent". Race safety against the cron comes from claiming the row
// atomically FIRST (`update ... where pushed_at is null`): whichever of
// the two — this immediate call, or the next cron tick — updates the row
// first "wins" the claim, and the other's WHERE clause matches zero rows
// and does nothing further, so the same notification can never be sent
// twice. If the actual Expo send then fails, the claim is rolled back
// (pushed_at reset to null) so the row falls back to the existing
// cron-based retry path exactly as if this function had never run — a
// transient push-provider failure is never silently lost, and this
// function never throws back into its caller (a failed push must never
// fail the call that was already created).
export async function dispatchNotificationNow(
  notificationId: string,
  // Devices already ringing through CallKit (lib/apnsVoip.ts) — no second,
  // ordinary push for the same call on those.
  opts: { skipDeviceIds?: Set<string> } = {},
): Promise<void> {
  const { data: claimed, error: claimErr } = await db
    .from("p2p_notifications")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("pushed_at", null)
    .select("id, user_id, title, message, notification_type, data")
    .maybeSingle();
  if (claimErr) {
    logger.error({ err: claimErr, notificationId }, "dispatchNotificationNow: failed to claim notification");
    return; // pushed_at is untouched (still null) -- cron will pick it up normally
  }
  if (!claimed) return; // already claimed/sent by cron or a prior call -- no duplicate

  const n = claimed as PendingNotification;
  let sendFailed = false;
  try {
    if (n.user_id) {
      const { data: tokenRows, error: tokenErr } = await db
        .from("p2p_push_tokens")
        .select("id, user_id, token, device_id")
        .eq("user_id", n.user_id)
        .eq("is_active", true)
        .neq("platform", "ios_voip");
      if (tokenErr) {
        logger.error({ err: tokenErr, notificationId }, "dispatchNotificationNow: failed to fetch push tokens");
        sendFailed = true;
      } else {
        const skip = opts.skipDeviceIds;
        const tokens = ((tokenRows ?? []) as (PushToken & { device_id: string | null })[])
          .filter((t) => !(skip && t.device_id && skip.has(t.device_id)));
        if (tokens.length > 0) {
          const messages = tokens.map((t) => buildExpoMessage(n, t.token));
          const tickets = await sendExpoBatch(messages);
          if (tickets.length === 0) {
            // sendExpoBatch already logged the Expo API failure.
            sendFailed = true;
          } else {
            const staleTokens: string[] = [];
            tickets.forEach((ticket, i) => {
              const t = ticket as { status?: string; details?: { error?: string } };
              if (t?.status === "error" && t.details?.error === "DeviceNotRegistered") {
                staleTokens.push(tokens[i].token);
              }
            });
            await deactivateTokens(staleTokens);
          }
        }
        // Zero active tokens is not a failure -- matches the batch
        // dispatcher's own "still marked pushed" behavior for a user with
        // no registered devices at send time.
      }
    }
  } catch (err) {
    logger.error({ err, notificationId }, "dispatchNotificationNow: unexpected error while dispatching");
    sendFailed = true;
  }

  if (sendFailed) {
    const { error: rollbackErr } = await db.from("p2p_notifications").update({ pushed_at: null }).eq("id", notificationId);
    if (rollbackErr) {
      logger.error({ err: rollbackErr, notificationId }, "dispatchNotificationNow: failed to roll back claim after send failure");
    }
  }
}

export async function dispatchPendingPushes(): Promise<{ notifications: number; pushed: number; staleTokens: number }> {
  const pending = await fetchPending();
  if (!pending.length) return { notifications: 0, pushed: 0, staleTokens: 0 };

  const userIds = Array.from(new Set(pending.map((n) => n.user_id).filter((id): id is string => !!id)));
  const { data: tokenRows, error: tokenErr } = await db
    .from("p2p_push_tokens")
    .select("id, user_id, token")
    .in("user_id", userIds)
    .eq("is_active", true)
    .neq("platform", "ios_voip"); // VoIP tokens go to Apple directly, never Expo
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
    // Still marked pushed below, so it's never retried either.
    if (isStaleIncomingCall(n)) continue;
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
// Silent "this call stopped ringing" push for app builds that ring calls
// natively (Android Telecom — modules/call-system). The ringing there lives
// in native code and must stop even when the app's JS isn't running (e.g.
// the caller hung up while the recipient's app was closed). Only tokens
// registered with call_system (migration 172) get it: an older build would
// show a payload with no title as an empty notification. No-op before 172.
export async function sendCallStatePush(userId: string, callId: string, status: string): Promise<void> {
  // Switched off (GET /calls/config): devices hand pushes back to Expo.
  if (process.env.NATIVE_CALLS_ANDROID === "false") return;
  const { data: rows, error } = await db
    .from("p2p_push_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("platform", "android")
    .eq("call_system", true);
  if (error || !rows?.length) return;
  await sendExpoBatch(rows.map((r) => ({
    to: r.token as string,
    data: { notificationType: "call_state", callId, status },
    priority: "high" as const,
    ttl: 60,
  })) as unknown as ReturnType<typeof buildExpoMessage>[]);
}
