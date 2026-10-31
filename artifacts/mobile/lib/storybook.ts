// Pure helpers for the Kingdom Stories storybook (no React, no network), so
// they can be tested on their own: Scripture references → P2P Bible targets,
// book paragraphs, chapter status wording, reading progress.
import { readerTarget } from "@/lib/bibleReaderApi";
import type { ChapterState, KingdomStoryChapter, StoryProgress } from "@/lib/kingdomStoriesApi";
import type { ListenSection } from "@/lib/listen/chunking";
import { questionSections } from "@/lib/listen/lessonContent";
import { NO_LABELS, type SpokenLabels } from "@/lib/listen/labels";

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

/**
 * How a narrative paragraph should be set in the reader (the text itself is
 * never changed): a short line ending in ":" is a sub-heading ("Final
 * reflection questions:"); "1. …" is a numbered item (hanging indent); a
 * paragraph opening with a known label ("Reflection: …", "Closing thought:
 * …", "Historical note: …") shows that label in bold.
 */
export type ParagraphKind =
  | { kind: "heading"; text: string }
  | { kind: "numbered"; number: string; text: string }
  | { kind: "labelled"; label: string; text: string }
  | { kind: "plain"; text: string };
const LABELS = /^(Reflection|Closing thought|Topic review|Historical note|Interpretive note|Editorial note|Note)(:)\s+([\s\S]+)$/;
export function paragraphKind(p: string): ParagraphKind {
  const t = p.trim();
  if (t.length <= 90 && /:$/.test(t) && !/[.!?]\s/.test(t)) return { kind: "heading", text: t.slice(0, -1) };
  const n = t.match(/^(\d{1,2})\.\s+([\s\S]+)$/);
  if (n) return { kind: "numbered", number: n[1], text: n[2] };
  const l = t.match(LABELS);
  if (l) {
    // "Topic review: The complete creation story" — a label with a short title reads as a heading.
    if (l[3].length <= 60 && !/[.!?]$/.test(l[3])) return { kind: "heading", text: `${l[1]}: ${l[3]}` };
    return { kind: "labelled", label: l[1], text: l[3] };
  }
  return { kind: "plain", text: t };
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

// ── Listen (the shared player): the words as shown, nothing added ────────────
const spokenParagraph = (p: string) => {
  const pk = paragraphKind(p);
  return pk.kind === "heading" ? pk.text : pk.kind === "numbered" ? `${pk.number}. ${pk.text}` : pk.kind === "labelled" ? `${pk.label}: ${pk.text}` : pk.text;
};

/**
 * A chapter as speakable sections, each announced so a listener knows where
 * they are: "Chapter 1: <title>", the narrative split at its sub-headings
 * (each paragraph a part), "Story Lessons" ("Lesson 1. …"), then "Personal
 * Reflections" and "Comprehensive Check" with each question announced —
 * QUESTIONS only, never anyone's answers. Hearing them answers nothing; the
 * chapter finishes only as it does today.
 */
export function chapterListenSections(
  ch: Pick<KingdomStoryChapter, "chapterNumber" | "title" | "narrative" | "lessons">,
  questions?: { reflections: { id: string; question: string }[]; check: { title: string; questions: { id: string; question: string }[] } | null },
  labels: SpokenLabels = NO_LABELS,
  /** The story's name, said first ("Ruth. Chapter 2: …") so every chapter announces where it is. */
  storyTitle?: string | null,
): ListenSection[] {
  const chapterLabel = labels.chapter(ch.chapterNumber);
  const heading = chapterLabel ? `${chapterLabel}: ${ch.title}.` : `${ch.chapterNumber}. ${ch.title}.`;
  const out: ListenSection[] = [{ id: "title", title: "Chapter title", parts: [
    ...(storyTitle?.trim() ? [{ key: "story", text: `${storyTitle.trim().replace(/[.!?]$/, "")}.` }] : []),
    { key: "title", text: heading },
  ] }];
  let current: ListenSection | null = null;
  paragraphs(ch.narrative).forEach((p, i) => {
    const pk = paragraphKind(p);
    if (pk.kind === "heading" || !current) {
      current = { id: `p${i}`, title: pk.kind === "heading" ? pk.text : "The story", parts: [] };
      out.push(current);
    }
    current.parts.push({ key: `p${i}`, text: spokenParagraph(p) });
  });
  const lessons = (ch.lessons ?? []).filter((l) => l && l.trim());
  if (lessons.length) out.push({ id: "lessons", title: "Story Lessons", parts: [
    ...(labels.storyLessons ? [{ key: "lessons", text: `${labels.storyLessons}.` }] : []),
    ...lessons.map((l, i) => ({ key: `lesson${i}`, text: `${labels.lessonItem(i + 1) ?? i + 1}. ${l}` })),
  ] });
  out.push(...questionSections([
    { id: "reflection", kind: "reflections", title: "Personal Reflections", questions: questions?.reflections ?? [] },
    ...(questions?.check ? [{ id: "check", kind: "check" as const, title: questions.check.title, name: questions.check.title, questions: questions.check.questions }] : []),
  ], labels));
  return out;
}

/** The story's introduction (announced, then title, subtitle, opening paragraphs) — empty when it has none. */
export function introListenSections(story: { title: string; subtitle: string | null; body: string }, labels: SpokenLabels = NO_LABELS): ListenSection[] {
  const intro = storyIntro(story.body ?? "");
  if (!intro.paragraphs.length) return [];
  return [{ id: "intro", title: "Introduction", parts: [
    ...(labels.introduction ? [{ key: "label", text: `${labels.introduction}.` }] : []),
    { key: "title", text: `${story.title}.${story.subtitle ? ` ${story.subtitle}.` : ""}` },
    ...intro.paragraphs.map((p, i) => ({ key: `p${i}`, text: spokenParagraph(p) })),
  ] }];
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
