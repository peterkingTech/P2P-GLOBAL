import { getChapter, type BibleChapter, type BibleTranslation } from "@/lib/bibleReaderApi";

// Family Circle / Church Gathering Scripture — the decisions behind the
// passage panel, kept here so they can be tested on their own.
//   • Only the REFERENCE is shared (book, chapter, verses, translation the
//     Guide chose); every member fetches the text from the licensed API.
//   • A member may READ the shared passage in another licensed translation;
//     that is personal and never changes the group's passage.
//   • Never a silent substitution: if a translation isn't available, the
//     panel says which one it shows instead.

export interface SharedRef { book: string; chapter: number; startVerse: number; endVerse: number; translation: string; translationName?: string }

/** One request per chapter+translation: the picker (verse count) and the passage share it. */
const chapterCache = new Map<string, Promise<BibleChapter>>();
export function cachedChapter(bookCode: string, chapter: number, translation: string): Promise<BibleChapter> {
  const key = `${translation}:${bookCode}:${chapter}`;
  let p = chapterCache.get(key);
  if (!p) {
    p = getChapter(bookCode, chapter, translation);
    chapterCache.set(key, p);
    p.catch(() => chapterCache.delete(key)); // a failure is retried next time
  }
  return p;
}
export function __clearChapterCache() { chapterCache.clear(); }

/** Validates a typed verse range against the chapter's real length. */
export function checkVerseRange(startText: string, endText: string, verseCount: number | null):
  { ok: true; start: number; end: number } | { ok: false; error: string } {
  const start = Number(startText.trim()), endRaw = endText.trim() === "" ? start : Number(endText.trim());
  if (!Number.isInteger(start) || start < 1) return { ok: false, error: "Enter the first verse as a number (1 or more)." };
  if (!Number.isInteger(endRaw) || endRaw < 1) return { ok: false, error: "Enter the last verse as a number." };
  if (endRaw < start) return { ok: false, error: "The last verse comes before the first." };
  if (verseCount != null && start > verseCount) return { ok: false, error: `This chapter has ${verseCount} verse${verseCount === 1 ? "" : "s"}.` };
  return { ok: true, start, end: verseCount != null ? Math.min(endRaw, verseCount) : endRaw };
}

/** The whole chapter, as a shareable range. */
export const fullChapterRange = (verseCount: number) => ({ start: 1, end: Math.max(1, verseCount) });
export const isWholeChapter = (ref: { startVerse: number; endVerse: number }, verseCount: number | null) =>
  ref.startVerse === 1 && verseCount != null && ref.endVerse >= verseCount;

/** "John 3" for a whole chapter, "John 3:16" / "John 3:16-18" otherwise. */
export function passageLabel(ref: { book: string; chapter: number; startVerse: number; endVerse: number }, verseCount: number | null): string {
  if (isWholeChapter(ref, verseCount)) return `${ref.book} ${ref.chapter}`;
  return `${ref.book} ${ref.chapter}:${ref.startVerse}${ref.endVerse > ref.startVerse ? `-${ref.endVerse}` : ""}`;
}

/**
 * Which licensed translation THIS member reads the shared passage in.
 * personal (if chosen and licensed) → the Guide's (if licensed) → the default
 * licensed one for the language. `note` explains any difference, so a
 * substitution is never silent.
 */
export function readingTranslation(sharedCode: string, personalCode: string | null, list: Pick<BibleTranslation, "code" | "name" | "language" | "isDefault">[], language = "en"):
  { code: string | null; note: string | null; personal: boolean } {
  const has = (c: string | null | undefined) => !!c && list.some((t) => t.code === c);
  const name = (c: string) => list.find((t) => t.code === c)?.code ?? c;
  if (personalCode && has(personalCode)) {
    return { code: personalCode, personal: personalCode !== sharedCode, note: personalCode !== sharedCode && sharedCode ? `You're reading in ${name(personalCode)}. The Guide shared ${sharedCode}.` : null };
  }
  if (has(sharedCode)) return { code: sharedCode, personal: false, note: null };
  const fallback = list.find((t) => t.isDefault && t.language === language) ?? list[0];
  if (!fallback) return { code: null, personal: false, note: null };
  return { code: fallback.code, personal: false, note: `${sharedCode || "That translation"} isn't available — shown in ${fallback.code}.` };
}
