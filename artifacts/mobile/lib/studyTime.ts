import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Study time for the daily goal: the time a lesson or the Bible is actually
// OPEN AND ON SCREEN on this phone (the app in front). Counted in short
// ticks, so leaving the screen or the app stops the clock. Kept on this phone
// per account and per LOCAL day; nothing is sent anywhere.

const TICK_MS = 15_000;
const MAX_PER_TICK_MS = 20_000; // a delayed tick never over-counts
const key = (userId: string) => `p2p.study.time.v1:${userId}`;

/** Local calendar day "YYYY-MM-DD" (time-zone aware: the phone's own day). */
export function localDayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Adds ms to a day bucket, keeping only the last 30 days (pure — tested). */
export function addStudyMs(store: Record<string, number>, day: string, ms: number): Record<string, number> {
  const next = { ...store, [day]: (store[day] ?? 0) + Math.max(0, Math.min(ms, MAX_PER_TICK_MS)) };
  const days = Object.keys(next).sort();
  for (const old of days.slice(0, Math.max(0, days.length - 30))) delete next[old];
  return next;
}

async function read(userId: string): Promise<Record<string, number>> {
  try { const v = await AsyncStorage.getItem(key(userId)); const o = v ? JSON.parse(v) : {}; return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}

export async function studyMinutesToday(userId: string): Promise<number> {
  return Math.floor(((await read(userId))[localDayKey()] ?? 0) / 60_000);
}

/** Counts study time while `active` (screen focused) and the app is in front. */
export function useStudyTimeTracker(userId: string | null | undefined, active: boolean) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!userId || !active) return;
    last.current = AppState.currentState === "active" ? Date.now() : null;
    const flush = async () => {
      if (last.current == null) return;
      const now = Date.now();
      const ms = now - last.current;
      last.current = now;
      const store = await read(userId);
      await AsyncStorage.setItem(key(userId), JSON.stringify(addStudyMs(store, localDayKey(), ms))).catch(() => {});
    };
    const timer = setInterval(() => { if (AppState.currentState === "active") void flush(); }, TICK_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") last.current = Date.now();
      else { void flush(); last.current = null; }
    });
    return () => { clearInterval(timer); sub.remove(); void flush(); };
  }, [userId, active]);
}
