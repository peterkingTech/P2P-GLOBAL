// Pure helpers for the Kingdom Stories storybook (no React, no network), so
// they can be tested on their own: Scripture references → P2P Bible targets,
// book paragraphs, chapter status wording, reading progress.
import { readerTarget } from "@/lib/bibleReaderApi";
import type { ChapterState, KingdomStoryChapter, StoryProgress } from "@/lib/kingdomStoriesApi";

export interface ScriptureLink {
  label: string;
  target: { book: string; chapter: number; v?: number; ve?: number } | null;
}

/** "Book 1:2" without the verse part, to carry a book across "; 21:8–21" shorthand. */
function bookOf(ref: string): string | null {
  const m = ref.trim().match(/^((?:[1-3]\s?)?[A-Za-z]+(?:\s(?:of\s)?[A-Za-z]+)*)\.?\s+\d/);
  return m ? m[1] : null;
}

function target(ref: string): ScriptureLink["target"] {
  const t = readerTarget(ref);
  if (!t) return null;
  // A range that runs into the next chapter ("5:13–6:27") opens at its first verse.
  if (t.v && t.ve && t.ve < t.v) return { book: t.book, chapter: t.chapter, v: t.v, ve: t.v };
  return t;
}

/**
 * A chapter's Scripture line ("Genesis 16; 21:8–21; Psalm 34:18") → one link
 * per reference. A part that starts with a number continues the previous
 * book. Anything that isn't a recognisable reference is kept as plain text
 * (target null) rather than guessed.
 */
export function scriptureLinks(line: string | null | undefined): ScriptureLink[] {
  const out: ScriptureLink[] = [];
  let lastBook: string | null = null;
  for (const raw of String(line ?? "").split(/;/)) {
    const part = raw.trim().replace(/\.$/, "");
    if (!part) continue;
    const full: string = /^\d/.test(part) && lastBook && /^\d{1,3}(:\d|\s*$|[–-])/.test(part) ? `${lastBook} ${part}` : part;
    const t = target(full);
    if (t) lastBook = bookOf(full) ?? lastBook;
    out.push({ label: full, target: t });
  }
  return out;
}

// "Hebrews 11:31", "1 Corinthians 5:7", "James 2:25", "Revelation 2:10–11"
// Only "Song of Solomon/Songs" has a multi-word name, so "Read Revelation 2:10" finds Revelation.
const INLINE_REF = /\b((?:[1-3]\s)?(?:Song\sof\s(?:Solomon|Songs)|[A-Z][a-z]+))\s(\d{1,3}):(\d{1,3})(?:[–-](\d{1,3}))?\b/g;

/** Splits narrative text into plain runs and verified Scripture references. */
export function inlineScripture(text: string): Array<{ text: string; target?: ScriptureLink["target"] }> {
  const out: Array<{ text: string; target?: ScriptureLink["target"] }> = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_REF)) {
    const t = target(m[0]);
    if (!t) continue; // "Chapter 3:2" or a name that isn't a Bible book stays plain text
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], target: t });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** Book paragraphs: blank-line separated, trimmed, never empty. */
export function paragraphs(text: string | null | undefined): string[] {
  return String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** The story's overview lines ("Central theme: …", "Primary Scripture: …") vs. its introduction. */
export function storyIntro(body: string): { theme: string | null; scripture: string[]; paragraphs: string[] } {
  let theme: string | null = null;
  const scripture: string[] = [];
  const rest: string[] = [];
  for (const p of paragraphs(body)) {
    const m = p.match(/^(Central theme|Primary Scripture|Supporting Scripture):\s*([\s\S]+)$/);
    if (m?.[1] === "Central theme") theme = m[2].trim();
    else if (m) scripture.push(m[2].trim());
    else rest.push(p);
  }
  return { theme, scripture, paragraphs: rest };
}

export const STATE_LABEL: Record<ChapterState, string> = {
  locked: "Locked",
  available: "Ready to read",
  in_progress: "In progress",
  awaiting_review: "Awaiting peer review",
  completed: "Completed",
  preview: "Preview",
};

/** Why a chapter is locked, in words (never only an icon or a colour). */
export function lockedMessage(chapters: Pick<KingdomStoryChapter, "id" | "chapterNumber">[], chapterId: string): string {
  const sorted = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const i = sorted.findIndex((c) => c.id === chapterId);
  const prev = i > 0 ? sorted[i - 1] : null;
  return prev ? `Complete Chapter ${prev.chapterNumber} to open this chapter.` : "This chapter isn't open yet.";
}

/** "3 of 7 chapters finished" — finished = Comprehensive Check submitted or completed. */
export function progressSummary(p: StoryProgress | undefined | null): { done: number; total: number; label: string; fraction: number } {
  const total = p?.totalChapters ?? 0;
  const done = (p?.completedChapters ?? 0) + (p?.awaitingReviewChapters ?? 0);
  const label = !total ? "" : done === 0 ? `${total} chapter${total === 1 ? "" : "s"}` : `${done} of ${total} chapter${total === 1 ? "" : "s"} finished`;
  return { done, total, label, fraction: total ? done / total : 0 };
}

/** Where to place a chapter's extra illustrations among its paragraphs (the first opens the chapter). */
export function illustrationSlots(paragraphCount: number, imageCount: number): number[] {
  // Returns, for images 2..n, the paragraph index they follow — spread evenly.
  const slots: number[] = [];
  for (let i = 1; i < imageCount; i++) slots.push(Math.max(0, Math.min(paragraphCount - 1, Math.round((i * paragraphCount) / imageCount) - 1)));
  return slots;
}

/** A story card's reading line: "Start reading · 7 chapters", "Continue · 2 of 7 chapters", "Finished". */
export function cardProgress(p: { totalChapters: number; doneChapters: number; started: boolean } | null | undefined): string | null {
  if (!p || !p.totalChapters) return null;
  if (p.doneChapters >= p.totalChapters) return `Finished · ${p.totalChapters} chapters`;
  if (p.started) return `Continue reading · ${p.doneChapters} of ${p.totalChapters} chapters`;
  return `Start reading · ${p.totalChapters} chapters`;
}
