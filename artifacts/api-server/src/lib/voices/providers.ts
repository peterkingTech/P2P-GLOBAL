// P2P VOICES — provider adapters. Each reads its credentials from the SERVER environment only (Railway variables
// in production, api-server/.env locally) and is disabled when they are missing. Nothing here is ever sent to the app.
//
//   Azure Speech        AZURE_SPEECH_KEY + AZURE_SPEECH_REGION           everyday content + story fallback
//   Google Cloud TTS    GOOGLE_TTS_API_KEY                               everyday content + story fallback
//   ElevenLabs          ELEVENLABS_API_KEY (+ VOICES_ELEVENLABS_CATALOGUE=true)   catalogue + previews ONLY
//   Spitch (Igbo…)      SPITCH_API_KEY + VOICES_SPITCH_VERIFIED=true     specialist; off until verified by the owner
//   9jaLingo            NAIJALINGO_API_KEY                                Igbo, Hausa, Pidgin, Yoruba — LIVE ONLY (no copies)
//   Naija Speech        P2P_Global_Igbo_Voice + VOICES_NAIJASPEECH_LICENCE=confirmed   Igbo, Hausa, Yoruba — LIVE ONLY
//   Giggy               GIGGY_API_TTS_KEY (VOICES_GIGGY=off to switch off)               Naija Pidgin, Igbo, Twi
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

// ── 9jaLingo (Naija Speech) — Igbo, Hausa, Nigerian Pidgin, Yoruba (owner 2026-11-19: "use it for igbo … hausa and pidgin").
// API (official SDK github.com/9jaLingo/9jalingo-sdk): https://api.9jalingo.org, header X-API-Key, GET /v1/speakers?language=,
// POST /v1/audio/speech { input, voice, lang, model: "9jalingo-tts-1", response_format }. The engine sleeps when idle and
// answers 202 (queued) while it starts — that request fails softly and the next one, once warm, works.
// TERMS (9jalingo.org/pricing + /terms-of-service, read 2026-11-19): commercial use allowed on every plan, no watermark;
// storing, caching, redistribution and offline use of generated audio are NOT addressed → owner's rule (unknown = no):
// LIVE ONLY — the server keeps a clip only long enough to deliver it, phones never keep a copy, no offline.
// VOICES_NAIJALINGO=off switches it off without removing the key.
const NL_BASE = "https://api.9jalingo.org";
const nlKey = () => process.env.NAIJALINGO_API_KEY || "";
export const NAIJALINGO_LANGUAGES = ["ig", "ha", "pcm", "yo"] as const;
const NL_DOMAIN: Record<string, string> = { "Everyday Conversation": "everyday", "Business Conversation": "business", "Health Conversation": "health", "Agricultural Conversation": "agriculture" };
export const naijalingo: VoiceProvider = {
  id: "naijalingo", name: "9jaLingo (Nigerian languages)", role: "Igbo, Hausa, Nigerian Pidgin and Yoruba",
  policy: { cacheAllowed: false, offlineAllowed: false, retentionDays: 0,
    note: "Commercial use is allowed on every 9jaLingo plan. Their terms say nothing about storing or offline use, so P2P plays these voices live only: no copies are kept on the server or on phones." },
  status() {
    if (!nlKey()) return { enabled: false, reason: "Not connected: no 9jaLingo key on the server." };
    if (process.env.VOICES_NAIJALINGO === "off") return { enabled: false, reason: "Switched off (VOICES_NAIJALINGO=off)." };
    return { enabled: true, reason: null };
  },
  async listVoices() {
    const at = now();
    const out: Voice[] = [];
    for (const lang of NAIJALINGO_LANGUAGES) {
      const r = await fetchWithTimeout(`${NL_BASE}/v1/speakers?language=${lang}`, { provider: "naijalingo", headers: { "X-API-Key": nlKey(), Accept: "application/json" }, timeoutMs: 20_000 });
      const j = (await r.json()) as unknown;
      const list = (Array.isArray(j) ? j : ((j as { speakers?: unknown[] })?.speakers ?? [])) as { id?: string; name?: string; language?: string; gender?: string; domain?: string | null }[];
      for (const s of list) {
        if (!s?.id || !/^[a-z0-9_-]{1,64}$/i.test(s.id)) continue;
        const loc = describeLocale(lang);
        const g = String(s.gender ?? "").toLowerCase();
        out.push({ id: `naijalingo:${s.id}`, provider: "naijalingo", providerVoiceId: s.id, name: s.name || s.id, ...loc, presentation: g === "female" || g === "male" ? g : null,
          characteristics: [], model: "9jalingo-tts-1", preview: { kind: "generate" }, canSynthesize: true, status: "available",
          source: `9jaLingo speaker list${s.domain && NL_DOMAIN[s.domain] ? ` (${s.domain})` : ""}`, refreshedAt: at });
      }
    }
    return out;
  },
  async synthesize(text, voice, signal) {
    const r = await fetchWithTimeout(`${NL_BASE}/v1/audio/speech`, { provider: "naijalingo", signal, method: "POST", timeoutMs: 45_000,
      headers: { "X-API-Key": nlKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ input: text, voice: voice.providerVoiceId, lang: voice.language, model: "9jalingo-tts-1", response_format: "mp3" }) });
    if (r.status === 202) throw new ProviderError("naijalingo", "unavailable", "9jaLingo's voice engine is starting.", 202);
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 100) throw new ProviderError("naijalingo", "bad_response", "9jaLingo returned no audio.");
    return { audio, contentType: "audio/mpeg", characters: text.length };
  },
};

// ── Naija Speech API (asr.naijallm.com) — Igbo, Hausa, Yoruba (owner's key, 2026-11-20) ─────────────────────────
// API (asr.naijallm.com/llms.txt, read 2026-11-20): base https://asr.naijallm.com/v1, Authorization: Bearer nlb_…,
// GET /audio/voices, POST /audio/speech { input ≤ 1000 chars, voice, language, response_format: "mp3" } → audio bytes.
// Limits per key: 10 requests/minute, 1,000/day, 100,000 TTS characters/day.
// TERMS: "Free for non-commercial use"; commercial products need a licence (ayuba@naijallm.com). The *_clear voices
// (MMS-TTS, CC BY-NC 4.0) are non-commercial ONLY → never offered. Storing generated audio isn't addressed → LIVE ONLY.
// Owner's copyright rule (unknown = no): OFF until the owner records Naija Speech's permission for P2P Global
// (VOICES_NAIJASPEECH_LICENCE=confirmed on Railway).
const NS_BASE = "https://asr.naijallm.com/v1";
const nsKey = () => process.env.P2P_Global_Igbo_Voice || process.env.NAIJASPEECH_API_KEY || "";
export const NAIJASPEECH_LANGUAGES = ["ig", "ha", "yo"] as const;
const NS_LANGUAGE_WORD: Record<string, string> = { ig: "Igbo", ha: "Hausa", yo: "Yoruba" };
export const naijaspeech: VoiceProvider = {
  id: "naijaspeech", name: "Naija Speech (Igbo, Hausa, Yoruba)", role: "Igbo, Hausa and Yoruba",
  policy: { cacheAllowed: false, offlineAllowed: false, retentionDays: 0,
    note: "Naija Speech is free for non-commercial use; P2P uses it only once Naija Speech has given permission. Its terms say nothing about storing audio, so P2P plays these voices live only." },
  status() {
    if (!nsKey()) return { enabled: false, reason: "Not connected: no Naija Speech key on the server." };
    if (process.env.VOICES_NAIJASPEECH_LICENCE !== "confirmed") return { enabled: false, reason: "Waiting for Naija Speech's permission for P2P Global (their API is free for non-commercial use only). Set VOICES_NAIJASPEECH_LICENCE=confirmed once it's given." };
    return { enabled: true, reason: null };
  },
  async listVoices() {
    const r = await fetchWithTimeout(`${NS_BASE}/audio/voices`, { provider: "naijaspeech", headers: { Authorization: `Bearer ${nsKey()}`, Accept: "application/json" }, timeoutMs: 20_000 });
    const j = (await r.json()) as { data?: { id?: string; language?: string; default?: boolean }[] };
    const at = now();
    return (j.data ?? []).filter((v) => v?.id && /^[a-z0-9_]{1,40}$/.test(v.id) && (NAIJASPEECH_LANGUAGES as readonly string[]).includes(String(v.language)) && !/_clear$/.test(v.id))
      .map((v): Voice => {
        const lang = String(v.language);
        const m = /_(female|male)(\d*)$/.exec(v.id!);
        const presentation = m ? (m[1] as "female" | "male") : null;
        const name = m ? `${NS_LANGUAGE_WORD[lang]} ${m[1]} voice${m[2] ? ` ${m[2]}` : ""}` : v.id!;
        return { id: `naijaspeech:${v.id}`, provider: "naijaspeech", providerVoiceId: v.id!, name, ...describeLocale(lang), presentation,
          characteristics: [], model: "naija-tts", preview: { kind: "generate" }, canSynthesize: true, status: "available",
          source: `Naija Speech voice list${v.default ? " (their default)" : ""}`, refreshedAt: at };
      });
  },
  async synthesize(text, voice, signal) {
    if (text.length > 1000) throw new ProviderError("naijaspeech", "bad_response", "That passage is longer than Naija Speech reads at once.");
    const r = await fetchWithTimeout(`${NS_BASE}/audio/speech`, { provider: "naijaspeech", signal, method: "POST", timeoutMs: 45_000,
      headers: { Authorization: `Bearer ${nsKey()}`, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ model: "naija-tts", input: text, voice: voice.providerVoiceId, language: voice.language, response_format: "mp3" }) });
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 100) throw new ProviderError("naijaspeech", "bad_response", "Naija Speech returned no audio.");
    return { audio, contentType: "audio/mpeg", characters: text.length };
  },
};

// ── Giggy (giggy.ai) — Naija Pidgin, Igbo, Twi (owner added GIGGY_API_TTS_KEY 2026-11-26: "add Naija Pidgin to the
// general P2P voices"). API https://api.giggy.ai/v1, header xi-api-key; GET /v1/integrations/voices (language, gender);
// POST /v1/text-to-speech { text, voice_id, mode:"batch", output_format:"mp3_24000_160" } → MP3; ≤ 20,000 characters.
// TERMS (giggy.ai/terms §7, AUP §8, TTS FAQ — read 2026-11-26): "you may use generated output for personal or commercial
// purposes", incl. monetized video, podcasts and audiobooks; no attribution; disclose synthetic media where expected
// (privacy policy). Giggy itself deletes batch audio after 7 days — P2P keeps its own copy, so caching and offline are
// allowed. Tested 2026-11-26: read back with Naija Speech's Igbo recogniser, Giggy's Igbo was clearly more accurate.
// Giggy's Twi is listed as Akan ("ak"); P2P's language code for it is "tw".
const GG_BASE = "https://api.giggy.ai/v1";
const ggKey = () => process.env.GIGGY_API_TTS_KEY || "";
// Owner 2026-11-26: Giggy is THE provider for these five (catalogue.ts GIGGY_ONLY_LANGUAGES) — not Naija Speech.
const GG_LANG: Record<string, string> = { pcm: "pcm", ig: "ig", ak: "tw", ha: "ha", yo: "yo" };
export const giggy: VoiceProvider = {
  id: "giggy", name: "Giggy (Igbo, Twi, Hausa, Yoruba, Naija Pidgin)", role: "Igbo, Twi, Hausa, Yoruba and Naija Pidgin",
  policy: { cacheAllowed: true, offlineAllowed: true, retentionDays: null,
    note: "Giggy's terms allow commercial use of generated audio (including audiobooks and video), with no attribution. AI voices are disclosed in the privacy policy." },
  status() {
    if (!ggKey()) return { enabled: false, reason: "Not connected: no Giggy key on the server." };
    if (process.env.VOICES_GIGGY === "off") return { enabled: false, reason: "Switched off (VOICES_GIGGY=off)." };
    return { enabled: true, reason: null };
  },
  async listVoices(signal) {
    const at = now();
    const out: Voice[] = [];
    type Page = { voices?: { voice_id?: string; name?: string; language?: string; gender?: string; accent?: string }[]; has_more?: boolean };
    const fetchPage = async (offset: number): Promise<Page> => {
      const r = await fetchWithTimeout(`${GG_BASE}/integrations/voices?limit=100&offset=${offset}`, { provider: "giggy", signal, headers: { "xi-api-key": ggKey(), Accept: "application/json" }, timeoutMs: 20_000 });
      return (await r.json()) as Page;
    };
    // the public catalogue (~25,000 voices), 100 per page, ten pages at a time (well under Giggy's 600 reads/minute);
    // only our languages are kept
    const pages: Page[] = [];
    for (let batch = 0; batch < 40; batch++) {
      const got = await Promise.all(Array.from({ length: 10 }, (_, i) => fetchPage((batch * 10 + i) * 100)));
      pages.push(...got);
      if (got.some((p) => !p.has_more || !(p.voices ?? []).length)) break;
    }
    for (const j of pages) {
      for (const v of j.voices ?? []) {
        const lang = GG_LANG[String(v.language)];
        if (!lang || !v.voice_id || !/^[0-9a-f-]{36}$/i.test(v.voice_id) || !v.name) continue;
        const presentation = v.gender === "female" || v.gender === "male" ? v.gender : null;
        out.push({ id: `giggy:${v.voice_id}`, provider: "giggy", providerVoiceId: v.voice_id, name: v.name, ...describeLocale(lang), presentation,
          characteristics: [], model: "giggyspeech", preview: { kind: "generate" }, canSynthesize: true, status: "available",
          source: "Giggy voice catalogue", refreshedAt: at });
      }
    }
    return [...new Map(out.map((v) => [v.id, v])).values()];
  },
  async synthesize(text, voice, signal) {
    if (text.length > 20_000) throw new ProviderError("giggy", "bad_response", "That passage is longer than Giggy reads at once.");
    const r = await fetchWithTimeout(`${GG_BASE}/text-to-speech`, { provider: "giggy", signal, method: "POST", timeoutMs: 60_000,
      headers: { "xi-api-key": ggKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, voice_id: voice.providerVoiceId, mode: "batch", output_format: "mp3_24000_160" }) });
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 100 || audio.subarray(0, 1).toString() === "{") throw new ProviderError("giggy", "bad_response", "Giggy returned no audio.");
    return { audio, contentType: "audio/mpeg", characters: text.length };
  },
};

export const PROVIDERS: VoiceProvider[] = [azure, google, elevenlabs, spitch, naijalingo, naijaspeech, giggy];
/** Advertised candidates that have NO adapter yet (not shown to anyone but admins). */
export const CANDIDATES = [
  { id: "orinode", name: "Orinode", languages: ["ig"], advertisedVoices: ["Chiamaka (female)", "Obi (male)"],
    finding: "No public API documentation could be found (2026-11-18)." },
];
