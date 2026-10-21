import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Bible reading comfort, kept on THIS device (like the app's local display
// preferences) — never a separate Bible theme: light/dark always follows the
// P2P theme (contexts/ThemeContext). Also remembers the last passage read.

export interface BibleReadingPrefs {
  fontSize: number;          // 15–30
  lineSpacing: "compact" | "comfortable" | "relaxed";
  verseNumbers: boolean;
  layout: "paragraphs" | "verses";
}
export const DEFAULT_PREFS: BibleReadingPrefs = { fontSize: 19, lineSpacing: "comfortable", verseNumbers: true, layout: "paragraphs" };
export const LINE_HEIGHT: Record<BibleReadingPrefs["lineSpacing"], number> = { compact: 1.45, comfortable: 1.7, relaxed: 1.95 };
export const FONT_MIN = 15, FONT_MAX = 30;

const PREFS_KEY = "p2p.bible.prefs.v1";
const POSITION_KEY = "p2p.bible.position.v1";

export function clampPrefs(raw: unknown): BibleReadingPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<BibleReadingPrefs>;
  return {
    fontSize: Number.isFinite(p.fontSize) ? Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(p.fontSize as number))) : DEFAULT_PREFS.fontSize,
    lineSpacing: p.lineSpacing === "compact" || p.lineSpacing === "relaxed" ? p.lineSpacing : "comfortable",
    verseNumbers: p.verseNumbers !== false,
    layout: p.layout === "verses" ? "verses" : "paragraphs",
  };
}

export function useBibleReadingPrefs() {
  const [prefs, setPrefs] = useState<BibleReadingPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then((v) => { if (v) try { setPrefs(clampPrefs(JSON.parse(v))); } catch { /* keep defaults */ } }).catch(() => {});
  }, []);
  const update = useCallback((patch: Partial<BibleReadingPrefs>) => {
    setPrefs((prev) => {
      const next = clampPrefs({ ...prev, ...patch });
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  return { prefs, update };
}

export interface ReadingPosition { translation: string; book: string; chapter: number }
export async function loadPosition(): Promise<ReadingPosition | null> {
  try {
    const v = await AsyncStorage.getItem(POSITION_KEY);
    const p = v ? JSON.parse(v) : null;
    return p && typeof p.book === "string" && Number.isInteger(p.chapter) && typeof p.translation === "string" ? p : null;
  } catch { return null; }
}
export function savePosition(p: ReadingPosition) {
  AsyncStorage.setItem(POSITION_KEY, JSON.stringify(p)).catch(() => {});
}
