// P2P Voice recordings kept ON THIS PHONE (owner 2026-11-19: "no internet → voices should fall back to cached voices
// or the phone voice"). Every P2P Voice sentence the listener plays — and the next ones fetched ahead — is downloaded
// once (it was already made by the SERVER; nothing is generated on the phone) into the app's cache folder, so the same
// sentence in the same voice plays again without internet, and online without waiting for the network.
//
//   key  = voice | content | translation | the sentence text  (edited text never replays old audio)
//   size = at most MAX_FILES recordings (~20–60 KB each); the oldest-used are removed first
//   web  = not kept (browsers have no app file storage here); offline web listening uses the browser's voice.
// Failures are silent: the cache only ever helps, it never stops listening.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const INDEX_KEY = "p2p.voices.cache.v1";
const MAX_FILES = 3000; // ≈ 60–180 MB at most
type Index = Record<string, number>; // file name → last used (ms)

let fs: typeof import("expo-file-system") | null = null;
if (Platform.OS !== "web") { try { fs = require("expo-file-system"); } catch { fs = null; } }

let index: Index | null = null;
let loading: Promise<Index> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const inflight = new Map<string, Promise<void>>();

/** FNV-1a (64-bit as two 32-bit halves) → a stable file name for this sentence in this voice. */
export function voiceCacheName(parts: { voiceId: string; contentKey: string; translation?: string; text: string }): string {
  const s = [parts.voiceId, parts.contentKey, parts.translation ?? "", parts.text.replace(/\s+/g, " ").trim()].join("\u0001");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `v${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}${s.length.toString(16)}.mp3`;
}

function dir() {
  if (!fs) return null;
  try {
    const d = new fs.Directory(fs.Paths.cache, "p2p-voices");
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  } catch { return null; }
}
async function loadIndex(): Promise<Index> {
  if (index) return index;
  return (loading ??= AsyncStorage.getItem(INDEX_KEY).then((raw) => (index = raw ? (JSON.parse(raw) as Index) : {})).catch(() => (index = {})));
}
function saveIndexSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; if (index) void AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => {}); }, 1500);
}

/** A kept recording of this sentence (a local file URI), or null. */
export async function cachedVoiceUri(name: string): Promise<string | null> {
  const d = dir();
  if (!d || !fs) return null;
  const idx = await loadIndex();
  if (!(name in idx)) return null;
  try {
    const f = new fs.File(d, name);
    if (!f.exists) { delete idx[name]; saveIndexSoon(); return null; }
    idx[name] = Date.now(); saveIndexSoon();
    return f.uri;
  } catch { return null; }
}

/** Keep this recording (downloaded once, in the background). */
export function keepVoice(name: string, url: string): void {
  const d = dir();
  if (!d || !fs || inflight.has(name)) return;
  const job = (async () => {
    const idx = await loadIndex();
    if (name in idx) return;
    const f = new fs!.File(d, name);
    if (!f.exists) await fs!.File.downloadFileAsync(url, f);
    idx[name] = Date.now();
    prune(idx, d);
    saveIndexSoon();
  })().catch(() => {}).finally(() => { inflight.delete(name); });
  inflight.set(name, job);
}

function prune(idx: Index, d: InstanceType<NonNullable<typeof fs>["Directory"]>) {
  const names = Object.keys(idx);
  if (names.length <= MAX_FILES) return;
  names.sort((a, b) => idx[a] - idx[b]);
  for (const n of names.slice(0, names.length - MAX_FILES)) {
    try { const f = new fs!.File(d, n); if (f.exists) f.delete(); } catch { /* already gone */ }
    delete idx[n];
  }
}
