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
//   • Owner decision 2026-11-13: "Hear it" must always play, like a dictionary. When the device has no
//     voice for the language (desktop browsers rarely have Greek or Hebrew; Aramaic has none anywhere),
//     the device's ENGLISH voice says a sounds-like spelling made from the transliteration (soundsLike:
//     "agapē" → "ah-gah-pay"), and the screen says it is an English approximation. The original letters
//     are still never read by an English voice.

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
  /** Why there is no audio in the language's own voice (Aramaic), or null. */
  unavailableReason: string | null;
  /** Sounds-like spelling from the transliteration, for the English-voice fallback (null without one). */
  soundsLike: string | null;
  /** Speech language of that fallback. */
  fallbackLanguage: "en";
}

// ── Sounds-like spelling ────────────────────────────────────────────────────
// From either transliteration style in use: the lexicon's (sha.lom, che.sed, agapē) and the BSB
// interlinear's (šā·lō·wm, ḥe·seḏ, bə·rê·šîṯ). The classroom pronunciation: Erasmian Greek; Hebrew with
// ḥ / ch / ḵ as "kh" and vocal shewa as "uh". Syllables joined by hyphens so an English voice says each.
type Unit = { out: string; vowel: boolean; src: string };
function tokens(word: string, table: [string, string, boolean][]): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < word.length;) {
    const hit = table.find(([src]) => word.startsWith(src, i));
    if (hit) { units.push({ out: hit[1], vowel: hit[2], src: hit[0] }); i += hit[0].length; }
    else { const ch = word[i]; if (/[a-z]/.test(ch)) units.push({ out: ch, vowel: false, src: ch }); i += 1; }
  }
  return units;
}
const V = true, C = false;
const HEBREW_TABLE: [string, string, boolean][] = [
  ["p̄", "f", C], ["sh", "sh", C], ["ch", "kh", C], ["kh", "kh", C], ["tz", "ts", C], ["ts", "ts", C], ["ph", "f", C],
  ["š", "sh", C], ["ś", "s", C], ["ṣ", "ts", C], ["ṯ", "t", C], ["ṭ", "t", C], ["ḇ", "v", C], ["ḏ", "d", C], ["ḡ", "g", C],
  ["ḵ", "kh", C], ["ḥ", "kh", C], ["q", "k", C],
  ["ā", "ah", V], ["â", "ah", V], ["ă", "ah", V], ["a", "ah", V], ["ê", "ay", V], ["ē", "ay", V], ["ĕ", "eh", V], ["é", "eh", V], ["e", "eh", V],
  ["ə", "uh", V], ["î", "ee", V], ["ī", "ee", V], ["i", "ee", V], ["ô", "oh", V], ["ō", "oh", V], ["ŏ", "oh", V], ["o", "oh", V],
  ["û", "oo", V], ["ū", "oo", V], ["u", "oo", V],
];
const GREEK_TABLE: [string, string, boolean][] = [
  ["ēu", "yoo", V], ["eu", "yoo", V], ["ai", "eye", V], ["ei", "ay", V], ["oi", "oy", V], ["ou", "oo", V], ["au", "ow", V], ["ui", "wee", V], ["yi", "wee", V],
  ["ch", "kh", C], ["th", "th", C], ["ph", "f", C], ["ps", "ps", C], ["rh", "r", C], ["x", "ks", C],
  ["ā", "ah", V], ["a", "ah", V], ["ē", "ay", V], ["e", "eh", V], ["ī", "ee", V], ["ï", "ee", V], ["i", "ee", V], ["ō", "oh", V], ["o", "oh", V],
  ["ÿ", "oo", V], ["y", "oo", V], ["u", "oo", V],
];
const STOPS = new Set(["p", "b", "t", "d", "k", "g", "ph", "th", "ch"]);
/** Greek consonants between two vowels: what may begin the next syllable (stop + liquid, s + stop, pn/gn/mn). */
function greekOnset(cs: Unit[]): number {
  if (cs.length <= 1) return cs.length;
  const [a, b] = [cs[cs.length - 2].src, cs[cs.length - 1].src];
  const pair = (STOPS.has(a) && (b === "r" || b === "l")) || (a === "s" && STOPS.has(b)) || ["pn", "gn", "mn"].includes(a + b);
  return pair ? 2 : 1;
}
function syllabify(units: Unit[], onset: (cs: Unit[]) => number): string {
  const syl: string[] = []; let cur = ""; let pending: Unit[] = []; let seenVowel = false;
  for (const u of units) {
    if (!u.vowel) { pending.push(u); continue; }
    if (seenVowel) {
      const n = onset(pending);
      cur += pending.slice(0, pending.length - n).map((x) => x.out).join("");
      syl.push(cur); cur = pending.slice(pending.length - n).map((x) => x.out).join("");
    } else cur += pending.map((x) => x.out).join("");
    pending = []; cur += u.out; seenVowel = true;
  }
  cur += pending.map((x) => x.out).join("");
  if (cur) syl.push(cur);
  return syl.join("-");
}
const tidy = (s: string) => s.normalize("NFC").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[’‘'`ʼʾʿ᾽]/g, "");

function soundsLikeHebrew(translit: string): string {
  return tidy(translit).split(/[\s\-–־]+/).filter(Boolean).map((word) => {
    const syl = word.split(/[·.]+/).filter(Boolean);
    // holem/shureq written with a vav (mō·wr, ō·wṯ): the w is a vowel letter, not a syllable
    for (let i = 1; i < syl.length; i++) if (/[ōoūu]$/.test(syl[i - 1]) && /^w(?![aeiouāēīōūâêîôûăĕŏə])/.test(syl[i])) { syl[i - 1] += syl[i].slice(1); syl.splice(i--, 1); }
    return syl.map((x) => tokens(x.replace(/([aeiouāēīōūâêîôûăĕŏə])h$/, "$1"), HEBREW_TABLE).map((u) => u.out).join("")).filter(Boolean).join("-");
  }).filter(Boolean).join(" ");
}
function soundsLikeGreek(translit: string): string {
  const keep = tidy(translit).normalize("NFD").replace(/[̀-ͯ]/g, (m) => (m === "̄" || m === "̈" ? m : "")).normalize("NFC");
  return keep.split(/[\s\-–]+/).filter(Boolean).map((word) => {
    const units = tokens(word, GREEK_TABLE).map((u, i, all) => {
      if (u.src === "g" && all[i + 1] && ["g", "k", "ks", "kh"].includes(all[i + 1].out)) return { ...u, out: "n" };   // γγ, γκ, γξ, γχ
      if (u.src === "ai" && i > 0 && !all[i - 1].vowel) return { ...u, out: "igh" };                            // -sai- → "sigh"
      return u;
    });
    return syllabify(units, greekOnset);
  }).filter(Boolean).join(" ");
}
/** Sounds-like spelling of a transliteration for an English voice ("agapē" → "ah-gah-pay"), or null. */
export function soundsLike(transliteration: string | null | undefined, language: string): string | null {
  const t = (transliteration ?? "").trim();
  if (!t) return null;
  const out = language === "greek" ? soundsLikeGreek(t) : language === "hebrew" || language === "aramaic" ? soundsLikeHebrew(t) : "";
  return /[a-z]/.test(out) ? out : null;
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

export function pronunciationPlan(text: string, language: string, transliteration?: string | null): PronunciationPlan {
  const fallback = { soundsLike: soundsLike(transliteration, language), fallbackLanguage: "en" as const };
  if (language === "hebrew") return {
    speak: speakableHebrew(text), speechLanguage: "he-IL", source: "device_tts", verified: false,
    convention: "Modern Israeli Hebrew (device voice) — not verified for Biblical Hebrew", unavailableReason: null, ...fallback,
  };
  if (language === "greek") return {
    speak: speakableGreek(text), speechLanguage: "el-GR", source: "device_tts", verified: false,
    convention: "Modern Greek (device voice) — not a reconstructed Koine pronunciation", unavailableReason: null, ...fallback,
  };
  return {
    speak: "", speechLanguage: null, source: "device_tts", verified: false,
    convention: language === "aramaic" ? "Biblical Aramaic" : "Unknown",
    unavailableReason: language === "aramaic"
      ? "No reliable Aramaic voice is available. Aramaic is not read with a Hebrew voice — use the transliteration."
      : "No voice is available for this language.",
    ...fallback,
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
