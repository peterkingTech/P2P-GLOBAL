// Original-language audio for Deep Study (Hebrew, Aramaic, Greek) — WHAT may be spoken and how it is
// labelled. Pure: no audio here (playback is P2P Listen: listen.speakSnippet / listen.play).
//
// Honest by design (owner brief 2026-11-12):
//   • The spoken text is the ORIGINAL SCRIPT, never the English transliteration.
//   • Hebrew keeps its vowel points (niqqud); only the cantillation marks (te'amim, U+0591–U+05AF), which
//     speech engines can't voice and which mark chant rather than spelling, are left out of what is SENT
//     to the voice. The screen always shows the word exactly as the source has it.
//   • The only voices available today are the DEVICE's own: they speak MODERN Israeli Hebrew and MODERN
//     Greek. That is said plainly ("Modern Israeli Hebrew, device voice — not verified for Biblical
//     Hebrew"; "Modern Greek, not reconstructed Koine"). Nothing is labelled as a human recording or as
//     verified.
//   • Aramaic has no suitable voice and is NEVER read as Hebrew: the transliteration is shown instead.
//   • Continuous reading of whole original-language verses stays OFF until a person has listened to
//     representative passages and approved it (ORIGINAL_AUDIO.continuous). Single words are available,
//     clearly marked as an unverified device voice.

export type OriginalLanguage = "hebrew" | "aramaic" | "greek";

/** Product switches (change only after a person has reviewed the pronunciation on real devices). */
export const ORIGINAL_AUDIO = {
  /** Single words: device voice, clearly labelled unverified. */
  words: true,
  /** Whole verses in Hebrew/Greek: awaiting a pronunciation review on representative passages. */
  continuous: false,
} as const;

export type AudioSource = "human_recording" | "provider_recording" | "ai_tts" | "device_tts";
export interface PronunciationPlan {
  /** What is sent to the voice (original script; Hebrew without cantillation, WITH vowels). */
  speak: string;
  /** Device speech language tag, or null when no honest voice exists (Aramaic). */
  speechLanguage: string | null;
  /** How the audio is produced — shown with the play button. */
  source: AudioSource;
  verified: false;
  /** The pronunciation convention, as the listener should understand it. */
  convention: string;
  /** Why there is no audio (Aramaic), or null. */
  unavailableReason: string | null;
}

const CANTILLATION = /[֑-֯]/g;          // te'amim (accents for chanting)
const HEBREW_JOINERS = /[־׀׃]/g;    // maqaf, paseq, sof pasuq → spaces / nothing
/** Hebrew/Aramaic text for a speech engine: vowel points kept, chant marks and punctuation marks removed. */
export function speakableHebrew(text: string): string {
  return text.normalize("NFC").replace(CANTILLATION, "").replace(/־/g, " ").replace(HEBREW_JOINERS, "").replace(/\s+/g, " ").trim();
}
/** Greek for a speech engine: accents and breathings kept (they guide stress); editorial brackets removed. */
export function speakableGreek(text: string): string {
  return text.normalize("NFC").replace(/[[\]⸀⸂⸃]/g, "").replace(/\s+/g, " ").trim();
}

export function pronunciationPlan(text: string, language: string): PronunciationPlan {
  if (language === "hebrew") return {
    speak: speakableHebrew(text), speechLanguage: "he-IL", source: "device_tts", verified: false,
    convention: "Modern Israeli Hebrew (device voice) — not verified for Biblical Hebrew", unavailableReason: null,
  };
  if (language === "greek") return {
    speak: speakableGreek(text), speechLanguage: "el-GR", source: "device_tts", verified: false,
    convention: "Modern Greek (device voice) — not a reconstructed Koine pronunciation", unavailableReason: null,
  };
  return {
    speak: "", speechLanguage: null, source: "device_tts", verified: false,
    convention: language === "aramaic" ? "Biblical Aramaic" : "Unknown",
    unavailableReason: language === "aramaic"
      ? "No reliable Aramaic voice is available. Aramaic is not read with a Hebrew voice — use the transliteration."
      : "No voice is available for this language.",
  };
}

/** Plain-language label for how a piece of audio was produced (never claims a human recording for TTS). */
export function audioSourceLabel(source: AudioSource): string {
  return { human_recording: "Recorded by a person", provider_recording: "Recording from the provider", ai_tts: "AI-generated voice", device_tts: "This device's own voice (computer-generated)" }[source];
}

/**
 * The identity of a piece of generated study audio — for a FUTURE generating provider (e.g. server-side
 * TTS, which needs approval: paid usage and per-licence rights). Same inputs → same key (never generated
 * twice); any change to the text, its version, language, voice, provider, convention or settings → a new
 * key (old audio is never served for changed content). Device speech generates nothing and caches nothing.
 */
export function audioCacheKey(p: { sourceId: string; contentVersion: string; text: string; language: string; provider: string; voice: string; convention?: string | null; settings?: Record<string, string | number | boolean> }): string {
  const settings = Object.keys(p.settings ?? {}).sort().map((k) => `${k}=${String(p.settings![k])}`).join("&");
  const raw = [p.sourceId, p.contentVersion, p.language, p.provider, p.voice, p.convention ?? "", settings, p.text.normalize("NFC")].join("␟");
  // FNV-1a 64-bit (as two 32-bit halves) — stable, dependency-free; a cache key, not a security hash.
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((ch << 7) | (i & 0x7f)), 0x5bd1e995) >>> 0;
  }
  return `${p.provider}:${p.language}:${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
