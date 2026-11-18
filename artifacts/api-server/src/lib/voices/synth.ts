// P2P VOICES — on-demand speech for ELIGIBLE content (never pre-generated, never Bible text, never ElevenLabs).
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
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { voiceById, providers } from "./catalogue";
import { ProviderError, type Voice } from "./types";

/** Content the participant may hear in a P2P Voice. NOT "bible" (licensed Bible text and audio are never synthesised)
 *  and NOT "playlist" (Scripture playlists are Bible text). "study" stays off: it carries Bible quotations in
 *  translations with different licences. */
export const ELIGIBLE_KINDS = ["story", "story-intro", "lesson", "plan", "daily_word", "learning", "general"] as const;
export type EligibleKind = (typeof ELIGIBLE_KINDS)[number];
export const isEligible = (k: string): k is EligibleKind => (ELIGIBLE_KINDS as readonly string[]).includes(k);
export const MAX_CHARS = 1500;
export const PREVIEW_SAMPLES: Record<string, string> = {
  en: "Peace be with you. This is how I sound when I read to you in P2P Global.",
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
const LIMITS = { speak: 400, preview: 40 };
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
async function put(key: string, audio: Buffer) {
  if (testStore) { testStore.set(key, audio); return; }
  if (await hasBucket()) { const { error } = await db.storage.from(BUCKET).upload(`${key}.mp3`, audio, { contentType: "audio/mpeg", upsert: true }); if (!error) return; }
  mkdirSync(LOCAL_DIR, { recursive: true }); writeFileSync(localAudioPath(key), audio);
}
const SIGNED_SECONDS = 6 * 3600;
async function urlFor(key: string, baseUrl: string): Promise<{ url: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_SECONDS;
  if (!testStore && (await hasBucket())) {
    const { data } = await db.storage.from(BUCKET).createSignedUrl(`${key}.mp3`, SIGNED_SECONDS);
    if (data?.signedUrl) return { url: data.signedUrl, expiresAt: new Date(exp * 1000).toISOString() };
  }
  return { url: `${baseUrl}/api/voices/audio/${key}?exp=${exp}&sig=${signLocal(key, exp)}`, expiresAt: new Date(exp * 1000).toISOString() };
}
export const readLocal = (key: string) => (testStore ? testStore.get(key) ?? null : existsSync(localAudioPath(key)) ? readFileSync(localAudioPath(key)) : null);

export const cacheKey = (v: Voice, o: { language: string; contentKey: string; contentVersion: string; text: string }) =>
  createHash("sha256").update([v.provider, v.providerVoiceId, v.model ?? "", o.language, o.contentKey, o.contentVersion, o.text].join("\u0001")).digest("hex");

const inflight = new Map<string, Promise<void>>();
let generations = 0;
export const generationCount = () => generations;

export interface SpeakRequest { userId: string; voiceId: string; contentKind: string; contentKey: string; contentVersion?: string; language: string; text: string; baseUrl: string }
/** One chunk of eligible content in a P2P Voice: the cached recording, or a new one (once). */
export async function speak(r: SpeakRequest): Promise<{ url: string; expiresAt: string; cached: boolean; voice: { id: string; name: string; provider: string; synthetic: true }; offlineAllowed: boolean }> {
  if (!isEligible(r.contentKind)) throw new VoicesError(400, "This content is read by your phone's voice only.", "not_eligible");
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
  const key = cacheKey(voice, { language: voice.language, contentKey: r.contentKey, contentVersion: r.contentVersion ?? "", text });
  const policy = p.policy;
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
          await put(key, out.audio);
          record(voice.provider, "generated", out.characters, { userId: r.userId, contentKind: r.contentKind });
        } catch (e) {
          record(voice.provider, "error", 0, { userId: r.userId, contentKind: r.contentKind, code: (e as ProviderError)?.code });
          logger.warn({ provider: voice.provider, code: (e as ProviderError)?.code, status: (e as ProviderError)?.status }, "voices: synthesis failed"); // never the text
          throw e;
        } finally { inflight.delete(key); }
      })();
      inflight.set(key, job);
    } else cached = false;
    try { await job; } catch { throw new VoicesError(503, "This voice isn't available at the moment. Your phone's voice can keep reading.", "provider_failed"); }
  }
  const link = await urlFor(key, r.baseUrl);
  return { ...link, cached, voice: { id: voice.id, name: voice.name, provider: voice.provider, synthetic: true }, offlineAllowed: policy.offlineAllowed };
}

/** A short, fixed sample in the voice's language (never a lesson): the provider's own preview link, or one cached sample. */
export async function preview(userId: string, voiceId: string, baseUrl: string): Promise<{ url: string; kind: "provider" | "sample" }> {
  const voice = await voiceById(voiceId);
  if (!voice) throw new VoicesError(404, "That voice isn't available right now.", "voice_unavailable");
  if (voice.preview?.kind === "url") return { url: voice.preview.url, kind: "provider" }; // ElevenLabs' own sample — no generation, no credits
  const sample = PREVIEW_SAMPLES[voice.language];
  if (!sample || voice.preview?.kind !== "generate") throw new VoicesError(404, "There's no preview for this voice yet.", "no_preview");
  if (!underLimit(userId, "preview")) throw new VoicesError(429, "Please wait a little before previewing more voices.", "rate_limited");
  const r = await speak({ userId, voiceId, contentKind: "general", contentKey: "p2p:voice-preview", contentVersion: "1", language: voice.language, text: sample, baseUrl });
  return { url: r.url, kind: "sample" };
}
