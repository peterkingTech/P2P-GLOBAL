// Publishing Studio — pure view logic (no React, no network) shared by the
// app/admin/studio/* screens, so every rule the UI shows can be tested
// directly. These rules only decide what to OFFER; the API and the database
// re-check every action (roles, approval, independent reviewer, content
// fingerprint, versions) and their answer wins.

import type { CalendarEvent, ReviewState, ScheduleAction, ScheduleStatus, SourceType, StudioItem, StudioApiError } from "@/lib/studioApi";

/** Mirrors STUDIO_VIEW_ROLES in api-server lib/studio/policy.ts (navigation only). */
export const STUDIO_VIEW_ROLES = [
  "super_admin", "admin_content", "admin_supervisor", "admin_moderation",
  "moderator", "admin_translation", "admin_marketing",
];
/** Mirrors the API/database editor and audit-reader roles. */
export const STUDIO_EDIT_ROLES = ["admin_content", "super_admin"];
export const STUDIO_AUDIT_ROLES = ["super_admin", "admin_supervisor", "admin_content"];

export const STUDIO_TABS = [
  { label: "Overview", path: "/admin/studio", icon: "speedometer-outline", exact: true },
  { label: "Calendar", path: "/admin/studio/calendar", icon: "calendar-outline" },
  { label: "Library", path: "/admin/studio/library", icon: "albums-outline" },
  { label: "Review", path: "/admin/studio/review", icon: "checkmark-done-outline" },
  { label: "Media", path: "/admin/studio/media", icon: "images-outline" },
  { label: "Distribution", path: "/admin/studio/distribution", icon: "share-social-outline" },
  { label: "Analytics", path: "/admin/studio/analytics", icon: "bar-chart-outline" },
  { label: "Settings", path: "/admin/studio/settings", icon: "settings-outline" },
] as const;

export const SOURCE_LABELS: Record<SourceType, string> = {
  kingdom_story: "Kingdom Stories", kingdom_win: "Kingdom Wins", curriculum: "Curriculum & Plans",
  prayer_topic: "Pray the Word topics", prayer_path: "Pray the Word paths",
};
export const STATUS_FILTERS: Record<SourceType, string[]> = {
  kingdom_story: ["draft", "review", "published", "archived"],
  kingdom_win: ["submitted", "published"],
  curriculum: ["published", "draft"],
  prayer_topic: ["draft", "published", "archived"],
  prayer_path: ["draft", "published", "archived"],
};
export const REVIEW_LABELS: Record<ReviewState, string> = {
  draft: "Not submitted", in_review: "In review", changes_requested: "Changes requested", approved: "Approved",
};
export const NATIVE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft", review: "Review", published: "Published", archived: "Archived",
  submitted: "Awaiting moderation", rejected: "Rejected",
};
export const ACTION_LABELS: Record<ScheduleAction, string> = { publish: "Publish", unpublish: "Unpublish", archive: "Archive" };
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  pending: "Scheduled", running: "Publishing now", succeeded: "Done", failed: "Failed", cancelled: "Cancelled",
};
export const CONFLICT_MESSAGE = "Someone else changed this item. The latest version has been loaded and your action was not applied.";
const LIVE: ScheduleStatus[] = ["pending", "running"];

export const reviewStateOf = (item: StudioItem): ReviewState => item.studio?.reviewState ?? "draft";
/** Version to send with a review change; 1 for an item with no Studio record yet. */
export const versionOf = (item: StudioItem): number => item.studio?.version ?? 1;
export const isApprovalStale = (item: StudioItem) => item.studio?.reviewState === "approved" && item.studio.approvalStale === true;

// ── Review actions ──────────────────────────────────────────────────────────
export interface ReviewAction {
  to: ReviewState; label: string; tone: "primary" | "secondary" | "danger";
  confirmTitle: string; confirmMessage: string;
  notePrompt?: string; noteRequired?: boolean;
  disabledReason?: string;
}

export function reviewActions(item: StudioItem, ctx: { editable: boolean; userId: string | null; role: string | null }): ReviewAction[] {
  if (!ctx.editable) return [];
  const state = reviewStateOf(item);
  const ownSubmission = !!item.studio?.submittedBy && item.studio.submittedBy === ctx.userId && ctx.role !== "super_admin";
  const fourEyes = ownSubmission ? "You submitted this. Another editor must review it." : undefined;
  const livePublish = item.schedules.some((s) => s.action === "publish" && LIVE.includes(s.status));
  switch (state) {
    case "draft":
      return [{ to: "in_review", label: "Submit for review", tone: "primary", confirmTitle: "Submit for review?", confirmMessage: `"${item.title}" will be sent to another editor for review.` }];
    case "in_review":
      return [
        { to: "approved", label: "Approve", tone: "primary", confirmTitle: "Approve this story?", confirmMessage: "Approval covers the story exactly as it is now (text, media and sources). It is not published yet.", notePrompt: "Note for the editor (optional)", disabledReason: fourEyes },
        { to: "changes_requested", label: "Request changes", tone: "secondary", confirmTitle: "Request changes?", confirmMessage: "The story goes back to its editor with your note.", notePrompt: "What needs to change?", noteRequired: true, disabledReason: fourEyes },
        { to: "draft", label: "Withdraw", tone: "secondary", confirmTitle: "Withdraw from review?", confirmMessage: "The story returns to draft." },
      ];
    case "changes_requested":
      return [
        { to: "in_review", label: "Resubmit", tone: "primary", confirmTitle: "Resubmit for review?", confirmMessage: "Make sure the requested changes were made in the story editor first." },
        { to: "draft", label: "Back to draft", tone: "secondary", confirmTitle: "Move back to draft?", confirmMessage: "The review request is closed." },
      ];
    case "approved":
      return [{ to: "draft", label: isApprovalStale(item) ? "Reopen for review" : "Reopen for edits", tone: isApprovalStale(item) ? "primary" : "danger", confirmTitle: "Reopen this story?",
        confirmMessage: livePublish ? "This withdraws the approval and CANCELS its scheduled publish. It must be approved again." : "This withdraws the approval. It must be approved again before it can be published." }];
  }
}

/** Why "Publish now" is not available (null = it is). The database decides in the end. */
export function publishNowBlocker(item: StudioItem, editable: boolean): string | null {
  if (!editable) return "Your role can view the Studio but cannot publish.";
  if (item.nativeStatus === "published") return "Already published.";
  if (reviewStateOf(item) !== "approved") return "Needs approval first.";
  if (isApprovalStale(item)) return "Changed since approval — review again before publishing.";
  return null;
}

// ── Scheduling blockers ────────────────────────────────────────────────────
export function scheduleBlocker(item: StudioItem, action: ScheduleAction, ctx: { editable: boolean }): string | null {
  if (!ctx.editable) return "Your role can view the Studio but cannot schedule content.";
  if (action === "publish" && reviewStateOf(item) !== "approved") return "This story must be approved before it can be scheduled to publish.";
  if (action === "publish" && isApprovalStale(item)) return "This story changed after it was approved. Reopen it for review before scheduling.";
  if (action === "publish" && item.nativeStatus === "published") return "This story is already published.";
  const willPublish = item.schedules.some((s) => s.action === "publish" && LIVE.includes(s.status));
  if (action === "unpublish" && item.nativeStatus !== "published" && !willPublish) return "Only a published (or scheduled-to-publish) story can be unpublished.";
  if (action === "archive" && item.nativeStatus === "archived") return "This story is already archived.";
  if (item.schedules.some((s) => s.action === action && LIVE.includes(s.status))) return `A ${ACTION_LABELS[action].toLowerCase()} is already scheduled. Cancel it first to reschedule.`;
  return null;
}

// ── Dates and time zones ───────────────────────────────────────────────────
export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** "YYYY-MM-DD" of an instant in `tz`; falls back to the device zone if `tz` is unsupported on this engine. */
export function dateKeyInZone(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

export function formatInZone(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) + ` (${tz})`;
  } catch {
    return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Combines the form's date + time fields into the API's localTime, or explains what is wrong. */
export function buildLocalTime(date: string, time: string): { ok: true; localTime: string } | { ok: false; error: string } {
  const d = date.trim(), t = time.trim();
  if (!DATE_RE.test(d)) return { ok: false, error: "Enter the date as YYYY-MM-DD." };
  if (!TIME_RE.test(t)) return { ok: false, error: "Enter the time as HH:MM (24-hour)." };
  const [y, m, day] = d.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return { ok: false, error: "That date does not exist." };
  return { ok: true, localTime: `${d}T${t}` };
}

export function timePreviewError(code: string): string {
  if (code === "nonexistent_local_time") return "That time does not exist in this time zone (clocks skip it for daylight saving). Choose another time.";
  if (code === "invalid_timezone") return "Unknown time zone. Use a name like Europe/London or Africa/Lagos.";
  if (code === "invalid_local_time") return "Enter a valid date and time.";
  return code;
}

export const nextSchedule = (item: StudioItem) =>
  item.schedules.filter((s) => LIVE.includes(s.status)).sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt))[0] ?? null;

// ── Calendar ───────────────────────────────────────────────────────────────
export function eventsByDay(events: CalendarEvent[], tz: string): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = dateKeyInZone(e.at, tz);
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  for (const list of map.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return map;
}
export const isOverdue = (e: CalendarEvent, nowMs: number) => e.kind === "schedule" && e.status === "pending" && Date.parse(e.at) < nowMs - 5 * 60_000;

/** Weeks (Mon-first) covering `month` (0-11) of `year`; each cell is a "YYYY-MM-DD" key. */
export function monthGrid(year: number, month: number): { key: string; day: number; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month, 1 - offset);
  const weeks: { key: string; day: number; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const t = new Date(start + (w * 7 + d) * 86_400_000);
      row.push({ key: t.toISOString().slice(0, 10), day: t.getUTCDate(), inMonth: t.getUTCMonth() === month });
    }
    if (w > 3 && !row.some((c) => c.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}
/** The UTC range to fetch for a month grid (padded a day either side for time zones). */
export function gridRange(weeks: { key: string }[][]): { from: string; to: string } {
  const first = weeks[0][0].key, last = weeks[weeks.length - 1][6].key;
  return { from: new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString(), to: new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000).toISOString() };
}

// ── Paging ─────────────────────────────────────────────────────────────────
export function pageLabel(p: { page: number; pageSize: number; total: number }): string {
  if (!p.total) return "No results";
  const from = p.page * p.pageSize + 1, to = Math.min(p.total, (p.page + 1) * p.pageSize);
  return `${from}–${to} of ${p.total}`;
}
export const hasNextPage = (p: { page: number; pageSize: number; total: number }) => (p.page + 1) * p.pageSize < p.total;

// ── Errors and audit ───────────────────────────────────────────────────────
export function describeError(e: unknown): { kind: StudioApiError["kind"] | "unknown"; title: string; message: string } {
  const err = e as Partial<StudioApiError> & { message?: string };
  switch (err?.kind) {
    case "permission": return { kind: "permission", title: "No access", message: err.message || "Your role does not have access to this." };
    case "unauthenticated": return { kind: "unauthenticated", title: "Signed out", message: "Sign in again to continue." };
    case "not_installed": return { kind: "not_installed", title: "Studio not set up yet", message: err.message || "The Publishing Studio database migration has not been applied." };
    case "conflict": return { kind: "conflict", title: "Not applied", message: err.message || CONFLICT_MESSAGE };
    case "network": return { kind: "network", title: "Offline", message: err.message || "Could not reach the server." };
    case "not_found": return { kind: "not_found", title: "Not found", message: err.message || "This item no longer exists." };
    case "validation": return { kind: "validation", title: "Check the details", message: err.message || "The request was not accepted." };
    case "server": return { kind: "server", title: "Something went wrong", message: "The server could not complete this. Try again shortly." };
    default: return { kind: "unknown", title: "Something went wrong", message: err?.message || "Unexpected error." };
  }
}

const AUDIT_LABELS: Record<string, string> = {
  "review.in_review": "Submitted for review", "review.approved": "Approved", "review.changes_requested": "Changes requested",
  "review.draft": "Moved back to draft", "review.invalidated": "Approval withdrawn (content changed)",
  "schedule.created": "Scheduled", "schedule.cancelled": "Schedule cancelled",
  "schedule.executed": "Scheduled job ran", "schedule.retry": "Scheduled job will retry", "schedule.failed": "Scheduled job failed",
  "story.published": "Published", "story.status_changed": "Status changed", "story.deleted": "Story deleted",
};
export const auditActionLabel = (a: string) => AUDIT_LABELS[a] ?? a;
export const AUDIT_FILTERS = [
  { value: "", label: "All" }, { value: "review", label: "Reviews" }, { value: "schedule", label: "Schedules" }, { value: "story", label: "Publication" },
];

/** Only known, non-sensitive detail fields, as readable lines. */
export function auditDetailLines(details: Record<string, unknown>): string[] {
  const d = details ?? {};
  const out: string[] = [];
  if (typeof d.title === "string") out.push(`Story: ${d.title}`);
  if (typeof d.from === "string" && typeof d.to === "string") out.push(`${REVIEW_LABELS[d.from as ReviewState] ?? NATIVE_STATUS_LABELS[d.from] ?? d.from} → ${REVIEW_LABELS[d.to as ReviewState] ?? NATIVE_STATUS_LABELS[d.to] ?? d.to}`);
  if (typeof d.jobAction === "string") out.push(`Action: ${ACTION_LABELS[d.jobAction as ScheduleAction] ?? d.jobAction}`);
  if (typeof d.localTime === "string" && typeof d.timezone === "string") out.push(`For ${d.localTime.replace("T", " ")} ${d.timezone}`);
  if (typeof d.path === "string") out.push(`Via: ${d.path === "editor" ? "story editor / Studio" : d.path === "studio_schedule" ? "scheduled job" : "direct database change"}`);
  if (typeof d.note === "string" && d.note) out.push(`Note: ${d.note}`);
  if (typeof d.reason === "string") out.push(`Reason: ${d.reason}`);
  if (typeof d.attempt === "number") out.push(`Attempt ${d.attempt}`);
  if (typeof d.changed === "boolean") out.push(d.changed ? "Content status changed" : "Already in that state (no change)");
  if (typeof d.cancelledPublishSchedules === "number" && d.cancelledPublishSchedules > 0) out.push(`Cancelled ${d.cancelledPublishSchedules} scheduled publish`);
  return out;
}
