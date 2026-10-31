// Listen: a Bible chapter (or selected verses) as content for the shared
// player — built here, not in the Bible screen, so moving to another chapter
// and "Continue to next chapter" keep working after the listener has left the
// Bible for another part of P2P Global. Text is the licensed chapter already
// fetched for reading (getChapter); nothing is stored.
import { router } from "expo-router";
import { BIBLE_COVER } from "@/constants/artwork";
import { bibleRoute, bookByCode, formatRef, getChapter, type BibleChapter } from "@/lib/bibleReaderApi";
import { loadLocale } from "@/lib/i18n";
import { listen, spokenLabels, type ListenAction, type ListenContent, type ListenSection } from "@/lib/listen";

export const bibleListenKey = (d: Pick<BibleChapter, "translation" | "book" | "chapter">) => `bible:${d.translation.code}:${d.book.code}.${d.chapter}`;

/**
 * The spoken heading, in the translation's language: "Proverbs Chapter 1."
 * (English selections name their verses — said as "chapter 3, verses 16 to 18").
 * A language without a "chapter" label gets no heading rather than English.
 */
export function bibleAnnouncement(d: BibleChapter, language: string, part?: { start: number; end: number }): ListenSection[] {
  const chapter = spokenLabels(language).chapter(d.chapter);
  if (!chapter) return [];
  const english = language.toLowerCase().startsWith("en");
  const text = part && english
    ? `${d.book.name} ${d.chapter}:${part.start}${part.end > part.start ? `–${part.end}` : ""}.`
    : `${d.book.name} ${chapter}.`;
  return [{ id: "heading", title: `${d.book.name} ${d.chapter}`, parts: [{ key: "heading", text }] }];
}

/** Listen to another chapter (the listener's choice): load it and play from its start. */
export async function playBibleChapter(bookCode: string, chapter: number, translation: string, language: string, actions: ListenAction[] = []) {
  const [d] = await Promise.all([getChapter(bookCode, chapter, translation), loadLocale(language)]);
  await listen.play(bibleListenContent(d, language, undefined, actions), "start", { present: listen.getState().presented });
}

/**
 * A chapter (or the verses `part`) as listening content. `actions` are extra
 * buttons for when listening ends (e.g. the reader's "Choose another passage").
 */
export function bibleListenContent(d: BibleChapter, language: string, part?: { start: number; end: number }, actions: ListenAction[] = []): ListenContent {
  const b = bookByCode(d.book.code);
  const verses = part ? d.verses.filter((v) => v.verse >= part.start && v.verse <= part.end) : d.verses;
  const t = d.translation.code;
  // Previous / next chapter: the listener's choice (a button), loaded here — works from anywhere in the app.
  const link = (to: { bookCode: string; chapter: number } | null) => to && !part
    ? { label: formatRef(bookByCode(to.bookCode), to.chapter), open: () => { void playBibleChapter(to.bookCode, to.chapter, t, language, actions).catch(() => {}); } }
    : null;
  const route = bibleRoute({ book: d.book.code, chapter: d.chapter, v: part?.start, ve: part?.end, translation: t });
  return {
    key: part ? `${bibleListenKey(d)}:${part.start}-${part.end}` : bibleListenKey(d),
    owner: "bible",
    kind: "bible",
    highlight: "part",
    title: formatRef(b, d.chapter, part?.start, part?.end),
    subtitle: d.translation.name,
    language,
    artwork: BIBLE_COVER,
    route,
    // First, where we are; then the verses, one part each — no verse numbers spoken.
    sections: [
      ...bibleAnnouncement(d, language, part),
      ...verses.map((v) => ({ id: String(v.verse), title: `Verse ${v.verse}`, parts: [{ key: String(v.verse), text: v.text }] })),
    ],
    previous: link(d.previous),
    next: link(d.next),
    // "Continue to next chapter" only ever goes to the next chapter of THIS book (never into another book).
    continueTo: part ? null
      : d.next && d.next.bookCode === d.book.code
        ? { chapter: d.next.chapter, label: formatRef(b, d.next.chapter), load: async () => bibleListenContent(await getChapter(d.book.code, d.next!.chapter, t), language, undefined, actions) }
        : null,
    completionActions: [
      { label: "Return to reading", icon: "book-outline", open: () => router.navigate(route as any) },
      ...actions,
    ],
    resumeGroup: part ? undefined : "bible",
    meta: { t, book: d.book.code, bookName: d.book.name, chapter: d.chapter, lastChapter: d.book.chapters },
  };
}
