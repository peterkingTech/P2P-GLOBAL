import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Prayer 2.0 Stage 6 — client bindings for routes/prayerTestimonies.ts
// (mounted at /prayer/testimonies), plus a video-upload helper that mirrors
// DataContext.tsx's uploadSubmissionMedia() exactly, targeting the separate
// "prayer-testimonies" Storage bucket (migration 141) instead of
// "submissions" so lesson-assignment media and testimony media never share
// one bucket's path namespace.
async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body;
}

// Same tiny RFC4122-ish v4 generator as DataContext.tsx's generateUUID —
// duplicated rather than exported/shared since it's a 6-line pure helper
// with no external dependency, not worth threading a new export through
// the already-large DataContext module for.
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type TestimonyType = "answered_prayer" | "growth";
export type TestimonyVisibility = "p2p_network" | "private";
export type TestimonyModerationStatus = "pending" | "approved" | "rejected" | "removed";

export interface PrayerTestimony {
  id: string; userId: string; testimonyType: TestimonyType;
  title: string; testimonyText: string; requestId: string | null;
  scriptureReference: unknown; mediaType: "video" | null; mediaPath: string | null;
  mediaDurationSeconds: number | null; isAnonymous: boolean; visibility: TestimonyVisibility;
  moderationStatus: TestimonyModerationStatus; createdAt: string; updatedAt: string;
  authorName: string | null;
}

// Uploads a locally-recorded video straight from the device to Supabase
// Storage (never proxied through the API server), generating the
// testimony's id up front so the storage path can be created before the DB
// row exists — identical two-step shape to uploadSubmissionMedia.
export async function uploadTestimonyVideo(
  localUri: string,
  userId: string
): Promise<{ testimonyId: string; mediaPath: string } | null> {
  try {
    const testimonyId = generateUUID();
    const rawExtCandidate = localUri.split(".").pop()?.toLowerCase();
    const rawExt = rawExtCandidate && /^[a-z0-9]{2,5}$/.test(rawExtCandidate) ? rawExtCandidate : "mp4";
    const ext = rawExt === "mov" ? "mp4" : rawExt;
    const mediaPath = `${userId}/${testimonyId}/video.${ext}`;

    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from("prayer-testimonies")
      .upload(mediaPath, arrayBuffer, { contentType: "video/mp4", upsert: false });
    if (error) return null;
    return { testimonyId, mediaPath };
  } catch {
    return null;
  }
}

export function getTestimonySignedUrl(mediaPath: string): Promise<string | null> {
  return supabase.storage.from("prayer-testimonies").createSignedUrl(mediaPath, 3600)
    .then(({ data, error }) => (error || !data?.signedUrl ? null : data.signedUrl));
}

export function createTestimony(input: {
  id?: string; testimonyType: TestimonyType; title: string; testimonyText: string; requestId?: string | null;
  scriptureReference?: unknown; mediaType?: "video" | null; mediaPath?: string | null;
  mediaDurationSeconds?: number | null; isAnonymous?: boolean; visibility?: TestimonyVisibility;
}): Promise<PrayerTestimony> {
  return authedFetch("/prayer/testimonies", { method: "POST", body: JSON.stringify(input) });
}
export function getMyTestimonies(): Promise<PrayerTestimony[]> {
  return authedFetch("/prayer/testimonies/mine");
}
export function getTestimonyFeed(type?: TestimonyType): Promise<PrayerTestimony[]> {
  return authedFetch(`/prayer/testimonies/feed${type ? `?type=${type}` : ""}`);
}
export function getTestimony(id: string): Promise<PrayerTestimony> {
  return authedFetch(`/prayer/testimonies/${id}`);
}
export function updateTestimony(id: string, updates: Partial<{
  title: string; testimonyText: string; scriptureReference: unknown; isAnonymous: boolean; visibility: TestimonyVisibility;
}>): Promise<PrayerTestimony> {
  return authedFetch(`/prayer/testimonies/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteTestimony(id: string): Promise<{ removed: true }> {
  return authedFetch(`/prayer/testimonies/${id}`, { method: "DELETE" });
}
