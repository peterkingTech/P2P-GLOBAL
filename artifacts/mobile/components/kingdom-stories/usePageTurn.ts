import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

// A light book-page turn for the Kingdom Stories reader. The new chapter is
// shown AT ONCE (navigation and loading never wait for the animation); the
// page then settles in from the side it was turned from — a slight swing on
// its spine (the left edge going forward, the right edge going back) with
// the shade of a turning leaf — in about a third of a second. A full page-curl was ruled out: it needs a snapshot of both pages
// (native-only, heavy on long illustrated chapters) and fights text
// selection. With Reduce Motion on, or if the animation can't run, the page
// simply appears — the same content, no movement.
export type TurnDirection = "next" | "prev";
export const TURN_MS = 340;

/** Animated values for a page entering from `dir` at progress p (0 → 1). Pure, for tests. */
export function turnFrame(dir: TurnDirection, p: number) {
  const from = dir === "next" ? 1 : -1;
  const rest = 1 - p;
  return { rotateYDeg: from * -14 * rest, translateX: from * 36 * rest, opacity: 0.35 + 0.65 * p, shade: 0.18 * rest };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => live && setReduced(!!v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setReduced(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return reduced;
}

export function usePageTurn() {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const [dir, setDir] = useState<TurnDirection>("next");

  const turn = useCallback((d: TurnDirection) => {
    if (reduced) return;
    setDir(d);
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: TURN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, reduced]);

  const a = turnFrame(dir, 0);
  const pageStyle = {
    transformOrigin: dir === "next" ? "left center" : "right center",
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [a.opacity, 1] }),
    transform: [
      { perspective: 1200 },
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [a.translateX, 0] }) },
      { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: [`${a.rotateYDeg}deg`, "0deg"] }) },
    ],
  };
  // A soft shadow across the page while it turns (pointer-events none).
  const shadeStyle = { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [a.shade, 0] }) };
  return { turn, pageStyle, shadeStyle, reduced, dir };
}
