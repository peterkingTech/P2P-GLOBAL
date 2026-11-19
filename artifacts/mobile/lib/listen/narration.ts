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

// Latin words keep exactly the form they always had (Kingdom Stories narrations were aligned with it); a word in
// another script (Hindi, Bengali, Tamil, Amharic …), which that form would erase, keeps its letters instead.
export const normWord = (w: string) => {
  const latin = w.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  return latin || w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{M}\p{N}]/gu, "");
};
export const wordsOf = (text: string) => text.split(/[\s—–-]+/).map(normWord).filter(Boolean);

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

/**
 * The whole chapter at once (2026-11-18 fix: continuous playback, no skipped / repeated sentences, no drift).
 * Every sentence the player will send (`sources`, in playing order) is matched to the recording IN ORDER with
 * a tolerant word alignment: a word written differently on screen ("2" / "two", a quotation mark, a dash), a
 * word the narrator added, or one left out does not break the match, and each sentence picks up where the
 * previous one ended. The stretches are made CONTIGUOUS — a sentence runs to the start of the next (the
 * narrator's pause included) — so the recording plays straight through: highlighting follows the audio and
 * nothing is skipped or played twice. Line wrapping and screen size play no part: only words are compared.
 * A sentence with too little of its text in the recording (e.g. an on-screen heading the narrator didn't read)
 * gets null — the phone's voice reads it — and the next sentence re-finds its place.
 */
export function alignChunks(n: RecordedNarration, sources: readonly string[]): (NarrationSegment | null)[] {
  const R = n.words;
  const LOOK = 8, RESYNC = 80;
  let r = 0;
  const spans: ({ first: number; last: number } | null)[] = [];
  for (const src of sources) {
    const W = wordsOf(src);
    if (!W.length) { spans.push(null); continue; }
    // Re-find this sentence's place when it doesn't start where the previous one ended (e.g. after a sentence
    // the narrator skipped): the next stretch of the recording that begins with this sentence's first words.
    const head = W.slice(0, Math.min(3, W.length));
    const startsAt = (i: number) => head.every((w, k) => R[i + k] === w);
    if (!startsAt(r)) for (let i = r + 1; i < Math.min(R.length, r + RESYNC); i++) if (startsAt(i)) { r = i; break; }
    const from = r;
    const hits: number[] = [];
    for (let j = 0; j < W.length && r < R.length; j++) {
      const w = W[j], next = W[j + 1];
      if (R[r] === w) { hits.push(r++); continue; }
      let found = -1;
      // The narrator said extra words: skip ahead to this word (confirmed by the next one).
      for (let k = 1; k <= LOOK && r + k < R.length; k++) if (R[r + k] === w && (next === undefined || R[r + k + 1] === next)) { found = r + k; break; }
      if (found >= 0) { hits.push(found); r = found + 1; continue; }
      // Written differently ("2" read as "two"): this recording word stands for it when the next word lines up.
      if (next !== undefined && R[r + 1] === next) { hits.push(r++); continue; }
      // Otherwise the word isn't in the recording (on screen only): the recording position stays.
    }
    const share = hits.length / W.length;
    if (hits.length && share >= 0.5) spans.push({ first: hits[0], last: hits[hits.length - 1] });
    else { spans.push(null); r = from; } // not in the recording: don't let it move the position
  }
  // Contiguous stretches: each runs from where the previous one ended to where the next one begins.
  const out: (NarrationSegment | null)[] = spans.map(() => null);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s) continue;
    const prev = i > 0 ? out[i - 1] : null;
    const nextSpan = spans.slice(i + 1).find((x) => x) ?? null;
    const start = prev && prev.lastWord < s.first && s.first - prev.lastWord <= 4 ? prev.end : n.starts[s.first] / 100;
    const end = nextSpan && nextSpan.first > s.last && nextSpan.first - s.last <= 4 ? n.starts[nextSpan.first] / 100 : n.ends[s.last] / 100;
    out[i] = { start, end: Math.max(end, start), firstWord: s.first, lastWord: s.last };
  }
  return out;
}

const aligned = new Map<string, (NarrationSegment | null)[]>();
/** `alignChunks`, worked out once per recording + sentence list (the same content plays many times). */
export function alignedSegments(n: RecordedNarration, sources: readonly string[]): (NarrationSegment | null)[] {
  const key = `${n.url}|${sources.length}|${sources.join("\u0001").length}|${sources[0] ?? ""}|${sources[sources.length - 1] ?? ""}`;
  let a = aligned.get(key);
  if (!a) {
    a = alignChunks(n, sources);
    aligned.set(key, a);
    if (aligned.size > 40) { const oldest = aligned.keys().next().value; if (oldest !== undefined) aligned.delete(oldest); }
  }
  return a;
}
