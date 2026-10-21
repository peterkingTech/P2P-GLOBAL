import AsyncStorage from "@react-native-async-storage/async-storage";

// Full-screen "Rotate" for the shared media player. The app stays portrait
// (no app-wide orientation change); the SAME mounted player is turned 90° and
// sized so its long side runs along the phone's long side. Nothing is
// remounted, so playback, position and the call are untouched.

/**
 * Long side (width before rotation) of a 16:9 player turned 90°, so that it
 * fits the screen: its rotated height (the long side) within the available
 * height and its rotated width (the short side) within the screen width.
 */
export function rotatedPlayerLength(windowWidth: number, windowHeight: number, reservedHeight = 120): number {
  const byHeight = Math.max(0, windowHeight - reservedHeight);
  const byWidth = Math.max(0, windowWidth - 8) * (16 / 9);
  return Math.floor(Math.min(byHeight, byWidth));
}

// Per-phone sound levels for Church Gatherings (Family has its own Audio
// Balance). Only this phone's speaker changes — never anyone else's.
const CHURCH_SOUND_KEY = "p2p.church.sound.v1";
export interface ChurchSound { media: number; voices: number }
export const DEFAULT_CHURCH_SOUND: ChurchSound = { media: 1, voices: 1 };
export function clampSound(raw: unknown): ChurchSound {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ChurchSound>;
  const c = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  return { media: c(o.media, 1), voices: c(o.voices, 1) };
}
export async function loadChurchSound(): Promise<ChurchSound> {
  try { const v = await AsyncStorage.getItem(CHURCH_SOUND_KEY); return v ? clampSound(JSON.parse(v)) : DEFAULT_CHURCH_SOUND; }
  catch { return DEFAULT_CHURCH_SOUND; }
}
export function saveChurchSound(s: ChurchSound) {
  AsyncStorage.setItem(CHURCH_SOUND_KEY, JSON.stringify(clampSound(s))).catch(() => {});
}
/** Agora's local playback level for everyone's voices on this phone (0–100). */
export const voicesPlaybackLevel = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);
