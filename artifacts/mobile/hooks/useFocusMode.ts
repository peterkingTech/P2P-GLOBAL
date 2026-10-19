import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";

// Focus mode for a screen's resources (Bible, Media, Workspace): one resource
// at a time takes the available space, everything else is hidden, and Done
// (or Android back) restores the previous layout and scroll position.
//
// It only changes what the screen RENDERS around the focused resource — the
// resource itself stays the same mounted component (callers keep it in the
// same place in the tree), so a playing video, a loaded passage or text being
// typed is never reset, and nothing here touches calls/audio (a live
// Gathering's voice lives in a hook above the rendered content).
export function useFocusMode<K extends string>(available: readonly K[]) {
  const [focus, setFocus] = useState<K | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetY = useRef(0);
  const savedY = useRef<number | null>(null);

  const enter = useCallback((key: K) => {
    savedY.current = offsetY.current;
    setFocus(key);
    // Start the focused view at its top.
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  }, []);

  const exit = useCallback(() => {
    setFocus(null);
    const y = savedY.current;
    savedY.current = null;
    if (y != null) {
      // After the hidden content is laid out again.
      requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: false })));
    }
  }, []);

  // The focused resource disappeared (e.g. the Guide changed mode): restore.
  const availableKey = available.join("|");
  useEffect(() => {
    if (focus && !available.includes(focus)) exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, availableKey, exit]);

  // Android back closes the focus view first instead of leaving the screen.
  useEffect(() => {
    if (!focus) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { exit(); return true; });
    return () => sub.remove();
  }, [focus, exit]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!focus) offsetY.current = e.nativeEvent.contentOffset.y;
  }, [focus]);

  return {
    focus,
    isFocused: (key: K) => focus === key,
    enter,
    exit,
    /** Spread onto the screen's main ScrollView. */
    scrollProps: { ref: scrollRef, onScroll, scrollEventThrottle: 32 },
  };
}
