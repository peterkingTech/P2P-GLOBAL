// Publishing Studio — converting an editor's local date/time in an IANA time
// zone to the exact UTC instant a job runs at. Pure (Intl only, no deps).
//
// Daylight-saving rules, decided explicitly rather than left to Date parsing:
//   - a local time that does not exist (the spring-forward gap, e.g. 02:30 on
//     the night clocks jump 02:00 → 03:00) is REJECTED — never silently moved;
//   - a local time that happens twice (the fall-back overlap) is reported as
//     ambiguous; the earlier occurrence is used unless fold = "later".
// The stored instant is UTC, so the job runs once at the right moment no
// matter when the server's own clock or zone changes.

export type LocalTimeResult =
  | { ok: true; utc: Date; ambiguous: boolean; offsetMinutes: number }
  | { ok: false; error: "invalid_timezone" | "invalid_local_time" | "nonexistent_local_time" };

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { formatterFor(tz); return true; } catch { return false; }
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of `instantMs` in `tz`, as if they were UTC (ms). */
function wallAsUtc(instantMs: number, tz: string): number {
  const parts = formatterFor(tz).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** Offset of `tz` from UTC at `instantMs`, in ms (e.g. +1h for Europe/Berlin in winter). */
function offsetAt(instantMs: number, tz: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallAsUtc(whole, tz) - whole;
}

export function zonedLocalToUtc(local: unknown, tz: unknown, fold: "earlier" | "later" = "earlier"): LocalTimeResult {
  if (!isValidTimeZone(tz)) return { ok: false, error: "invalid_timezone" };
  const m = typeof local === "string" ? LOCAL_RE.exec(local) : null;
  if (!m) return { ok: false, error: "invalid_local_time" };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(wall);
  // Rejects 2026-02-30, 25:00, etc. (Date.UTC would roll them over).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) {
    return { ok: false, error: "invalid_local_time" };
  }
  // Every offset the zone could have around this wall time; keep those that
  // map back to exactly this wall time.
  const offsets = new Set([offsetAt(wall - 86_400_000, tz), offsetAt(wall, tz), offsetAt(wall + 86_400_000, tz)]);
  const candidates = Array.from(offsets)
    .map((o) => wall - o)
    .filter((t) => wallAsUtc(t, tz) === wall)
    .sort((a, b) => a - b);
  const unique = Array.from(new Set(candidates));
  if (unique.length === 0) return { ok: false, error: "nonexistent_local_time" };
  const chosen = unique.length > 1 && fold === "later" ? unique[unique.length - 1] : unique[0];
  return { ok: true, utc: new Date(chosen), ambiguous: unique.length > 1, offsetMinutes: Math.round((wall - chosen) / 60000) };
}

/** The local "YYYY-MM-DDTHH:mm" wall time of an instant in `tz` (for display). */
export function utcToZonedLocal(instant: Date, tz: string): string {
  return new Date(wallAsUtc(instant.getTime(), tz)).toISOString().slice(0, 16);
}
