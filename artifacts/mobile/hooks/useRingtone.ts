import { useCallback, useEffect, useRef } from "react";
import { Platform, Vibration } from "react-native";
import { Audio } from "expo-av";

// A real incoming-call ringing experience (audio + vibration), not a visual
// animation standing in for it. Singleton-per-hook-instance by design: a
// module-level "is anything currently ringing" guard means even if
// incoming.tsx re-renders/re-mounts unexpectedly, a second overlapping
// ringtone can never start while one is already playing — only stop() (or
// this same start() call again, which is a no-op while already ringing)
// can end it.
let activeSound: Audio.Sound | null = null;
let isRinging = false;

// Android's repeating-vibration API takes a pattern array (ms): the first
// value is an initial delay, then alternating vibrate/pause durations.
// Matches roughly one ring cycle so the phone visibly buzzes in sync with
// the two audible ring bursts in ringtone.wav.
const VIBRATION_PATTERN = [0, 700, 300, 700, 2400];

export function useRingtone() {
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const start = useCallback(async () => {
    if (isRinging) return; // already ringing — never stack a second instance
    isRinging = true;
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require("../assets/sounds/ringtone.wav"),
        { isLooping: true, volume: 1.0, shouldPlay: true }
      );
      // start() can race a fast stop() (e.g. the caller cancelled while the
      // asset was still loading) — if ringing was already turned off by the
      // time this resolves, unload immediately instead of playing anyway.
      if (!isRinging) { await sound.unloadAsync().catch(() => {}); return; }
      activeSound = sound;
      Vibration.vibrate(VIBRATION_PATTERN, true);
    } catch (e) {
      console.warn("CALL DEBUG: ringtone failed to start", e);
      isRinging = false;
    }
  }, []);

  const stop = useCallback(async () => {
    if (!isRinging && !activeSound) return;
    isRinging = false;
    Vibration.cancel();
    const sound = activeSound;
    activeSound = null;
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch { /* already stopped/unloaded — nothing left to clean up */ }
    }
  }, []);

  // Belt-and-suspenders: if the screen using this hook unmounts without
  // explicitly calling stop() (an unexpected navigation, a crash recovery,
  // Android back button, etc.), never leave a ringtone/vibration running.
  useEffect(() => {
    return () => { void stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { start, stop };
}