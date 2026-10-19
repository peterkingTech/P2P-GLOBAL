import { useSyncExternalStore } from "react";

// The Family Gathering this device is in right now (Prompt 6). The Gathering
// screen stays mounted underneath when a participant opens their own lesson,
// so its call keeps running; it publishes here so those screens can show a
// "Return to Gathering" bar with the same microphone toggle. Nothing here
// starts, joins or ends a call — it only mirrors the Gathering's own state.

export interface ActiveGathering {
  sessionId: string;
  voiceConnected: boolean;
  micMuted: boolean;
  toggleMic: () => void;
}

let current: ActiveGathering | null = null;
const listeners = new Set<() => void>();

export function setActiveGathering(next: ActiveGathering | null) {
  current = next;
  listeners.forEach((l) => l());
}

/** Clears only if this session is still the one published (a newer Gathering wins). */
export function clearActiveGathering(sessionId: string) {
  if (current?.sessionId === sessionId) setActiveGathering(null);
}

export function getActiveGathering() {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useActiveGathering(): ActiveGathering | null {
  return useSyncExternalStore(subscribe, getActiveGathering, getActiveGathering);
}
