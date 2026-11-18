// Admin Centre notifications — client (api-server routes/adminNotifications.ts). The server decides which modules'
// notifications this administrator may see (their roles); this file only fetches and renders what it is given.
// Live updates: Supabase realtime on p2p_admin_notification_signals (id + module only, no text — migration 255);
// fallback: refresh every 60 s and whenever the app comes back to the foreground. One shared store, so the header
// bell, sidebar badges and dashboard never fetch separately.
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { apiRequest } from "@/lib/apiClient";
import { supabase } from "@/contexts/AuthContext";

export type Priority = "critical" | "high" | "normal" | "info";
export type NotificationFilter = "all" | "unread" | "action" | "assigned" | "important" | "resolved";
export interface AdminNotification {
  id: string; module: string; moduleLabel: string; type: string; priority: Priority; category: string; actionRequired: boolean; title: string; description: string;
  route: string; params?: Record<string, string>; actorLabel?: string | null; assignedTo?: string | null; occurredAt: string; dueAt?: string | null; count?: number;
  status: "open" | "resolved" | "archived"; unread: boolean; actionTakenAt: string | null; remindedAt: string | null; reminderCount: number; resolvedAt: string | null;
}
export interface Summary {
  unread: number; actionRequired: number; critical: number; assignedToMe: number; overdue: number; badges: Record<string, number>;
  recent: { id: string; title: string; module: string; priority: Priority; status: string; at: string; route: string; params: Record<string, string> }[];
  persisted: boolean; notConnected: { module: string; reason: string }[];
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const getSummary = () => apiRequest<Summary>("/admin/notifications/summary", {}, { fallbackError: "" });
export const listNotifications = (f: { filter?: NotificationFilter; module?: string | null; before?: string | null }) => {
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return apiRequest<{ items: AdminNotification[]; next: string | null; filters: { key: NotificationFilter; count: number }[]; persisted: boolean }>(`/admin/notifications${qs ? `?${qs}` : ""}`, {}, { fallbackError: "Couldn't load notifications." });
};
export const markNotifications = (what: "read" | "unread" | "action" | "archive", ids: string[] | "all") =>
  apiRequest<{ updated: number }>(`/admin/notifications/${what}`, json("POST", { ids }), { fallbackError: "Couldn't update that." });
export interface NotificationPrefs { categories: Record<string, boolean>; sound: boolean }
export const getNotificationPrefs = () => apiRequest<{ prefs: NotificationPrefs }>("/admin/notifications/prefs", {}, { fallbackError: "" });
export const saveNotificationPrefs = (prefs: NotificationPrefs) => apiRequest<{ prefs: NotificationPrefs }>("/admin/notifications/prefs", json("PUT", { prefs }), { fallbackError: "Couldn't save." });

// ── one shared summary ──
let summary: Summary | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let version = 0;
export function refreshSummary(): Promise<void> {
  if (inflight) return inflight;
  inflight = getSummary().then((s) => { summary = s; version++; listeners.forEach((l) => l()); }, () => {}).finally(() => { inflight = null; });
  return inflight;
}
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let appSub: { remove: () => void } | null = null;
function start() {
  void refreshSummary();
  timer = setInterval(() => void refreshSummary(), 60_000); // fallback when realtime is unavailable
  appSub = AppState.addEventListener("change", (s) => { if (s === "active") void refreshSummary(); });
  try {
    channel = supabase.channel("p2p_admin_notification_signals")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "p2p_admin_notification_signals" }, () => { void refreshSummary(); })
      .subscribe();
  } catch { channel = null; }
}
function stop() {
  if (timer) clearInterval(timer); timer = null;
  appSub?.remove(); appSub = null;
  if (channel) { void supabase.removeChannel(channel); channel = null; }
}
/** The live summary (bell count, sidebar badges, dashboard). Mount anywhere in the Admin Centre. */
export function useAdminNotificationSummary(): Summary | null {
  useEffect(() => { if (users++ === 0) start(); return () => { if (--users === 0) stop(); }; }, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => summary, () => summary);
}
export const summaryVersion = () => version;
