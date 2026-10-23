import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Where the reader stopped in a chapter, remembered on this device: coming
// back to the chapter opens it at the same place. Saved as they scroll
// (throttled) and restored once the chapter's text has laid out. Positions
// near the very top aren't kept. Storage failures never block reading.
const KEY = (chapterId: string) => `kingdomStories:position:${chapterId}`;
const SAVE_EVERY_MS = 600;

export function useReadingPosition(chapterId: string | undefined, ready: boolean) {
  const ref = useRef<ScrollView>(null);
  const saved = useRef<number | null>(null);
  const restored = useRef(false);
  const lastSave = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    restored.current = false;
    saved.current = null;
    if (!chapterId) return;
    AsyncStorage.getItem(KEY(chapterId)).then((v) => { const y = Number(v); saved.current = Number.isFinite(y) && y > 0 ? y : null; }).catch(() => {});
  }, [chapterId]);

  const write = useCallback((y: number) => {
    if (!chapterId) return;
    if (y < 80) AsyncStorage.removeItem(KEY(chapterId)).catch(() => {});
    else AsyncStorage.setItem(KEY(chapterId), String(Math.round(y))).catch(() => {});
  }, [chapterId]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!restored.current) return; // don't overwrite the saved place before it's restored
    const y = e.nativeEvent.contentOffset.y;
    const now = Date.now();
    if (pending.current) clearTimeout(pending.current);
    if (now - lastSave.current > SAVE_EVERY_MS) { lastSave.current = now; write(y); }
    else pending.current = setTimeout(() => { lastSave.current = Date.now(); write(y); }, SAVE_EVERY_MS);
  }, [write]);

  // Restore once the content is tall enough to reach the saved place.
  const onContentSizeChange = useCallback((_w: number, h: number) => {
    if (restored.current || !ready) return;
    const y = saved.current;
    if (y == null) { restored.current = true; return; }
    if (h > y + 200) { ref.current?.scrollTo({ y, animated: false }); restored.current = true; }
  }, [ready]);

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  return { ref, onScroll, onContentSizeChange };
}
