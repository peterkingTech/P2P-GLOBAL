import { useCallback, useEffect, useRef } from "react";
import { Platform, Vibration } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

// A real incoming-call ringing experience (audio + vibration), not a visual
// animation standing in for it. Singleton-per-hook-instance by design: a
// module-level "is anything currently ringing" guard means even if
// incoming.tsx re-renders/re-mounts unexpectedly, a second overlapping
// ringtone can never start while one is already playing — only stop() (or
// this same start() call again, which is a no-op while already ringing)
// can end it.
let activeSound: AudioPlayer | null = null;
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
      // expo-audio field names differ from expo-av's AudioMode: playsInSilentMode
      // (was playsInSilentModeIOS), shouldPlayInBackground (was
      // staysActiveInBackground). shouldDuckAndroid has no direct equivalent —
      // interruptionMode: "doNotMix" is the closest match to the original intent
      // (an incoming-call ringtone should take priority, not be ducked under
      // other audio) rather than the default "mixWithOthers".
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: "doNotMix",
      });
      // createAudioPlayer is synchronous (unlike expo-av's async createAsync),
      // so the "stopped while still loading" race this used to guard against
      // no longer has a window to occur in.
      const sound = createAudioPlayer(require("../assets/sounds/ringtone.wav"));
      sound.loop = true;
      sound.volume = 1.0;
      activeSound = sound;
      sound.play();
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
        // expo-audio has no stopAsync/unloadAsync — pause() halts playback,
        // remove() frees the underlying native player. Both are synchronous.
        sound.pause();
        sound.remove();
      } catch { /* already stopped/removed — nothing left to clean up */ }
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