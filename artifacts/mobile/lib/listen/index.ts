import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { getActiveGathering } from "@/lib/activeGathering";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import i18n from "@/lib/i18n";
import { createListenEngine, type ListenState, type SpeechDriver } from "./engine";
import { labelsFrom, type SpokenLabels } from "./labels";
import { baseLanguage } from "./voices";
import { createUiPrefs, type ListenUiPrefs } from "./uiPrefs";

/** Spoken signposts in the TEXT's language (no fallback to another language). */
export function spokenLabels(language: string): SpokenLabels {
  const exact = String(language ?? "").replace("_", "-");
  const lng = i18n.hasResourceBundle(exact, "translation") ? exact : baseLanguage(language);
  return labelsFrom((key) => i18n.getResource(lng, "translation", key) as string | undefined);
}
export type { SpokenLabels } from "./labels";

export type { ListenContent, ListenState, ListenStatus, StartAt, ChunkPosition, ListenAction, ArtworkSource, NarrationCapabilities, BibleContinue } from "./engine";
export type { ListenSection, ListenPart } from "./chunking";
export { RATES } from "./engine";

// The device's own speech engine (expo-speech: iOS AVSpeechSynthesizer,
// Android TextToSpeech, the browser's speechSynthesis on web).
//
// Background (iOS): speech keeps going with the screen locked only on the
// app's own audio session in "playback" mode (Info.plist already declares the
// "audio" background mode). That session is set up — the same way the
// ringtone does it, through expo-audio — only when Background playback is on
// and NO call is live; during a call the system-managed session is kept, so
// call audio (Agora, CallKit, Bluetooth routing) is never touched.
// Android has no session switch here; see docs/listen.md for its limits.
let speakToken = 0;
let sessionAt = 0;
const deviceSpeech: SpeechDriver = {
  speak(text, o) {
    const token = ++speakToken;
    const appSession = Platform.OS === "ios" && !!o.background && !getActiveGathering();
    const go = () => {
      if (token !== speakToken) return; // stopped or replaced while the session was set up
      Speech.speak(text, {
        language: o.language || undefined, voice: o.voice, rate: o.rate,
        // Off: the system manages a separate session, so calls and other audio
        // interrupt or duck speech normally. On: the app's playback session (background).
        useApplicationAudioSession: appSession,
        onDone: o.onDone, onStopped: o.onStopped, onError: o.onError,
        onBoundary: o.onBoundary as any,
      });
    };
    // Re-assert the playback session now and then (a ringtone or call may have changed it).
    if (appSession && Date.now() - sessionAt > 60_000) {
      sessionAt = Date.now();
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => { sessionAt = 0; }).finally(go);
    } else go();
  },
  stop: () => { speakToken++; return Speech.stop(); },
  // Honest about what device speech can do: no length, elapsed time or seeking by seconds;
  // the finest reliable position is one utterance (one sentence).
  capabilities: { seekSeconds: false, duration: false, timing: "sentence" },
  getVoices: async () => (await Speech.getAvailableVoicesAsync()).map((v) => ({ identifier: v.identifier, name: v.name, language: v.language, quality: String(v.quality) })),
};

/** The one shared player. */
export const listen = createListenEngine(deviceSpeech, {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
});

export function useListenState(): ListenState {
  return useSyncExternalStore(listen.subscribe, listen.getState, listen.getState);
}

/** The Read & Listen screen's look for this person (mode, text size, follow). */
export const listenUi = createUiPrefs({ get: (k) => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v) });
export function useListenUi(): ListenUiPrefs {
  return useSyncExternalStore(listenUi.subscribe, listenUi.get, listenUi.get);
}
export { LISTEN_MODES, TEXT_SCALES, type ListenMode, type ListenUiPrefs } from "./uiPrefs";

/**
 * For a screen with Listen buttons. The listening session no longer belongs
 * to the screen: leaving it, opening another part of P2P Global or closing
 * the screen keeps the narration going (the floating mini player is always
 * there to pause, stop or reopen it). This only tells the player which Listen
 * screen is in front, so that screen shows its own bar instead.
 */
export function useListenOwner(owner: string) {
  useFocusEffect(useCallback(() => { listen.setFocusedOwner(owner); return () => listen.clearFocusedOwner(owner); }, [owner]));
}

/**
 * Mounted once at the app root (components/listen/ListenHost): when the app
 * goes to the background, pause — unless Background playback is on. Only an
 * explicit Stop, an error or the listener's own choice ends a session.
 */
export function useListenAppState() {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" && !listen.getState().background) listen.pause();
    });
    return () => sub.remove();
  }, []);
}
