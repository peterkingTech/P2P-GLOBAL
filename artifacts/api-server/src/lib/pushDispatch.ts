import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { getDeactivatedUserIds } from "./accountStatus";
import { getPreviewLevels, getSenderPhotos, pushPresentation, PREVIEW_CONTENT_LEVELS, type PreviewLevel, type PushPresentation } from "./notificationPrivacy";
import { issuePreviewToken } from "./previewToken";
import {
  decideNotification, sendExpoMessages,
  type ExpoMessage, type ExpoSendDeps, type MessageOutcome, type NotificationVerdict,
} from "./expoPush";

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
// One presentation per notification (same for all of the recipient's
// devices). A preview token is issued only for a 'full' / 'hold' recipient of a
// message push, and only when the server has NOTIFICATION_PREVIEW_SECRET.
function presentationFor(n: PendingNotification, level: PreviewLevel, senderPhoto?: string): PushPresentation {
  const d = n.data ?? {};
  const previewToken = PREVIEW_CONTENT_LEVELS.has(level) && n.notification_type === "new_message" && n.user_id
    ? issuePreviewToken({ notificationId: n.id, recipientId: n.user_id, messageId: String(d.messageId ?? ""), conversationId: String(d.conversationId ?? "") })
    : null;
  return pushPresentation(n, level, { senderPhoto, previewToken });
}

// pres: what this recipient's privacy level allows (lib/notificationPrivacy.ts
// pushPresentation — title/body, sender photo, iOS preview category, preview
// token). Never contains message content. The preview token goes in data,
// which iOS hands the Notification Service Extension as userInfo["body"].
function buildExpoMessage(n: PendingNotification, to: string, pres: PushPresentation) {
  const isIncomingCall = n.notification_type === "incoming_call";
  return {
    to,
    title: pres.title,
    body: pres.body,
    ...(pres.image ? { richContent: { image: pres.image } } : {}),
    ...(pres.mutableContent ? { mutableContent: true } : {}),
    ...(pres.categoryId && !isIncomingCall ? { categoryId: pres.categoryId } : {}),
    data: { notificationId: n.id, notificationType: n.notification_type, ...(n.data ?? {}), ...(pres.previewToken ? { previewToken: pres.previewToken } : {}) },
    sound: "default" as const,
    // categoryId shows the Accept/Decline buttons (registered client-side in
    // lib/callNotifications.ts); ttl drops a ring push that can't be
    // delivered while the call is still ringing.
    ...(isIncomingCall
      ? { channelId: "calls", priority: "high" as const, categoryId: "incoming_call", ttl: INCOMING_CALL_PUSH_TTL_SECONDS }
      : {}),
  };
}

// Sending itself lives in lib/expoPush.ts: at most 100 messages per Expo
// request, one outcome per message in order, bounded retries with jitter
// for transient failures, no re-send after an ambiguous timeout, and a
// per-project split only when Expo itself says which token belongs to which
// project. EXPO_ACCESS_TOKEN is optional (only needed if Expo "enhanced push
// security" is switched on for the project); it is never logged.
const expoDeps: ExpoSendDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  logger,
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
};
function sendExpo(messages: ExpoMessage[], label: string): Promise<MessageOutcome[]> {
  return messages.length ? sendExpoMessages(messages, expoDeps, { label }) : Promise.resolve([]);
}

// Ordinary notifications whose pushes only failed transiently are retried by
// the cron for up to this long, then recorded as abandoned (logged) so a
// prolonged provider outage can never block the queue forever.
const PUSH_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;

function outcomeCounts(outcomes: MessageOutcome[]): Record<string, number> {
  return outcomes.reduce((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {} as Record<string, number>);
}

function invalidTokens(tokens: string[], outcomes: MessageOutcome[]): string[] {
  return tokens.filter((_, i) => outcomes[i]?.kind === "token_invalid");
}

function logVerdict(n: PendingNotification, verdict: NotificationVerdict, outcomes: MessageOutcome[], path: string) {
  const level = verdict === "accepted" || verdict === "no_devices" ? "info" : verdict === "retry" || verdict === "partial" ? "warn" : "error";
  logger[level]({
    provider: "expo", path, notificationId: n.id, notificationType: n.notification_type,
    verdict, devices: outcomes.length, outcomes: outcomeCounts(outcomes),
  }, "pushDispatch: notification outcome");
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
        // Zero active tokens is not a failure (verdict "no_devices").
        const level = (await getPreviewLevels([n.user_id])).get(n.user_id) ?? "none";
        const photo = level === "none" ? undefined : (await getSenderPhotos([n])).get(n.id);
        const pres = presentationFor(n, level, photo);
        const outcomes = await sendExpo(tokens.map((t) => buildExpoMessage(n, t.token, pres)), n.notification_type ?? "immediate");
        await deactivateTokens(invalidTokens(tokens.map((t) => t.token), outcomes));
        const { verdict, finished } = decideNotification(outcomes, { ageMs: 0, maxRetryAgeMs: Number.POSITIVE_INFINITY });
        logVerdict(n, verdict, outcomes, "immediate");
        // Only transient failures hand the row back to the cron; an incoming
        // call that is still unsent by then is recorded there as "expired".
        sendFailed = !finished;
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

export async function dispatchPendingPushes(): Promise<{
  notifications: number; pushed: number; staleTokens: number;
  verdicts?: Partial<Record<NotificationVerdict | "paused", number>>; retrying?: number;
}> {
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
  // Users on a break (account deactivated) get no device pushes; their
  // notifications are still stored and readable in-app when they return.
  // Incoming-call rings are left to the call system untouched.
  const deactivated = await getDeactivatedUserIds(userIds);
  const levels = await getPreviewLevels(userIds);
  const senderPhotos = await getSenderPhotos(pending);
  const tokensByUser = new Map<string, PushToken[]>();
  for (const row of (tokenRows ?? []) as PushToken[]) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row);
    tokensByUser.set(row.user_id, list);
  }

  const messages: ExpoMessage[] = [];
  const messageTokens: string[] = []; // parallel arrays: which token / which notification each message is for
  const messageOwner: number[] = [];
  const preVerdict = new Map<number, NotificationVerdict | "paused">();
  pending.forEach((n, ni) => {
    // An incoming-call ring past its ring window announces a call that is
    // already over: not sent, recorded as "expired" (never as delivered).
    if (isStaleIncomingCall(n)) { preVerdict.set(ni, "expired"); return; }
    if (n.user_id && deactivated.has(n.user_id) && n.notification_type !== "incoming_call") { preVerdict.set(ni, "paused"); return; }
    const tokens = n.user_id ? (tokensByUser.get(n.user_id) ?? []) : [];
    if (!tokens.length) return;
    const level = (n.user_id && levels.get(n.user_id)) || "none";
    const pres = presentationFor(n, level, level === "none" ? undefined : senderPhotos.get(n.id));
    for (const t of tokens) {
      messages.push(buildExpoMessage(n, t.token, pres));
      messageTokens.push(t.token);
      messageOwner.push(ni);
    }
  });

  // Chunked (<= 100 per request), retried and split inside sendExpo; one
  // failing chunk never stops the others.
  const outcomes = await sendExpo(messages, "cron");
  const staleTokens = invalidTokens(messageTokens, outcomes);
  await deactivateTokens(staleTokens);

  // A notification is recorded as handled (pushed_at) only when its outcome
  // is final: accepted, partially accepted, no devices, permanent failure,
  // ambiguous (not re-sent to avoid duplicates), expired ring, paused user,
  // or transient failures past the retry window ("abandoned"). Notifications
  // whose pushes only failed transiently stay pending for the next run.
  const outcomesByOwner = new Map<number, MessageOutcome[]>();
  messageOwner.forEach((ni, i) => outcomesByOwner.set(ni, [...(outcomesByOwner.get(ni) ?? []), outcomes[i]]));
  const finishedIds: string[] = [];
  const verdicts: Partial<Record<NotificationVerdict | "paused", number>> = {};
  const now = Date.now();
  pending.forEach((n, ni) => {
    const pre = preVerdict.get(ni);
    let verdict: NotificationVerdict | "paused";
    let finished = true;
    const outs = outcomesByOwner.get(ni) ?? [];
    if (pre) {
      verdict = pre;
    } else {
      const ageMs = n.created_at ? Math.max(0, now - new Date(n.created_at).getTime()) : 0;
      ({ verdict, finished } = decideNotification(outs, { ageMs, maxRetryAgeMs: PUSH_RETRY_WINDOW_MS }));
    }
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
    if (verdict !== "accepted" && verdict !== "no_devices" && verdict !== "paused") logVerdict(n, verdict as NotificationVerdict, outs, "cron");
    if (finished) finishedIds.push(n.id);
  });
  await markPushed(finishedIds);

  const acceptedMessages = outcomes.filter((o) => o.kind === "accepted").length;
  return {
    notifications: pending.length, pushed: acceptedMessages, staleTokens: staleTokens.length,
    verdicts, retrying: pending.length - finishedIds.length,
  };
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
  const tokens = rows.map((r) => r.token as string);
  const outcomes = await sendExpo(tokens.map((to) => ({
    to,
    data: { notificationType: "call_state", callId, status },
    priority: "high" as const,
    ttl: 60,
  })), "call_state");
  await deactivateTokens(invalidTokens(tokens, outcomes));
}
