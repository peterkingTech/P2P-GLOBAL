// P2P VOICES — the app side (owner brief 2026-11-18). One shared voice library inside P2P Listen (no other player):
//   • the API client (api-server routes/voices.ts) — no provider key, URL or secret ever lives in the app;
//   • the participant's choices: a P2P Voice per CONTENT language, favourites, "official narration first",
//     kept on the phone (works offline) and synced to their account when the server has the table (migration 254);
//   • a tiny runtime store the player reads to say what is reading right now: official narration, a synthetic
//     P2P Voice (which one, from whom) — never mixed up, never silently swapped (no phone voice since 2026-11-19).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/apiClient";
import { getOfflineUser } from "@/lib/offline";

export type VoiceProviderId = "azure" | "google" | "elevenlabs" | "spitch";
export type Presentation = "female" | "male";
export interface P2PVoice {
  id: string; provider: VoiceProviderId; providerVoiceId: string; name: string; language: string; languageName: string; locale: string; accent: string;
  presentation: Presentation | null; characteristics: string[]; model: string | null;
  preview: { kind: "url"; url: string } | { kind: "generate" } | null; canSynthesize: boolean; status: "available" | "unavailable"; refreshedAt: string;
}
export interface Catalogue {
  total: number; page: number; pageSize: number; voices: P2PVoice[];
  facets: { language: { key: string; count: number; name: string }[]; accent: { key: string; count: number }[]; provider: { key: VoiceProviderId; count: number }[];
    presentation: { key: Presentation; count: number }[]; characteristic: { key: string; count: number }[] };
  providers: { id: VoiceProviderId; name: string; enabled: boolean; stale: boolean; refreshedAt: string | null; count: number }[];
}
export type CatalogueFilter = { language?: string | null; accent?: string | null; provider?: VoiceProviderId | null; presentation?: Presentation | null; characteristic?: string | null; q?: string; purpose?: "everyday" | "story"; page?: number };
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getCatalogue = (f: CatalogueFilter) => {
  const qs = Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return apiRequest<Catalogue>(`/voices/catalogue${qs ? `?${qs}` : ""}`, {}, { fallbackError: "Voices aren't available right now." });
};
export const getCapabilities = () => apiRequest<{ languages: { language: string; languageName: string; providers: string[]; presentations: string[]; canListen: boolean }[]; eligibleKinds: string[] }>(
  "/voices/capabilities", {}, { fallbackError: "" });
export const speakChunk = (b: { voiceId: string; contentKind: string; contentKey: string; contentVersion?: string; language: string; text: string; translation?: string }) =>
  apiRequest<{ url: string; expiresAt: string; cached: boolean; voice: { id: string; name: string; provider: string; synthetic: true }; offlineAllowed: boolean }>("/voices/speak", json(b), { fallbackError: "This voice isn't available at the moment." });
export const previewVoiceAudio = (voiceId: string) => apiRequest<{ url: string; kind: "provider" | "sample" }>("/voices/preview", json({ voiceId }), { fallbackError: "There's no preview for this voice right now." });

/** Content kinds a P2P Voice may read (mirrors the server's ELIGIBLE_KINDS — the server decides; this only avoids a wasted call).
 *  Owner 2026-11-19: P2P Voice is the ONLY reading voice — the Bible and playlists too, in public-domain translations
 *  (the server checks the translation; any other translation gets a plain message, never the phone's voice). */
export const ELIGIBLE_KINDS = new Set(["story", "story-intro", "lesson", "plan", "daily_word", "learning", "general", "bible", "playlist", "study"]);
export const isEligibleKind = (k: string | undefined | null) => !!k && ELIGIBLE_KINDS.has(k);

// ── Preferences ──────────────────────────────────────────────────────────────────────────────────────────────
export interface ChosenVoice { voiceId: string; name: string; provider: VoiceProviderId; accent: string; language: string; presentation: Presentation | null }
export interface VoicePrefs {
  version: 1;
  preferOfficial: boolean;
  /** Per content language: the chosen P2P Voice, null = an old "phone voice" choice, now ignored (P2P default). */
  byLanguage: Record<string, ChosenVoice | null>;
  favourites: string[];
}
const DEFAULTS: VoicePrefs = { version: 1, preferOfficial: true, byLanguage: {}, favourites: [] };
const KEY = () => `p2p.voices.prefs:${getOfflineUser() ?? "anon"}`;
let prefs: VoicePrefs = DEFAULTS;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const base = (lang: string) => String(lang ?? "").toLowerCase().split(/[-_]/)[0];

/** Reload when the signed-in person changes (the app loads this module before sign-in). */
export async function loadVoicePrefs(): Promise<VoicePrefs> {
  const k = KEY();
  if (loadedFor === k) return prefs;
  if (getOfflineUser() === null) return prefs; // not signed in yet: try again when listening starts
  loadedFor = k;
  try { const raw = await AsyncStorage.getItem(k); prefs = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS; } catch { prefs = DEFAULTS; }
  emit();
  // The account copy wins when it is newer than nothing on this phone (a new phone gets the person's choices).
  apiRequest<{ prefs: { preferOfficial: boolean; byLanguage: Record<string, { voiceId: string | null; accent?: string | null; provider?: string | null } | undefined>; favourites: string[] } | null; stored: boolean }>(
    "/voices/preferences", {}, { fallbackError: "" }).then((r) => {
    if (!r?.prefs || Object.keys(prefs.byLanguage).length || prefs.favourites.length) return;
    const byLanguage: VoicePrefs["byLanguage"] = {};
    for (const [lang, v] of Object.entries(r.prefs.byLanguage ?? {})) if (v?.voiceId) byLanguage[lang] = { voiceId: v.voiceId, name: v.voiceId.split(":")[1] ?? v.voiceId, provider: (v.provider ?? v.voiceId.split(":")[0]) as VoiceProviderId, accent: v.accent ?? "", language: lang, presentation: null };
    prefs = { version: 1, preferOfficial: r.prefs.preferOfficial !== false, byLanguage, favourites: r.prefs.favourites ?? [] };
    void AsyncStorage.setItem(k, JSON.stringify(prefs)).catch(() => {});
    emit();
  }).catch(() => {});
  return prefs;
}
function save(next: VoicePrefs) {
  prefs = next; emit();
  void AsyncStorage.setItem(KEY(), JSON.stringify(next)).catch(() => {});
  const server = { preferOfficial: next.preferOfficial, favourites: next.favourites,
    byLanguage: Object.fromEntries(Object.entries(next.byLanguage).map(([l, v]) => [l, { voiceId: v?.voiceId ?? null, accent: v?.accent ?? null, provider: v?.provider ?? null }])) };
  void apiRequest("/voices/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: server }) }, { fallbackError: "" }).catch(() => {});
}
export const getVoicePrefs = () => prefs;
export const subscribeVoicePrefs = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useVoicePrefs = () => useSyncExternalStore(subscribeVoicePrefs, getVoicePrefs, getVoicePrefs);
/** P2P default voices per language (the listener's own choice in byLanguage wins). Other languages' choices are kept. */
let defaults: Record<string, ChosenVoice> = {};
let defaultsLoaded = false;
let defaultsLoading: Promise<Record<string, ChosenVoice>> | null = null;
export function loadVoiceDefaults(): Promise<Record<string, ChosenVoice>> {
  if (defaultsLoaded) return Promise.resolve(defaults);
  return (defaultsLoading ??= fetchDefaults().finally(() => { defaultsLoading = null; }));
}
async function fetchDefaults() {
  try { const raw = await AsyncStorage.getItem("p2p.voices.defaults"); if (raw) defaults = JSON.parse(raw); } catch { /* none kept */ }
  try {
    const r = await apiRequest<{ defaults: Record<string, ChosenVoice> }>("/voices/defaults", {}, { fallbackError: "" });
    defaults = r.defaults ?? {}; defaultsLoaded = true;
    void AsyncStorage.setItem("p2p.voices.defaults", JSON.stringify(defaults)).catch(() => {});
    emit();
  } catch { /* offline: last known defaults (none → the player asks to connect to the internet) */ }
  return defaults;
}
/** True once P2P's default voices are known on this phone (fetched now, or kept from an earlier session). */
export const voiceDefaultsKnown = () => defaultsLoaded || Object.keys(defaults).length > 0;
export const defaultVoiceFor = (language: string) => defaults[base(language)] ?? null;
/** The P2P Voice for this content language: the listener's own choice, else P2P's default; null = no P2P Voice for
 *  this language. Owner 2026-11-19: P2P Voice only — an earlier "My phone's voice" choice (null) is no longer honoured. */
export const chosenVoiceFor = (language: string): ChosenVoice | null => {
  const k = base(language);
  return prefs.byLanguage[k] ?? defaults[k] ?? null;
};
export function chooseVoice(language: string, v: P2PVoice | null) {
  const next = { ...prefs.byLanguage };
  if (v) next[base(language)] = { voiceId: v.id, name: v.name, provider: v.provider, accent: v.accent, language: v.language, presentation: v.presentation };
  else delete next[base(language)]; // back to P2P's default voice for this language
  save({ ...prefs, byLanguage: next });
}
export function toggleFavourite(id: string) {
  save({ ...prefs, favourites: prefs.favourites.includes(id) ? prefs.favourites.filter((x) => x !== id) : [...prefs.favourites, id].slice(-60) });
}
export const setPreferOfficial = (on: boolean) => save({ ...prefs, preferOfficial: on });
/** Back to the defaults: official narration first, P2P's default voice for everything else. Favourites are kept. */
export const restoreVoiceDefaults = () => save({ ...DEFAULTS, favourites: prefs.favourites });

// ── What is reading right now (set by the Listen driver) ─────────────────────────────────────────────────────
export type ReadingSource = { mode: "official"; voice: string } | { mode: "p2p"; voice: string; provider: string } | { mode: "device" } | null; // device = offline only
let source: ReadingSource = null;
let notice: string | null = null;
const rtListeners = new Set<() => void>();
const rtEmit = () => rtListeners.forEach((l) => l());
let snapshot: { source: ReadingSource; notice: string | null } = { source, notice };
export function setReadingSource(s: ReadingSource) {
  if (JSON.stringify(s) === JSON.stringify(source)) return;
  source = s; snapshot = { source, notice }; rtEmit();
}
/** A short, friendly note (never a provider's technical error). */
export function setVoiceNotice(n: string | null) { if (n === notice) return; notice = n; snapshot = { source, notice }; rtEmit(); }
export const useReadingSource = () => useSyncExternalStore((l) => { rtListeners.add(l); return () => { rtListeners.delete(l); }; }, () => snapshot, () => snapshot);
export const PROVIDER_LABEL: Record<string, string> = { azure: "Azure", google: "Google", elevenlabs: "ElevenLabs", spitch: "Verified specialist provider" };
