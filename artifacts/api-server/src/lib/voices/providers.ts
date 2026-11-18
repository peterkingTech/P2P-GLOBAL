// P2P VOICES — provider adapters. Each reads its credentials from the SERVER environment only (Railway variables
// in production, api-server/.env locally) and is disabled when they are missing. Nothing here is ever sent to the app.
//
//   Azure Speech        AZURE_SPEECH_KEY + AZURE_SPEECH_REGION           everyday content + story fallback
//   Google Cloud TTS    GOOGLE_TTS_API_KEY                               everyday content + story fallback
//   ElevenLabs          ELEVENLABS_API_KEY (+ VOICES_ELEVENLABS_CATALOGUE=true)   catalogue + previews ONLY
//   Spitch (Igbo…)      SPITCH_API_KEY + VOICES_SPITCH_VERIFIED=true     specialist; off until verified by the owner
import { characteristicsFrom, describeLocale, fetchWithTimeout, isChildVoice, ProviderError, type ProviderPolicy, type Voice, type VoiceProvider } from "./types";

const now = () => new Date().toISOString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Customer output of both cloud TTS services belongs to the customer and may be stored and replayed (Azure and
// Google Cloud service terms) — the owner should still confirm this for P2P's own contracts before production.
const CLOUD_POLICY: ProviderPolicy = { cacheAllowed: true, offlineAllowed: true, retentionDays: null,
  note: "Generated audio is the customer's output and may be stored and replayed under the provider's service terms. Confirm against P2P's own agreement before production." };

// ── Azure Speech ─────────────────────────────────────────────────────────────────────────────────────────────
/** Azure voices documented as CHILD voices (not offered at this stage — owner). Metadata checks catch others. */
const AZURE_CHILD = new Set(["en-US-AnaNeural", "en-GB-MaisieNeural", "de-DE-GiselaNeural", "fr-FR-EloiseNeural", "zh-CN-XiaoyouNeural", "zh-CN-XiaoshuangNeural"]);
/** Azure's metadata has no age field, but its documented child voices (Ana, Maisie, Gisela, Eloise, Xiaoyou) all carry
 *  one of these exact persona profiles; any voice with the same profile is treated as a child voice and not offered
 *  (checked 2026-11-18: es-ES Irene, es-MX Marina, it-IT Pierina, ja-JP Aoi, ko-KR SeoHyeon, pt-BR Leticia). */
const CHILD_PROFILES = new Set(["curious|cheerful", "curious|cheerful|engaging", "crisp|cheerful|bright"]);
const childProfile = (p?: string[]) => !!p?.length && CHILD_PROFILES.has(p.map((x) => x.toLowerCase()).join("|"));
interface AzureVoice { ShortName: string; DisplayName: string; LocalName?: string; Gender?: string; Locale: string; VoiceType?: string; Status?: string;
  StyleList?: string[]; VoiceTag?: { TailoredScenarios?: string[]; VoicePersonalities?: string[] } }
export const azure: VoiceProvider = {
  id: "azure", name: "Microsoft Azure Speech", role: "Everyday content (Daily Word, lessons, plans) and Kingdom Stories fallback",
  policy: CLOUD_POLICY,
  status() {
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) return { enabled: false, reason: "Azure credentials are not set on the server (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)." };
    return { enabled: true, reason: null };
  },
  async listVoices(signal) {
    const region = process.env.AZURE_SPEECH_REGION!;
    const r = await fetchWithTimeout(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      provider: "azure", signal, headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY! } });
    const list = (await r.json()) as AzureVoice[];
    if (!Array.isArray(list)) throw new ProviderError("azure", "bad_response", "Azure returned an unexpected voice list.");
    const at = now();
    return list.filter((v) => v?.ShortName && v.Locale && !AZURE_CHILD.has(v.ShortName) && !childProfile(v.VoiceTag?.VoicePersonalities)
        && !isChildVoice([...(v.VoiceTag?.VoicePersonalities ?? []), ...(v.VoiceTag?.TailoredScenarios ?? [])]))
      .map((v): Voice => {
        const loc = describeLocale(v.Locale);
        const g = String(v.Gender ?? "").toLowerCase();
        return { id: `azure:${v.ShortName}`, provider: "azure", providerVoiceId: v.ShortName, name: v.LocalName && v.LocalName !== v.DisplayName ? `${v.DisplayName} (${v.LocalName})` : v.DisplayName,
          ...loc, presentation: g === "female" || g === "male" ? g : null,
          characteristics: characteristicsFrom([...(v.VoiceTag?.VoicePersonalities ?? []), ...(v.VoiceTag?.TailoredScenarios ?? [])]),
          model: v.VoiceType ?? null, preview: { kind: "generate" }, canSynthesize: true,
          status: !v.Status || /^(ga|preview)$/i.test(v.Status) ? "available" : "unavailable", source: "Azure Speech voices/list for P2P's resource", refreshedAt: at };
      });
  },
  async synthesize(text, voice, signal) {
    const region = process.env.AZURE_SPEECH_REGION!;
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${esc(voice.locale)}"><voice name="${esc(voice.providerVoiceId)}">${esc(text)}</voice></speak>`;
    const r = await fetchWithTimeout(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      provider: "azure", signal, method: "POST", timeoutMs: 20_000, body: ssml,
      headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "p2p-voices" } });
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 100) throw new ProviderError("azure", "bad_response", "Azure returned no audio.");
    return { audio, contentType: "audio/mpeg", characters: text.length };
  },
};

// ── Google Cloud Text-to-Speech ──────────────────────────────────────────────────────────────────────────────
interface GoogleVoice { name: string; languageCodes: string[]; ssmlGender?: string; naturalSampleRateHertz?: number }
const googleModel = (name: string) => (name.match(/-(Standard|Wavenet|Neural2|News|Studio|Polyglot|Journey|Casual|Chirp3-HD|Chirp-HD)-/)?.[1] ?? null);
export const google: VoiceProvider = {
  id: "google", name: "Google Cloud Text-to-Speech", role: "Everyday content (Daily Word, lessons, plans) and Kingdom Stories fallback",
  policy: CLOUD_POLICY,
  status() {
    if (!process.env.GOOGLE_TTS_API_KEY) return { enabled: false, reason: "Google Cloud credentials are not set on the server (GOOGLE_TTS_API_KEY)." };
    return { enabled: true, reason: null };
  },
  async listVoices(signal) {
    const r = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(process.env.GOOGLE_TTS_API_KEY!)}`, { provider: "google", signal });
    const j = (await r.json()) as { voices?: GoogleVoice[] };
    if (!Array.isArray(j.voices)) throw new ProviderError("google", "bad_response", "Google returned an unexpected voice list.");
    const at = now();
    return j.voices.flatMap((v) => (v.languageCodes ?? []).slice(0, 1).map((lc): Voice => {
      const loc = describeLocale(lc);
      const g = String(v.ssmlGender ?? "").toLowerCase();
      return { id: `google:${v.name}`, provider: "google", providerVoiceId: v.name, name: v.name.replace(/^[a-z]{2,3}-[A-Z]{2}-/, ""), ...loc,
        presentation: g === "female" || g === "male" ? g : null, characteristics: [], model: googleModel(v.name),
        preview: { kind: "generate" }, canSynthesize: true, status: "available", source: "Google Cloud TTS voices.list for P2P's project", refreshedAt: at };
    }));
  },
  async synthesize(text, voice, signal) {
    const r = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(process.env.GOOGLE_TTS_API_KEY!)}`, {
      provider: "google", signal, method: "POST", timeoutMs: 20_000, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text }, voice: { languageCode: voice.locale, name: voice.providerVoiceId }, audioConfig: { audioEncoding: "MP3" } }) });
    const j = (await r.json()) as { audioContent?: string };
    if (!j.audioContent) throw new ProviderError("google", "bad_response", "Google returned no audio.");
    return { audio: Buffer.from(j.audioContent, "base64"), contentType: "audio/mpeg", characters: text.length };
  },
};

// ── ElevenLabs — CATALOGUE AND PREVIEWS ONLY (no synthesize: generation is the owner's, outside P2P) ─────────────
interface XiVoice { voice_id: string; name: string; category?: string; preview_url?: string | null;
  labels?: { accent?: string; gender?: string; age?: string; description?: string; use_case?: string; language?: string }; verified_languages?: { language: string; locale?: string; accent?: string }[] }
export const elevenlabs: VoiceProvider = {
  id: "elevenlabs", name: "ElevenLabs", role: "Official Kingdom Stories narration — voice catalogue and previews only (the owner generates and uploads narration)",
  policy: { cacheAllowed: false, offlineAllowed: false, retentionDays: null, note: "P2P never generates ElevenLabs audio. Previews are the provider's own sample links, played from ElevenLabs." },
  status() {
    if (!process.env.ELEVENLABS_API_KEY) return { enabled: false, reason: "No ElevenLabs key on the server (catalogue and previews are optional)." };
    if (process.env.VOICES_ELEVENLABS_CATALOGUE !== "true") return { enabled: false, reason: "The ElevenLabs voice catalogue is switched off (VOICES_ELEVENLABS_CATALOGUE)." };
    return { enabled: true, reason: null };
  },
  async listVoices(signal) {
    const out: Voice[] = [];
    let token: string | null = null;
    const at = now();
    for (let page = 0; page < 10; page++) { // the account's OWN voices (v2 /voices, paginated) — not the public library
      const qs = new URLSearchParams({ page_size: "100", ...(token ? { next_page_token: token } : {}) });
      const r = await fetchWithTimeout(`https://api.elevenlabs.io/v2/voices?${qs}`, { provider: "elevenlabs", signal, headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } });
      const j = (await r.json()) as { voices?: XiVoice[]; has_more?: boolean; next_page_token?: string | null };
      for (const v of j.voices ?? []) {
        const l = v.labels ?? {};
        if (isChildVoice([l.age, l.description, l.use_case])) continue;
        const langs = v.verified_languages?.length ? v.verified_languages : l.language ? [{ language: l.language, locale: undefined, accent: l.accent }] : [];
        for (const vl of langs.slice(0, 3)) {
          const loc = describeLocale(vl.locale ?? vl.language);
          const g = String(l.gender ?? "").toLowerCase();
          out.push({ id: `elevenlabs:${v.voice_id}${langs.length > 1 ? `@${loc.locale}` : ""}`, provider: "elevenlabs", providerVoiceId: v.voice_id, name: v.name, ...loc,
            accent: vl.accent && loc.language === "en" && !vl.locale ? `${vl.accent} English` : loc.accent,
            presentation: g === "female" || g === "male" ? g : null, characteristics: characteristicsFrom([l.description, l.use_case]), model: null,
            preview: v.preview_url ? { kind: "url", url: v.preview_url } : null, canSynthesize: false, status: "available",
            source: "ElevenLabs /v2/voices for P2P's account (catalogue only)", refreshedAt: at });
        }
      }
      if (!j.has_more || !j.next_page_token) break;
      token = j.next_page_token;
    }
    return out;
  },
  // Deliberately NO synthesize — see the header.
};

// ── Spitch — specialist African-language provider (candidate for Igbo). OFF until the owner verifies it. ─────────
// Public documentation (spitch.app/docs, PyPI "spitch") describes Igbo text-to-speech; the voice ids, pricing,
// commercial-use and caching terms were NOT confirmed (2026-11-18). Activation needs: SPITCH_API_KEY, the verified
// voice list in VOICES_SPITCH_VOICES (JSON: [{"id":"…","language":"ig","gender":"female","name":"…"}]) and
// VOICES_SPITCH_VERIFIED=true after real Igbo test passages have been listened to. Until then nothing is shown.
export const spitch: VoiceProvider = {
  id: "spitch", name: "Spitch (specialist African languages)", role: "Candidate Igbo / Yoruba / Hausa provider — not active until verified",
  policy: { cacheAllowed: false, offlineAllowed: false, retentionDays: 0, note: "Caching and offline use stay off until Spitch's terms are confirmed for P2P." },
  status() {
    if (!process.env.SPITCH_API_KEY) return { enabled: false, reason: "Not connected: no Spitch account key on the server." };
    if (process.env.VOICES_SPITCH_VERIFIED !== "true") return { enabled: false, reason: "Key present but the voices have not been verified by the owner (VOICES_SPITCH_VERIFIED)." };
    return { enabled: true, reason: null };
  },
  async listVoices() {
    // Only voices the owner verified — Spitch's voices are configured, never assumed from marketing pages.
    let list: { id: string; language: string; gender?: string; name?: string }[] = [];
    try { list = JSON.parse(process.env.VOICES_SPITCH_VOICES ?? "[]"); } catch { list = []; }
    const at = now();
    return list.filter((v) => v?.id && v.language).map((v): Voice => {
      const loc = describeLocale(v.language);
      const g = String(v.gender ?? "").toLowerCase();
      return { id: `spitch:${v.id}`, provider: "spitch", providerVoiceId: v.id, name: v.name ?? v.id, ...loc, presentation: g === "female" || g === "male" ? g : null,
        characteristics: [], model: null, preview: { kind: "generate" }, canSynthesize: true, status: "available", source: "Owner-verified Spitch voice list", refreshedAt: at };
    });
  },
  async synthesize(text, voice, signal) {
    const r = await fetchWithTimeout("https://api.spitch.app/v1/speech", { provider: "spitch", signal, method: "POST", timeoutMs: 25_000,
      headers: { Authorization: `Bearer ${process.env.SPITCH_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ language: voice.language, text, voice: voice.providerVoiceId, format: "mp3" }) });
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 100) throw new ProviderError("spitch", "bad_response", "Spitch returned no audio.");
    return { audio, contentType: "audio/mpeg", characters: text.length };
  },
};

export const PROVIDERS: VoiceProvider[] = [azure, google, elevenlabs, spitch];
/** Advertised candidates that have NO adapter yet (not shown to anyone but admins). */
export const CANDIDATES = [
  { id: "naija-speech", name: "Naija Speech API / 9jaLingo", languages: ["ig", "yo", "ha", "pcm"], advertisedVoices: ["igbo_female1", "igbo_female2", "igbo_male2"],
    finding: "Documentation found only on a development domain; the advertised Igbo voice ids could not be confirmed (2026-11-18)." },
  { id: "orinode", name: "Orinode", languages: ["ig"], advertisedVoices: ["Chiamaka (female)", "Obi (male)"],
    finding: "No public API documentation could be found (2026-11-18)." },
];
