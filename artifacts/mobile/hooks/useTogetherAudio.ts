import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_TOGETHER_AUDIO_PREFS, type TogetherAudioPrefs } from "@/lib/togetherAudio/types";
import { clampVolume } from "@/lib/togetherAudio/mixer";
import { loadTogetherAudioPrefs, saveTogetherAudioPrefs } from "@/lib/togetherAudio/storage";

const SAVE_DEBOUNCE_MS = 400; // a drag gesture fires many updates/sec — write once it settles, not per-frame.

// The mixer's state + setters. Effective volumes are deliberately NOT
// computed here — call effectiveMediaVolume(prefs)/effectiveParticipantVolume(prefs, id)
// from lib/togetherAudio/mixer directly, so those stay plain, independently
// testable pure functions rather than something only reachable through a hook.
export function useTogetherAudio() {
  const [prefs, setPrefs] = useState<TogetherAudioPrefs>(DEFAULT_TOGETHER_AUDIO_PREFS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTogetherAudioPrefs().then((p) => { if (!cancelled) { setPrefs(p); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((updater: (prev: TogetherAudioPrefs) => TogetherAudioPrefs) => {
    setPrefs((prev) => {
      const next = updater(prev);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { saveTogetherAudioPrefs(next); }, SAVE_DEBOUNCE_MS);
      return next;
    });
  }, []);

  const setOutputVolume = useCallback((v: number) => update((p) => ({ ...p, outputVolume: clampVolume(v) })), [update]);
  const setMediaVolume = useCallback((v: number) => update((p) => ({ ...p, mediaVolume: clampVolume(v) })), [update]);
  const setRoomVolume = useCallback((v: number) => update((p) => ({ ...p, roomVolume: clampVolume(v) })), [update]);
  const setParticipantVolume = useCallback(
    (userId: string, v: number) => update((p) => ({ ...p, participantVolumes: { ...p.participantVolumes, [userId]: clampVolume(v) } })),
    [update]
  );
  const toggleMuteParticipant = useCallback(
    (userId: string) => update((p) => ({
      ...p,
      mutedParticipants: p.mutedParticipants.includes(userId)
        ? p.mutedParticipants.filter((id) => id !== userId)
        : [...p.mutedParticipants, userId],
    })),
    [update]
  );

  return { prefs, loaded, setOutputVolume, setMediaVolume, setRoomVolume, setParticipantVolume, toggleMuteParticipant };
}