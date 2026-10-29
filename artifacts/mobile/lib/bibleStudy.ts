import { bibleRoute, readerTarget } from "@/lib/bibleReaderApi";
import type { ScriptureReference } from "@/lib/prayerTopicsApi";

/**
 * Where a curated topic reference opens in the P2P Bible reader (in context,
 * in its translation when one is set), or null when it can't be read there —
 * never an outside website.
 */
export function topicPassageRoute(r: Pick<ScriptureReference, "book" | "chapter" | "startVerse" | "endVerse" | "translationCode">) {
  const t = readerTarget(`${r.book} ${r.chapter}:${r.startVerse}-${r.endVerse}`);
  return t ? bibleRoute({ ...t, translation: r.translationCode }) : null;
}
