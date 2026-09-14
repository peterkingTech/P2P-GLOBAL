import { fromZonedTime } from "date-fns-tz";

// Prayer 2.0 Stage 1 — the ONLY place in this codebase that converts a
// "local wall-clock time in an IANA timezone" into a real UTC instant.
// Forensic finding: no existing feature does this correctly anywhere
// (mobile has no timezone library at all; the only stored `timezone`
// columns — p2p_profiles, p2p_peer_circles, p2p_churches — are free text,
// never converted). Every function here returns/consumes real UTC Date
// objects; callers must never compare the raw local time strings directly.

export function isValidTimezone(tz: string): boolean {
  try {
    // Intl.supportedValuesOf is available in Node 18+; this is the
    // authoritative list of real IANA zone names.
    return Intl.supportedValuesOf("timeZone").includes(tz);
  } catch {
    return false;
  }
}

function toUtc(dateStr: string, timeStr: string, timezone: string): Date {
  // date-fns-tz's fromZonedTime interprets "dateStr timeStr" as wall-clock
  // time IN `timezone` and returns the correct UTC instant, accounting for
  // that specific date's DST offset — never a fixed/guessed offset.
  return fromZonedTime(`${dateStr}T${timeStr}`, timezone);
}

export interface Occurrence {
  start: Date;
  end: Date;
}

// A one-off slot's single occurrence, in UTC.
export function computeOnceOccurrence(specificDate: string, startTime: string, endTime: string, timezone: string): Occurrence {
  return { start: toUtc(specificDate, startTime, timezone), end: toUtc(specificDate, endTime, timezone) };
}

// A weekly slot has no single occurrence — this returns every occurrence
// (in UTC) whose LOCAL calendar date (in the slot's own timezone) falls
// within [windowStartUtc, windowEndUtc] inclusive of a small look-back/
// look-ahead margin, so a caller can find "does 'now' fall inside one of
// these" or "what's the next one" without ever guessing which local date
// today is in a foreign timezone from the server's own UTC clock.
export function computeWeeklyOccurrencesInWindow(
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  timezone: string,
  windowStartUtc: Date,
  windowEndUtc: Date
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  // Walk every calendar date (in UTC terms, which is a safe superset —
  // we only keep the ones whose actual local-timezone conversion lands
  // inside the requested window) from one day before the window to one
  // day after, checking each candidate date's actual day-of-week AS
  // RESOLVED IN THE SLOT'S OWN TIMEZONE before computing its occurrence.
  const cursor = new Date(windowStartUtc.getTime() - 2 * 24 * 60 * 60 * 1000);
  const limit = new Date(windowEndUtc.getTime() + 2 * 24 * 60 * 60 * 1000);

  while (cursor <= limit) {
    const candidateDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(cursor); // en-CA locale formats as YYYY-MM-DD
    const localWeekday = new Date(`${candidateDateStr}T12:00:00Z`).getUTCDay();
    if (localWeekday === dayOfWeek) {
      const occ = computeOnceOccurrence(candidateDateStr, startTime, endTime, timezone);
      if (occ.end >= windowStartUtc && occ.start <= windowEndUtc) occurrences.push(occ);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return occurrences;
}

export function occurrenceContains(occ: Occurrence, instant: Date): boolean {
  return instant >= occ.start && instant <= occ.end;
}
