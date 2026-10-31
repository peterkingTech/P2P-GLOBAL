// Development-only content-loading measurements. Off in normal builds: on
// only in development (__DEV__) or a measurement build made with
// EXPO_PUBLIC_PERF=1. Nothing is sent anywhere — results stay in this
// browser/app and are read from the console:
//
//   __P2P_PERF__.report()        a text table of every screen visit
//   copy(__P2P_PERF__.report())  (browser) copy it to share
//   __P2P_PERF__.reset()         start a fresh run
//
// A "visit" runs from the moment a screen opens (or switches chapter) until
// its main content is on screen (measured after the next paint). Network
// requests started during the visit are listed by kind (table / API path —
// never query values, tokens or bodies), so duplicate and waterfall requests
// are visible.
import { useEffect, useRef } from "react";

declare const __DEV__: boolean;
export const PERF_ON = (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_PERF === "1";

interface Req { at: number; ms: number; what: string; status: number | string }
interface Visit { key: string; label: string; start: number; ms: number | null; reqs: Req[]; note?: string }
const visits: Visit[] = [];
const requests: Req[] = [];
const open = new Map<string, Visit>();
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** "rest/v1/p2p_lessons" / "api/kingdom-stories/:id" — no ids, query values or tokens. */
export function describeRequest(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
      .replace(/\/\d+(?=\/|$)/g, "/:n");
    if (path.startsWith("/storage/v1/object/sign/")) path = "/storage/v1/object/sign/…";
    const host = /supabase\.co$/.test(u.hostname) ? "supabase" : /railway\.app$/.test(u.hostname) ? "api" : u.hostname.startsWith("127.0.0.1") || u.hostname === "localhost" ? "local" : u.hostname;
    return `${host}${path}`;
  } catch {
    return "other";
  }
}

function installFetchCounter() {
  const g = globalThis as any;
  if (!PERF_ON || g.__p2pPerfFetch || typeof g.fetch !== "function") return;
  const original = g.fetch.bind(g);
  g.__p2pPerfFetch = true;
  g.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const r: Req = { at: now(), ms: 0, what: describeRequest(url), status: "…" };
    requests.push(r);
    if (requests.length > 2000) requests.shift();
    for (const v of open.values()) v.reqs.push(r);
    try {
      const res = await original(input, init);
      r.status = res.status;
      return res;
    } catch (e) {
      r.status = "error";
      throw e;
    } finally {
      r.ms = now() - r.at;
    }
  };
}
installFetchCounter();

/** A screen (or chapter) starts loading. */
export function perfStart(key: string, label: string) {
  if (!PERF_ON) return;
  const v: Visit = { key, label, start: now(), ms: null, reqs: [] };
  open.set(key, v);
  visits.push(v);
  if (visits.length > 300) visits.shift();
}

/** Its main content is ready — recorded after the next paint. */
export function perfDone(key: string, note?: string) {
  if (!PERF_ON) return;
  const v = open.get(key);
  if (!v || v.ms != null) return;
  const finish = () => {
    if (v.ms != null) return;
    v.ms = now() - v.start;
    v.note = note;
    open.delete(key);
    console.log(`[perf] ${v.label}: ${Math.round(v.ms)} ms · ${v.reqs.length} request(s)${note ? ` · ${note}` : ""}`);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(finish));
  else setTimeout(finish, 0);
}

/**
 * Measure a screen: starts when `id` changes (mount, another chapter), done
 * the first time `ready` is true for that id.
 */
export function usePerfVisit(key: string, label: string, id: string | null | undefined, ready: boolean, note?: string) {
  const started = useRef<string | null>(null);
  if (PERF_ON && id && started.current !== id) { started.current = id; perfStart(key, label); }
  useEffect(() => { if (PERF_ON && id && ready) perfDone(key, note); }, [key, id, ready, note]);
}

export function perfReport(): string {
  const lines = ["P2P Global — content loading (ms = until the content is on screen)", ""];
  for (const v of visits) {
    const kinds = new Map<string, number>();
    for (const r of v.reqs) kinds.set(r.what, (kinds.get(r.what) ?? 0) + 1);
    const dupes = [...kinds.values()].filter((n) => n > 1).length;
    lines.push(`${v.label.padEnd(34)} ${v.ms == null ? "(not finished)" : `${Math.round(v.ms)} ms`.padStart(9)}  ${String(v.reqs.length).padStart(3)} req${dupes ? `  (${dupes} repeated)` : ""}${v.note ? `  ${v.note}` : ""}`);
    for (const [what, n] of kinds) lines.push(`      ${n > 1 ? `${n}× ` : "   "}${what}`);
  }
  return lines.join("\n");
}

if (PERF_ON) {
  (globalThis as any).__P2P_PERF__ = {
    report: perfReport,
    reset() { visits.length = 0; requests.length = 0; open.clear(); return "reset"; },
    visits, requests,
  };
}
