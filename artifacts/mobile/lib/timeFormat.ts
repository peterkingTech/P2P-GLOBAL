// The app's one set of time-text helpers ("5m ago", "02:14", "1h 20m").
// Screens chose different wordings on purpose (a compact inbox, a calm
// "3 days ago" on people), so each wording is a named style here rather than
// a separate copy in every screen. Invalid or missing times never throw.

export type TimeAgoStyle =
  /** just now · 5m ago · 3h ago · 2d ago */
  | "ago"
  /** now · 5m · 3h · 2d (inboxes) */
  | "compact"
  /** today · 1 day ago · 4 days ago */
  | "days"
  /** today · 4 days ago · 2 months ago · 1 year ago */
  | "long";

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Time since `iso` in the given style; `empty` when the time is missing or invalid. */
export function timeAgo(iso: string | null | undefined, style: TimeAgoStyle = "ago", opts: { now?: number; empty?: string } = {}): string {
  const t = parse(iso);
  if (t === null) return opts.empty ?? "";
  const diffMs = Math.max(0, (opts.now ?? Date.now()) - t);
  if (style === "days" || style === "long") {
    const days = Math.floor(diffMs / 86400000);
    if (days < 1) return "today";
    if (style === "days") return days === 1 ? "1 day ago" : `${days} days ago`;
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  const ago = style === "ago" ? " ago" : "";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return style === "ago" ? "just now" : "now";
  if (mins < 60) return `${mins}m${ago}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${ago}`;
  return `${Math.floor(hrs / 24)}d${ago}`;
}

/** Notification Center time: now · 5m · 3h · 2d, then the date ("12 Oct") after a week. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = parse(iso);
  if (t === null) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * A running clock. Default "m:ss" (voice messages); `padded` gives "mm:ss"
 * (recorders, players, calls) and becomes "hh:mm:ss" from one hour.
 */
export function formatClock(seconds: number, { padded = false }: { padded?: boolean } = {}): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!padded) return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(total % 60)}` : `${pad(m)}:${pad(total % 60)}`;
}

export type DurationStyle =
  /** 4m 12s · 45s */
  | "minSec"
  /** 1h 20m · 35m (whole minutes, rounded down) */
  | "hourMin"
  /** 1h 20m · 35m (minutes rounded to nearest) */
  | "hourMinRounded"
  /** 35 min · 2h · 1h 20m (minutes rounded to nearest) */
  | "words";

/** A length of time in seconds as text. */
export function formatDuration(totalSeconds: number, style: DurationStyle = "hourMin"): string {
  const secs = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  if (style === "minSec") {
    const whole = Math.floor(secs);
    const m = Math.floor(whole / 60);
    return m > 0 ? `${m}m ${whole % 60}s` : `${whole % 60}s`;
  }
  const mins = style === "hourMin" ? Math.floor(secs / 60) : Math.round(secs / 60);
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  if (style === "words") {
    if (mins < 60) return `${mins} min`;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  }
  return h > 0 ? `${h}h ${rem}m` : `${mins}m`;
}

export type DateStyle =
  /** 30 October 2026 */
  | "long"
  /** 30 Oct 2026 */
  | "medium"
  /** 14:05 today, otherwise 30 Oct */
  | "todayTime"
  /** 30/10/2026 14:05 */
  | "dateTime";

/** A date in the device's locale; `empty` for a missing/invalid time. */
export function formatDate(iso: string | null | undefined, style: DateStyle = "medium", { empty = "", now = Date.now() }: { empty?: string; now?: number } = {}): string {
  const t = parse(iso);
  if (t === null) return empty;
  const d = new Date(t);
  switch (style) {
    case "long": return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    case "todayTime":
      return d.toDateString() === new Date(now).toDateString()
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
    case "dateTime": return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    default: return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
}

/** Clock time of day in the device's locale ("3:05 PM"); "" for a missing/invalid time. */
export function formatTimeOfDay(iso: string | null | undefined): string {
  const t = parse(iso);
  return t === null ? "" : new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Seconds between two times; a missing end means "now". Never negative. */
export function secondsBetween(startIso: string, endIso?: string | null, now = Date.now()): number {
  const start = parse(startIso);
  if (start === null) return 0;
  const end = parse(endIso ?? null) ?? now;
  return Math.max(0, (end - start) / 1000);
}
