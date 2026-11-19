// Listen: a Bible chapter (or selected verses) as content for the shared
// player — built here, not in the Bible screen, so moving to another chapter
// and "Continue to next chapter" keep working after the listener has left the
// Bible for another part of P2P Global. Text is the licensed chapter already
// fetched for reading (getChapter); nothing is stored.
import { router } from "expo-router";
import { BIBLE_COVER } from "@/constants/artwork";
import { bibleRoute, bookByCode, formatRef, getChapter, getChapterAudio, getTranslations, type BibleChapter } from "@/lib/bibleReaderApi";
import { estimatedNarration, recordingDuration, sliceNarration } from "./chapterAudio";
import type { RecordedNarration } from "./narration";
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
  await listen.play(await withChapterAudio(bibleListenContent(d, language, undefined, actions), d), "start", { present: listen.getState().presented });
}

/**
 * A chapter (or the verses `part`) as listening content. `actions` are extra
 * buttons for when listening ends (e.g. the reader's "Choose another passage").
 */
/** The whole chapter's licensed recording with estimated positions (the chapter's parts, in reading order), or null. */
async function chapterRecording(d: BibleChapter, language: string): Promise<{ narration: RecordedNarration; texts: string[]; verseOf: (number | null)[] } | null> {
  if (d.offline) return null;
  let url: string | null = d.audio?.[0]?.url ?? null, reader = d.audio?.[0]?.reader ?? "";
  if (!url) {
    const tr = (await getTranslations().catch(() => null))?.translations.find((x) => x.code === d.translation.code);
    if (!tr?.recordedAudio) return null;
    const a = await getChapterAudio(d.translation.code, d.book.code, d.chapter);
    if (!a) return null;
    url = a.url; reader = a.reader;
  }
  const dur = await recordingDuration(url);
  if (!dur) return null;
  // Positions are estimated over the WHOLE chapter as it is read (heading + every verse), so a selection's verses
  // land where they are in the recording.
  const full = bibleListenContent(d, language);
  // The reader also reads the section headings ("Jisọs na Nikọdimọs") — counted in the timing (not highlighted), or
  // every verse after a heading would be highlighted too early (owner 2026-11-19: "the audio is not following the text").
  const headingsBefore = (v: number) => (d.headings ?? []).filter((h) => h.beforeVerse === v && h.text.trim()).map((h) => ({ text: h.text, verse: null as number | null }));
  const parts = full.sections.flatMap((s) => {
    const verse = /^\d+$/.test(s.id) ? Number(s.id) : null;
    return [...(verse !== null ? headingsBefore(verse) : []), ...s.parts.map((p) => ({ text: p.text, verse }))];
  });
  const narration = estimatedNarration(url, reader || d.translation.name, parts.map((p) => p.text), dur);
  return narration ? { narration, texts: parts.map((p) => p.text), verseOf: parts.map((p) => p.verse) } : null;
}

/** Just the verses start–end of the chapter's recording; `heading` (spoken words not in the recording) is skipped. */
export async function passageRecording(d: BibleChapter, language: string, start: number, end: number, heading: string[] = []): Promise<RecordedNarration | null> {
  try {
    const rec = await chapterRecording(d, language);
    if (!rec) return null;
    return sliceNarration(rec.narration, rec.texts, (i) => rec.verseOf[i] !== null && rec.verseOf[i]! >= start && rec.verseOf[i]! <= end, heading);
  } catch { return null; }
}

/**
 * The chapter's own LICENSED RECORDING, when its translation has one (owner 2026-11-19): AO Lab's recording that
 * came with the chapter, or the translation's API.Bible audio edition (streamed). It becomes the content's
 * narration, so P2P Listen plays the real recording first — never replaced by a generated voice. A selection of
 * verses plays just its stretch of the chapter's recording (owner 2026-11-19: Igbo should play everywhere).
 * No recording / no connection → the content as it was.
 */
export async function withChapterAudio(content: ListenContent, d: BibleChapter): Promise<ListenContent> {
  const whole = bibleListenKey(d);
  const sel = content.key.startsWith(`${whole}:`) ? /:(\d+)-(\d+)$/.exec(content.key) : null;
  if (content.key !== whole && !sel) return content;
  try {
    if (sel) {
      const heading = content.sections.filter((s) => !/^\d+$/.test(s.id)).flatMap((s) => s.parts.map((p) => p.text));
      const narration = await passageRecording(d, content.language, Number(sel[1]), Number(sel[2]), heading);
      return narration ? { ...content, narration, subtitle: `${d.translation.name} · Recorded audio` } : content;
    }
    const rec = await chapterRecording(d, content.language);
    return rec ? { ...content, narration: rec.narration, subtitle: `${d.translation.name} · Recorded audio` } : content;
  } catch { return content; }
}

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
        ? { chapter: d.next.chapter, label: formatRef(b, d.next.chapter), load: async () => { const nd = await getChapter(d.book.code, d.next!.chapter, t); return withChapterAudio(bibleListenContent(nd, language, undefined, actions), nd); } }
        : null,
    completionActions: [
      { label: "Return to reading", icon: "book-outline", open: () => router.navigate(route as any) },
      ...actions,
    ],
    resumeGroup: part ? undefined : "bible",
    meta: { t, book: d.book.code, bookName: d.book.name, chapter: d.chapter, lastChapter: d.book.chapters },
  };
}
