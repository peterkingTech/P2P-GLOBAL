import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

// Incoming-call system notifications: the Accept/Decline buttons, and
// clearing a ringing notification once its call is no longer ringing.
//
// The server can't retract a push once delivered (Expo's push API has no
// tag/collapse-id), so every place this app learns a call stopped ringing
// clears its notification here: the ringing screen, the realtime watcher in
// DataContext, and an app-foreground sweep. While P2P is open, the in-app
// ringing screen replaces the system notification entirely (see push.ts's
// handler), so there's never a second "Incoming call" entry for one call.

export const INCOMING_CALL_CATEGORY = "incoming_call";
export const ACCEPT_ACTION = "ACCEPT_CALL";
export const DECLINE_ACTION = "DECLINE_CALL";

// Mirrors incoming.tsx's RING_TIMEOUT_MS plus the server sweep's grace.
const RING_WINDOW_MS = 45000;

// Both actions open the app: a background-only Decline needs a headless
// task, which expo-notifications supports on Android only (and only with
// expo-task-manager, not a dependency here). Opening P2P is the one
// behavior that reliably settles the call on both platforms.
export async function registerIncomingCallCategory(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setNotificationCategoryAsync(INCOMING_CALL_CATEGORY, [
      { identifier: ACCEPT_ACTION, buttonTitle: "Accept", options: { opensAppToForeground: true } },
      { identifier: DECLINE_ACTION, buttonTitle: "Decline", options: { opensAppToForeground: true, isDestructive: true } },
    ]);
  } catch (e) {
    console.warn("callNotifications: category registration failed", e instanceof Error ? e.message : String(e));
  }
}

function isIncomingCallNotification(n: Notifications.Notification, callId?: string): boolean {
  const data = n.request.content.data as Record<string, unknown> | undefined;
  if (data?.notificationType !== "incoming_call") return false;
  return callId ? data.callId === callId : true;
}

/** Removes the incoming-call notification(s) for one call, or all of them. */
export async function dismissCallNotifications(callId?: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => isIncomingCallNotification(n, callId))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch { /* nothing presented / not supported — nothing to clear */ }
}

/** Clears any incoming-call notification whose call has stopped ringing. */
export async function sweepStaleCallNotifications(supabase: SupabaseClient): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const presented = (await Notifications.getPresentedNotificationsAsync()).filter((n) => isIncomingCallNotification(n));
    if (!presented.length) return;
    const ids = presented.map((n) => (n.request.content.data as Record<string, unknown>).callId as string).filter(Boolean);
    const { data: rows } = await supabase.from("p2p_incoming_calls").select("id,status,created_at").in("id", ids);
    const live = new Set(
      (rows ?? [])
        .filter((r: any) => r.status === "ringing" && Date.now() - new Date(r.created_at).getTime() < RING_WINDOW_MS)
        .map((r: any) => r.id as string)
    );
    await Promise.all(
      presented
        .filter((n) => !live.has((n.request.content.data as Record<string, unknown>).callId as string))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch { /* best effort */ }
}
