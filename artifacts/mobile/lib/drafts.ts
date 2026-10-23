import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Unsent writing (lesson and Kingdom Stories reflections, Comprehensive Check
// answers, Family/Church lesson work) kept as a draft so it survives leaving
// the screen, expanding/restoring a focus view, the app going to the
// background, or the OS closing it. Keys include the signed-in user's id, so a
// shared device never shows one person's draft to another.
//
// Drafts also follow the person to their other devices (migration 213,
// p2p_answer_drafts — readable and writable ONLY by the writer; nobody else,
// not leaders or reviewers, can see a draft). The device copy is always
// written first, so writing never depends on a connection; the online copy is
// saved a moment after typing stops and whenever the app leaves the
// foreground. When a draft is opened, the newer of the two copies wins. A
// draft is deleted everywhere once the answer is submitted.
const PREFIX = "p2p:draft:v1:";
const SAVE_DELAY_MS = 400;
const SYNC_DELAY_MS = 1500;

export function draftKey(userId: string, scope: string): string {
  return `${PREFIX}${userId}:${scope}`;
}

/** The (userId, scope) the online copy is stored under; null for keys not made by draftKey. */
export function draftParts(key: string): { userId: string; scope: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const i = rest.indexOf(":");
  if (i <= 0 || i === rest.length - 1) return null;
  return { userId: rest.slice(0, i), scope: rest.slice(i + 1).slice(0, 300) };
}

const atKey = (key: string) => `${key}:at`;

export async function loadDraft(key: string): Promise<string> {
  try { return (await AsyncStorage.getItem(key)) ?? ""; } catch { return ""; }
}
async function loadLocal(key: string): Promise<{ text: string; at: number }> {
  try {
    const [text, at] = await Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem(atKey(key))]);
    return { text: text ?? "", at: Number(at) || 0 };
  } catch { return { text: "", at: 0 }; }
}

export async function saveDraft(key: string, text: string, at = Date.now()): Promise<void> {
  try {
    if (text.trim()) await AsyncStorage.multiSet([[key, text], [atKey(key), String(at)]]);
    else await AsyncStorage.multiRemove([key, atKey(key)]);
  } catch { /* storage unavailable: the draft just isn't persisted */ }
}

export async function clearDraft(key: string): Promise<void> {
  try { await AsyncStorage.multiRemove([key, atKey(key)]); } catch { /* ignore */ }
  void removeOnline(key);
}

// ── Online copy (best effort; a failure never touches the device copy) ──────
async function db() {
  return (await import("@/contexts/AuthContext")).supabase;
}
async function loadOnline(key: string): Promise<{ text: string; at: number } | null> {
  const p = draftParts(key);
  if (!p) return null;
  try {
    const { data, error } = await (await db()).from("p2p_answer_drafts").select("body,updated_at").eq("user_id", p.userId).eq("scope", p.scope).maybeSingle();
    if (error || !data) return null;
    return { text: (data.body as string) ?? "", at: Date.parse(data.updated_at as string) || 0 };
  } catch { return null; }
}
async function saveOnline(key: string, text: string, at: number): Promise<void> {
  const p = draftParts(key);
  if (!p) return;
  try {
    const client = await db();
    if (text.trim()) {
      await client.from("p2p_answer_drafts").upsert(
        { user_id: p.userId, scope: p.scope, body: text.slice(0, 60000), updated_at: new Date(at).toISOString() },
        { onConflict: "user_id,scope" });
    } else {
      await client.from("p2p_answer_drafts").delete().eq("user_id", p.userId).eq("scope", p.scope);
    }
  } catch { /* offline / not yet migrated: the device copy still holds the draft */ }
}
async function removeOnline(key: string): Promise<void> {
  const p = draftParts(key);
  if (!p) return;
  try { await (await db()).from("p2p_answer_drafts").delete().eq("user_id", p.userId).eq("scope", p.scope); } catch { /* ignore */ }
}

/** Of a device copy and an online copy, the one to show (newer wins; text beats nothing). */
export function pickDraft(local: { text: string; at: number }, online: { text: string; at: number } | null): { text: string; at: number; from: "device" | "online" } {
  if (!online || !online.text.trim()) return { ...local, from: "device" };
  if (!local.text.trim()) return { ...online, from: "online" };
  return online.at > local.at ? { ...online, from: "online" } : { ...local, from: "device" };
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
  const latestAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyOnline = useRef(false);
  const typedBeforeLoad = useRef(false);

  useEffect(() => {
    if (!key) { setLoaded(true); return; }
    let live = true;
    setLoaded(false);
    void (async () => {
      const local = await loadLocal(key);
      // Show the device copy at once; then check the online copy.
      if (live && local.text && !typedBeforeLoad.current) { latest.current = local.text; latestAt.current = local.at; setTextState(local.text); setRestored(true); }
      if (live) setLoaded(true);
      const online = await loadOnline(key);
      if (!live) return;
      const best = pickDraft(local, online);
      if (best.from === "online" && !typedBeforeLoad.current) {
        latest.current = best.text; latestAt.current = best.at;
        setTextState(best.text); setRestored(true);
        void saveDraft(key, best.text, best.at);
      } else if (local.text.trim() && (!online || local.at > online.at)) {
        void saveOnline(key, local.text, local.at || Date.now()); // written offline earlier
      }
    })();
    return () => { live = false; };
  }, [key]);

  const flushOnline = useCallback(() => {
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
    if (key && dirtyOnline.current) { dirtyOnline.current = false; void saveOnline(key, latest.current, latestAt.current || Date.now()); }
  }, [key]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (key) void saveDraft(key, latest.current, latestAt.current || Date.now());
  }, [key]);

  const setText = useCallback((t: string) => {
    typedBeforeLoad.current = true;
    latest.current = t;
    latestAt.current = Date.now();
    setTextState(t);
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
    dirtyOnline.current = true;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(flushOnline, SYNC_DELAY_MS);
  }, [key, flush, flushOnline]);

  // Save immediately when the app is backgrounded, and when leaving the screen.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") { flush(); flushOnline(); } });
    return () => { sub.remove(); flush(); flushOnline(); };
  }, [flush, flushOnline]);

  const clear = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
    dirtyOnline.current = false;
    latest.current = "";
    latestAt.current = 0;
    setTextState("");
    setRestored(false);
    if (key) await clearDraft(key);
  }, [key]);

  return { text, setText, clear, restored, loaded };
}
