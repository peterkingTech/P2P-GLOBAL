import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
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

export type { ListenContent, ListenState, ListenStatus, StartAt, ChunkPosition, ListenAction, ArtworkSource, NarrationCapabilities } from "./engine";
export type { ListenSection, ListenPart } from "./chunking";
export { RATES } from "./engine";

// The device's own speech engine (expo-speech: iOS AVSpeechSynthesizer,
// Android TextToSpeech, the browser's speechSynthesis on web).
const deviceSpeech: SpeechDriver = {
  speak(text, o) {
    Speech.speak(text, {
      language: o.language || undefined, voice: o.voice, rate: o.rate,
      // iOS: let the system manage the session, so calls and other audio
      // interrupt or duck speech normally instead of fighting it.
      useApplicationAudioSession: false,
      onDone: o.onDone, onStopped: o.onStopped, onError: o.onError,
      onBoundary: o.onBoundary as any,
    });
  },
  stop: () => Speech.stop(),
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
 * For a screen with Listen buttons: speech belongs to the screen that started
 * it. Leaving the screen (another screen on top) or the app going to the
 * background PAUSES it, keeping the place; the screen closing STOPS it. Speech
 * never carries on unseen with no way to stop it.
 */
export function useListenOwner(owner: string) {
  useFocusEffect(useCallback(() => () => listen.release(owner, "pause"), [owner]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") listen.release(owner, "pause"); });
    return () => { sub.remove(); listen.release(owner, "stop"); };
  }, [owner]);
}
