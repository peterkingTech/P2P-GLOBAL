// Listen: matching the CONTENT's language to a voice on this device.
//
// Three different things, never mixed up: the app's interface language, the
// language of the text being read (a Bible translation, a translated lesson)
// and the voices this phone's speech engine has. A voice is chosen only when
// its language matches the content. When none matches, the player says so and
// lets the person pick another voice themselves or keep reading silently —
// it never quietly reads in a different language.

export interface DeviceVoice { identifier: string; name: string; language: string; quality?: string }

// Three-letter codes some sources use → the two-letter codes voices use.
const ISO3: Record<string, string> = {
  eng: "en", fra: "fr", fre: "fr", spa: "es", por: "pt", deu: "de", ger: "de", ara: "ar", swa: "sw", swh: "sw", hin: "hi",
  ibo: "ig", yor: "yo", kor: "ko", ind: "id", rus: "ru", tgl: "tl", fil: "tl", ben: "bn", zho: "zh", chi: "zh", cmn: "zh",
  amh: "am", hau: "ha", tur: "tr", urd: "ur", ita: "it", nld: "nl", dut: "nl", ron: "ro", rum: "ro", ukr: "uk", ell: "el",
  gre: "el", heb: "he", fas: "fa", per: "fa", vie: "vi", tha: "th",
};

/** "en_US" / "EN-us" / "eng" → base language "en" ("" when unknown). */
export function baseLanguage(code: string | null | undefined): string {
  const first = String(code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!first) return "";
  return ISO3[first] ?? first;
}

/** The engine's language tag for content in `code` ("en" → "en", "pt_BR" → "pt-BR"). */
export function speechLanguageTag(code: string | null | undefined): string {
  const parts = String(code ?? "").trim().split(/[-_]/).filter(Boolean);
  if (!parts.length) return "";
  const base = baseLanguage(parts[0]);
  return parts.length > 1 ? `${base}-${parts[1].toUpperCase()}` : base;
}

// ── Narration quality ───────────────────────────────────────────────────────
// Phones also ship joke and sound-effect voices (Apple's Bells, Boing,
// Bubbles, Bahh, Cellos, Albert, Zarvox…) and the robotic "Eloquence" set
// (Eddy, Flo, Grandma, Grandpa, Reed, Rocko, Sandy, Shelley). They are
// recognised by the system's IDENTIFIER first (Apple's novelty voices live
// under "com.apple.speech.synthesis.voice.", Eloquence under
// "com.apple.eloquence."), then by name as a fallback for engines with
// opaque identifiers. Real voices with ordinary names (Arthur, Catherine,
// Daniel…) are kept — their identifiers say compact / enhanced / premium.
export type VoiceTier = "novelty" | "robotic" | "standard" | "enhanced" | "premium";
const NOVELTY_NAMES = new Set(["albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "good news", "hysterical", "jester", "organ", "pipe organ", "superstar", "trinoids", "whisper", "wobble", "zarvox", "fred", "junior", "kathy", "ralph", "princess", "agnes", "bruce", "vicki", "victoria"]);
const ROBOTIC_NAMES = new Set(["eddy", "flo", "grandma", "grandpa", "reed", "rocko", "sandy", "shelley"]);

export function voiceTier(v: DeviceVoice): VoiceTier {
  const id = String(v.identifier ?? "").toLowerCase();
  const name = String(v.name ?? "").toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
  const quality = String(v.quality ?? "").toLowerCase();
  if (id.startsWith("com.apple.speech.synthesis.voice.") || NOVELTY_NAMES.has(name)) return "novelty";
  if (id.includes("eloquence") || ROBOTIC_NAMES.has(name)) return "robotic";
  if (id.includes(".premium") || /\bpremium\b/.test(name)) return "premium";
  // Browsers: "Microsoft … Online (Natural)", "Google …" network voices; Android "-network" voices.
  if (quality === "enhanced" || id.includes(".enhanced") || /\b(natural|neural|enhanced)\b/i.test(String(v.name))) return "enhanced";
  return "standard";
}
const TIER_SCORE: Record<VoiceTier, number> = { novelty: -10, robotic: -1, standard: 2, enhanced: 4, premium: 6 };
/** Suitable for long Bible and lesson narration (no joke or sound-effect voices). */
export const isNarrationVoice = (v: DeviceVoice) => voiceTier(v) !== "novelty";

/**
 * Narration voices that speak the content's language, best first: premium,
 * enhanced, then standard; the content's exact region before others.
 * Robotic voices are offered only when nothing better exists for the language.
 */
export function voicesFor(language: string, voices: DeviceVoice[]): DeviceVoice[] {
  const base = baseLanguage(language);
  if (!base) return [];
  const tag = speechLanguageTag(language).toLowerCase();
  const same = voices.filter((v) => baseLanguage(v.language) === base && isNarrationVoice(v));
  const good = same.filter((v) => voiceTier(v) !== "robotic");
  return (good.length ? good : same).sort((a, b) => score(b, tag) - score(a, tag) || a.name.localeCompare(b.name));
}
function score(v: DeviceVoice, tag: string) {
  return TIER_SCORE[voiceTier(v)] + (v.language.toLowerCase().replace("_", "-") === tag ? 1 : 0);
}

/** Every narration voice on the device (for choosing another language explicitly), best first. */
export function narrationVoices(voices: DeviceVoice[]): DeviceVoice[] {
  return voices.filter(isNarrationVoice).sort((a, b) => a.language.localeCompare(b.language) || TIER_SCORE[voiceTier(b)] - TIER_SCORE[voiceTier(a)] || a.name.localeCompare(b.name));
}

export type VoiceChoice =
  /** Speak in the content's language (with this voice, or the engine's own choice for that language). */
  | { kind: "match"; language: string; voice: string | null }
  /** The device reported its voices and none speaks this language. */
  | { kind: "unavailable"; language: string }
  /** The person explicitly chose a voice in another language for this content. */
  | { kind: "override"; language: string; voice: string };

/**
 * Which voice to use. `preferred` is the person's saved voice for this
 * language; `override` a voice they explicitly picked after being told the
 * content's language isn't available. An empty voice list means the engine
 * didn't say (some Android engines report nothing until first use) — then the
 * language tag alone is passed and the engine's own error, if any, is shown.
 */
export function chooseVoice(language: string, voices: DeviceVoice[], preferred: string | null, override: string | null): VoiceChoice {
  const tag = speechLanguageTag(language);
  if (override) {
    const v = voices.find((x) => x.identifier === override && isNarrationVoice(x));
    if (v) return baseLanguage(v.language) === baseLanguage(language) ? { kind: "match", language: tag, voice: v.identifier } : { kind: "override", language: speechLanguageTag(v.language), voice: v.identifier };
  }
  if (!voices.length) return { kind: "match", language: tag, voice: null };
  const matching = voicesFor(language, voices);
  if (!matching.length) return { kind: "unavailable", language: tag };
  const pick = matching.find((v) => v.identifier === preferred) ?? matching[0];
  return { kind: "match", language: tag, voice: pick.identifier };
}
