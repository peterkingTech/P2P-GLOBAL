import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Scripture listening and memorisation reminders — optional, local
// notifications scheduled by the phone itself (the same approach as
// lib/studyReminders and lib/dailyReminders), so they fire on time offline
// and in the phone's own time zone. Settings stay on this phone. Opening a
// reminder only opens the Library, a playlist or the memorisation list — it
// never starts playback by itself and never records anything. The text never
// contains anything personal (no passage, no playlist name).

export type ReminderKind = "listen" | "memorise";
export interface ListeningReminder {
  id: string;
  kind: ReminderKind;
  enabled: boolean;
  /** "HH:MM", 24-hour. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Listening: open this playlist (else the Library). */
  collectionId?: string | null;
  collectionTitle?: string | null;
}
export const TIME_PRESETS = [{ label: "Morning", time: "07:00" }, { label: "Afternoon", time: "13:00" }, { label: "Evening", time: "20:00" }] as const;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KEY = "p2p.listening.reminders.v1";
const ID_PREFIX = "p2p-listen-";
const MAX_REMINDERS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
/** Clean stored / edited settings: unknown values are dropped, never guessed. */
export function normalizeReminders(raw: unknown): ListeningReminder[] {
  if (!Array.isArray(raw)) return [];
  const out: ListeningReminder[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(r.id) || out.some((x) => x.id === r.id)) continue;
    const days = Array.from(new Set((Array.isArray(r.days) ? r.days : []).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))).sort();
    out.push({
      id: r.id, kind: r.kind === "memorise" ? "memorise" : "listen", enabled: r.enabled === true,
      time: validTime(r.time) ? (r.time as string) : "07:00", days,
      collectionId: typeof r.collectionId === "string" && UUID.test(r.collectionId) ? r.collectionId : null,
      collectionTitle: typeof r.collectionTitle === "string" ? r.collectionTitle.slice(0, 120) : null,
    });
    if (out.length === MAX_REMINDERS) break;
  }
  return out;
}
/** Where tapping the reminder goes (an approved place only). */
export function reminderRoute(r: Pick<ListeningReminder, "kind" | "collectionId">): string {
  if (r.kind === "memorise") return "/library/memorise";
  return r.collectionId && UUID.test(r.collectionId) ? `/scripture-collections/${r.collectionId}` : "/library";
}
/** The notification text — nothing personal. */
export const reminderText = (r: Pick<ListeningReminder, "kind">) => r.kind === "memorise"
  ? { title: "Scripture to remember", body: "A few minutes with the passages you're learning by heart." }
  : { title: "Time with Scripture", body: "Your listening time — open P2P Global when you're ready." };
/** One weekly trigger per selected day, with stable ids (no duplicates). */
export function plannedTriggers(list: ListeningReminder[]) {
  return list.filter((r) => r.enabled && r.days.length).flatMap((r) => {
    const [hour, minute] = r.time.split(":").map(Number);
    return r.days.map((d) => ({ identifier: `${ID_PREFIX}${r.id}-${d}`, weekday: d + 1, hour, minute, reminder: r }));
  });
}

export async function loadReminders(): Promise<ListeningReminder[]> {
  try { return normalizeReminders(JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]")); } catch { return []; }
}
export type ApplyResult = { status: "scheduled"; count: number } | { status: "off" } | { status: "permission_denied" } | { status: "unsupported" };
/** Save and make the phone's scheduled reminders match exactly (old ones are cancelled first). */
export async function saveReminders(list: ListeningReminder[], askPermission = true): Promise<ApplyResult> {
  const clean = normalizeReminders(list);
  await AsyncStorage.setItem(KEY, JSON.stringify(clean)).catch(() => {});
  if (Platform.OS === "web") return { status: "unsupported" };
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
  const planned = plannedTriggers(clean);
  if (!planned.length) return { status: "off" };
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted" && askPermission && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== "granted") return { status: "permission_denied" };
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.identifier,
      content: { ...reminderText(p.reminder), data: { notificationType: "listening_reminder", route: reminderRoute(p.reminder) }, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: p.weekday, hour: p.hour, minute: p.minute },
    });
  }
  return { status: "scheduled", count: planned.length };
}
