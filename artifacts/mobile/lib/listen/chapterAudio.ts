// A Bible chapter's own LICENSED RECORDING as P2P Listen narration (owner 2026-11-19). The recording comes from the
// translation's audio edition (API.Bible, or AO Lab's when its licence permits) — authorised audio always comes
// before any generated voice. It is one file per chapter without word timings, so the sentence positions the
// shared player needs are ESTIMATED from the length of the text across the recording's duration: playback itself
// is the real recording, continuous; only the highlighted verse is approximate. Streamed — never stored by P2P.
import { createAudioPlayer } from "expo-audio";
import type { RecordedNarration } from "./narration";

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

/** Word timings spread across the duration in proportion to the text (verse by verse, in reading order). */
export function estimatedNarration(url: string, voice: string, texts: string[], duration: number): RecordedNarration | null {
  const words = texts.join(" ").split(/\s+/).filter(Boolean);
  if (!words.length || !(duration > 1)) return null;
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const starts: number[] = [], ends: number[] = [];
  let at = 0;
  for (const w of words) {
    const len = ((w.length + 1) / total) * duration;
    starts.push(at); ends.push(at + len); at += len;
  }
  return { url, voice, words, starts, ends };
}
