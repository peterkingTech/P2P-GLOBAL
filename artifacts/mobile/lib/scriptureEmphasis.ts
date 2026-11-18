// SCRIPTURE EMPHASIS (owner brief 2026-11-18): independently switchable categories shown in the Bible reader.
//   • Words of Jesus (red) come from each TRANSLATION'S OWN red-letter markup (its "words of Jesus" marks),
//     as exact character ranges — narration and other speakers in the same verse are never coloured. A
//     translation without that markup simply shows no red (said plainly in the legend).
//   • The other categories come from editor-approved references (study-workspace /emphasis, four eyes) — NEVER
//     from keyword matching. A category with no published references says so instead of guessing.
// Emphasis is a display layer: off by default, it never changes or replaces the participant's own highlights
// (a personal highlight always wins where both apply), and turning it off restores the plain text.
import { apiRequest } from "@/lib/apiClient";

export const EMPHASIS = ["jesus", "holy_spirit", "father", "commands", "promises", "prophecy", "prayer_worship"] as const;
export type EmphasisCategory = (typeof EMPHASIS)[number];
/** Colours chosen to keep readable contrast on the reader's light and dark pages (text colour for Jesus' words). */
export const EMPHASIS_COLOR: Record<EmphasisCategory, { light: string; dark: string }> = {
  jesus: { light: "#B3261E", dark: "#FF8A80" },
  holy_spirit: { light: "#6A1B9A", dark: "#CE93D8" },
  father: { light: "#9A7400", dark: "#FFD54F" },
  commands: { light: "#1565C0", dark: "#90CAF9" },
  promises: { light: "#2E7D32", dark: "#A5D6A7" },
  prophecy: { light: "#B45309", dark: "#FFB74D" },
  prayer_worship: { light: "#00796B", dark: "#80CBC4" },
};
export const emphasisColor = (c: EmphasisCategory, mode: "light" | "dark") => EMPHASIS_COLOR[c][mode];
export const isEmphasis = (v: unknown): v is EmphasisCategory => (EMPHASIS as readonly string[]).includes(String(v));

export interface EmphasisReference { category: Exclude<EmphasisCategory, "jesus">; startVerse: number; endVerse: number; note: string | null }
export interface ChapterEmphasis { references: EmphasisReference[]; available: string[] }
const cache = new Map<string, Promise<ChapterEmphasis>>();
/** Published references for one chapter (cached per session; an error means "none", never a guess). */
export function loadChapterEmphasis(book: string, chapter: number): Promise<ChapterEmphasis> {
  const key = `${book}.${chapter}`;
  let p = cache.get(key);
  if (!p) {
    p = apiRequest<ChapterEmphasis>(`/study-workspace/emphasis/${book}/${chapter}`, {}, { fallbackError: "Couldn't load emphasis." })
      .catch(() => { cache.delete(key); return { references: [], available: [] }; });
    cache.set(key, p);
  }
  return p;
}
/** The enabled categories that cover this verse (editorial references only — Jesus' words are ranges in the text). */
export function verseCategories(verse: number, refs: readonly EmphasisReference[], enabled: ReadonlySet<EmphasisCategory>): EmphasisReference["category"][] {
  const out: EmphasisReference["category"][] = [];
  for (const r of refs) if (enabled.has(r.category) && verse >= r.startVerse && verse <= r.endVerse && !out.includes(r.category)) out.push(r.category);
  return out;
}
