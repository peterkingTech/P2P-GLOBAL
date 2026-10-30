import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Daily prayer and journal reminders — local notifications scheduled by the
// phone itself (same approach as lib/studyReminders), so they fire on time
// offline and in the phone's own time zone. Opening one only navigates; it
// never writes a prayer or journal entry, and the text never contains
// anything personal.
//   • Morning confession — Settings → Prayer (profile.morningConfessionEnabled/Time)
//   • Prayer journal     — Settings → Prayer (profile.prayerJournalReminderEnabled), 20:00
//   • Discipleship Journal — Settings → Widgets & Offline (this phone only)
// Before this, the two Prayer switches were saved but nothing scheduled them.

export const PRAYER_JOURNAL_TIME = "20:00";
const ID_PREFIX = "p2p-daily-";

export interface DailyReminderSettings {
  confession: { enabled: boolean; time: string };
  prayerJournal: { enabled: boolean };
  journal: { enabled: boolean; time: string };
}

export interface PlannedDaily { identifier: string; hour: number; minute: number; title: string; body: string; route: string }

const parseTime = (t: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  const h = m ? Math.min(23, Number(m[1])) : 7;
  const min = m ? Math.min(59, Number(m[2])) : 0;
  return [h, min];
};

/** Exactly which daily reminders the settings ask for (pure, testable). */
export function plannedDailyReminders(s: DailyReminderSettings): PlannedDaily[] {
  const out: PlannedDaily[] = [];
  if (s.confession.enabled) {
    const [hour, minute] = parseTime(s.confession.time);
    out.push({ identifier: `${ID_PREFIX}confession`, hour, minute, title: "Morning confession", body: "Speak God's truth over your day.", route: "/prayer/build-confession" });
  }
  if (s.prayerJournal.enabled) {
    const [hour, minute] = parseTime(PRAYER_JOURNAL_TIME);
    out.push({ identifier: `${ID_PREFIX}prayer-journal`, hour, minute, title: "Time to pray", body: "Set aside a moment with God.", route: "/prayer/journal" });
  }
  if (s.journal.enabled) {
    const [hour, minute] = parseTime(s.journal.time);
    out.push({ identifier: `${ID_PREFIX}journal`, hour, minute, title: "Take a moment to reflect", body: "What have you learned today?", route: "/my-discipleship/journal" });
  }
  return out;
}

async function cancelDailyReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
}

export type DailyScheduleResult = { status: "scheduled"; count: number } | { status: "off" } | { status: "permission_denied" } | { status: "unsupported" };

/** Makes the phone's daily reminders match the settings exactly (previous ones are always cancelled first). */
export async function applyDailyReminders(s: DailyReminderSettings | null, askPermission = false): Promise<DailyScheduleResult> {
  if (Platform.OS === "web") return { status: "unsupported" };
  await cancelDailyReminders();
  const planned = s ? plannedDailyReminders(s) : [];
  if (!planned.length) return { status: "off" };
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted" && askPermission && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== "granted") return { status: "permission_denied" };
  for (const r of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.identifier,
      content: { title: r.title, body: r.body, data: { notificationType: "daily_reminder", route: r.route }, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: r.hour, minute: r.minute },
    });
  }
  return { status: "scheduled", count: planned.length };
}

// ── Discipleship Journal reminder preference (this phone, per account) ──────
const journalKey = (userId: string) => `dailyReminders:journal:${userId}`;
export const DEFAULT_JOURNAL_REMINDER = { enabled: false, time: "21:00" };

export async function loadJournalReminder(userId: string): Promise<{ enabled: boolean; time: string }> {
  try {
    const raw = await AsyncStorage.getItem(journalKey(userId));
    const p = raw ? JSON.parse(raw) : {};
    return { enabled: p.enabled === true, time: typeof p.time === "string" && /^\d{1,2}:\d{2}$/.test(p.time) ? p.time : DEFAULT_JOURNAL_REMINDER.time };
  } catch {
    return DEFAULT_JOURNAL_REMINDER;
  }
}
export async function saveJournalReminder(userId: string, v: { enabled: boolean; time: string }): Promise<void> {
  await AsyncStorage.setItem(journalKey(userId), JSON.stringify(v)).catch(() => {});
}

/** On sign-in / app start / settings change: re-apply this account's daily reminders (or clear them when signed out). */
export async function syncDailyReminders(
  userId: string | null,
  profile: { morningConfessionEnabled?: boolean; morningConfessionTime?: string; prayerJournalReminderEnabled?: boolean } | null,
  askPermission = false,
): Promise<DailyScheduleResult> {
  try {
    if (!userId || !profile) return await applyDailyReminders(null);
    const journal = await loadJournalReminder(userId);
    return await applyDailyReminders({
      confession: { enabled: !!profile.morningConfessionEnabled, time: profile.morningConfessionTime ?? "07:00" },
      prayerJournal: { enabled: !!profile.prayerJournalReminderEnabled },
      journal,
    }, askPermission);
  } catch {
    return { status: "unsupported" };
  }
}
