// Display rules for the in-app Notification Center's identity layout:
// left = who it's from (the real person, or P2P Global for system events),
// middle = name + what happened, right = P2P branding / time / unread.
// The acting person comes only from the server's `actor` field (verified
// per type in api-server lib/notificationActors.ts) — never guessed here.

export interface NotificationActor { id: string; name: string | null; photoUrl: string | null; username: string | null }
export interface NotificationLike {
  id: string; title: string; message: string | null; isRead: boolean; createdAt: string;
  notificationType: string | null; data: Record<string, unknown> | null; actor?: NotificationActor | null;
}

export type NotificationIdentity =
  | { kind: "person"; name: string; photoUrl: string | null }
  | { kind: "system"; name: "P2P Global" };

export function notificationIdentity(n: NotificationLike): NotificationIdentity {
  if (n.actor && (n.actor.name ?? "").trim()) return { kind: "person", name: n.actor.name!.trim(), photoUrl: n.actor.photoUrl ?? null };
  return { kind: "system", name: "P2P Global" };
}

/** Headline (bold) + detail line. No message content is added that the server didn't send. */
export function notificationText(n: NotificationLike): { headline: string; detail: string | null } {
  const id = notificationIdentity(n);
  const message = (n.message ?? "").trim() || null;
  const title = (n.title ?? "").trim();
  if (id.kind === "person") {
    // e.g. new_message: title "Grace", message "sent you a message".
    const detail = message ?? (title && title !== id.name ? title : null);
    return { headline: id.name, detail };
  }
  return { headline: title || "P2P Global", detail: message };
}

// Notification Center time text is the shared helper (lib/timeFormat).
import { relativeTime } from "@/lib/timeFormat";
export { relativeTime };

export function notificationAccessibilityLabel(n: NotificationLike, now = Date.now()): string {
  const { headline, detail } = notificationText(n);
  // Sighted users see the P2P mark on the left; say it for screen readers.
  const from = notificationIdentity(n).kind === "system" && headline !== "P2P Global" ? "From P2P Global" : null;
  return [n.isRead ? null : "Unread", from, headline, detail, relativeTime(n.createdAt, now)].filter(Boolean).join(", ");
}

export const NOTIFICATION_PAGE_SIZE = 30;
