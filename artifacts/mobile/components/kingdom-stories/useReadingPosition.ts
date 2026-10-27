import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Where the reader stopped in a chapter, remembered on this device: coming
// back to the chapter opens it at the same place. Saved as they scroll
// (throttled) and restored once the chapter's text has laid out. Positions
// near the very top aren't kept. Storage failures never block reading.
// Chapters change in place (page turn, no remount): a new chapter starts at
// the top unless it has a saved place, and the saved place is restored even
// if the text lays out before storage answers.
const KEY = (chapterId: string) => `kingdomStories:position:${chapterId}`;
const SAVE_EVERY_MS = 600;

export function useReadingPosition(chapterId: string | undefined, ready: boolean) {
  const ref = useRef<ScrollView>(null);
  const saved = useRef<number | null>(null);
  const read = useRef(false);       // storage answered for this chapter
  const restored = useRef(false);
  const height = useRef(0);         // latest content height
  const lastSave = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tryRestore = useCallback(() => {
    if (restored.current || !read.current || !ready) return;
    const y = saved.current;
    if (y == null) { restored.current = true; return; }
    if (height.current > y + 200) { ref.current?.scrollTo({ y, animated: false }); restored.current = true; }
  }, [ready]);

  useEffect(() => {
    restored.current = false;
    read.current = false;
    saved.current = null;
    if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    ref.current?.scrollTo({ y: 0, animated: false });
    if (!chapterId) return;
    let live = true;
    AsyncStorage.getItem(KEY(chapterId))
      .then((v) => { if (!live) return; const y = Number(v); saved.current = Number.isFinite(y) && y > 0 ? y : null; })
      .catch(() => {})
      .finally(() => { if (!live) return; read.current = true; tryRestore(); });
    return () => { live = false; };
  }, [chapterId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    height.current = h;
    tryRestore();
  }, [tryRestore]);

  useEffect(() => { tryRestore(); }, [ready, tryRestore]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  return { ref, onScroll, onContentSizeChange };
}
