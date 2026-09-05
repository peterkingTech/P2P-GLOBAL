import { useEffect, useRef, useState } from "react";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Eases a growth-score number toward its real, persisted value over time
// instead of snapping to it — a level-up (or any new lesson/reflection/
// fruit) reads as gradual growth, never a jump-cut. The duration scales
// with the size of the jump (a whole-category completion animates longer
// than a single lesson) so a big, legitimate milestone still *feels* big,
// just never instant.
export function useSmoothedGrowth(realScore: number): number {
  const [displayed, setDisplayed] = useState(realScore);
  const fromRef = useRef(realScore);
  const toRef = useRef(realScore);
  const startRef = useRef(0);
  const durationRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const firstRunRef = useRef(true);

  useEffect(() => {
    // On first mount, show the real, current state immediately — no replay,
    // no animating up from zero.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      setDisplayed(realScore);
      fromRef.current = realScore;
      toRef.current = realScore;
      return;
    }
    if (realScore === toRef.current) return;

    fromRef.current = displayed;
    toRef.current = realScore;
    startRef.current = Date.now();
    const delta = Math.abs(realScore - fromRef.current);
    durationRef.current = Math.max(600, Math.min(6000, 1500 * (delta / 10)));

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    function step() {
      const elapsed = Date.now() - startRef.current;
      const t = Math.min(1, elapsed / durationRef.current);
      const eased = easeOutCubic(t);
      setDisplayed(fromRef.current + (toRef.current - fromRef.current) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realScore]);

  return displayed;
}