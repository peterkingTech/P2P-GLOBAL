import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAILY_VERSES } from "@/constants/dailyVerses";
import { verseForDay } from "@/lib/widgetSnapshot";

// Daily prayer and journal reminders — local notifications scheduled by the
// phone itself (same approach as lib/studyReminders), so they fire on time
// offline and in the phone's own time zone. Opening one only navigates; it
// never writes a prayer or journal entry, and the text never contains
// anything personal.
//   • Morning confession — Settings → Prayer (profile.morningConfessionEnabled/Time)
//   • Prayer journal     — Settings → Prayer (profile.prayerJournalReminderEnabled), 20:00
//   • Discipleship Journal — Settings → Widgets & Offline (this phone only)
//   • Daily Word (owner 2026-11-27) — Settings → Notifications (this phone only; ON by default, 07:00). Each day's
//     notification carries THAT day's verse (the same rule as Home, the widgets and /daily-word), so the phone
//     schedules the next DAILY_WORD_DAYS days one by one and refreshes them every time the app opens.
// Before this, the two Prayer switches were saved but nothing scheduled them.

export const PRAYER_JOURNAL_TIME = "20:00";
const ID_PREFIX = "p2p-daily-";

export interface DailyReminderSettings {
  confession: { enabled: boolean; time: string };
  prayerJournal: { enabled: boolean };
  journal: { enabled: boolean; time: string };
  /** Optional so older callers keep working; absent = off. */
  dailyWord?: { enabled: boolean; time: string };
}

export interface PlannedDaily { identifier: string; hour: number; minute: number; title: string; body: string; route: string; /** one particular day (Daily Word); absent = every day */ date?: Date }

/** Days of Daily Word scheduled ahead (iOS keeps at most 64 pending notifications for the whole app). */
export const DAILY_WORD_DAYS = 14;
const DAILY_WORD_ID = `${ID_PREFIX}word-`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The Daily Word notifications for the coming days, each with its own day's verse (pure, testable). */
export function plannedDailyWord(setting: { enabled: boolean; time: string } | undefined, now: Date = new Date()): PlannedDaily[] {
  if (!setting?.enabled) return [];
  const [hour, minute] = parseTime(setting.time);
  const out: PlannedDaily[] = [];
  for (let i = 0; i <= DAILY_WORD_DAYS && out.length < DAILY_WORD_DAYS; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour, minute, 0, 0);
    if (at.getTime() <= now.getTime() + 30_000) continue;   // today's time has passed → start tomorrow
    const v = verseForDay(DAILY_VERSES, at);
    if (!v) break;
    out.push({
      identifier: `${DAILY_WORD_ID}${ymd(at)}`, hour, minute, date: at, route: "/daily-word",
      title: v.theme ? `Daily Word · ${v.theme}` : "Daily Word",
      // Berean Standard Bible (public domain) — the text Home shows; the Daily Word screen opens it in the person's own translation
      body: `“${v.text.replace(/[\s,;:]+$/, "")}” — ${v.ref} (BSB)`,
    });
  }
  return out;
}

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
  out.push(...plannedDailyWord(s.dailyWord));
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
      trigger: r.date
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.date }
        : { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: r.hour, minute: r.minute },
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

// ── Daily Word notification preference (this phone, per account) — ON by default (owner 2026-11-27) ──
const wordKey = (userId: string) => `dailyReminders:dailyWord:${userId}`;
export const DEFAULT_DAILY_WORD_REMINDER = { enabled: true, time: "07:00" };
export const DAILY_WORD_TIMES = ["06:00", "07:00", "08:00", "12:00", "18:00", "21:00"];

export async function loadDailyWordReminder(userId: string): Promise<{ enabled: boolean; time: string }> {
  try {
    const raw = await AsyncStorage.getItem(wordKey(userId));
    const p = raw ? JSON.parse(raw) : {};
    return { enabled: p.enabled !== false, time: typeof p.time === "string" && /^\d{1,2}:\d{2}$/.test(p.time) ? p.time : DEFAULT_DAILY_WORD_REMINDER.time };
  } catch {
    return DEFAULT_DAILY_WORD_REMINDER;
  }
}
export async function saveDailyWordReminder(userId: string, v: { enabled: boolean; time: string }): Promise<void> {
  await AsyncStorage.setItem(wordKey(userId), JSON.stringify(v)).catch(() => {});
}

/** On sign-in / app start / settings change: re-apply this account's daily reminders (or clear them when signed out). */
export async function syncDailyReminders(
  userId: string | null,
  profile: { morningConfessionEnabled?: boolean; morningConfessionTime?: string; prayerJournalReminderEnabled?: boolean; notificationsEnabled?: boolean } | null,
  askPermission = false,
): Promise<DailyScheduleResult> {
  try {
    if (!userId || !profile) return await applyDailyReminders(null);
    const [journal, word] = await Promise.all([loadJournalReminder(userId), loadDailyWordReminder(userId)]);
    return await applyDailyReminders({
      confession: { enabled: !!profile.morningConfessionEnabled, time: profile.morningConfessionTime ?? "07:00" },
      prayerJournal: { enabled: !!profile.prayerJournalReminderEnabled },
      journal,
      // the "Phone notifications" master switch silences the Daily Word too
      dailyWord: { ...word, enabled: word.enabled && profile.notificationsEnabled !== false },
    }, askPermission);
  } catch {
    return { status: "unsupported" };
  }
}
