// Exact-text selection and highlight ranges for the Bible reader. Pure
// functions (tested in tests/bibleReader.test.mjs) over the chapter's verse
// texts as served by the API — offsets are character positions in those
// texts, end EXCLUSIVE. Nothing here stores or sends Bible text.

export interface Pos { verse: number; offset: number }
/** A selection / highlight: from `start` up to (not including) `end`. */
export interface TextRange { start: Pos; end: Pos }
export interface Token { start: number; end: number; text: string; word: boolean }
export interface StyledRun { text: string; start: number; end: number; color: string | null; selected: boolean }
export interface StoredHighlight { id?: string; color: string; startVerse: number; endVerse: number; startOffset: number | null; endOffset: number | null }

// A word = a run of characters that are neither whitespace nor punctuation.
// Defined by exclusion (not \p{L}) so it works on every engine and keeps
// combining marks (Hindi, Arabic) inside their word; apostrophes (' ’) and
// inner hyphens stay part of a word ("Lord’s", "well-pleased").
const WORD_RE = /[^\s.,;:!?"“”‘()[\]{}—–…·،؛؟।॥]+/g;

/** Words (selectable) and the spaces/punctuation between them (never selected on their own). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const s = m.index ?? 0;
    if (s > last) out.push({ start: last, end: s, text: text.slice(last, s), word: false });
    out.push({ start: s, end: s + m[0].length, text: m[0], word: true });
    last = s + m[0].length;
  }
  if (last < text.length) out.push({ start: last, end: text.length, text: text.slice(last), word: false });
  return out;
}

const cmp = (a: Pos, b: Pos) => (a.verse - b.verse) || (a.offset - b.offset);
/** Orders two positions into a range (selection made "backwards" still works). */
export function orderRange(a: Pos, b: Pos): TextRange { return cmp(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a }; }
export const isEmptyRange = (r: TextRange) => cmp(r.start, r.end) >= 0;

/** The range of one word token. */
export function wordRange(verse: number, t: Token): TextRange { return { start: { verse, offset: t.start }, end: { verse, offset: t.end } }; }
/** A whole verse. */
export function verseRange(verse: number, text: string): TextRange { return { start: { verse, offset: 0 }, end: { verse, offset: text.length } }; }
/** From the start of one word to the end of another (in either order) — exactly those words. */
export function phraseRange(a: { verse: number; t: Token }, b: { verse: number; t: Token }): TextRange {
  const s = orderRange({ verse: a.verse, offset: a.t.start }, { verse: b.verse, offset: b.t.start });
  const e = orderRange({ verse: a.verse, offset: a.t.end }, { verse: b.verse, offset: b.t.end });
  return { start: s.start, end: e.end };
}

const SENTENCE_END = /[.!?](?:["'’”)\]]*)/g;
/**
 * The whole sentence around a position, across verse boundaries: back to just
 * after the previous . ! ? (or the chapter start), forward through the next
 * one (including closing quotes). Best effort — Scripture sentences can be long.
 */
export function sentenceRange(verses: { verse: number; text: string }[], at: Pos): TextRange {
  const idx = verses.findIndex((v) => v.verse === at.verse);
  if (idx < 0) return { start: at, end: at };
  // Start: scan backwards.
  let start: Pos = { verse: verses[0].verse, offset: 0 };
  outerBack: for (let i = idx; i >= 0; i--) {
    const t = verses[i].text;
    const limit = i === idx ? at.offset : t.length;
    let lastEnd = -1;
    for (const m of t.slice(0, limit).matchAll(SENTENCE_END)) lastEnd = (m.index ?? 0) + m[0].length;
    if (lastEnd >= 0) {
      let o = lastEnd; while (o < t.length && /\s/.test(t[o])) o++;
      start = o >= t.length && i + 1 < verses.length ? { verse: verses[i + 1].verse, offset: 0 } : { verse: verses[i].verse, offset: o };
      break outerBack;
    }
  }
  // End: scan forwards.
  let end: Pos = { verse: verses[verses.length - 1].verse, offset: verses[verses.length - 1].text.length };
  for (let i = idx; i < verses.length; i++) {
    const t = verses[i].text;
    const from = i === idx ? at.offset : 0;
    SENTENCE_END.lastIndex = 0;
    const m = SENTENCE_END.exec(t.slice(from));
    if (m) { end = { verse: verses[i].verse, offset: from + (m.index ?? 0) + m[0].length }; break; }
  }
  return { start, end };
}

/** Moves one edge of a selection by a word (expand/shrink), staying on word boundaries. */
export function nudgeRange(verses: { verse: number; text: string }[], r: TextRange, edge: "start" | "end", dir: -1 | 1): TextRange {
  const words: { verse: number; t: Token }[] = verses.flatMap((v) => tokenize(v.text).filter((t) => t.word).map((t) => ({ verse: v.verse, t })));
  if (!words.length) return r;
  if (edge === "start") {
    const i = words.findIndex((w) => cmp({ verse: w.verse, offset: w.t.start }, r.start) >= 0);
    const j = Math.max(0, Math.min(words.length - 1, (i < 0 ? words.length : i) + dir));
    const next = { verse: words[j].verse, offset: words[j].t.start };
    return isEmptyRange({ start: next, end: r.end }) ? r : { start: next, end: r.end };
  }
  let i = -1;
  words.forEach((w, k) => { if (cmp({ verse: w.verse, offset: w.t.end }, r.end) <= 0) i = k; });
  const j = Math.max(0, Math.min(words.length - 1, i + dir));
  const next = { verse: words[j].verse, offset: words[j].t.end };
  return isEmptyRange({ start: r.start, end: next }) ? r : { start: r.start, end: next };
}

/** A stored highlight → range (null offsets = whole verse edges). Clamped to the text. */
export function storedToRange(h: StoredHighlight, lengthOf: (verse: number) => number): TextRange {
  return {
    start: { verse: h.startVerse, offset: Math.min(h.startOffset ?? 0, lengthOf(h.startVerse)) },
    end: { verse: h.endVerse, offset: Math.min(h.endOffset ?? lengthOf(h.endVerse), lengthOf(h.endVerse)) },
  };
}
/** A range → what the API stores (whole-verse edges become null). */
export function rangeToStored(r: TextRange, lengthOf: (verse: number) => number) {
  return {
    startVerse: r.start.verse, endVerse: r.end.verse,
    startOffset: r.start.offset <= 0 ? null : r.start.offset,
    endOffset: r.end.offset >= lengthOf(r.end.verse) ? null : r.end.offset,
  };
}

/**
 * One verse's text split into inline runs, each with the highlight colour
 * (latest wins where saved highlights overlap) and whether it's selected.
 * Runs cover the text exactly once — nothing is duplicated or dropped, so
 * highlighted words stay inline with their neighbours.
 */
export function verseRuns(verse: number, text: string, highlights: StoredHighlight[], selection: TextRange | null, lengthOf: (verse: number) => number): StyledRun[] {
  const len = text.length;
  const colorAt: (string | null)[] = new Array(len).fill(null);
  for (const h of highlights) {
    if (verse < h.startVerse || verse > h.endVerse) continue;
    const r = storedToRange(h, lengthOf);
    const s = verse === r.start.verse ? r.start.offset : 0;
    const e = verse === r.end.verse ? r.end.offset : len;
    for (let i = Math.max(0, s); i < Math.min(len, e); i++) colorAt[i] = h.color;
  }
  const sel: boolean[] = new Array(len).fill(false);
  if (selection && verse >= selection.start.verse && verse <= selection.end.verse) {
    const s = verse === selection.start.verse ? selection.start.offset : 0;
    const e = verse === selection.end.verse ? selection.end.offset : len;
    for (let i = Math.max(0, s); i < Math.min(len, e); i++) sel[i] = true;
  }
  const runs: StyledRun[] = [];
  let i = 0;
  while (i < len) {
    let j = i + 1;
    while (j < len && colorAt[j] === colorAt[i] && sel[j] === sel[i]) j++;
    runs.push({ text: text.slice(i, j), start: i, end: j, color: colorAt[i], selected: sel[i] });
    i = j;
  }
  return runs;
}

/** The exact selected text (only used where the translation's licence allows copying). */
export function rangeText(verses: { verse: number; text: string }[], r: TextRange): string {
  return verses.filter((v) => v.verse >= r.start.verse && v.verse <= r.end.verse).map((v) => {
    const s = v.verse === r.start.verse ? r.start.offset : 0;
    const e = v.verse === r.end.verse ? r.end.offset : v.text.length;
    return v.text.slice(s, e);
  }).join(" ").replace(/\s+/g, " ").trim();
}
