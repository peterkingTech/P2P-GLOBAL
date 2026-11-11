// Listening time and progress, shown the way music apps do (owner request 2026-11-10, after Spotify):
//   • before playing — "10 scriptures · about 20 min", "6 chapters · about 24 min";
//   • while playing  — a progress line, the percentage played and the time left ("45% · about 12 min left").
//
// The phone's own voice has no length, so its times are ESTIMATES from the words still to be read at the
// chosen speed, always worded "about". A studio recording (Kingdom Stories narration) has a real length:
// its word timings give the duration, shown without "about".
//
// Pure (no React, no audio): used by the shared player, playlists, the Library and Kingdom Stories.

import { formatDuration } from "@/lib/timeFormat";

/** Phone voices read about 155 words a minute at normal speed. */
export const WORDS_PER_MINUTE = 155;
/** About 10 seconds a verse at normal speed (as lib/libraryRules.estimateMinutes). */
export const SECONDS_PER_VERSE = 10;

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
export const secondsForWords = (words: number, rate = 1) => (words / WORDS_PER_MINUTE) * 60 / (rate || 1);
export const secondsForVerses = (verses: number, rate = 1) => (verses * SECONDS_PER_VERSE) / (rate || 1);

/** "1 hr 47 min", "24 min", "45 sec" — lib/timeFormat's "listen" style. */
export const listenTime = (seconds: number) => formatDuration(seconds, "listen");

/** "10 scriptures · about 20 min" — the count, then the length (estimates say "about"). */
export function summaryLine(count: number, noun: [string, string], seconds: number, exact = false): string {
  const what = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  return seconds > 0 ? `${what} · ${exact ? "" : "about "}${listenTime(seconds)}` : what;
}

export interface TimingInput {
  status: string;
  chunk: number;
  chunks: { section: number; part: number; start: number; end: number }[];
  rate: number;
  content: { sections: { parts: { text: string }[] }[]; narration?: unknown } | null;
}
export interface PlaybackTiming {
  /** 0–1, by words read (not sentences, so a long sentence counts for more). */
  fraction: number;
  /** Whole-number percentage played, 0–100. */
  percent: number;
  totalSeconds: number;
  remainingSeconds: number;
  /** From a studio recording's real length; false = estimated from the words. */
  exact: boolean;
}

/** A recording's length in seconds, when the content has a studio recording with word timings. */
function recordedSeconds(narration: unknown): number | null {
  const ends = (narration as { ends?: readonly number[] } | null | undefined)?.ends;
  return ends?.length ? ends[ends.length - 1] / 100 : null;
}

/** Where the session is: percentage played, total and remaining time. Null before anything is loaded. */
export function playbackTiming(st: TimingInput): PlaybackTiming | null {
  if (!st.content || !st.chunks.length) return null;
  const words = st.chunks.map((c) => wordCount(st.content!.sections[c.section]?.parts[c.part]?.text.slice(c.start, c.end) ?? ""));
  const total = words.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const doneChunks = st.status === "completed" ? st.chunks.length : Math.min(st.chunk, st.chunks.length);
  const done = words.slice(0, doneChunks).reduce((a, b) => a + b, 0);
  const fraction = Math.min(1, done / total);
  const recorded = recordedSeconds(st.content.narration);
  const totalSeconds = recorded != null ? recorded / (st.rate || 1) : secondsForWords(total, st.rate);
  return { fraction, percent: Math.round(fraction * 100), totalSeconds, remainingSeconds: totalSeconds * (1 - fraction), exact: recorded != null };
}

/** "45% · about 12 min left" (or "100% · Finished"). */
export function progressLine(t: PlaybackTiming | null): string {
  if (!t) return "";
  if (t.fraction >= 1) return "100% · Finished";
  return `${t.percent}% · ${t.exact ? "" : "about "}${listenTime(t.remainingSeconds)} left`;
}
