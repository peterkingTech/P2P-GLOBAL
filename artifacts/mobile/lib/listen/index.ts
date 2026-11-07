import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { segmentFor, type RecordedNarration } from "./narration";
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

export type { ListenContent, ListenState, ListenStatus, StartAt, ChunkPosition, ListenAction, ArtworkSource, NarrationCapabilities, BibleContinue, RepeatMode } from "./engine";
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

// A studio recording (lib/listen/narration): each sentence plays its own stretch of the one file
// (expo-audio), so the engine's sentence-by-sentence behaviour is unchanged. Consecutive sentences
// play straight on without re-seeking (the engine stops and starts between sentences; the pause is
// deferred one tick so the next sentence can simply continue). A sentence the recording doesn't
// contain — or any failure — falls back to the phone's voice.
let recPlayer: AudioPlayer | null = null;
let recUrl = "";
let recToken = 0;
let recCursor = 0;
let recPause: ReturnType<typeof setTimeout> | null = null;
let recSub: { remove: () => void } | null = null;
const recBroken = new Set<string>();
const recordedNarration: SpeechDriver = {
  speak(text, o) {
    const n = o.narration as RecordedNarration | undefined;
    const seg = n && o.source && !recBroken.has(n.url) ? segmentFor(n, o.source, recCursor) : null;
    if (!n || !seg) { recStop(true); return deviceSpeech.speak(text, o); }
    const token = ++recToken;
    if (recPause) { clearTimeout(recPause); recPause = null; }
    try {
      if (!recPlayer || recUrl !== n.url) {
        recStop(true);
        recPlayer?.remove();
        recPlayer = createAudioPlayer({ uri: n.url }, { updateInterval: 100 });
        recUrl = n.url;
        recCursor = 0;
        setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: !!o.background, interruptionMode: "doNotMix" }).catch(() => {});
      }
      const p = recPlayer;
      recCursor = seg.lastWord + 1;
      let done = false;
      const finish = () => { if (done || token !== recToken) return; done = true; recSub?.remove(); recSub = null; o.onDone?.(); };
      recSub?.remove();
      recSub = p.addListener("playbackStatusUpdate", (s) => {
        if (token !== recToken) return;
        if (s.didJustFinish || s.currentTime >= seg.end - 0.02) finish();
      });
      // Carry straight on when the recording is already at this sentence (it just finished the one before).
      const here = p.currentTime;
      const contiguous = p.playing && here >= seg.start - 0.6 && here <= seg.start + 0.3;
      p.setPlaybackRate(o.rate);
      if (contiguous) p.play();
      else p.seekTo(seg.start).then(() => { if (token === recToken) p.play(); }, () => { if (token === recToken) p.play(); });
      // The recording can't be played (no connection, an expired link): this sentence — and the rest
      // of this recording — goes to the phone's voice rather than silence.
      setTimeout(() => {
        if (done || token !== recToken || p.currentTime > seg.start + 0.05 || p.playing) return;
        done = true; recBroken.add(n.url); recStop(true); deviceSpeech.speak(text, o);
      }, 6000);
      // Never stuck: if status updates stop, move on after the segment's length (+ slack).
      setTimeout(finish, ((seg.end - seg.start) / Math.max(0.5, o.rate)) * 1000 + 2500);
    } catch {
      recStop(true);
      deviceSpeech.speak(text, o);
    }
  },
  stop: () => { recStop(false); return deviceSpeech.stop(); },
  capabilities: deviceSpeech.capabilities,
  getVoices: deviceSpeech.getVoices,
};
function recStop(now: boolean) {
  recToken++;
  recSub?.remove(); recSub = null;
  if (recPause) { clearTimeout(recPause); recPause = null; }
  if (!recPlayer) return;
  if (now) { try { recPlayer.pause(); } catch {} return; }
  // Deferred: if the engine starts the next sentence straight away, it carries on without a gap.
  recPause = setTimeout(() => { recPause = null; try { recPlayer?.pause(); } catch {} }, 0);
}

/** The one shared player: the device's own voice, or a chapter's studio recording when it has one. */
export const listen = createListenEngine(recordedNarration, {
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
