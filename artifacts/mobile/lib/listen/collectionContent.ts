// Listen: a Scripture collection or playlist, passage by passage, in the
// listening order given. Each passage is announced ("John 3:16–18.") and then
// read; the text is the licensed chapter fetched live for reading (getChapter,
// shared with the Bible reader) — nothing is stored. Each chapter is fetched
// once even when several passages come from it. A passage that can't be
// loaded is never dropped silently: it is reported back (`unavailable`) so the
// player can say so and offer to try again.
import { BIBLE_COVER } from "@/constants/artwork";
import { getChapter, type BibleChapter, type NewRef } from "@/lib/bibleReaderApi";
import type { ListenContent, ListenSection } from "@/lib/listen";
import { bibleAnnouncement } from "@/lib/listen/bibleContent";
import type { CollectionItem } from "@/lib/scriptureCollectionsApi";

/** One passage in a listening queue: `key` is unique in the queue (a playlist item id, or a generated one). */
export interface QueueEntry { key: string; itemId: string | null; ref: NewRef; reference: string }
export const entryOf = (i: CollectionItem): QueueEntry => ({
  key: i.id, itemId: i.id, reference: i.reference,
  ref: { translationCode: i.translationCode, bookCode: i.bookCode, chapter: i.chapter, startVerse: i.startVerse, endVerse: i.endVerse },
});

export interface PlaylistMeta { id: string | null; title: string; kind: "collection" | "playlist" | "queue" }
/** The content the shared player reads, plus the passages that couldn't be loaded. */
export async function playlistContent(meta: PlaylistMeta, entries: QueueEntry[], language: string): Promise<{ content: ListenContent; unavailable: QueueEntry[] }> {
  const chapters = new Map<string, Promise<BibleChapter | null>>();
  const chapterOf = (r: NewRef) => {
    const k = `${r.translationCode}:${r.bookCode}.${r.chapter}`;
    if (!chapters.has(k)) chapters.set(k, getChapter(r.bookCode, r.chapter, r.translationCode).catch(() => null));
    return chapters.get(k)!;
  };
  const loaded = await Promise.all(entries.map(async (e) => ({ e, d: await chapterOf(e.ref) })));
  const sections: ListenSection[] = [];
  const unavailable: QueueEntry[] = [];
  for (const { e, d } of loaded) {
    const verses = d ? d.verses.filter((v) => v.verse >= e.ref.startVerse && v.verse <= e.ref.endVerse) : [];
    if (!d || !verses.length) { unavailable.push(e); continue; }
    // The heading names the passage; ids are unique per queue entry.
    const [heading] = bibleAnnouncement(d, language, { start: e.ref.startVerse, end: e.ref.endVerse });
    const parts = [
      ...(heading ? heading.parts.map((p) => ({ ...p, key: `${e.key}:heading` })) : []),
      ...verses.map((v) => ({ key: `${e.key}:${v.verse}`, text: v.text })),
    ];
    sections.push({ id: e.key, title: e.reference, parts });
  }
  if (!sections.length) throw new Error("These passages couldn't be loaded. Please check your connection and try again.");
  return {
    unavailable,
    content: {
      key: meta.id ? `collection:${meta.id}` : `queue:${entries.map((e) => e.key).join(",").slice(0, 200)}`,
      owner: "scripture-collection",
      kind: "playlist",
      title: meta.title,
      subtitle: meta.kind === "playlist" ? "Scripture playlist" : meta.kind === "collection" ? "Scripture collection" : "Listening queue",
      language,
      highlight: "part",
      artwork: BIBLE_COVER,
      sections,
      route: meta.id ? { pathname: "/scripture-collections/[id]", params: { id: meta.id } } : { pathname: "/library" },
    },
  };
}

/** Load and play from the start (or from one passage), opening the full player. Kept for existing callers. */
export async function playCollection(c: { id: string; title: string; kind: "collection" | "playlist"; items: CollectionItem[] }, _language: string, fromItemId?: string) {
  const { playEntries } = await import("@/lib/listen/playlistSession");
  await playEntries({ id: c.id, title: c.title, kind: c.kind }, c.items.map(entryOf), { startKey: fromItemId ?? null });
}
