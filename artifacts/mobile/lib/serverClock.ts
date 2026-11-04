import AsyncStorage from "@react-native-async-storage/async-storage";

// The server's clock, for countdowns that stay right when the phone's clock
// or time zone is wrong or changes. Each API response carries the server
// time; we pair it with a MONOTONIC reading (performance.now, which a user
// changing the clock can't move) and count forward from there. Deadlines are
// absolute UTC instants from the server, so time zones never matter.
// Offline / after a restart: the last known offset (server − phone clock) is
// used until the next response refreshes it.

const KEY = "p2p.serverClock.offsetMs";
const mono = () => (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now());
let anchor: { server: number; mono: number } | null = null;
let fallbackOffset = 0;
AsyncStorage.getItem(KEY).then((v) => { const n = Number(v); if (Number.isFinite(n)) fallbackOffset = n; }).catch(() => {});

/** Record the server's time from a response (ISO string). */
export function syncServerTime(iso: string, nowMono = mono(), nowWall = Date.now()) {
  const server = Date.parse(iso);
  if (!Number.isFinite(server)) return;
  anchor = { server, mono: nowMono };
  fallbackOffset = server - nowWall;
  AsyncStorage.setItem(KEY, String(fallbackOffset)).catch(() => {});
}
/** Best estimate of the server's current time, in ms. */
export function serverNowMs(nowMono = mono(), nowWall = Date.now()): number {
  if (anchor) return anchor.server + (nowMono - anchor.mono);
  return nowWall + fallbackOffset;
}
/** Days / hours / minutes / seconds until (or since) a deadline. */
export function splitDuration(ms: number) {
  const overdue = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(s / 86400); s -= days * 86400;
  const hours = Math.floor(s / 3600); s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  return { overdue, days, hours, minutes, seconds: s - minutes * 60 };
}
/** Test hook. */
export const _resetServerClock = () => { anchor = null; fallbackOffset = 0; };
