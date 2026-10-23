import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// The storybook's text size, remembered on this device. Steps are relative to
// the base reading size and also respect the system font scale (Text scales
// with the OS setting on its own). Storage failures never block reading.
const KEY = "kingdomStories:readingScale";
export const READING_SCALES = [0.9, 1, 1.12, 1.25, 1.4] as const;

export function useReadingScale() {
  const [index, setIndex] = useState(1);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const i = Number(v);
      if (Number.isInteger(i) && i >= 0 && i < READING_SCALES.length) setIndex(i);
    }).catch(() => {});
  }, []);
  const set = useCallback((i: number) => {
    const next = Math.max(0, Math.min(READING_SCALES.length - 1, i));
    setIndex(next);
    AsyncStorage.setItem(KEY, String(next)).catch(() => {});
  }, []);
  return {
    scale: READING_SCALES[index],
    canSmaller: index > 0, canLarger: index < READING_SCALES.length - 1,
    smaller: () => set(index - 1), larger: () => set(index + 1),
  };
}
