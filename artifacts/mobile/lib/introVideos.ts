// About P2P — the 11 introduction videos (owner brief 2026-11-26).
//
// One reusable system for every video: the catalogue (titles, media, languages) and timed text come from the API
// (/api/intro-videos), viewing status is kept per account (server, migration 260) with the phone as a fallback and
// for the first launch before registration (moved to the account after sign-up), and one rule decides when an
// introduction opens by itself (shouldAutoShow). The player is components/introVideo/IntroVideoPlayer.tsx.
//
// Rules (brief §4):
//  • first viewing must be completed: no skip, no dismiss, no seeking past what was watched; pausing is fine;
//    progress is saved and resumed; it is completed only when playback genuinely reaches the end;
//  • later viewings can be skipped, closed and replayed;
//  • after completing one, "Don't show automatically again" stops feature introductions opening by themselves
//    (the onboarding videos and the library are unaffected);
//  • accounts that existed before the videos (created before INTRO_REQUIRED_FROM) are shown each feature
//    introduction once and may skip it — they already know P2P (owner's production-safety charter);
//  • if the server could not be reached, an introduction is not forced (it would otherwise reappear after every
//    failed request): it opens next time.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { apiFetch, apiRequest } from "@/lib/apiClient";

export type IntroVideoId = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11";
export const INTRO_VIDEO_IDS: IntroVideoId[] = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];

/** Accounts created on or after this date watch each introduction in full the first time. */
export const INTRO_REQUIRED_FROM = "2026-11-26T00:00:00Z";
/** The onboarding videos: always required the first time, never switched off by the preference. */
export const ONBOARDING_VIDEOS: IntroVideoId[] = ["01", "02", "03", "04"];

/** About P2P library groups (brief §5), in order. */
export const LIBRARY_GROUPS: { key: string; titleKey: string; title: string; ids: IntroVideoId[] }[] = [
  { key: "vision", titleKey: "introVideos.groupVision", title: "Our Vision", ids: ["01", "02", "03"] },
  { key: "together", titleKey: "introVideos.groupTogether", title: "Growing Together", ids: ["04", "05", "08"] },
  { key: "living", titleKey: "introVideos.groupLiving", title: "Learning and Living", ids: ["06", "07", "09", "10", "11"] },
];

export interface IntroLanguage {
  code: string; subtitles: boolean; overlays: boolean; audio: boolean;
  status: { subtitles: string; overlays: string; audio: string };
  /** the narrator in this language (older API responses have none) */
  voice?: { name: string; gender: "male" | "female" } | null;
  /** every recorded voice in this language: key "de" (first voice), "de-2" (second voice, the other gender) */
  voices?: { key: string; name: string; gender: "male" | "female" }[];
}
/** "de-2" → "de" (the language of a voice key) */
export const voiceLanguage = (key: string) => (key.endsWith("-2") ? key.slice(0, -2) : key);   // "zh-TW" is a language, "-2" a second voice
/** The voice keys a film offers (older API responses: one per language with a voice-over). */
export function voiceKeys(v: IntroVideoInfo): string[] {
  return v.languages.filter((l) => l.audio).flatMap((l) => (l.voices?.length ? l.voices.map((x) => x.key) : [l.code]));
}
export interface IntroVideoInfo {
  id: IntroVideoId; group: string; order: number; duration: number;
  title: string; description: string; titleLanguage: string;
  media: { hls: string; mp4: string; thumbnail: string } | null;
  languages: IntroLanguage[];
}
export interface IntroManifest { version: string; mediaReady: boolean; preview: boolean; videos: IntroVideoInfo[] }
export interface IntroOverlay {
  id: string; t: number; len: number; role: string;
  x: number; y: number; w?: number; anchor: "top" | "middle" | "bottom"; align: "left" | "center"; size: number; color: "cream" | "gold" | "muted";
  font: "serif" | "serif-italic" | "sans" | "sans-bold" | "script";
  scripture?: boolean; ref?: string; text: string; language: string; brand?: boolean;
}
export interface IntroText {
  id: string; language: string; rtl: boolean; subtitles: "available" | "unavailable"; overlaysLanguage: string;
  cues: { t0: number; t1: number; text: string }[]; overlays: IntroOverlay[];
  scriptureSources: { name: string; licence: string; credit: string }[];
}

// ── catalogue + text (memory, then the phone's copy when offline) ──
const mem = new Map<string, { at: number; data: any }>();
async function cached<T>(key: string, url: string, maxAgeMs = 10 * 60_000): Promise<T> {
  const m = mem.get(key);
  if (m && Date.now() - m.at < maxAgeMs) return m.data as T;
  try {
    const data = await apiRequest<T>(url);
    mem.set(key, { at: Date.now(), data });
    AsyncStorage.setItem(`introVideos:cache:${key}`, JSON.stringify(data)).catch(() => {});
    return data;
  } catch (e) {
    const saved = await AsyncStorage.getItem(`introVideos:cache:${key}`).catch(() => null);
    if (saved) return JSON.parse(saved) as T;
    throw e;
  }
}
export function fetchIntroManifest(lang: string, preview = false): Promise<IntroManifest> {
  return cached<IntroManifest>(`manifest:${lang}:${preview ? 1 : 0}`, `/intro-videos/manifest?lang=${encodeURIComponent(lang)}${preview ? "&preview=1" : ""}`);
}
export function fetchIntroText(id: IntroVideoId, lang: string, preview = false): Promise<IntroText> {
  return cached<IntroText>(`text:${id}:${lang}:${preview ? 1 : 0}`, `/intro-videos/${id}/text?lang=${encodeURIComponent(lang)}${preview ? "&preview=1" : ""}`);
}
/** The stream to play: HLS (one picture, an audio track per language) on phones; the MP4 on the web. */
export function introSource(v: IntroVideoInfo, voiceKey?: string): string | null {
  if (!v.media) return null;
  if (Platform.OS !== "web") return v.media.hls;   // phones: one stream, the voice-over is an audio track
  // the web cannot switch HLS audio tracks: each voice-over language has its own web copy (web-<lang>.mp4)
  const key = voiceKey && voiceKey !== "en" && voiceKeys(v).includes(voiceKey) ? voiceKey : null;
  return key ? v.media.mp4.replace(/web\.mp4$/, `web-${key}.mp4`) : v.media.mp4;
}

// ── viewing status ──
export interface IntroView {
  position: number; maxWatched: number; completedAt: string | null; skippedAt?: string | null; completions: number;
  autoIntroOff: boolean; audioLanguage?: string | null; subtitleLanguage?: string | null; updatedAt?: string; pending?: boolean;
}
export type IntroViews = Partial<Record<IntroVideoId, IntroView>>;
const keyFor = (userId: string | null | undefined) => `introVideos:v1:${userId ?? "anon"}`;
const blank = (): IntroView => ({ position: 0, maxWatched: 0, completedAt: null, completions: 0, autoIntroOff: false });

async function readLocal(userId: string | null | undefined): Promise<IntroViews> {
  try { return JSON.parse((await AsyncStorage.getItem(keyFor(userId))) || "{}") as IntroViews; } catch { return {}; }
}
async function writeLocal(userId: string | null | undefined, v: IntroViews): Promise<void> {
  try { await AsyncStorage.setItem(keyFor(userId), JSON.stringify(v)); } catch {}
}
function mergeView(a: IntroView | undefined, b: IntroView | undefined): IntroView | undefined {
  if (!a) return b; if (!b) return a;
  return {
    position: Math.max(a.position, b.position), maxWatched: Math.max(a.maxWatched, b.maxWatched),
    completedAt: a.completedAt ?? b.completedAt, skippedAt: a.skippedAt ?? b.skippedAt ?? null,
    completions: Math.max(a.completions, b.completions), autoIntroOff: a.autoIntroOff || b.autoIntroOff,
    audioLanguage: a.audioLanguage ?? b.audioLanguage, subtitleLanguage: a.subtitleLanguage ?? b.subtitleLanguage,
    pending: a.pending || b.pending,
  };
}

/** Status for this account (or the phone before registration). `reliable` = safe to decide on auto-showing. */
export async function loadIntroViews(userId: string | null | undefined): Promise<{ views: IntroViews; reliable: boolean; stored: boolean }> {
  if (userId) await adoptAnonymousIntroViews(userId);   // watched on this phone before signing up / in
  const local = await readLocal(userId);
  if (!userId) return { views: local, reliable: true, stored: false };
  try {
    const r = await apiRequest<{ stored: boolean; views: (IntroView & { videoId: IntroVideoId })[] }>("/intro-videos/progress");
    if (!r.stored) return { views: local, reliable: true, stored: false };   // migration 260 not applied: the phone decides
    const merged: IntroViews = { ...local };
    for (const s of r.views) merged[s.videoId] = mergeView(local[s.videoId], { ...s, pending: false });
    // Anything the phone has that the server lacks (offline at the time) is sent again.
    for (const id of INTRO_VIDEO_IDS) if (local[id]?.pending) pushView(userId, id, merged[id]!).catch(() => {});
    await writeLocal(userId, merged);
    return { views: merged, reliable: true, stored: true };
  } catch {
    return { views: local, reliable: false, stored: false };
  }
}

async function pushView(userId: string, id: IntroVideoId, v: IntroView, extra: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const res = await apiFetch(`/intro-videos/progress/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: v.position, maxWatched: v.maxWatched, completed: !!v.completedAt, autoIntroOff: v.autoIntroOff, audioLanguage: v.audioLanguage ?? undefined, subtitleLanguage: v.subtitleLanguage ?? undefined, ...extra }),
    });
    return res.ok;
  } catch { return false; }
}

/** Records progress on the phone at once and on the account in the background. */
export async function saveIntroView(userId: string | null | undefined, id: IntroVideoId, patch: Partial<IntroView>, extra: Record<string, unknown> = {}): Promise<IntroView> {
  const all = await readLocal(userId);
  const prev = all[id] ?? blank();
  const next: IntroView = {
    ...prev, ...patch,
    maxWatched: Math.max(prev.maxWatched, patch.maxWatched ?? 0),
    completedAt: prev.completedAt ?? patch.completedAt ?? null,
    completions: prev.completions + (patch.completedAt ? 1 : 0),
    updatedAt: new Date().toISOString(), pending: !!userId,
  };
  all[id] = next;
  await writeLocal(userId, all);
  if (userId) {
    pushView(userId, id, next, extra).then(async (ok) => {
      if (!ok) return;
      const cur = await readLocal(userId);
      if (cur[id]) { cur[id]!.pending = false; await writeLocal(userId, cur); }
    });
  }
  return next;
}

/** After registration / sign-in: what was watched on this phone before signing up belongs to the new account. */
export async function adoptAnonymousIntroViews(userId: string): Promise<void> {
  const anon = await readLocal(null);
  const ids = Object.keys(anon) as IntroVideoId[];
  if (!ids.length) return;
  const mine = await readLocal(userId);
  for (const id of ids) mine[id] = mergeView(mine[id], { ...anon[id]!, pending: true });
  await writeLocal(userId, mine);
  for (const id of ids) {
    const v = mine[id]!;
    pushView(userId, id, v).then(async (ok) => { if (ok) { const cur = await readLocal(userId); if (cur[id]) { cur[id]!.pending = false; await writeLocal(userId, cur); } } });
  }
  try { await AsyncStorage.removeItem(keyFor(null)); } catch {}
}

/** Whether the "Don't show automatically again" choice is on (any completed video can set it). */
export const autoIntrosOff = (views: IntroViews) => INTRO_VIDEO_IDS.some((id) => views[id]?.autoIntroOff);

/**
 * Should this introduction open by itself now?
 * show = open it; mustComplete = first viewing that must be watched to the end (no skip).
 */
export function shouldAutoShow(id: IntroVideoId, views: IntroViews, opts: { reliable: boolean; accountCreatedAt?: string | null }): { show: boolean; mustComplete: boolean } {
  const v = views[id];
  if (v?.completedAt || v?.skippedAt) return { show: false, mustComplete: false };
  if (!opts.reliable) return { show: false, mustComplete: false };
  const onboarding = ONBOARDING_VIDEOS.includes(id);
  if (!onboarding && autoIntrosOff(views)) return { show: false, mustComplete: false };
  const existingAccount = !!opts.accountCreatedAt && opts.accountCreatedAt < INTRO_REQUIRED_FROM;
  return { show: true, mustComplete: !existingAccount };
}

// ── analytics (events only; never blocks anything) ──
export type IntroEvent = "intro_shown" | "play_started" | "completed" | "interrupted" | "replayed" | "skipped" | "language_selected" | "translation_unavailable";
let queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
export function logIntroEvent(videoId: IntroVideoId, event: IntroEvent, info: { context?: string; language?: string; position?: number } = {}): void {
  queue.push({ videoId, event, ...info, position: info.position != null ? Math.round(info.position) : undefined });
  if (timer) return;
  timer = setTimeout(() => {
    const events = queue; queue = []; timer = null;
    apiFetch("/intro-videos/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }) }).catch(() => {});
  }, 4000);
}

/** mm:ss / h:mm:ss for a duration in seconds. */
export function formatIntroDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
