// Listen: a Scripture collection or playlist, passage by passage, in its own
// order. Each passage is announced ("John 3:16–18.") and then read; the text
// is the licensed chapter fetched live for reading (getChapter, shared with
// the Bible reader) — nothing is stored. Each chapter is fetched once even
// when several passages come from it.
import { BIBLE_COVER } from "@/constants/artwork";
import { getChapter, type BibleChapter } from "@/lib/bibleReaderApi";
import { loadLocale } from "@/lib/i18n";
import { listen, type ListenContent, type ListenSection } from "@/lib/listen";
import { bibleAnnouncement } from "@/lib/listen/bibleContent";
import type { CollectionItem } from "@/lib/scriptureCollectionsApi";

export async function collectionListenContent(c: { id: string; title: string; kind: "collection" | "playlist"; items: CollectionItem[] }, language: string): Promise<ListenContent> {
  const chapters = new Map<string, Promise<BibleChapter | null>>();
  const chapterOf = (i: CollectionItem) => {
    const k = `${i.translationCode}:${i.bookCode}.${i.chapter}`;
    if (!chapters.has(k)) chapters.set(k, getChapter(i.bookCode, i.chapter, i.translationCode).catch(() => null));
    return chapters.get(k)!;
  };
  const loaded = await Promise.all(c.items.map(async (i) => ({ i, d: await chapterOf(i) })));
  const sections: ListenSection[] = [];
  for (const { i, d } of loaded) {
    if (!d) continue;
    const part = { start: i.startVerse, end: i.endVerse };
    const verses = d.verses.filter((v) => v.verse >= part.start && v.verse <= part.end);
    if (!verses.length) continue;
    // The heading names the passage; ids are made unique per item.
    const [heading] = bibleAnnouncement(d, language, part);
    const parts = [
      ...(heading ? heading.parts.map((p) => ({ ...p, key: `${i.id}:heading` })) : []),
      ...verses.map((v) => ({ key: `${i.id}:${v.verse}`, text: v.text })),
    ];
    sections.push({ id: i.id, title: i.reference, parts });
  }
  if (!sections.length) throw new Error("These passages couldn't be loaded. Please try again.");
  return {
    key: `collection:${c.id}`,
    owner: "scripture-collection",
    title: c.title,
    subtitle: c.kind === "playlist" ? "Scripture playlist" : "Scripture collection",
    language,
    highlight: "part",
    artwork: BIBLE_COVER,
    sections,
    route: { pathname: "/scripture-collections/[id]", params: { id: c.id } },
  };
}

/** Load and play from the start (or from one passage), opening the full player. */
export async function playCollection(c: Parameters<typeof collectionListenContent>[0], language: string, fromItemId?: string) {
  const [content] = await Promise.all([collectionListenContent(c, language), loadLocale(language)]);
  await listen.play(content, "start", { present: true });
  const from = fromItemId ? content.sections.find((s) => s.id === fromItemId) : null;
  if (from && from !== content.sections[0]) listen.seekPart(from.parts[0].key);
}
