// Prayer 2.0 — DISPLAY-ONLY timezone formatting for the mobile app. This is
// deliberately the easy half of the timezone problem (formatting a known
// UTC instant into a given IANA zone's local wall-clock string via the
// device's own Intl engine, which Expo SDK 54's Hermes ships with full ICU
// support for) — the hard half (converting a *local* wall-clock time back
// into the correct UTC instant, accounting for DST) stays server-side in
// artifacts/api-server/src/lib/prayerTime.ts via date-fns-tz. The mobile
// app never performs that conversion itself and never compares two raw
// local-time strings from different zones directly.

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Short city/region label from an IANA zone name, e.g. "Europe/Berlin" -> "Berlin".
export function zoneShortLabel(timezone: string): string {
  const parts = timezone.split("/");
  return (parts[parts.length - 1] || timezone).replace(/_/g, " ");
}

export function formatTimeInZone(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(isoUtc));
}

export function formatDateInZone(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(isoUtc));
}

// "Tonight", "Tomorrow", or a short date — relative to the VIEWER's own
// device timezone (never the other party's), so "Tonight" always means
// tonight for the person reading it.
export function relativeDayLabel(isoUtc: string): string {
  const target = new Date(isoUtc);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(target) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return target.getHours() >= 17 ? "Tonight" : "Today";
  if (diffDays === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(target);
}

export function minutesUntil(isoUtc: string): number {
  return Math.round((new Date(isoUtc).getTime() - Date.now()) / 60000);
}

export function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}
