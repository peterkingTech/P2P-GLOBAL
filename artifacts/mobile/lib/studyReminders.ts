import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

// Personal study reminders + a daily goal. Local-first: settings live on THIS
// phone (per signed-in account) and reminders are local notifications
// scheduled by the phone itself, so they fire in the phone's own local time
// (a time-zone change just shifts them with the clock) and need no server.
// Opening a reminder never marks anything complete — it only navigates.

export type StudyFocus = "core" | "plans" | "bible";
export interface StudyReminderSettings {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Local time "HH:MM" (24h). */
  time: string;
  goalMinutes: number;
  focus: StudyFocus[];
}
export const DEFAULT_REMINDERS: StudyReminderSettings = { enabled: false, days: [1, 2, 3, 4, 5], time: "07:00", goalMinutes: 15, focus: ["core"] };
export const GOAL_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FOCI: StudyFocus[] = ["core", "plans", "bible"];

const key = (userId: string) => `p2p.study.reminders.v1:${userId}`;
const ID_PREFIX = "p2p-study-";
const SNOOZE_ID = `${ID_PREFIX}snooze`;

/** Never trust stored data blindly (older versions, manual edits). */
export function normalizeSettings(raw: unknown): StudyReminderSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<StudyReminderSettings>;
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_REMINDERS.days;
  const time = typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : DEFAULT_REMINDERS.time;
  const goal = typeof o.goalMinutes === "number" && Number.isFinite(o.goalMinutes) ? Math.min(240, Math.max(5, Math.round(o.goalMinutes))) : DEFAULT_REMINDERS.goalMinutes;
  const focus = Array.isArray(o.focus) ? o.focus.filter((f): f is StudyFocus => FOCI.includes(f as StudyFocus)) : DEFAULT_REMINDERS.focus;
  return { enabled: o.enabled === true, days, time, goalMinutes: goal, focus: focus.length ? [...new Set(focus)] : ["core"] };
}

export async function loadReminderSettings(userId: string): Promise<StudyReminderSettings> {
  try { const v = await AsyncStorage.getItem(key(userId)); return v ? normalizeSettings(JSON.parse(v)) : DEFAULT_REMINDERS; }
  catch { return DEFAULT_REMINDERS; }
}
export async function saveReminderSettings(userId: string, s: StudyReminderSettings): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify(normalizeSettings(s)));
}

/** Where a reminder opens — a real app route for the chosen focus. */
export function reminderRoute(focus: StudyFocus[]): string {
  if (focus.length === 1 && focus[0] === "bible") return "/bible";
  if (focus.length === 1 && focus[0] === "plans") return "/plans";
  return "/(tabs)/learn";
}
export const ALLOWED_REMINDER_ROUTES = new Set(["/bible", "/plans", "/(tabs)/learn"]);

export function reminderText(s: StudyReminderSettings): { title: string; body: string } {
  const what = s.focus.length === 1
    ? (s.focus[0] === "bible" ? "Bible reading" : s.focus[0] === "plans" ? "your P2P Plan" : "your Core Foundation lesson")
    : "your study time";
  return { title: "Time to grow 🌱", body: `Your ${s.goalMinutes}-minute goal: ${what}. Tap to begin.` };
}

/** The weekly triggers to schedule — one per selected day, stable ids (no duplicates). */
export function plannedReminders(s: StudyReminderSettings) {
  if (!s.enabled || !s.days.length) return [];
  const [hour, minute] = s.time.split(":").map(Number);
  // expo-notifications weekly weekday: 1 = Sunday … 7 = Saturday.
  return s.days.map((d) => ({ identifier: `${ID_PREFIX}${d}`, weekday: d + 1, hour, minute }));
}

async function cancelStudyReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
}

export type ScheduleResult = { status: "scheduled"; count: number } | { status: "off" } | { status: "permission_denied" } | { status: "unsupported" };

/**
 * Makes the phone's scheduled study reminders match the settings exactly:
 * every previous study reminder is cancelled first, then one weekly reminder
 * per selected day is scheduled. Disabled (or signed out) → none remain.
 */
export async function applyReminderSchedule(s: StudyReminderSettings | null, askPermission = false): Promise<ScheduleResult> {
  if (Platform.OS === "web") return { status: "unsupported" };
  await cancelStudyReminders();
  if (!s || !s.enabled || !s.days.length) return { status: "off" };
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted" && askPermission && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== "granted") return { status: "permission_denied" };
  const { title, body } = reminderText(s);
  const route = reminderRoute(s.focus);
  for (const r of plannedReminders(s)) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.identifier,
      content: { title, body, data: { notificationType: "study_reminder", route }, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: r.weekday, hour: r.hour, minute: r.minute },
    });
  }
  return { status: "scheduled", count: s.days.length };
}

/** "Remind me later" — one extra reminder after `minutes` (replaces any earlier snooze). */
export async function snoozeStudyReminder(s: StudyReminderSettings, minutes = 60): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted") return false;
  await Notifications.cancelScheduledNotificationAsync(SNOOZE_ID).catch(() => {});
  const { title, body } = reminderText(s);
  await Notifications.scheduleNotificationAsync({
    identifier: SNOOZE_ID,
    content: { title, body, data: { notificationType: "study_reminder", route: reminderRoute(s.focus) }, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(60, minutes * 60), repeats: false },
  });
  return true;
}

/** On sign-in / app start / time-zone change: re-apply this account's reminders (or clear them when signed out). */
export async function syncStudyReminders(userId: string | null): Promise<void> {
  try { await applyReminderSchedule(userId ? await loadReminderSettings(userId) : null); } catch { /* best effort */ }
}

/** Plain-language goal progress (transparent about what is counted). */
export function goalProgress(minutesToday: number, goalMinutes: number) {
  const m = Math.max(0, Math.floor(minutesToday));
  const pct = goalMinutes > 0 ? Math.min(100, Math.round((m / goalMinutes) * 100)) : 0;
  return { minutes: m, pct, met: m >= goalMinutes, remaining: Math.max(0, goalMinutes - m),
    label: m >= goalMinutes ? `Goal met — ${m} of ${goalMinutes} minutes today` : `${m} of ${goalMinutes} minutes today` };
}
