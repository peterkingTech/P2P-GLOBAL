// P2P VOICES — on-demand speech for ELIGIBLE content (never pre-generated, never ElevenLabs; Bible text only from
// PUBLIC-DOMAIN translations — owner 2026-11-19: P2P Voice is the only reading voice, no phone voice).
//
// The app's player is sentence-by-sentence (lib/listen/engine): each request here is ONE chunk exactly as the
// listener will hear it, so highlighting stays on the sentence being spoken, pause/resume and a voice change
// continue from the same sentence, and nothing is generated that nobody asked to hear.
//
// Cache key = sha256(provider | providerVoiceId | model | language | content key | content version | text):
//   the text itself is part of the key, so edited content can never be served old audio; speaking speed is
//   applied by the player (playback rate), so one recording serves every speed. Concurrent requests for the
//   same key share ONE generation (in-flight map) and storage is checked first, so a second server instance
//   reuses what the first made.
// Storage: Supabase Storage bucket `p2p-voices-audio` (private; signed links) when it exists (migration 254
// creates it); otherwise — local development — a folder on this server, served by a signed link.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { voiceById, providers } from "./catalogue";
import { ProviderError, type Voice } from "./types";
import { syntheticSpeechAllowed, type TranslationRow } from "../bibleLicence";
import { licensedTranslations } from "../bibleReader";

/** Content the participant may hear in a P2P Voice. Since 2026-11-19 (owner: P2P Voice only) this includes the Bible
 *  and Scripture playlists — but ONLY in a public-domain translation (SCRIPTURE_KINDS: the request must name the
 *  translation and syntheticSpeechAllowed must pass). "study" = commentaries, dictionary and lexicon articles
 *  (public-domain / open study sources, in English); when it names a translation, the same rule applies. */
export const ELIGIBLE_KINDS = ["story", "story-intro", "lesson", "plan", "daily_word", "learning", "general", "bible", "playlist", "study"] as const;
export const SCRIPTURE_KINDS: readonly string[] = ["bible", "playlist"];
type Lookup = (code: string) => Promise<TranslationRow | null>;
// Static import (a dynamic import here would move database-client code ahead of the start-up env guard).
let lookupTranslation: Lookup = async (code) => (await licensedTranslations()).find((r) => r.translation_code === code) ?? null;
export const setTranslationLookupForTests = (f: Lookup) => { lookupTranslation = f; };
export const NOT_PUBLIC_DOMAIN = "P2P Voice reads only public-domain Bible translations. Switch to one such as KJV, WEB or ASV to listen.";
export type EligibleKind = (typeof ELIGIBLE_KINDS)[number];
export const isEligible = (k: string): k is EligibleKind => (ELIGIBLE_KINDS as readonly string[]).includes(k);
export const MAX_CHARS = 1500;
export const PREVIEW_SAMPLES: Record<string, string> = {
  en: "Peace be with you. This is how I sound when I read to you in P2P Global.",
  // Igbo / Hausa / Pidgin / Yoruba samples: written by P2P (2026-11-19) — native-speaker review welcome.
  ig: "Udo dịrị gị. Otu a ka olu m na-ada mgbe m na-agụrụ gị ihe na P2P Global.",
  ha: "Salama a gare ka. Haka muryata take idan ina karanta maka a cikin P2P Global.",
  pcm: "Peace be unto you. Na so my voice dey sound when I dey read for you for P2P Global.",
  yo: "Àlàáfíà fún ọ. Báyìí ni ohùn mi ṣe rí nígbà tí mo bá ń kà fún ọ ní P2P Global.",
  de: "Friede sei mit dir. So klinge ich, wenn ich dir in P2P Global vorlese.",
  fr: "Que la paix soit avec toi. Voici ma voix quand je te lis un texte dans P2P Global.",
  es: "La paz sea contigo. Así sueno cuando te leo en P2P Global.",
  pt: "A paz esteja contigo. É assim que eu soo quando leio para ti no P2P Global.",
  sw: "Amani iwe nawe. Hivi ndivyo sauti yangu inavyosikika ninapokusomea katika P2P Global.",
  ar: "السلام معك. هكذا يبدو صوتي عندما أقرأ لك في P2P Global.",
  hi: "आपको शांति मिले। P2P Global में आपके लिए पढ़ते समय मेरी आवाज़ ऐसी लगती है।",
};

export class VoicesError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

// ── rate limits (per participant, per hour, this instance) ──
const LIMITS = { speak: 1500, preview: 40 }; // a Bible chapter is ~30–80 sentences; listening all hour stays under this
const hits = new Map<string, number[]>();
export function underLimit(userId: string, what: keyof typeof LIMITS, nowMs = Date.now()): boolean {
  const k = `${what}:${userId}`;
  const kept = (hits.get(k) ?? []).filter((t) => nowMs - t < 3600_000);
  if (kept.length >= LIMITS[what]) { hits.set(k, kept); return false; }
  kept.push(nowMs); hits.set(k, kept);
  if (hits.size > 20_000) for (const [key, v] of hits) if (!v.some((t) => nowMs - t < 3600_000)) hits.delete(key);
  return true;
}
export const resetLimitsForTests = () => hits.clear();

// ── usage (for administrators; never the text) ──
const usage = new Map<string, { requests: number; generated: number; cached: number; characters: number; errors: number }>();
export function usageSummary() { return [...usage.entries()].map(([provider, u]) => ({ provider, ...u })); }
function record(provider: string, kind: "generated" | "cached" | "error", characters = 0, meta: { userId?: string; contentKind?: string; code?: string } = {}) {
  const u = usage.get(provider) ?? { requests: 0, generated: 0, cached: 0, characters: 0, errors: 0 };
  u.requests++; if (kind === "generated") { u.generated++; u.characters += characters; } else if (kind === "cached") u.cached++; else u.errors++;
  usage.set(provider, u);
  if (!testMode) void Promise.resolve(db.from("p2p_voice_usage").insert({ provider, event: kind, characters, user_id: meta.userId ?? null, content_kind: meta.contentKind ?? null, error_code: meta.code ?? null }))
    .then(() => undefined, () => undefined); // table from migration 254; absent → memory only
}

// ── storage ──
const BUCKET = "p2p-voices-audio";
const LOCAL_DIR = path.join(os.tmpdir(), "p2p-voices-audio");
let testMode = false;
let testStore: Map<string, Buffer> | null = null;
export function setTestStore(m: Map<string, Buffer> | null) { testStore = m; testMode = !!m; }
const secret = () => createHash("sha256").update(`p2p-voices|${process.env.VOICES_AUDIO_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev"}`).digest();
export const signLocal = (key: string, exp: number) => createHmac("sha256", secret()).update(`${key}.${exp}`).digest("base64url");
export function verifyLocal(key: string, exp: number, sig: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(signLocal(key, exp)), b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const localAudioPath = (key: string) => path.join(LOCAL_DIR, `${key}.mp3`);
let bucketOk: boolean | null = null;
async function hasBucket(): Promise<boolean> {
  if (testMode) return false;
  if (bucketOk !== null) return bucketOk;
  try { const { data } = await db.storage.getBucket(BUCKET); bucketOk = !!data; } catch { bucketOk = false; }
  return bucketOk;
}
async function exists(key: string): Promise<boolean> {
  if (testStore) return testStore.has(key);
  if (await hasBucket()) { const { data } = await db.storage.from(BUCKET).list("", { search: `${key}.mp3`, limit: 1 }); return !!data?.length; }
  return existsSync(localAudioPath(key));
}
// LIVE-ONLY providers (policy.cacheAllowed false): the clip is kept only long enough to be played, under live/,
// and deleted after LIVE_MS (timer + an hourly sweep that also catches files left by a restart).
export const LIVE_MS = 20 * 60_000;
const liveName = (key: string) => `live/${key}.mp3`;
const liveLocal = (key: string) => path.join(LOCAL_DIR, "live", `${key}.mp3`);
async function putLive(key: string, audio: Buffer) {
  if (testStore) { testStore.set(`live/${key}`, audio); return; }
  if (await hasBucket()) { const { error } = await db.storage.from(BUCKET).upload(liveName(key), audio, { contentType: "audio/mpeg", upsert: true }); if (!error) { scheduleRemoval(key); return; } }
  mkdirSync(path.dirname(liveLocal(key)), { recursive: true }); writeFileSync(liveLocal(key), audio); scheduleRemoval(key);
}
async function removeLive(key: string) {
  if (testStore) { testStore.delete(`live/${key}`); return; }
  try { if (await hasBucket()) await db.storage.from(BUCKET).remove([liveName(key)]); } catch { /* the sweep retries */ }
  try { if (existsSync(liveLocal(key))) unlinkSync(liveLocal(key)); } catch { /* the sweep retries */ }
}
const scheduleRemoval = (key: string) => { setTimeout(() => { void removeLive(key); }, LIVE_MS).unref?.(); };
/** Deletes live clips older than LIVE_MS (hourly from index.ts). */
export async function sweepLiveAudio(): Promise<number> {
  let n = 0;
  const cutoff = Date.now() - LIVE_MS;
  try {
    if (await hasBucket()) {
      const { data } = await db.storage.from(BUCKET).list("live", { limit: 1000 });
      const old = (data ?? []).filter((f) => new Date(f.created_at ?? 0).getTime() < cutoff).map((f) => `live/${f.name}`);
      if (old.length) { await db.storage.from(BUCKET).remove(old); n += old.length; }
    }
  } catch { /* next sweep */ }
  try {
    const dir = path.join(LOCAL_DIR, "live");
    if (existsSync(dir)) for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); n++; } }
  } catch { /* next sweep */ }
  return n;
}
async function put(key: string, audio: Buffer) {
  if (testStore) { testStore.set(key, audio); return; }
  if (await hasBucket()) { const { error } = await db.storage.from(BUCKET).upload(`${key}.mp3`, audio, { contentType: "audio/mpeg", upsert: true }); if (!error) return; }
  mkdirSync(LOCAL_DIR, { recursive: true }); writeFileSync(localAudioPath(key), audio);
}
const SIGNED_SECONDS = 6 * 3600;
async function urlFor(key: string, baseUrl: string, live = false): Promise<{ url: string; expiresAt: string }> {
  const seconds = live ? Math.floor(LIVE_MS / 1000) : SIGNED_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + seconds;
  if (!testStore && (await hasBucket())) {
    const { data } = await db.storage.from(BUCKET).createSignedUrl(live ? liveName(key) : `${key}.mp3`, seconds);
    if (data?.signedUrl) return { url: data.signedUrl, expiresAt: new Date(exp * 1000).toISOString() };
  }
  return { url: `${baseUrl}/api/voices/audio/${key}?exp=${exp}&sig=${signLocal(key, exp)}`, expiresAt: new Date(exp * 1000).toISOString() };
}
export const readLocal = (key: string) => (testStore ? testStore.get(key) ?? testStore.get(`live/${key}`) ?? null
  : existsSync(localAudioPath(key)) ? readFileSync(localAudioPath(key)) : existsSync(liveLocal(key)) ? readFileSync(liveLocal(key)) : null);
/** A live-only clip (the audio route sends it with no-store so nothing keeps a copy). */
export const isLiveLocal = (key: string) => (testStore ? testStore.has(`live/${key}`) : existsSync(liveLocal(key)));

export const cacheKey = (v: Voice, o: { language: string; contentKey: string; contentVersion: string; text: string }) =>
  createHash("sha256").update([v.provider, v.providerVoiceId, v.model ?? "", o.language, o.contentKey, o.contentVersion, o.text].join("\u0001")).digest("hex");

const inflight = new Map<string, Promise<void>>();
let generations = 0;
export const generationCount = () => generations;

export interface SpeakRequest { userId: string; voiceId: string; contentKind: string; contentKey: string; contentVersion?: string; language: string; text: string; baseUrl: string; translation?: string;
  /** The app keeps no copy of a live-only voice's audio (new builds send it; older builds keep every clip). */
  honoursPolicy?: boolean }
/** One chunk of eligible content in a P2P Voice: the cached recording, or a new one (once). */
export async function speak(r: SpeakRequest): Promise<{ url: string; expiresAt: string; cached: boolean; voice: { id: string; name: string; provider: string; synthetic: true }; offlineAllowed: boolean }> {
  if (!isEligible(r.contentKind)) throw new VoicesError(400, "P2P Voice can't read this yet.", "not_eligible");
  const translation = String(r.translation ?? "").trim();
  if (SCRIPTURE_KINDS.includes(r.contentKind) && !translation) throw new VoicesError(400, NOT_PUBLIC_DOMAIN, "translation_required");
  if (translation) {
    if (!/^[\w-]{1,64}$/.test(translation)) throw new VoicesError(400, NOT_PUBLIC_DOMAIN, "translation_not_permitted");
    let row: TranslationRow | null = null;
    try { row = await lookupTranslation(translation); } catch { throw new VoicesError(503, "Listening isn't available at the moment. Please try again shortly.", "provider_failed"); }
    if (!row || !syntheticSpeechAllowed(row)) throw new VoicesError(403, NOT_PUBLIC_DOMAIN, "translation_not_permitted");
  }
  const text = String(r.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new VoicesError(400, "There is nothing to read.", "empty");
  if (text.length > MAX_CHARS) throw new VoicesError(400, "That passage is too long to read at once.", "too_long");
  if (!/^[\w:.\-/]{1,160}$/.test(r.contentKey)) throw new VoicesError(400, "Unknown content.", "bad_key");
  const voice = await voiceById(r.voiceId);
  if (!voice) throw new VoicesError(404, "That voice isn't available right now. Please choose another.", "voice_unavailable");
  const p = providers().find((x) => x.id === voice.provider);
  if (!voice.canSynthesize || !p?.synthesize) throw new VoicesError(400, "That voice can only be previewed.", "catalogue_only"); // ElevenLabs: never generated here
  // The text is spoken in its own language — never translated, never read by a voice of another language.
  if (voice.language !== String(r.language).toLowerCase().split(/[-_]/)[0]) throw new VoicesError(400, "That voice speaks a different language from this text.", "language_mismatch");
  if (!underLimit(r.userId, "speak")) throw new VoicesError(429, "You've listened to a lot in a short time. Please wait a little and try again.", "rate_limited");
  const policy = p.policy;
  if (!policy.offlineAllowed && !r.honoursPolicy) throw new VoicesError(400, "Please update P2P Global to listen with this voice.", "needs_update");
  const live = !policy.cacheAllowed;
  const key = cacheKey(voice, { language: voice.language, contentKey: r.contentKey, contentVersion: r.contentVersion ?? "", text });
  let cached = policy.cacheAllowed && (await exists(key));
  if (cached) record(voice.provider, "cached", 0, { userId: r.userId, contentKind: r.contentKind });
  else {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const ctl = new AbortController();
        try {
          generations++;
          const out = await p.synthesize!(text, voice, ctl.signal);
          if (live) await putLive(key, out.audio); else await put(key, out.audio);
          record(voice.provider, "generated", out.characters, { userId: r.userId, contentKind: r.contentKind });
        } catch (e) {
          record(voice.provider, "error", 0, { userId: r.userId, contentKind: r.contentKind, code: (e as ProviderError)?.code });
          logger.warn({ provider: voice.provider, code: (e as ProviderError)?.code, status: (e as ProviderError)?.status }, "voices: synthesis failed"); // never the text
          throw e;
        } finally { inflight.delete(key); }
      })();
      inflight.set(key, job);
    } else cached = false;
    try { await job; } catch { throw new VoicesError(503, "P2P Voice isn't available at the moment. Please try again shortly.", "provider_failed"); }
  }
  const link = await urlFor(key, r.baseUrl, live);
  return { ...link, cached, voice: { id: voice.id, name: voice.name, provider: voice.provider, synthetic: true }, offlineAllowed: policy.offlineAllowed };
}

/** A short, fixed sample in the voice's language (never a lesson): the provider's own preview link, or one cached sample. */
export async function preview(userId: string, voiceId: string, baseUrl: string, honoursPolicy = false): Promise<{ url: string; kind: "provider" | "sample" }> {
  const voice = await voiceById(voiceId);
  if (!voice) throw new VoicesError(404, "That voice isn't available right now.", "voice_unavailable");
  if (voice.preview?.kind === "url") return { url: voice.preview.url, kind: "provider" }; // ElevenLabs' own sample — no generation, no credits
  const sample = PREVIEW_SAMPLES[voice.language];
  if (!sample || voice.preview?.kind !== "generate") throw new VoicesError(404, "There's no preview for this voice yet.", "no_preview");
  if (!underLimit(userId, "preview")) throw new VoicesError(429, "Please wait a little before previewing more voices.", "rate_limited");
  const r = await speak({ userId, voiceId, contentKind: "general", contentKey: "p2p:voice-preview", contentVersion: "1", language: voice.language, text: sample, baseUrl, honoursPolicy });
  return { url: r.url, kind: "sample" };
}
