// The shared content-loading foundation (React Query), used the same way on
// phones and web so no feature invents its own caching:
//   • identical requests made at the same time share ONE network call;
//   • content opened before shows at once from memory, and is refreshed in
//     the background when it's older than its `maxAge` (never shown as newer
//     than it is — the screen simply updates when fresh data arrives);
//   • everything is in memory only and cleared when the signed-in person
//     changes or signs out, so one person's private data (progress,
//     answers, saves) can never appear for another. Licensed Bible text is
//     never written to storage here.
// Screens keep their own state and simply ask `loadCached` instead of
// fetching directly; `peekCached` gives what's already known for an instant
// first paint.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Cache keys — one place, so a feature and its screens always agree. */
export const qk = {
  story: (id: string) => ["kingdom-story", id] as const,
  storiesHome: () => ["kingdom-stories", "discover"] as const,
  storyCategories: () => ["kingdom-stories", "categories"] as const,
  lessonContent: (id: string) => ["lesson-content", id] as const,
  plan: (id: string, userId: string | null | undefined) => ["plan", id, userId ?? "anon"] as const,
  curriculumCatalog: (userId: string | null | undefined) => ["curriculum-catalog", userId ?? "anon"] as const,
  bibleTranslations: () => ["bible", "translations"] as const,
  myStudies: () => ["study-together", "mine"] as const,
  learningOverview: () => ["learning-centre", "overview"] as const,
};

/**
 * The content for `key`: from memory when it's younger than `maxAgeMs`,
 * otherwise fetched (once, even if several screens ask together).
 * `fresh: true` always fetches (after the person changed something).
 */
export function loadCached<T>(key: readonly unknown[], fetcher: () => Promise<T>, opts: { maxAgeMs?: number; fresh?: boolean } = {}): Promise<T> {
  return queryClient.fetchQuery({ queryKey: key, queryFn: fetcher, staleTime: opts.fresh ? 0 : opts.maxAgeMs ?? 60_000 });
}

/** What's already loaded for `key` (possibly older), for an instant first paint. */
export function peekCached<T>(key: readonly unknown[]): T | undefined {
  return queryClient.getQueryData<T>(key);
}

/** Replace the cached value (after an edit) so other screens see it at once. */
export function setCached<T>(key: readonly unknown[], value: T) {
  queryClient.setQueryData(key, value);
}

/** Mark content as outdated, so the next visit fetches it. */
export function invalidateCached(key: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey: key });
}

/** Signed out, or another person signed in: forget everything. */
export function clearContentCache() {
  queryClient.clear();
}
