import { getApiUrl } from "./apiUrl";

export interface VerseResult {
  text: string;
  translationCode: string;
  language: string;
  fromCache: boolean;
  fallback: boolean;
}

// In-memory cache to avoid repeated network calls within a session
const sessionCache = new Map<string, VerseResult | null>();

function cacheKey(ref: string, lang: string): string {
  return `${lang}:${ref.toLowerCase().trim()}`;
}

/**
 * Fetch verse text for a single reference in the given language.
 * Returns null if not available (caller should fall back to stored English text).
 */
export async function fetchVerseText(
  ref: string,
  lang: string
): Promise<VerseResult | null> {
  if (!ref?.trim() || lang === "en") return null;

  const key = cacheKey(ref, lang);
  if (sessionCache.has(key)) return sessionCache.get(key) ?? null;

  const apiUrl = getApiUrl();
  if (!apiUrl) return null;

  try {
    const res = await fetch(
      `${apiUrl}/bible/verse?ref=${encodeURIComponent(ref)}&lang=${encodeURIComponent(lang)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      sessionCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as VerseResult;
    sessionCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Batch fetch verse texts for multiple references.
 * Returns a map: ref → VerseResult (missing refs are absent from map).
 */
export async function fetchBatchVerseText(
  refs: Array<{ id: string; ref: string }>,
  lang: string
): Promise<Map<string, VerseResult>> {
  const results = new Map<string, VerseResult>();
  if (!refs.length || lang === "en") return results;

  const apiUrl = getApiUrl();
  if (!apiUrl) return results;

  // Separate cached from uncached
  const uncached: Array<{ id: string; ref: string }> = [];
  for (const item of refs) {
    const key = cacheKey(item.ref, lang);
    if (sessionCache.has(key)) {
      const val = sessionCache.get(key);
      if (val) results.set(item.id, val);
    } else {
      uncached.push(item);
    }
  }

  if (!uncached.length) return results;

  try {
    const res = await fetch(`${apiUrl}/bible/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: uncached, lang }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return results;
    const data = (await res.json()) as Record<string, VerseResult>;
    for (const [id, val] of Object.entries(data)) {
      results.set(id, val);
      // Find the ref to populate session cache
      const item = uncached.find((u) => u.id === id);
      if (item) sessionCache.set(cacheKey(item.ref, lang), val);
    }
    // Cache misses as null
    for (const item of uncached) {
      if (!results.has(item.id)) {
        sessionCache.set(cacheKey(item.ref, lang), null);
      }
    }
  } catch {
    // Network error — return what we have
  }

  return results;
}

/** Clear session cache (e.g. when contentLanguage changes) */
export function clearVerseCache(): void {
  sessionCache.clear();
}
