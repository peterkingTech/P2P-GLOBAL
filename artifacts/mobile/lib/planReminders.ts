import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOfflineUser } from "@/lib/offline";

// LEARNING PLAN REMINDERS (owner brief 2026-11-19 §7) — the SAME reminder infrastructure P2P already uses for study
// and listening reminders (lib/studyReminders, lib/listeningReminders): local notifications scheduled by the phone
// itself, so they fire in the phone's own local time (a time-zone change moves them with the clock), work offline,
// and need no server or second notification system. Only the participant creates them (never automatic).
//   • once (a date and time) or repeating on chosen days at a time;
//   • edit, pause, resume, delete; stable notification ids per reminder and day (never duplicates);
//   • tapping opens THAT plan; the text names the plan and says it's their scheduled learning reminder;
//   • reconcile(): a completed, left or deleted plan stops all its future reminders.
// Settings stay on this phone, per signed-in account.

export interface PlanReminder {
  id: string;
  planId: string;
  planTitle: string;
  /** "once" = a single date and time; "repeat" = the chosen weekdays at the time. */
  kind: "once" | "repeat";
  /** "HH:MM", 24-hour, the phone's local time. */
  time: string;
  /** Repeat: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Once: "YYYY-MM-DD" (local date). */
  date: string | null;
  /** Paused by the participant. */
  paused: boolean;
  /** The PLAN is paused (the existing pause behaviour): nothing is delivered until the plan is resumed. */
  planPaused?: boolean;
}
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MAX_PER_PLAN = 5;
const ID_PREFIX = "p2p-plan-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = () => `p2p.plan.reminders.v1:${getOfflineUser() ?? "anon"}`;
const validTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const validDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime());

/** Never trust stored data blindly: unknown values are dropped, not guessed. */
export function normalizePlanReminders(raw: unknown): PlanReminder[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanReminder[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(r.id) || out.some((x) => x.id === r.id)) continue;
    if (typeof r.planId !== "string" || !UUID.test(r.planId)) continue;
    const kind = r.kind === "once" ? "once" : "repeat";
    const days = Array.from(new Set((Array.isArray(r.days) ? r.days : []).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))).sort();
    const date = validDate(r.date) ? (r.date as string) : null;
    if (kind === "once" && !date) continue;
    if (out.filter((x) => x.planId === r.planId).length >= MAX_PER_PLAN) continue;
    out.push({ id: r.id, planId: r.planId, planTitle: typeof r.planTitle === "string" ? r.planTitle.slice(0, 120) : "", kind, time: validTime(r.time) ? (r.time as string) : "07:00", days, date, paused: r.paused === true, planPaused: r.planPaused === true });
  }
  return out;
}
/** The notification text: which plan, and that it's their scheduled learning reminder (nothing else personal). */
export function planReminderText(r: Pick<PlanReminder, "planTitle">) {
  return { title: "Your learning reminder", body: r.planTitle ? `Time for “${r.planTitle}” — your scheduled Learning Plan. Open it when you're ready.` : "Time for your scheduled Learning Plan. Open it when you're ready." };
}
export const planRoute = (planId: string) => `/study-plan/${planId}`;

/** Exactly the triggers the phone should hold (paused or past one-off reminders: none). One id per reminder/day. */
export type PlannedTrigger = { identifier: string; kind: "once"; at: Date; reminder: PlanReminder } | { identifier: string; kind: "weekly"; weekday: number; hour: number; minute: number; reminder: PlanReminder };
export function plannedPlanTriggers(list: PlanReminder[], now = new Date()): PlannedTrigger[] {
  return list.filter((r) => !r.paused && !r.planPaused).flatMap((r): PlannedTrigger[] => {
    const [hour, minute] = r.time.split(":").map(Number);
    if (r.kind === "once") {
      const at = new Date(`${r.date}T${r.time}:00`); // the phone's local time
      return at.getTime() > now.getTime() ? [{ identifier: `${ID_PREFIX}${r.id}`, kind: "once" as const, at, reminder: r }] : [];
    }
    return r.days.map((d) => ({ identifier: `${ID_PREFIX}${r.id}-${d}`, kind: "weekly" as const, weekday: d + 1, hour, minute, reminder: r }));
  });
}

export async function loadPlanReminders(): Promise<PlanReminder[]> {
  try { return normalizePlanReminders(JSON.parse((await AsyncStorage.getItem(key())) ?? "[]")); } catch { return []; }
}
export type ApplyResult = { status: "scheduled"; count: number } | { status: "off" } | { status: "permission_denied" } | { status: "unsupported" };
/** Save and make the phone's scheduled plan reminders match exactly (old ones are cancelled first — no duplicates). */
export async function savePlanReminders(list: PlanReminder[], askPermission = true): Promise<ApplyResult> {
  const clean = normalizePlanReminders(list);
  await AsyncStorage.setItem(key(), JSON.stringify(clean)).catch(() => {});
  if (Platform.OS === "web") return { status: "unsupported" };
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
  const planned = plannedPlanTriggers(clean);
  if (!planned.length) return { status: "off" };
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted" && askPermission && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== "granted") return { status: "permission_denied" };
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.identifier,
      content: { ...planReminderText(p.reminder), data: { notificationType: "plan_reminder", route: planRoute(p.reminder.planId) }, sound: "default" },
      trigger: p.kind === "once"
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at }
        : { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: p.weekday, hour: p.hour, minute: p.minute },
    });
  }
  return { status: "scheduled", count: planned.length };
}
/** Match reminders to this person's plans: a completed, left or deleted plan stops all its future reminders (they're
 *  removed); a paused plan holds them until it is resumed. `status` = each plan's run status (active / paused). */
export async function reconcilePlanReminders(status: Map<string, "active" | "paused">): Promise<void> {
  const list = await loadPlanReminders();
  const next = list.filter((r) => status.has(r.planId)).map((r) => ({ ...r, planPaused: status.get(r.planId) === "paused" }));
  if (JSON.stringify(next) !== JSON.stringify(list)) await savePlanReminders(next, false);
}
export const newReminderId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
