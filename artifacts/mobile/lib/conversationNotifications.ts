import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { accessToken, apiFetch } from "@/lib/apiClient";

// Opening a chat clears THAT chat's message notifications — the tray entries
// on this phone and the in-app Notification Center rows — and nothing else:
// other chats, calls and every other notification type are left alone.
// The server part is retried (stored here) if it fails, e.g. offline.

const PENDING_KEY = "p2p.notifications.pendingConversationReads.v1";

type Presented = { request: { identifier: string; content: { data?: unknown } } };

/** Tray notifications that belong to this chat's messages (pure — tested). */
export function conversationNotificationIds(presented: Presented[], conversationId: string): string[] {
  return presented
    .filter((n) => {
      const d = (n.request.content.data ?? {}) as Record<string, unknown>;
      return d.notificationType === "new_message" && d.conversationId === conversationId;
    })
    .map((n) => n.request.identifier);
}

/** Removes this chat's message notifications from the phone's tray. */
export async function dismissConversationNotifications(conversationId: string): Promise<number> {
  if (Platform.OS === "web" || !conversationId) return 0;
  try {
    const ids = conversationNotificationIds(await Notifications.getPresentedNotificationsAsync(), conversationId);
    await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id).catch(() => {})));
    return ids.length;
  } catch { return 0; } // nothing presented / not supported
}

async function readPending(): Promise<string[]> {
  try { const v = await AsyncStorage.getItem(PENDING_KEY); const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; }
  catch { return []; }
}
async function writePending(ids: string[]) {
  try { await AsyncStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(ids)].slice(-50))); } catch { /* best effort */ }
}

/** Marks this chat's unread message notifications read on the server (own rows only). */
async function markConversationNotificationsRead(conversationId: string): Promise<boolean> {
  try {
    if (!(await accessToken())) return false;
    const res = await apiFetch(`/notifications/me/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
    return res.ok || res.status === 404; // 404 = not a valid id: nothing to retry
  } catch { return false; }
}

/**
 * Called when a chat has opened successfully: clears its tray entries now and
 * marks its Notification Center rows read (queued for retry on failure).
 * `onMarked` lets the caller refresh its unread count.
 */
export async function clearConversationNotifications(conversationId: string, onMarked?: () => void): Promise<void> {
  if (!conversationId) return;
  await dismissConversationNotifications(conversationId);
  if (await markConversationNotificationsRead(conversationId)) {
    onMarked?.();
    const pending = await readPending();
    if (pending.includes(conversationId)) await writePending(pending.filter((x) => x !== conversationId));
  } else {
    await writePending([...(await readPending()), conversationId]);
  }
}

/** Retries chats whose server mark-read failed earlier (call when signed in / back online). */
export async function flushPendingConversationReads(onMarked?: () => void): Promise<void> {
  const pending = await readPending();
  if (!pending.length) return;
  const left: string[] = [];
  for (const id of pending) if (!(await markConversationNotificationsRead(id))) left.push(id);
  await writePending(left);
  if (left.length < pending.length) onMarked?.();
}
