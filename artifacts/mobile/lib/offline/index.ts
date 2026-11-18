// OFFLINE-FIRST FOUNDATION (owner brief 2026-11-18 §11). One shared layer — not a second storage system:
//   • kv        per-person local copies on this phone (AsyncStorage, the app's existing storage), so saved
//               personal content opens without a connection;
//   • queue     pending changes, written to storage BEFORE they are sent, replayed in order when the
//               connection returns (and at app start / foreground) — so nothing is lost if the app closes
//               or the network drops mid-way;
//   • no duplicates: every queued create carries a client key the server honours (a replay returns the same
//               record), and the same change queued twice is kept once;
//   • conflicts: a change based on an older copy is answered 409 by the server — it is NEVER forced. The
//               queue keeps it as a conflict, with the server's copy, for the person to choose (lib/offline
//               resolveConflict) — neither side is silently overwritten;
//   • status    "offline · 3 changes waiting", "syncing", "1 change needs you" (useSyncStatus).
// Live features (calls, chat, evaluations) are not queued: they say plainly that they need a connection.
// Sensitive data stays where it is: sign-in tokens are managed by the auth library, never copied here.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { useEffect, useState } from "react";

// ── Per-person local copies ─────────────────────────────────────────────────────
let userId: string | null = null;
const mem = new Map<string, unknown>();
const k = (ns: string) => `offline:v1:${userId ?? "anon"}:${ns}`;
/** Called by the auth layer when the signed-in person changes (copies are kept per person). */
export function setOfflineUser(id: string | null) {
  if (id === userId) return;
  userId = id; mem.clear(); queue = null; void loadQueue().then(() => flush());
}
/** The signed-in person these copies belong to (null before sign-in). */
export const getOfflineUser = () => userId;
export async function kvGet<T>(ns: string): Promise<T | null> {
  const key = k(ns);
  if (mem.has(key)) return mem.get(key) as T;
  try { const raw = await AsyncStorage.getItem(key); const v = raw ? (JSON.parse(raw) as T) : null; mem.set(key, v); return v; } catch { return null; }
}
export async function kvSet<T>(ns: string, value: T): Promise<void> {
  const key = k(ns);
  mem.set(key, value);
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full: the online copy still works */ }
}
export async function kvRemove(ns: string) { const key = k(ns); mem.delete(key); try { await AsyncStorage.removeItem(key); } catch {} }

/** Read-through cache: fresh copy online (stored), the stored copy offline (marked `offline: true`). */
export async function cached<T>(ns: string, fetcher: () => Promise<T>, opts: { store?: boolean } = {}): Promise<T & { offline?: boolean; savedAt?: string }> {
  try {
    const v = await fetcher();
    markOnline();
    if (opts.store !== false) void kvSet(ns, { v, at: new Date().toISOString() });
    return v as T & { offline?: boolean };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const c = await kvGet<{ v: T; at: string }>(ns);
    if (c) return { ...(c.v as T), offline: true, savedAt: c.at };
    throw e;
  }
}

// ── Connectivity ───────────────────────────────────────────────────────────────
let online = true;
/** No status code = the request never reached the server (no connection, DNS, timeout). */
export const isNetworkError = (e: unknown) => {
  const s = (e as { status?: number } | null)?.status;
  return s === 0 || s === undefined && (e instanceof TypeError || /network|fetch|offline|timed out|connection/i.test(String((e as Error)?.message ?? "")));
};
function markOnline() { if (!online) { online = true; emit(); void flush(); } }
function markOffline() { if (online) { online = false; emit(); } }
if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("online", () => markOnline());
  window.addEventListener("offline", () => markOffline());
}
AppState.addEventListener?.("change", (s) => { if (s === "active") void flush(); });

// ── Pending changes ────────────────────────────────────────────────────────────
export interface PendingAction {
  id: string;                 // stable: the client key (duplicates of the same change are kept once)
  type: string;               // a registered handler
  payload: unknown;
  createdAt: string;
  attempts: number;
  state: "pending" | "conflict" | "failed";
  error?: string;
  /** For a conflict: the server's current copy, to show beside the person's change. */
  current?: unknown;
  label?: string;             // shown in the sync status ("Study “Grace of God”")
}
type Handler = (payload: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
/** Register how a queued change is sent. A 409 → conflict (kept); a 4xx → failed (kept, shown); no connection → retried. */
export function registerHandler(type: string, h: Handler) { handlers.set(type, h); }
let queue: PendingAction[] | null = null;
let syncing = false;
const QKEY = () => k("queue");
async function loadQueue(): Promise<PendingAction[]> {
  if (queue) return queue;
  try { const raw = await AsyncStorage.getItem(QKEY()); queue = raw ? (JSON.parse(raw) as PendingAction[]) : []; } catch { queue = []; }
  emit();
  return queue;
}
async function saveQueue() { try { await AsyncStorage.setItem(QKEY(), JSON.stringify(queue ?? [])); } catch {} emit(); }
/** Queue a change (stored first, then sent when possible). The same id replaces an older unsent copy. */
export async function enqueue(a: Omit<PendingAction, "createdAt" | "attempts" | "state">): Promise<void> {
  const q = await loadQueue();
  const i = q.findIndex((x) => x.id === a.id && x.state === "pending");
  const item: PendingAction = { ...a, createdAt: new Date().toISOString(), attempts: 0, state: "pending" };
  if (i >= 0) q[i] = { ...item, createdAt: q[i].createdAt }; else q.push(item);
  await saveQueue();
  void flush();
}
/** Send everything pending, in order. Safe to call any time (one run at a time). */
let again = false;
export async function flush(): Promise<void> {
  if (!userId) return;
  if (syncing) { again = true; return; } // runs once more when the current run ends
  const q = await loadQueue();
  if (!q.some((x) => x.state === "pending")) return;
  syncing = true; again = false; emit();
  try {
    for (const a of [...q]) {
      if (a.state !== "pending") continue;
      const h = handlers.get(a.type);
      if (!h) continue; // its screen hasn't loaded yet; kept for later
      a.attempts++;
      try {
        await h(a.payload);
        queue = (queue ?? []).filter((x) => x !== a);
        markOnline();
      } catch (e: any) {
        if (isNetworkError(e)) { markOffline(); await saveQueue(); break; } // stop; retry when back online
        if (e?.status === 409) { a.state = "conflict"; a.current = e?.current ?? null; a.error = e?.message; }
        else if (a.attempts >= 5 || (e?.status >= 400 && e?.status < 500)) { a.state = "failed"; a.error = e?.message ?? "Couldn't be saved."; }
      }
      await saveQueue();
    }
  } finally { syncing = false; emit(); }
  if (again && online) { again = false; await flush(); }
}
/** Keep mine (re-send based on the server's current version), keep theirs (drop mine), or retry a failed one. */
export async function resolveConflict(id: string, choice: "mine" | "theirs" | "retry", rebase?: (payload: unknown, current: unknown) => unknown) {
  const q = await loadQueue();
  const a = q.find((x) => x.id === id);
  if (!a) return;
  if (choice === "theirs") queue = q.filter((x) => x !== a);
  else { if (choice === "mine" && rebase) a.payload = rebase(a.payload, a.current); a.state = "pending"; a.attempts = 0; a.error = undefined; a.current = undefined; }
  await saveQueue();
  void flush();
}
// Retry pending changes now and then while the app is open (cheap: nothing happens when the queue is empty).
setInterval(() => { void flush(); }, 30_000);

// ── Status ─────────────────────────────────────────────────────────────────────
export interface SyncStatus { online: boolean; syncing: boolean; pending: number; conflicts: PendingAction[]; failed: PendingAction[] }
const subs = new Set<(s: SyncStatus) => void>();
export function syncStatus(): SyncStatus {
  const q = queue ?? [];
  return { online, syncing, pending: q.filter((x) => x.state === "pending").length, conflicts: q.filter((x) => x.state === "conflict"), failed: q.filter((x) => x.state === "failed") };
}
function emit() { const s = syncStatus(); for (const f of subs) f(s); }
export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(syncStatus);
  useEffect(() => { subs.add(setS); void loadQueue(); return () => { subs.delete(setS); }; }, []);
  return s;
}
/** A random key for a new record (the server makes a replay return the same record). */
export function newKey(prefix = "k"): string {
  let s = prefix + "-";
  for (let i = 0; i < 22; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}
