// Recorded narration (ElevenLabs, owner decision 2026-11-06/07): a Kingdom Stories chapter can have one
// studio recording. The shared Listen player still works sentence by sentence; for each sentence it asks
// this module where that sentence is in the recording, and plays just that stretch — so highlighting,
// pause/resume, Listen Again and the position work exactly as with the phone's voice. Anything the
// recording doesn't contain is read by the phone's voice as before.
//
// The recordings and their word timings come from the API (GET /kingdom-stories/:id/chapters/:id/narration),
// generated server-side by api-server/scripts/narrate.mjs — never on the phone, never on play.
// Loaded once per chapter and kept for the session (`loadNarration`).
//
// Pure apart from the loader (no audio APIs): the player itself is in lib/listen/index.ts.

import { getChapterNarration, type ChapterNarrationData } from "@/lib/kingdomStoriesApi";

export interface RecordedNarration { url: string; voice: string; words: string[]; starts: readonly number[]; ends: readonly number[] }
export interface NarrationSegment { start: number; end: number; firstWord: number; lastWord: number }

export function fromData(d: ChapterNarrationData | null | undefined): RecordedNarration | null {
  if (!d?.url || !d.words || d.starts?.length !== d.ends?.length) return null;
  const words = d.words.split(" ");
  return words.length === d.starts.length ? { url: d.url, voice: d.voice, words, starts: d.starts, ends: d.ends } : null;
}

const loaded = new Map<string, Promise<RecordedNarration | null>>();
/** A chapter's narration in `lang` (or null), fetched once per session; a failure means the phone's voice. */
export function loadNarration(storyId: string, chapterId: string, lang = "en"): Promise<RecordedNarration | null> {
  const key = `${storyId}/${chapterId}/${lang}`;
  let p = loaded.get(key);
  if (!p) {
    p = getChapterNarration(storyId, chapterId, lang).then((r) => fromData(r?.narration), () => { loaded.delete(key); return null; });
    loaded.set(key, p);
  }
  return p;
}

export const normWord = (w: string) => w.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const wordsOf = (text: string) => text.split(/[\s—–-]+/).map(normWord).filter(Boolean);

/**
 * Where `text` (one or more whole sentences, as displayed) is in the recording, in seconds.
 * Searches from `fromWord` first (the narration normally moves forward), then the whole recording,
 * so a repeated phrase resolves to the next occurrence. Null when the recording doesn't contain it.
 */
export function segmentFor(n: RecordedNarration, text: string, fromWord = 0): NarrationSegment | null {
  const want = wordsOf(text);
  if (!want.length) return null;
  const at = (i: number) => want.every((w, k) => n.words[i + k] === w);
  const find = (from: number, to: number) => { for (let i = Math.max(0, from); i <= to - want.length; i++) if (at(i)) return i; return -1; };
  let i = find(fromWord, n.words.length);
  if (i < 0) i = find(0, Math.min(n.words.length, fromWord + want.length));
  if (i < 0) return null;
  const last = i + want.length - 1;
  return { start: n.starts[i] / 100, end: n.ends[last] / 100, firstWord: i, lastWord: last };
}
