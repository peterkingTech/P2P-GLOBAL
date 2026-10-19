import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Unsent writing (lesson reflections, assignment answers, notes) kept on the
// device so it survives leaving the screen, expanding/restoring a focus view,
// the app going to the background, or the OS closing it. Keys include the
// signed-in user's id, so a shared device never shows one person's draft to
// another. Nothing here is sent anywhere; a draft is cleared once submitted.
const PREFIX = "p2p:draft:v1:";
const SAVE_DELAY_MS = 400;

export function draftKey(userId: string, scope: string): string {
  return `${PREFIX}${userId}:${scope}`;
}

export async function loadDraft(key: string): Promise<string> {
  try { return (await AsyncStorage.getItem(key)) ?? ""; } catch { return ""; }
}

export async function saveDraft(key: string, text: string): Promise<void> {
  try {
    if (text.trim()) await AsyncStorage.setItem(key, text);
    else await AsyncStorage.removeItem(key);
  } catch { /* storage unavailable: the draft just isn't persisted */ }
}

export async function clearDraft(key: string): Promise<void> {
  try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Text state backed by a persisted draft. `restored` is true when an earlier
 * draft was loaded. `key` null (e.g. not signed in yet) = plain state only.
 */
export function useDraft(key: string | null): {
  text: string; setText: (t: string) => void; clear: () => Promise<void>; restored: boolean; loaded: boolean;
} {
  const [text, setTextState] = useState("");
  const [restored, setRestored] = useState(false);
  const [loaded, setLoaded] = useState(!key);
  const latest = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typedBeforeLoad = useRef(false);

  useEffect(() => {
    if (!key) { setLoaded(true); return; }
    let live = true;
    setLoaded(false);
    void loadDraft(key).then((saved) => {
      if (!live) return;
      // Never overwrite something typed while the draft was loading.
      if (saved && !typedBeforeLoad.current) { latest.current = saved; setTextState(saved); setRestored(true); }
      setLoaded(true);
    });
    return () => { live = false; };
  }, [key]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (key) void saveDraft(key, latest.current);
  }, [key]);

  const setText = useCallback((t: string) => {
    typedBeforeLoad.current = true;
    latest.current = t;
    setTextState(t);
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [key, flush]);

  // Save immediately when the app is backgrounded, and when leaving the screen.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") flush(); });
    return () => { sub.remove(); flush(); };
  }, [flush]);

  const clear = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    latest.current = "";
    setTextState("");
    setRestored(false);
    if (key) await clearDraft(key);
  }, [key]);

  return { text, setText, clear, restored, loaded };
}
