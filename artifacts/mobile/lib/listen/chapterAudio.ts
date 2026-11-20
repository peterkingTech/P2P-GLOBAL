// A Bible chapter's own LICENSED RECORDING as P2P Listen narration (owner 2026-11-19). The recording comes from the
// translation's audio edition (API.Bible, or AO Lab's when its licence permits) — authorised audio always comes
// before any generated voice. It is one file per chapter without word timings, so the sentence positions the
// shared player needs are ESTIMATED from the length of the text across the recording's duration: playback itself
// is the real recording, continuous; only the highlighted verse is approximate. Streamed — never stored by P2P.
import { createAudioPlayer } from "expo-audio";
import { normWord, type RecordedNarration } from "./narration";

/** The recording's length in seconds (read from the file itself), or null if it can't be read in time. */
export function recordingDuration(url: string, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    let p: ReturnType<typeof createAudioPlayer> | null = null;
    const finish = (v: number | null) => { if (done) return; done = true; clearInterval(poll); clearTimeout(timer); try { p?.remove(); } catch { /* gone */ } resolve(v); };
    try { p = createAudioPlayer({ uri: url }); } catch { resolve(null); return; }
    const poll = setInterval(() => { const d = p?.duration ?? 0; if (Number.isFinite(d) && d > 1) finish(d); }, 150);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Word timings spread across the duration in proportion to the text (verse by verse, in reading order).
 *  Same word form and time unit (1/100 s) as the matcher (narration.ts alignChunks) — 2026-11-19 fix: raw words in
 *  seconds never matched, so every API.Bible recording fell back to P2P Voice ("P2P only reads public translations"). */
export interface EstimateShape {
  /** Seconds before the first displayed words (opening quiet + the reader's introduction). */
  leadSeconds?: number;
  /** Seconds of pause before each text (same order as `texts`; e.g. around headings, between verses). */
  pausesBefore?: number[];
  /** Seconds of quiet after the last word. */
  tailSeconds?: number;
}
export function estimatedNarration(url: string, voice: string, texts: string[], duration: number, shape: number | EstimateShape = 0): RecordedNarration | null {
  const sh: EstimateShape = typeof shape === "number" ? { leadSeconds: shape } : shape;
  const tokens: { raw: string; w: string; part: number }[] = [];
  texts.forEach((text, part) => { for (const raw of text.split(/[\s—–-]+/)) { const w = normWord(raw); if (w) tokens.push({ raw, w, part }); } });
  if (!tokens.length || !(duration > 1)) return null;
  const total = tokens.reduce((n, t) => n + t.raw.length + 1, 0);
  // The reader's introduction (book, chapter, title) before the first displayed words: `leadSeconds` of the
  // recording belong to the FIRST word, so playback always starts at 0 s — the reader's very first word, nothing
  // skipped (owner 2026-11-20) — and the text after it waits for the introduction instead of running ahead.
  // Pauses before a text belong to the word before it (the next text starts after the pause; nothing is skipped).
  const lead = Math.max(0, Math.min(sh.leadSeconds ?? 0, duration * 0.15));
  const pauses = tokens.map((t, i) => (i > 0 && tokens[i - 1].part !== t.part ? Math.max(0, sh.pausesBefore?.[t.part] ?? 0) : 0));
  const tail = Math.max(0, sh.tailSeconds ?? 0);
  let fixed = lead + tail + pauses.reduce((a, b) => a + b, 0);
  const scale = fixed > duration * 0.4 ? (duration * 0.4) / fixed : 1; // never let pauses swallow the speech
  fixed *= scale;
  const speech = duration - fixed;
  const words: string[] = [], starts: number[] = [], ends: number[] = [];
  let at = 0;
  tokens.forEach((t, i) => {
    let len = ((t.raw.length + 1) / total) * speech * 100 + (i === 0 ? lead * scale * 100 : 0);
    const nextPause = i + 1 < tokens.length ? pauses[i + 1] * scale : 0;
    len += nextPause * 100;
    words.push(t.w); starts.push(at); ends.push(at + len); at += len;
  });
  return { url, voice, words, starts, ends };
}

/** The stretch of a chapter's estimated recording that covers some of its parts (a selection of verses, or one
 *  passage of a playlist). `partTexts` are the chapter's parts in order (as given to estimatedNarration). Words that
 *  aren't in the recording (the selection's spoken heading) get a zero-length stretch at its start: skipped silently. */
export function sliceNarration(n: RecordedNarration, partTexts: string[], keep: (index: number) => boolean, leading: string[] = []): RecordedNarration | null {
  const words: string[] = [], starts: number[] = [], ends: number[] = [];
  let w = 0;
  partTexts.forEach((text, i) => {
    const count = text.split(/[\s—–-]+/).map(normWord).filter(Boolean).length;
    if (keep(i)) for (let k = w; k < w + count && k < n.words.length; k++) { words.push(n.words[k]); starts.push(n.starts[k]); ends.push(n.ends[k]); }
    w += count;
  });
  if (!words.length) return null;
  const lead = leading.join(" ").split(/[\s—–-]+/).map(normWord).filter(Boolean);
  return { url: n.url, voice: n.voice, words: [...lead, ...words], starts: [...lead.map(() => starts[0]), ...starts], ends: [...lead.map(() => starts[0]), ...ends] };
}
