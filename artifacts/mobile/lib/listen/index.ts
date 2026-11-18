import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { alignedSegments, segmentFor, type RecordedNarration } from "./narration";
import { getActiveGathering } from "@/lib/activeGathering";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import i18n from "@/lib/i18n";
import { createListenEngine, type ListenState, type SpeechDriver } from "./engine";
import { labelsFrom, type SpokenLabels } from "./labels";
import { baseLanguage } from "./voices";
import { createUiPrefs, type ListenUiPrefs } from "./uiPrefs";
import { chosenVoiceFor, getVoicePrefs, isEligibleKind, loadVoiceDefaults, loadVoicePrefs, setReadingSource, setVoiceNotice, speakChunk, type ChosenVoice } from "@/lib/voices";

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
// Where a paused recording stopped: { url, chunk, time } — resume continues from that exact moment.
let recPausedAt: { url: string; chunk: number; time: number } | null = null;
let recWatch: ReturnType<typeof setInterval> | null = null;
let recCurrent: { url: string; chunk: number } | null = null;
// ── P2P Voices (owner brief 2026-11-18): a synthetic voice from P2P's voice library, for ELIGIBLE content only ──
// Same engine, same sentences: each sentence is one short recording made on demand by the server (cached there),
// played with expo-audio. Highlighting stays on the sentence being heard, pause resumes at the exact moment, and
// changing voice carries on from the same sentence. The next two sentences are fetched ahead so playback flows.
// Never for Bible content (the server refuses too); any failure → the phone's voice reads that sentence and the
// player says so in plain words. Official narration always comes first when the listener keeps that setting.
let cloudPlayer: AudioPlayer | null = null;
let cloudToken = 0;
let cloudSub: { remove: () => void } | null = null;
let cloudWatch: ReturnType<typeof setInterval> | null = null;
let cloudPausedAt: { key: string; time: number } | null = null;
let cloudCurrentKey = "";
const cloudUrls = new Map<string, Promise<string>>();
function cloudUrl(voiceId: string, o: { kind?: string; contentKey?: string; language: string }, text: string): Promise<string> {
  const k = `${voiceId}|${o.contentKey}|${text}`;
  let p = cloudUrls.get(k);
  if (!p) {
    p = speakChunk({ voiceId, contentKind: o.kind ?? "", contentKey: o.contentKey ?? "p2p", language: o.language, text }).then((r) => r.url);
    p.catch(() => cloudUrls.delete(k));
    cloudUrls.set(k, p);
    if (cloudUrls.size > 120) { const oldest = cloudUrls.keys().next().value; if (oldest !== undefined) cloudUrls.delete(oldest); }
  }
  return p;
}
function cloudStop(rememberPause: boolean) {
  cloudToken++;
  cloudSub?.remove(); cloudSub = null;
  if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; }
  if (cloudPlayer) {
    if (rememberPause && cloudCurrentKey) { try { cloudPausedAt = { key: cloudCurrentKey, time: cloudPlayer.currentTime }; } catch {} }
    try { cloudPlayer.pause(); } catch {}
  }
}
function cloudSpeak(text: string, o: Parameters<SpeechDriver["speak"]>[1], voice: ChosenVoice): boolean {
  const source = (o.source ?? text).trim();
  if (!source) return false;
  const token = ++cloudToken;
  const key = `${voice.voiceId}|${o.contentKey}|${o.chunkIndex ?? -1}`;
  const fallback = (why: string) => {
    if (token !== cloudToken) return;
    setVoiceNotice(why);
    setReadingSource({ mode: "device" });
    deviceSpeech.speak(text, o);
  };
  // Ahead: the next two sentences (same voice), so the next one starts without a wait.
  if (o.chunkSources && typeof o.chunkIndex === "number")
    for (const n of [1, 2]) { const t = o.chunkSources[o.chunkIndex + n]?.trim(); if (t) void cloudUrl(voice.voiceId, o, t).catch(() => {}); }
  cloudUrl(voice.voiceId, o, source).then((url) => {
    if (token !== cloudToken) return;
    if (!cloudPlayer) cloudPlayer = createAudioPlayer({ uri: url }, { updateInterval: 100 });
    else cloudPlayer.replace({ uri: url });
    const p = cloudPlayer;
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: !!o.background, interruptionMode: "doNotMix" }).catch(() => {});
    setReadingSource({ mode: "p2p", voice: voice.name, provider: voice.provider });
    setVoiceNotice(null);
    cloudCurrentKey = key;
    const resumeAt = o.resuming && cloudPausedAt?.key === key ? cloudPausedAt.time : 0;
    cloudPausedAt = null;
    let done = false;
    cloudSub?.remove();
    cloudSub = p.addListener("playbackStatusUpdate", (s) => {
      if (token !== cloudToken || done) return;
      if (s.didJustFinish) { done = true; cloudSub?.remove(); cloudSub = null; if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; } o.onDone?.(); }
    });
    p.setPlaybackRate(o.rate);
    (resumeAt > 0 ? p.seekTo(resumeAt) : Promise.resolve()).then(() => { if (token === cloudToken) p.play(); }, () => { if (token === cloudToken) p.play(); });
    // A recording that never starts within 8 s (no connection, expired link): the phone's voice reads this sentence.
    let started = false, waited = 0;
    if (cloudWatch) clearInterval(cloudWatch);
    cloudWatch = setInterval(() => {
      if (token !== cloudToken || done) { if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; } return; }
      if (p.currentTime > resumeAt + 0.05) started = true;
      if (!started && ++waited >= 8) { if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; } cloudStop(false); fallback("Your chosen voice couldn't load, so your phone's voice is reading for now."); }
    }, 1000);
  }, () => fallback("Your chosen voice isn't available at the moment, so your phone's voice is reading."));
  return true;
}

const recordedNarration: SpeechDriver = {
  speak(text, o) {
    const official = o.narration as RecordedNarration | undefined;
    void loadVoicePrefs(); void loadVoiceDefaults(); // after sign-in (cheap when already loaded)
    // Official narration first (unless the listener chose a P2P Voice over it); otherwise their P2P Voice for this
    // language when the content is eligible; otherwise the phone's voice. Bible is never read by a P2P Voice.
    const chosen = o.kind !== "bible" && isEligibleKind(o.kind) ? chosenVoiceFor(o.language) : null;
    if (chosen && (!official || !getVoicePrefs().preferOfficial)) { recStop(true); if (cloudSpeak(text, o, chosen)) return; }
    cloudStop(false);
    const n = official;
    setReadingSource(n ? { mode: "official", voice: n.voice } : { mode: "device" });
    // 2026-11-18: the sentence's stretch comes from ONE in-order alignment of the whole content (contiguous,
    // tolerant of small wording differences); the old per-sentence exact search is kept only for callers
    // that don't pass the sentence list.
    const seg = n && o.source && !recBroken.has(n.url)
      ? (o.chunkSources && typeof o.chunkIndex === "number" ? alignedSegments(n, o.chunkSources)[o.chunkIndex] ?? null : segmentFor(n, o.source, recCursor))
      : null;
    if (!n || !seg) { recStop(true); return deviceSpeech.speak(text, o); }
    const token = ++recToken;
    if (recPause) { clearTimeout(recPause); recPause = null; }
    if (recWatch) { clearInterval(recWatch); recWatch = null; }
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
      const chunk = typeof o.chunkIndex === "number" ? o.chunkIndex : -1;
      recCurrent = { url: n.url, chunk };
      let done = false;
      const finish = () => {
        if (done || token !== recToken) return;
        done = true; recSub?.remove(); recSub = null;
        if (recWatch) { clearInterval(recWatch); recWatch = null; }
        o.onDone?.();
      };
      recSub?.remove();
      // The sentence ends when the AUDIO reaches its end (or the file ends) — never on a timer.
      recSub = p.addListener("playbackStatusUpdate", (s) => {
        if (token !== recToken) return;
        if (s.didJustFinish || s.currentTime >= seg.end - 0.02) finish();
      });
      // Resume after a pause: from the exact moment it was paused (within this sentence's stretch).
      const pausedHere = o.resuming && recPausedAt && recPausedAt.url === n.url && recPausedAt.chunk === chunk
        && recPausedAt.time >= seg.start && recPausedAt.time < seg.end ? recPausedAt.time : null;
      recPausedAt = null;
      const from = pausedHere ?? seg.start;
      // Carry straight on when the recording is already here (it just finished the sentence before).
      const here = p.currentTime;
      const contiguous = pausedHere === null && p.playing && here >= seg.start - 0.6 && here <= seg.start + 0.3;
      p.setPlaybackRate(o.rate);
      if (contiguous) p.play();
      else p.seekTo(from).then(() => { if (token === recToken) p.play(); }, () => { if (token === recToken) p.play(); });
      // Watchdog — progress, not time. A recording that never starts (no connection, an expired link) goes to
      // the phone's voice; one that stops moving mid-sentence (buffering) is WAITED for, and only after a long
      // stall is it reported as an error (the listener resumes from the same place). It never skips ahead.
      let lastTime = -1, still = 0, started = false;
      recWatch = setInterval(() => {
        if (done || token !== recToken) { if (recWatch) { clearInterval(recWatch); recWatch = null; } return; }
        const t = p.currentTime;
        if (t > from + 0.05) started = true;
        if (t !== lastTime) { lastTime = t; still = 0; return; }
        still++;
        if (!started && still >= 6) { // 6 s and not a moment played: the recording isn't reachable
          done = true; if (recWatch) { clearInterval(recWatch); recWatch = null; }
          recBroken.add(n.url); recStop(true); deviceSpeech.speak(text, o);
        } else if (started && still >= 25) { // stuck mid-sentence for 25 s: stop and say so (no skipping)
          done = true; if (recWatch) { clearInterval(recWatch); recWatch = null; }
          recPausedAt = { url: n.url, chunk, time: t };
          recStop(true); o.onError?.(new Error("the recording stopped loading — check your connection, then tap play to continue"));
        }
      }, 1000);
    } catch {
      recStop(true);
      deviceSpeech.speak(text, o);
    }
  },
  stop: () => { recStop(false); cloudStop(true); return deviceSpeech.stop(); },
  capabilities: deviceSpeech.capabilities,
  getVoices: deviceSpeech.getVoices,
};
function recStop(now: boolean) {
  recToken++;
  recSub?.remove(); recSub = null;
  if (recWatch) { clearInterval(recWatch); recWatch = null; }
  if (recPause) { clearTimeout(recPause); recPause = null; }
  if (!recPlayer) return;
  // Remember where this sentence was (a pause resumes from here; any other start ignores it).
  if (recCurrent && recCurrent.url === recUrl) { try { recPausedAt = { url: recUrl, chunk: recCurrent.chunk, time: recPlayer.currentTime }; } catch {} }
  if (now) { try { recPlayer.pause(); } catch {} return; }
  // Deferred: if the engine starts the next sentence straight away, it carries on without a gap.
  recPause = setTimeout(() => { recPause = null; try { recPlayer?.pause(); } catch {} }, 0);
}

/** The one shared player: the device's own voice, or a chapter's studio recording when it has one. */
export const listen = createListenEngine(recordedNarration, {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
}, Date.now, {
  // A verified P2P Voice for a language the phone can't speak (e.g. Igbo, once a specialist provider is verified).
  externalVoice: (language, kind) => isEligibleKind(kind) && !!chosenVoiceFor(language),
});
void loadVoicePrefs(); void loadVoiceDefaults();

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
