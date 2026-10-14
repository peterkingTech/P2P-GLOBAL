import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Loads `fetcher()` when the screen gains focus and whenever `deps` change;
 * ignores answers from older, slower requests so a screen never shows stale
 * data over newer data.
 */
export function useStudioQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: unknown; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await fetcher();
      if (mine !== seq.current) return;
      setData(r); setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, deps);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { data, loading, error, reload };
}
