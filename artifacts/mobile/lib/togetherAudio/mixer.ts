import type { TogetherAudioPrefs } from "./types";

export function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

// Master -> Media. Independent of Room/participant volumes by
// construction — it's a separate multiplication chain, so changing
// mediaVolume can never move a single voice fader and vice versa.
export function effectiveMediaVolume(prefs: TogetherAudioPrefs): number {
  return clampVolume(prefs.outputVolume * prefs.mediaVolume);
}

// Master -> Room -> this one participant's personal fader (0 if muted).
// A change to one participant's personal volume only ever touches their
// own entry in participantVolumes, so it can never affect another
// participant's effective volume or Media's.
export function effectiveParticipantVolume(prefs: TogetherAudioPrefs, userId: string): number {
  if (prefs.mutedParticipants.includes(userId)) return 0;
  const personal = prefs.participantVolumes[userId] ?? 1;
  return clampVolume(prefs.outputVolume * prefs.roomVolume * personal);
}

// Smooths a value change over a short duration when applying it to a real
// audio sink (expo-av's setVolumeAsync, YouTube's setVolume) — the
// accessibility requirement to "avoid sudden volume jumps": a big fader
// move lands as a quick fade, not an audible pop. Returns a cancel fn.
export function rampVolume(from: number, to: number, durationMs: number, onTick: (v: number) => void): () => void {
  const steps = Math.max(1, Math.round(durationMs / 30));
  const delta = (to - from) / steps;
  let i = 0;
  const interval = setInterval(() => {
    i += 1;
    if (i >= steps) {
      onTick(clampVolume(to));
      clearInterval(interval);
      return;
    }
    onTick(clampVolume(from + delta * i));
  }, 30);
  return () => clearInterval(interval);
}