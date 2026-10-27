import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Kingdom Stories — P2P-curated EDITORIAL content (migration 152).
// Distinct from Kingdom Wins/P2P Impact (peer-authored testimony): only
// admin_content/super_admin can create or publish. No author identity is
// ever shown to peers — the content is the product, not a creator.
async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `studioRequired`: refused by the Publishing Studio approval gate or the
    // live-story freeze (migration 188) — the story was left unchanged.
    const b = body as { error?: string; code?: string; studioRequired?: boolean };
    throw Object.assign(new Error(b.error ?? "Request failed"), { status: res.status, code: b.code, studioRequired: b.studioRequired === true });
  }
  return body;
}

export type KingdomStoryContentType = "historical_story" | "person" | "movement" | "event" | "place" | "present_day_story" | "documentary" | "scripture_story";
export type KingdomStoryStatus = "draft" | "review" | "published" | "archived";
export type KingdomStoryMediaType = "image" | "video";

export const CONTENT_TYPE_LABELS: Record<KingdomStoryContentType, string> = {
  historical_story: "Historical Story", person: "Person", movement: "Movement", event: "Event", place: "Place",
  present_day_story: "Present-Day Story", documentary: "Documentary", scripture_story: "Scripture Story",
};

export interface KingdomStoryCategory {
  id: string; slug: string; title: string; description: string | null; displayOrder: number; status: "draft" | "published" | "archived";
  icon?: string | null;
}
export interface KingdomStoryMedia {
  id: string; mediaType: KingdomStoryMediaType; mediaPath: string; caption: string | null;
  displayOrder: number; isCover: boolean; durationSeconds: number | null;
  /** The chapter this image illustrates; null/absent = story-level (cover, gallery). */
  chapterId?: string | null;
  /** Migration 212: accessibility description and attribution (optional). */
  altText?: string | null; sourceUrl?: string | null; licenseNote?: string | null; imageKind?: KingdomImageKind | null;
  /** Migration 215: where the image is used; null = cover/chapter/gallery by its other fields. */
  role?: MediaRole | null;
}
export type MediaRole = "cover" | "hero" | "overview" | "chapter" | "thumbnail" | "gallery";
export type KingdomImageKind = "artistic_illustration" | "historical_photograph" | "artefact" | "manuscript" | "location_photograph" | "ai_generated" | "other";
export const IMAGE_KIND_LABELS: Record<KingdomImageKind, string> = {
  artistic_illustration: "Artistic illustration", historical_photograph: "Historical photograph", artefact: "Historical artefact",
  manuscript: "Manuscript", location_photograph: "Modern photograph of the place", ai_generated: "AI-generated illustration (not a historical record)", other: "Image",
};
export interface KingdomStorySource {
  id: string; title: string; publisher: string | null; url: string | null; citation: string | null;
  sourceType: string | null; displayOrder: number; chapterId?: string | null;
}
export interface KingdomStory {
  id: string; title: string; subtitle: string | null; categoryId: string;
  category?: { slug: string; title: string } | null;
  contentType: KingdomStoryContentType | null; body: string;
  historicalPeriod: string | null; startYear: number | null; endYear: number | null;
  location: string | null; people: string | null; learningSection: string | null; reflection: string | null;
  scriptureReferenceId: string | null;
  relatedMissionFieldId: string | null; relatedMissionStoryId: string | null; relatedCurriculumId: string | null;
  relatedKingdomWinId: string | null; relatedStoryId: string | null;
  related?: {
    missionField?: { id: string; slug: string; title: string };
    missionStory?: { id: string; title: string };
    curriculum?: { id: string; title: string };
    kingdomWin?: { id: string; title: string };
    story?: { id: string; title: string; status: string };
  };
  isFeatured: boolean; status: KingdomStoryStatus; editorId: string | null;
  createdAt: string; updatedAt: string; publishedAt: string | null; archivedAt: string | null;
  media?: KingdomStoryMedia[]; sources?: KingdomStorySource[];
  topicId?: string | null; chapters?: KingdomStoryChapter[];
  /** Storybook (migration 212): the reader's progress through this book. */
  progress?: StoryProgress;
  /** Story cards: chapters this reader has finished (submitted or completed). */
  myProgress?: { totalChapters: number; doneChapters: number; started: boolean } | null;
  /** Stable display number within its category (migration 215) — never the id. */
  topicNumber?: number | null;
  /** The reader's own Favourite / Saved for Later (migration 215). */
  mine?: { favourite: boolean; later: boolean };
  /** Recently viewed shelf: when it was last opened and which chapter. */
  lastOpenedAt?: string; lastChapterId?: string | null;
}

/** "Topic 012" — the same everywhere a story is listed. */
export function formatTopicNumber(n: number | null | undefined): string | null {
  return n ? `Topic ${String(n).padStart(3, "0")}` : null;
}

// ── Personal library (migration 215) ─────────────────────────────────────────
export type LibraryShelf = "favourites" | "later" | "recent" | "in_progress" | "completed";
export const SHELF_LABELS: Record<LibraryShelf, string> = {
  favourites: "My Favourites", later: "Saved for Later", recent: "Recently Viewed", in_progress: "In Progress", completed: "Completed",
};
export function getLibraryShelf(shelf: LibraryShelf, limit = 30): Promise<{ shelf: LibraryShelf; stories: KingdomStory[]; available: boolean }> {
  return authedFetch(`/kingdom-stories/me/library?shelf=${shelf}&limit=${limit}`);
}
export function saveStory(storyId: string, kind: "favourite" | "later"): Promise<{ saved: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/save`, { method: "POST", body: JSON.stringify({ kind }) });
}
export function unsaveStory(storyId: string, kind: "favourite" | "later"): Promise<{ saved: false }> {
  return authedFetch(`/kingdom-stories/${storyId}/save/${kind}`, { method: "DELETE" });
}
/** Recently viewed + resume; never counts as progress. Best-effort (never throws). */
export function markStoryOpened(storyId: string, chapterId?: string | null): Promise<void> {
  return authedFetch(`/kingdom-stories/${storyId}/opened`, { method: "POST", body: JSON.stringify(chapterId ? { chapterId } : {}) }).then(() => {}, () => {});
}
export type FeedSort = "topic" | "title" | "recent" | "updated";

// ── Discovery homepage + editorial collections (migration 215) ──────────────
export type StoryCard = KingdomStory & { lastChapterNumber?: number | null };
export interface DiscoverHome {
  featured: (StoryCard & { hero: { id: string; mediaPath: string; altText: string | null } | null }) | null;
  continueLearning: StoryCard[]; favourites: StoryCard[]; later: StoryCard[]; recentlyViewed: StoryCard[];
  collections: { id: string; slug: string; title: string; description: string | null; stories: StoryCard[]; total: number }[];
  categoryRows: { category: { id: string; slug: string; title: string; icon: string | null }; stories: StoryCard[]; total: number }[];
  recentlyAdded: StoryCard[]; totalPublished: number; libraryAvailable: boolean;
}
export function getDiscoverHome(): Promise<DiscoverHome> { return authedFetch("/kingdom-stories/discover"); }
export function getStoryCollection(slug: string): Promise<{ id: string; slug: string; title: string; description: string | null; stories: StoryCard[] }> {
  return authedFetch(`/kingdom-stories/collections/${encodeURIComponent(slug)}`);
}
export interface StoryCollectionAdmin { id: string; slug: string; title: string; description: string | null; displayOrder: number; status: "draft" | "published" | "archived"; updatedAt: string; storyIds: string[] }
export function getStoryCollectionsAdmin(): Promise<{ collections: StoryCollectionAdmin[] }> { return authedFetch("/kingdom-stories/admin/collections"); }
export function createStoryCollection(input: { title: string; description?: string; displayOrder?: number }): Promise<StoryCollectionAdmin> {
  return authedFetch("/kingdom-stories/admin/collections", { method: "POST", body: JSON.stringify(input) });
}
export function updateStoryCollection(id: string, input: Partial<{ title: string; description: string | null; displayOrder: number; status: "draft" | "published" | "archived" }>): Promise<StoryCollectionAdmin> {
  return authedFetch(`/kingdom-stories/admin/collections/${id}`, { method: "PUT", body: JSON.stringify(input) });
}
export function setStoryCollectionStories(id: string, storyIds: string[]): Promise<{ storyIds: string[] }> {
  return authedFetch(`/kingdom-stories/admin/collections/${id}/stories`, { method: "PUT", body: JSON.stringify({ storyIds }) });
}
export function deleteStoryCollection(id: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/admin/collections/${id}`, { method: "DELETE" });
}
export type ChapterState = "locked" | "available" | "in_progress" | "awaiting_review" | "completed" | "preview";
export interface ChapterLearning {
  lessonId: string | null;
  state: ChapterState;
  remaining: Array<"comprehensive_check" | "finish_reading">;
  reflectionQuestions: Array<{ id: string; question: string }>;
  check: { assignmentId: string; title: string; questions: Array<{ id: string; question: string }> } | null;
  reflectionsAnswered: number;
}
export interface StoryProgress {
  totalChapters: number; completedChapters: number; awaitingReviewChapters: number;
  currentChapterId: string | null; started: boolean; finished: boolean;
}

// ── Catalogue (migration 210): Category → Topic → Story → Chapters ──────────
/** Exactly this many Kingdom Lessons and Peer Reflection Questions per chapter to publish. */
export const CHAPTER_ITEMS = 5;
export interface KingdomStoryChapter {
  id: string; storyId: string; chapterNumber: number; title: string; narrative: string;
  people: string | null; places: string | null; dates: string | null; scriptureRefs: string | null;
  evidence: { documented: string | null; testimony: string | null; tradition: string | null; disputed: string | null };
  lessons: string[]; reflections: string[]; complete: boolean; sources: KingdomStorySource[];
  /** Optional chapter Comprehensive Check (stored as the 211 assignment field): title and task. */
  assignment?: { title: string | null; text: string | null } | null;
  /** Migration 212: the chapter's lesson in the Core Curriculum learning engine. */
  lessonId?: string | null;
  /** Storybook state for the signed-in reader (absent from editor-only endpoints). */
  learning?: ChapterLearning;
}
export type ChapterInput = Partial<Pick<KingdomStoryChapter, "title" | "narrative" | "people" | "places" | "dates" | "scriptureRefs" | "lessons" | "reflections">> & {
  evidence?: Partial<KingdomStoryChapter["evidence"]>;
  assignmentTitle?: string | null; assignment?: string | null;
};
/** A category as readers see it: published stories and planned topics counted separately. */
export interface CatalogueCategory {
  id: string; slug: string; title: string; description: string | null; icon: string | null; displayOrder: number;
  publishedStories: number; plannedTopics: number;
}
/** Editors' category lists: active categories in their order, inactive ones after them. */
export function editorCategoryOrder<T extends Pick<KingdomStoryCategory, "status" | "displayOrder">>(cats: T[]): T[] {
  return [...cats].sort((a, b) => Number(a.status !== "published") - Number(b.status !== "published") || a.displayOrder - b.displayOrder);
}
/** Reader labels, kept separate: "3 stories" / "No stories yet", and "12 planned" (null when none). */
export function categoryCountLabels(cat: Pick<CatalogueCategory, "publishedStories" | "plannedTopics">): { published: string; planned: string | null } {
  const n = cat.publishedStories;
  return {
    published: n === 0 ? "No stories yet" : n === 1 ? "1 story" : `${n} stories`,
    planned: cat.plannedTopics > 0 ? `${cat.plannedTopics} planned` : null,
  };
}
export const TOPIC_STATUSES = ["topic", "researching", "drafting", "in_review", "ready_to_publish", "published", "archived"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];
export const TOPIC_STATUS_LABELS: Record<TopicStatus, string> = {
  topic: "Topic", researching: "Researching", drafting: "Drafting", in_review: "In review",
  ready_to_publish: "Ready to publish", published: "Published", archived: "Archived",
};
export const TOPIC_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type TopicPriority = (typeof TOPIC_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<TopicPriority, string> = {
  P1: "P1 · Foundational", P2: "P2 · Major historical", P3: "P3 · Regional / specialised", P4: "P4 · Future expansion",
};
export interface KingdomStoryTopic {
  id: string; slug: string; title: string; categoryId: string; summary: string | null; tags: string[];
  historicalPeriod: string | null; region: string | null; keyPeople: string | null; researchNotes: string | null;
  priority: TopicPriority; status: TopicStatus; displayOrder: number; overlapNote: string | null;
  createdAt: string; updatedAt: string;
  stories?: { id: string; title: string; status: KingdomStoryStatus }[];
}
export type TopicInput = Partial<Pick<KingdomStoryTopic, "title" | "categoryId" | "summary" | "tags" | "historicalPeriod" | "region" | "keyPeople" | "researchNotes" | "priority" | "status" | "overlapNote">>;
export interface CatalogueOverview {
  totals: { categories: number; activeCategories: number; topics: number; stories: number; topicsWithStory: number };
  topicsByStatus: Partial<Record<TopicStatus, number>>;
  topicsByPriority: Partial<Record<TopicPriority, number>>;
  storiesByStatus: Partial<Record<KingdomStoryStatus, number>>;
  categories: { id: string; slug: string; title: string; status: string; displayOrder: number; icon: string | null; topics: number; topicsByStatus: Partial<Record<TopicStatus, number>>; publishedStories: number; storiesInProgress: number }[];
  storiesInProgress: { id: string; title: string; status: KingdomStoryStatus; topicId: string | null; chapters: number; complete: number }[];
}

export function getCatalogueCategories(): Promise<{ categories: CatalogueCategory[] }> {
  return authedFetch("/kingdom-stories/catalogue/categories");
}
export function searchKingdomStories(q: string, page = 0): Promise<{ stories: KingdomStory[]; total: number; page: number; pageSize: number }> {
  return authedFetch(`/kingdom-stories/feed?${new URLSearchParams({ q, page: String(page), limit: "20" })}`);
}
export function getCatalogueOverview(): Promise<CatalogueOverview> {
  return authedFetch("/kingdom-stories/admin/catalogue/overview");
}
export function getTopics(filters: { category?: string; status?: TopicStatus; priority?: TopicPriority; q?: string; period?: string; region?: string; page?: number; limit?: number } = {}): Promise<{ topics: KingdomStoryTopic[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") q.set(k, String(v));
  return authedFetch(`/kingdom-stories/admin/topics?${q}`);
}
export function getTopic(id: string): Promise<KingdomStoryTopic> {
  return authedFetch(`/kingdom-stories/admin/topics/${id}`);
}
export function createTopic(input: TopicInput & { title: string; categoryId: string }): Promise<KingdomStoryTopic> {
  return authedFetch("/kingdom-stories/admin/topics", { method: "POST", body: JSON.stringify(input) });
}
export function updateTopic(id: string, input: TopicInput): Promise<KingdomStoryTopic> {
  return authedFetch(`/kingdom-stories/admin/topics/${id}`, { method: "PUT", body: JSON.stringify(input) });
}
export function reorderTopics(categoryId: string, orderedIds: string[]): Promise<{ ok: true }> {
  return authedFetch("/kingdom-stories/admin/topics/reorder", { method: "POST", body: JSON.stringify({ categoryId, orderedIds }) });
}
export function createStoryFromTopic(topicId: string): Promise<{ story: { id: string; title: string; status: KingdomStoryStatus } }> {
  return authedFetch(`/kingdom-stories/admin/topics/${topicId}/story`, { method: "POST" });
}
export function linkStoryToTopic(topicId: string, storyId: string): Promise<{ story: { id: string } }> {
  return authedFetch(`/kingdom-stories/admin/topics/${topicId}/link`, { method: "POST", body: JSON.stringify({ storyId }) });
}
export function unlinkStoryFromTopic(topicId: string, storyId: string): Promise<{ unlinked: true }> {
  return authedFetch(`/kingdom-stories/admin/topics/${topicId}/link/${storyId}`, { method: "DELETE" });
}
export function addChapter(storyId: string, input: ChapterInput = {}): Promise<KingdomStoryChapter> {
  return authedFetch(`/kingdom-stories/${storyId}/chapters`, { method: "POST", body: JSON.stringify(input) });
}
export function updateChapter(storyId: string, chapterId: string, input: ChapterInput): Promise<KingdomStoryChapter> {
  return authedFetch(`/kingdom-stories/${storyId}/chapters/${chapterId}`, { method: "PUT", body: JSON.stringify(input) });
}
export function reorderChapters(storyId: string, orderedIds: string[]): Promise<{ ok: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/chapters/reorder`, { method: "POST", body: JSON.stringify({ orderedIds }) });
}
export function deleteChapter(storyId: string, chapterId: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/chapters/${chapterId}`, { method: "DELETE" });
}

export function getKingdomStoryCategories(): Promise<KingdomStoryCategory[]> {
  return authedFetch("/kingdom-stories/categories");
}
export function getKingdomStoriesFeed(opts: { category?: string; featured?: boolean; page?: number; limit?: number; sort?: FeedSort } = {}): Promise<{ stories: KingdomStory[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (opts.category) q.set("category", opts.category);
  if (opts.featured) q.set("featured", "true");
  if (opts.sort && opts.sort !== "topic") q.set("sort", opts.sort);
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  return authedFetch(`/kingdom-stories/feed?${q}`);
}
export function getKingdomStory(id: string): Promise<KingdomStory> {
  return authedFetch(`/kingdom-stories/${id}`);
}

// ── Admin (admin_content / super_admin only) ────────────────────────────────
export function getKingdomStoriesAdminList(status?: KingdomStoryStatus): Promise<KingdomStory[]> {
  return authedFetch(`/kingdom-stories/admin/list${status ? `?status=${status}` : ""}`);
}
export function createKingdomStory(input: Partial<KingdomStory> & { title: string; body: string; categoryId: string }): Promise<KingdomStory> {
  return authedFetch("/kingdom-stories", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStory(id: string, updates: Partial<KingdomStory>): Promise<KingdomStory> {
  return authedFetch(`/kingdom-stories/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteKingdomStory(id: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${id}`, { method: "DELETE" });
}
export function addKingdomStoryMedia(storyId: string, input: { id?: string; mediaType: KingdomStoryMediaType; mediaPath: string; caption?: string; displayOrder?: number; isCover?: boolean; durationSeconds?: number; chapterId?: string | null; role?: MediaRole | null }): Promise<KingdomStoryMedia> {
  return authedFetch(`/kingdom-stories/${storyId}/media`, { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStoryMedia(storyId: string, mediaId: string, updates: Partial<{ caption: string; displayOrder: number; isCover: boolean; chapterId: string | null; altText: string | null; sourceUrl: string | null; licenseNote: string | null; imageKind: KingdomImageKind | null; role: MediaRole | null }>): Promise<KingdomStoryMedia> {
  return authedFetch(`/kingdom-stories/${storyId}/media/${mediaId}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteKingdomStoryMedia(storyId: string, mediaId: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/media/${mediaId}`, { method: "DELETE" });
}
export function addKingdomStorySource(storyId: string, input: { title: string; publisher?: string; url?: string; citation?: string; sourceType?: string; displayOrder?: number; chapterId?: string }): Promise<KingdomStorySource> {
  return authedFetch(`/kingdom-stories/${storyId}/sources`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteKingdomStorySource(storyId: string, sourceId: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/sources/${sourceId}`, { method: "DELETE" });
}
export function createKingdomStoryCategory(input: { slug: string; title: string; description?: string; displayOrder?: number }): Promise<KingdomStoryCategory> {
  return authedFetch("/kingdom-stories/admin/categories", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStoryCategory(id: string, updates: Partial<{ title: string; description: string; displayOrder: number; status: "draft" | "published" | "archived" }>): Promise<KingdomStoryCategory> {
  return authedFetch(`/kingdom-stories/admin/categories/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}

// ── Media upload — same client-generated-id shape used throughout this app,
// but path-scoped by STORY id, not user id (editorial content has no
// per-user ownership).
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export async function uploadKingdomStoryImage(storyId: string, asset: { uri: string; mimeType?: string; fileName?: string | null }): Promise<{ mediaId: string; mediaPath: string } | null> {
  try {
    const { resolveMediaUpload } = await import("@/lib/mediaUpload");
    const { ext, contentType } = resolveMediaUpload(asset);
    const mediaId = generateUUID();
    const mediaPath = `${storyId}/${mediaId}.${ext}`;
    const response = await fetch(asset.uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-stories-media").upload(mediaPath, arrayBuffer, { contentType, upsert: false });
    if (error) return null;
    return { mediaId, mediaPath };
  } catch {
    return null;
  }
}
export async function uploadKingdomStoryVideo(storyId: string, localUri: string): Promise<{ mediaId: string; mediaPath: string } | null> {
  try {
    const mediaId = generateUUID();
    const rawExt = localUri.split(".").pop()?.toLowerCase();
    const ext = rawExt && /^[a-z0-9]{2,5}$/.test(rawExt) ? (rawExt === "mov" ? "mp4" : rawExt) : "mp4";
    const mediaPath = `${storyId}/${mediaId}.${ext}`;
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-stories-media").upload(mediaPath, arrayBuffer, { contentType: "video/mp4", upsert: false });
    if (error) return null;
    return { mediaId, mediaPath };
  } catch {
    return null;
  }
}
/** Finish a chapter that has no Comprehensive Check (opens the next one). */
export function finishKingdomStoryChapter(storyId: string, chapterId: string): Promise<{ finished: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/chapters/${chapterId}/finish`, { method: "POST" });
}
/** Editors: prepare a draft's reflections and Comprehensive Checks for preview (publishing does it too). */
export function syncKingdomStoryLearning(storyId: string): Promise<{ lessons: number; reflection_questions: number; comprehensive_checks: number }> {
  return authedFetch(`/kingdom-stories/${storyId}/learning/sync`, { method: "POST" });
}
export function getKingdomStoryMediaSignedUrl(mediaPath: string): Promise<string | null> {
  return supabase.storage.from("kingdom-stories-media").createSignedUrl(mediaPath, 3600)
    .then(({ data, error }) => (error || !data?.signedUrl ? null : data.signedUrl));
}
