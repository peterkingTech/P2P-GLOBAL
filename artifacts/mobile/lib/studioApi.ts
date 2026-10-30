import { apiFetch } from "@/lib/apiClient";

// Publishing Studio client (api-server routes/studio.ts, migration 188).
// Every read and write goes through /api/studio, which checks the caller's
// role and the approval rules on the server; writes run in the database as
// the signed-in user. This client never touches Studio tables directly and
// offers no audit-log writes. `editable` and error responses only decide
// what to show — the client is never the security boundary.

export type SourceType = "kingdom_story" | "kingdom_win" | "curriculum" | "prayer_topic" | "prayer_path";
export type ReviewState = "draft" | "in_review" | "changes_requested" | "approved";
export type ScheduleAction = "publish" | "unpublish" | "archive";
export type ScheduleStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface StudioSchedule {
  id: string; action: ScheduleAction; runAt: string; localTime: string; timezone: string;
  status: ScheduleStatus; attempts: number; lastError: string | null;
}
export interface StudioState {
  itemId: string; reviewState: ReviewState; plannedFor: string | null; timezone: string; version: number;
  submittedBy: string | null; submittedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  /** Approved, but the story's content changed since — it cannot publish until reviewed again. */
  approvalStale?: boolean;
}
export interface StudioItem {
  sourceId: string; title: string;
  /** The canonical record's own status — the only "is it published" truth. */
  nativeStatus: string; contentType: string | null; visibility?: string;
  updatedAt: string; publishedAt: string | null;
  studio: StudioState | null;
  schedules: StudioSchedule[];
}
export interface Paged { page: number; pageSize: number; total: number }
export interface StudioItemsResponse extends Paged {
  sourceType: SourceType; label: string; editable: boolean; readOnlyReason: string | null;
  manage: { label: string; path: string | null }; items: StudioItem[];
}
export interface ReviewQueueResponse extends Paged { state: ReviewState; editable: boolean; items: StudioItem[] }
export interface TimePreview { utc: string; ambiguous: boolean; offsetMinutes: number }
export interface AuditEntry {
  id: number; at: string; actor_id: string | null; actor_role: string | null; action: string;
  item_id?: string | null; source_type?: string | null; source_id?: string | null; details: Record<string, unknown>;
}
export interface OverviewResponse {
  timezone: string; generatedAt: string;
  stories: { draft: number; review: number; published: number; archived: number };
  review: { in_review: number; changes_requested: number; approved: number };
  schedules: { scheduled: number; dueToday: number; overdue: number; failed: number };
  recentlyPublished: { sourceId: string; title: string; publishedAt: string }[];
  wins: { awaitingModeration: number; published: number };
  activity: AuditEntry[] | null;
}
export type CalendarEvent =
  | { kind: "schedule"; id: string; sourceId: string; title: string; action: ScheduleAction; at: string; localTime: string; timezone: string; status: ScheduleStatus; attempts: number; lastError: string | null }
  | { kind: "published"; id: string; sourceId: string; title: string; at: string };
export interface MediaItem {
  id: string; sourceId: string; storyTitle: string | null; storyStatus: string | null; mediaType: "image" | "video";
  fileName: string; caption: string | null; isCover: boolean; durationSeconds: number | null; createdAt: string;
}
export interface AnalyticsResponse {
  generatedAt: string;
  publishedByMonth: { month: string; count: number }[];
  publishedByCategory: { category: string; count: number }[];
  scheduledJobsLast30Days: { succeeded: number; failed: number; cancelled: number };
  reviewActivityLast30Days: { submitted: number; approved: number; changesRequested: number };
  notMeasured: string[];
}
export interface SettingsResponse {
  schedulerEnabled: boolean;
  scheduling: { minLeadMinutes: number; maxLeadDays: number; maxAttempts: number; retryBaseSeconds: number; retryMaxMinutes: number; staleClaimMinutes: number };
  roles: { view: string[]; edit: string[]; audit: string[] };
  approval: { independentReviewer: boolean; superAdminMaySelfApprove: boolean; bindsToContent: boolean; liveStoriesFrozen: boolean };
  yourRole: string;
}

export type StudioErrorKind = "unauthenticated" | "permission" | "conflict" | "not_installed" | "not_found" | "validation" | "server" | "network";

export class StudioApiError extends Error {
  constructor(message: string, readonly kind: StudioErrorKind, readonly status: number, readonly code?: string) { super(message); }
}

export function errorKindForStatus(status: number): StudioErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 503) return "not_installed";
  if (status >= 400 && status < 500) return "validation";
  return "server";
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = apiFetch;
/** Tests only: replace the network layer. */
export function __setStudioFetcher(f: Fetcher) { fetcher = f; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`/studio${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new StudioApiError("Could not reach the server. Check your connection and try again.", "network", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: unknown; code?: unknown };
    const message = typeof b.error === "string" ? b.error : "Request failed.";
    throw new StudioApiError(message, errorKindForStatus(res.status), res.status, typeof b.code === "string" ? b.code : undefined);
  }
  return body as T;
}
const qs = (params: Record<string, string | number | undefined | null>) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const getStudioItems = (p: { sourceType: SourceType; q?: string; status?: string; page?: number; pageSize?: number }) =>
  request<StudioItemsResponse>(`/items${qs(p)}`);
export const getStudioItem = (sourceId: string) =>
  request<{ editable: boolean; item: StudioItem }>(`/items/kingdom_story/${sourceId}`);
export const getReviewQueue = (state: ReviewState, page = 0, pageSize = 20) =>
  request<ReviewQueueResponse>(`/review-queue${qs({ state, page, pageSize })}`);
export const getOverview = (tz: string) => request<OverviewResponse>(`/overview${qs({ tz })}`);
export const getCalendar = (from: string, to: string) => request<{ from: string; to: string; events: CalendarEvent[] }>(`/calendar${qs({ from, to })}`);
export const getMedia = (p: { page?: number; pageSize?: number; mediaType?: "image" | "video" }) =>
  request<Paged & { items: MediaItem[] }>(`/media${qs(p)}`);
export const getAnalytics = () => request<AnalyticsResponse>("/analytics");
export const getSettings = () => request<SettingsResponse>("/settings");
export const getAuditLog = (p: { action?: string; sourceType?: "kingdom_story"; sourceId?: string; page?: number; pageSize?: number }) =>
  request<Paged & { entries: AuditEntry[] }>(`/audit${qs(p)}`);

export const previewLocalTime = (localTime: string, timezone: string, fold: "earlier" | "later" = "earlier") =>
  request<TimePreview>(`/time-preview${qs({ localTime, timezone, fold })}`);

/** `version` is the item version the user was looking at; the server refuses (409) if it changed since. */
export const changeReviewState = (sourceId: string, to: ReviewState, version: number, note?: string) =>
  request<{ itemId: string; reviewState: ReviewState; version: number; cancelledPublishSchedules: number }>(
    `/items/kingdom_story/${sourceId}/review`, { method: "POST", body: JSON.stringify({ to, version, ...(note ? { note } : {}) }) });

/** Publish now (needs valid approval), unpublish, or archive. */
export const setStoryStatus = (sourceId: string, status: "published" | "draft" | "archived") =>
  request<{ sourceId: string; nativeStatus: string }>(`/items/kingdom_story/${sourceId}/status`, { method: "POST", body: JSON.stringify({ status }) });

/** The same idempotencyKey for a retried submission never creates a second job. `fold` only when the time is ambiguous. */
export const createSchedule = (
  sourceId: string,
  input: { action: ScheduleAction; localTime: string; timezone: string; fold?: "earlier" | "later" },
  idempotencyKey: string,
) => request<{ replayed: boolean; schedule: { id: string; action: ScheduleAction; run_at: string; local_time: string; timezone: string; status: ScheduleStatus }; ambiguousLocalTime?: boolean; displayLocal?: string }>(
  `/items/kingdom_story/${sourceId}/schedules`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) });

export const cancelSchedule = (scheduleId: string) =>
  request<{ cancelled: boolean; alreadyCancelled?: boolean }>(`/schedules/${scheduleId}/cancel`, { method: "POST" });

export function newIdempotencyKey(): string {
  return `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
