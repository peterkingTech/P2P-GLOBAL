// Listen: turning what a screen already shows into speakable pieces.
//
// Content is SECTIONS (a chapter's paragraphs, a lesson's sections, the
// verses of a Bible chapter) made of PARTS (one verse, one paragraph). Each
// part is split into CHUNKS small enough for every speech engine, at sentence
// boundaries where possible, never inside a word. Every chunk keeps the part
// it came from and its character range in that part's text, so a position
// can always be mapped back to what is on screen. Nothing here changes the
// displayed text — `speakable` only tidies whitespace and marks for speech.

export interface ListenPart { key: string; text: string }
export interface ListenSection { id: string; title: string; parts: ListenPart[] }
export interface Chunk {
  section: number; part: number; partKey: string;
  /** Character range in the part's ORIGINAL text. */
  start: number; end: number;
  /** What is sent to the speech engine. */
  text: string;
}

/** Comfortably under every engine's limit (Android's is ~4000 characters). */
export const CHUNK_MAX = 360;

const SPOKEN_JUNK = /[¶§*_#~`|<>{}[\]]/g;

/** Speech-only form of displayed text: same words, no layout marks, tidy spaces. */
export function speakable(text: string): string {
  return text.replace(SPOKEN_JUNK, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split one part's text into [start, end) ranges of at most `max` characters:
 * whole sentences together, a long sentence at a comma/semicolon, then at a
 * space — never inside a word unless a single "word" is longer than `max`.
 */
export function splitRanges(text: string, max = CHUNK_MAX): [number, number][] {
  const out: [number, number][] = [];
  const len = text.length;
  let i = 0;
  while (i < len && /\s/.test(text[i])) i++;
  while (i < len) {
    if (len - i <= max) { out.push([i, len]); break; }
    const window = text.slice(i, i + max + 1);
    const cut = lastBreak(window, /[.!?…]["'”’)\]]*\s/g) ?? lastBreak(window, /[,;:—–]\s/g) ?? lastBreak(window, /\s/g) ?? max;
    let end = i + cut;
    let next = end;
    while (end > i && /\s/.test(text[end - 1])) end--;
    while (next < len && /\s/.test(text[next])) next++;
    if (end <= i) { end = i + max; next = end; }
    out.push([i, end]);
    i = next;
  }
  return out.filter(([s, e]) => e > s && text.slice(s, e).trim().length > 0);
}

// The end of the last match in the window (past half way, so chunks don't get tiny).
function lastBreak(window: string, re: RegExp): number | null {
  let best: number | null = null;
  for (const m of window.matchAll(re)) {
    const at = (m.index ?? 0) + m[0].length;
    if (at > window.length * 0.4 && at <= window.length) best = at;
  }
  return best;
}

// A full stop after these isn't the end of a sentence ("e.g. the", "Dr. Luke", "1 Cor. 13").
const NOT_AN_END = /(?:\b[A-Za-z]\.(?:[A-Za-z]\.)*|\b(?:Dr|Mr|Mrs|Ms|St|Sr|Jr|Rev|vv?|cf|ca|No|vs|etc|Gen|Ex|Lev|Num|Deut|Josh|Judg|Sam|Kgs|Chr|Neh|Ps|Prov|Eccl|Isa|Jer|Lam|Ezek|Dan|Hos|Mic|Hab|Zech|Mal|Matt|Mk|Lk|Jn|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Tit|Philem|Heb|Jas|Pet|Rev|z\.\s?B|d\.\s?h|usw|bzw|vgl)\.)$/;

/**
 * Sentences as [start, end) ranges of the text (end punctuation and closing
 * quotes included). An abbreviation's full stop, or one followed by a
 * lower-case word, doesn't end a sentence. Text without stops is one range.
 */
export function sentenceRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
  let from = 0;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    const before = text.slice(Math.max(from, end - 12), end);
    const after = text.slice(end).match(/^\s+(\S)/)?.[1] ?? "";
    if (/\.$/.test(m[0]) && NOT_AN_END.test(before)) continue;
    if (after && after !== after.toUpperCase() && after === after.toLowerCase() && /[.]$/.test(m[0])) continue;
    out.push([from, end]);
    from = end;
  }
  if (from < text.length) out.push([from, text.length]);
  return out.filter(([s, e]) => text.slice(s, e).trim().length > 0);
}

/**
 * All chunks of the content, in reading order — ONE PER SENTENCE (a very long
 * sentence is split further at commas/spaces), so the reading view can show
 * exactly what is being said. Empty parts are skipped. `prepare` turns each
 * chunk's displayed words into what the voice says (lib/listen/pronounce) —
 * only the spoken copy; `start`/`end` still point into the untouched text.
 */
export function buildChunks(sections: ListenSection[], max = CHUNK_MAX, prepare: (text: string) => string = (t) => t): Chunk[] {
  const out: Chunk[] = [];
  sections.forEach((sec, si) => sec.parts.forEach((p, pi) => {
    const raw = typeof p.text === "string" ? p.text : "";
    const ranges = sentenceRanges(raw).flatMap(([s, e]) => splitRanges(raw.slice(s, e), max).map(([a, b]) => [s + a, s + b] as [number, number]));
    for (const [start, end] of ranges) {
      const text = prepare(speakable(raw.slice(start, end)));
      if (text) out.push({ section: si, part: pi, partKey: p.key, start, end, text });
    }
  }));
  return out;
}

/** The chunk to start from for a part key (+ character offset in that part). */
export function chunkIndexFor(chunks: Chunk[], partKey: string, offset = 0): number {
  let found = -1;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.partKey !== partKey) continue;
    if (found < 0) found = i;
    if (offset >= c.start && offset < c.end) return i;
  }
  return found;
}

/** First chunk of a section (or -1 when the section has nothing to say). */
export function firstChunkOfSection(chunks: Chunk[], section: number): number {
  return chunks.findIndex((c) => c.section === section);
}

/**
 * Where to resume inside a chunk after a pause: the start of the last word the
 * engine reported (boundary events), else the chunk's start. Returns an index
 * into the chunk's spoken text.
 */
export function resumeOffset(chunkText: string, boundaryCharIndex: number | null): number {
  if (boundaryCharIndex == null || boundaryCharIndex <= 0 || boundaryCharIndex >= chunkText.length) return 0;
  let i = boundaryCharIndex;
  while (i > 0 && !/\s/.test(chunkText[i - 1])) i--;
  return i;
}
