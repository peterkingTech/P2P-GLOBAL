import { useSyncExternalStore } from "react";

// The Gathering this device is in right now — a Family Gathering (Prompt 6)
// or a Church Gathering (Prompt 7). The Gathering
// screen stays mounted underneath when a participant opens their own lesson,
// so its call keeps running; it publishes here so those screens can show a
// "Return to Gathering" bar with the same microphone toggle. Nothing here
// starts, joins or ends a call — it only mirrors the Gathering's own state.

export interface ActiveGathering {
  sessionId: string;
  /** The mounted Gathering screen to return to (Family Gathering or Church Gathering). */
  returnTo: { pathname: string; params: Record<string, string> };
  voiceConnected: boolean;
  micMuted: boolean;
  toggleMic: () => void;
  /**
   * The passage the Guide/host has shared with the group, if any, so the
   * Bible reader can offer "Go to the group's passage". Read-only: opening
   * it never changes what the group sees.
   */
  sharedPassage?: { translation: string; book: string; chapter: number; startVerse: number; endVerse: number } | null;
  kind?: "family" | "church";
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
