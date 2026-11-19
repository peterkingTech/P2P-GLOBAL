import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { alignedSegments, segmentFor, type RecordedNarration } from "./narration";
import { getActiveGathering } from "@/lib/activeGathering";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { cachedVoiceUri, keepVoice, voiceCacheName } from "./voiceCache";
import i18n from "@/lib/i18n";
import { createListenEngine, VoiceUnavailable, type ListenState, type SpeechDriver } from "./engine";
import { labelsFrom, type SpokenLabels } from "./labels";
import { baseLanguage } from "./voices";
import { createUiPrefs, type ListenUiPrefs } from "./uiPrefs";
import { chosenVoiceFor, getVoicePrefs, isEligibleKind, loadVoiceDefaults, loadVoicePrefs, setReadingSource, setVoiceNotice, speakChunk, voiceDefaultsKnown, type ChosenVoice } from "@/lib/voices";
import { getLanguageName } from "@/lib/languageNames";

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

// OWNER 2026-11-19: "only P2P voice … no internet: voices should fall back to the phone voice or cached voices; when
// there is internet, phone voices hide immediately". So, for every sentence:
//   1. official narration (a studio recording), when the content has it and the listener keeps it first;
//   2. the listener's P2P Voice — the copy KEPT ON THIS PHONE when that sentence was heard before (lib/listen/
//      voiceCache: works offline, starts instantly), otherwise fresh from the server (and then kept);
//   3. ONLY when there is no internet: the phone's own voice (expo-speech), with a plain "you're offline" note.
//      The moment the server answers again, P2P Voice takes over and the phone's voice is gone (never offered online).
// Online refusals (a translation that isn't public domain, no P2P Voice for the language, the provider down) are
// said in plain words — the phone's voice is never used to get round them while there is internet.

// The app's own playback session (needed for background listening) — but NEVER during a live call or Gathering:
// then the system-managed session is kept, so call audio (Agora, CallKit, Bluetooth routing) is never touched.
function playbackSession(background: boolean) {
  if (getActiveGathering()) return;
  setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: background, interruptionMode: "doNotMix" }).catch(() => {});
}

// ── The phone's own voice: OFFLINE ONLY ─────────────────────────────────────────────────────────────────────────
// Background (iOS): speech keeps going with the screen locked only on the app's own audio session in "playback"
// mode — set up only when Background playback is on and NO call is live (calls untouched).
let speakToken = 0;
let sessionAt = 0;
const phoneSpeech = {
  speak(text: string, o: Parameters<SpeechDriver["speak"]>[1]) {
    const token = ++speakToken;
    const appSession = Platform.OS === "ios" && !!o.background && !getActiveGathering();
    const go = () => {
      if (token !== speakToken) return; // stopped or replaced while the session was set up
      Speech.speak(text, {
        language: o.language || undefined, rate: o.rate,
        useApplicationAudioSession: appSession,
        onDone: o.onDone, onStopped: o.onStopped, onError: o.onError,
        onBoundary: o.onBoundary as any,
      });
    };
    if (appSession && Date.now() - sessionAt > 60_000) {
      sessionAt = Date.now();
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => { sessionAt = 0; }).finally(go);
    } else go();
  },
  stop: () => { speakToken++; return Speech.stop(); },
};
// "Offline" = the server couldn't be reached (a network failure, not a refusal). Re-tried every 15 s while offline
// (and on every sentence that has no kept copy after that), so P2P Voice returns as soon as the internet does.
let offlineSince = 0;
const RETRY_MS = 15_000;
const isOffline = () => offlineSince > 0;
const markOffline = () => { if (!offlineSince) offlineSince = Date.now(); };
const markOnline = () => { offlineSince = 0; };
const OFFLINE_NOTE = "You're offline, so your phone's voice is reading. P2P Voice comes back when you're online.";
function phoneVoice(text: string, o: Parameters<SpeechDriver["speak"]>[1]) {
  cloudStop(false);
  setReadingSource({ mode: "device" });
  setVoiceNotice(OFFLINE_NOTE);
  phoneSpeech.speak(text, o);
}
/** Online, P2P Voice can't read this: stop with a plain message (the phone's voice is never used online). */
function cannotRead(o: Parameters<SpeechDriver["speak"]>[1], message: string) {
  setReadingSource(null);
  o.onError?.(new VoiceUnavailable(message));
}
const noVoiceMessage = (language: string) => {
  const code = baseLanguage(language);
  return `There's no P2P Voice for ${code === "en" ? "English" : getLanguageName(code)} yet.`;
};
/** The server accepts letters, digits and : . - / _ in a content key (a listening queue's key has commas). */
const safeKey = (k: string | undefined) => (String(k ?? "p2p").replace(/[^\w:.\-/]/g, "_").slice(0, 160) || "p2p");
// Sentence-level positions only (one recording per sentence): no total length or seeking by seconds.
const SENTENCE_CAPABILITIES = { seekSeconds: false, duration: false, timing: "sentence" } as const;
/** A network failure has no HTTP status; the server's own refusals do (and carry a plain message). */
const isNetworkFailure = (e: unknown) => !(typeof (e as { status?: number } | null)?.status === "number" && (e as { status: number }).status > 0);

// A studio recording (lib/listen/narration): each sentence plays its own stretch of the one file
// (expo-audio), so the engine's sentence-by-sentence behaviour is unchanged. Consecutive sentences
// play straight on without re-seeking (the engine stops and starts between sentences; the pause is
// deferred one tick so the next sentence can simply continue). A sentence the recording doesn't
// contain — or any failure — is read by the listener's P2P Voice (offline: kept copy, then the phone).
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
// ── P2P Voices (owner brief 2026-11-18): a synthetic voice from P2P's voice library ──
// Same engine, same sentences: each sentence is one short recording made on demand by the SERVER (cached there, and
// kept on this phone once heard), played with expo-audio. Highlighting stays on the sentence being heard, pause
// resumes at the exact moment, and changing voice carries on from the same sentence. The next two sentences are
// fetched (and kept) ahead so playback flows. Bible and playlists: public-domain translations only (server check).
let cloudPlayer: AudioPlayer | null = null;
let cloudToken = 0;
let cloudSub: { remove: () => void } | null = null;
let cloudWatch: ReturnType<typeof setInterval> | null = null;
let cloudPausedAt: { key: string; time: number } | null = null;
let cloudCurrentKey = "";
const cloudUrls = new Map<string, Promise<string>>();
type VoiceOpts = { kind?: string; contentKey?: string; language: string; translation?: string };
const keptName = (voiceId: string, o: VoiceOpts, text: string) => voiceCacheName({ voiceId, contentKey: safeKey(o.contentKey), translation: o.translation, text });
function cloudUrl(voiceId: string, o: VoiceOpts, text: string): Promise<string> {
  const k = `${voiceId}|${o.contentKey}|${o.translation ?? ""}|${text}`;
  let p = cloudUrls.get(k);
  if (!p) {
    p = speakChunk({ voiceId, contentKind: o.kind ?? "general", contentKey: safeKey(o.contentKey), language: o.language, text, ...(o.translation ? { translation: o.translation } : {}) })
      .then((r) => {
        markOnline();
        // Keep a copy for offline listening only when the voice's terms allow it (9jaLingo: live only — no copy, and its
        // short-lived link is forgotten before it expires).
        if (r.offlineAllowed) keepVoice(keptName(voiceId, o, text), r.url);
        else setTimeout(() => cloudUrls.delete(k), 15 * 60_000);
        return r.url;
      });
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
function cloudSpeak(text: string, o: Parameters<SpeechDriver["speak"]>[1], voice: ChosenVoice): void {
  const source = (o.source ?? text).trim();
  const token = ++cloudToken;
  if (!source) { setTimeout(() => { if (token === cloudToken) o.onDone?.(); }, 0); return; } // nothing to say: next sentence
  const key = `${voice.voiceId}|${o.contentKey}|${o.chunkIndex ?? -1}`;
  const refused = (message: string) => { if (token !== cloudToken) return; setVoiceNotice(null); cannotRead(o, message); };
  const noInternet = () => { if (token !== cloudToken) return; markOffline(); phoneVoice(text, o); };
  // Ahead: the next two sentences (same voice), so the next one starts without a wait — and is kept for offline.
  if (!isOffline() && o.chunkSources && typeof o.chunkIndex === "number")
    for (const n of [1, 2]) { const t = o.chunkSources[o.chunkIndex + n]?.trim(); if (t) void cloudUrl(voice.voiceId, o, t).catch(() => {}); }
  const play = (uri: string, kept: boolean) => {
    if (token !== cloudToken) return;
    if (!cloudPlayer) cloudPlayer = createAudioPlayer({ uri }, { updateInterval: 100 });
    else cloudPlayer.replace({ uri });
    const p = cloudPlayer;
    playbackSession(!!o.background);
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
      // Paused from OUTSIDE the app (lock screen, headset, Bluetooth, a call): P2P Listen pauses at the same place.
      else if (heard && !s.playing && !s.isBuffering) systemPause();
      else if (s.playing && s.currentTime > resumeAt + 0.05) heard = true;
    });
    let heard = false;
    p.setPlaybackRate(o.rate);
    (resumeAt > 0 ? p.seekTo(resumeAt) : Promise.resolve()).then(() => { if (token === cloudToken) { p.play(); lockScreenFor(p, o); } }, () => { if (token === cloudToken) { p.play(); lockScreenFor(p, o); } });
    // A recording that never starts within 8 s: a fresh one → the connection is gone (the phone's voice reads this
    // sentence); a kept one that won't play → fetch it fresh instead.
    let started = false, waited = 0;
    if (cloudWatch) clearInterval(cloudWatch);
    cloudWatch = setInterval(() => {
      if (token !== cloudToken || done) { if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; } return; }
      if (p.currentTime > resumeAt + 0.05) started = true;
      if (!started && ++waited >= 8) {
        if (cloudWatch) { clearInterval(cloudWatch); cloudWatch = null; }
        try { p.pause(); } catch {}
        if (kept) fresh(); else noInternet();
      }
    }, 1000);
  };
  const fresh = () => {
    if (token !== cloudToken) return;
    // Known offline and not yet time to try again: straight to the phone's voice (no waiting on every sentence).
    if (isOffline() && Date.now() - offlineSince < RETRY_MS) return noInternet();
    cloudUrl(voice.voiceId, o, source).then((url) => play(url, false), (e) => (isNetworkFailure(e) ? noInternet() : refused((e as Error).message)));
  };
  // A copy kept on this phone plays first (offline too); otherwise the server.
  cachedVoiceUri(keptName(voice.voiceId, o, source)).then((uri) => (uri ? play(uri, true) : fresh()), fresh);
}
/** The listener's P2P Voice reads this sentence. No P2P Voice for this language: a plain message online, the
 *  phone's voice offline (or before P2P's voice list has ever reached this phone). */
function p2pSpeak(text: string, o: Parameters<SpeechDriver["speak"]>[1]) {
  const chosen = isEligibleKind(o.kind ?? "general") ? chosenVoiceFor(o.language) : null;
  if (chosen) return cloudSpeak(text, o, chosen);
  if (isOffline() || !voiceDefaultsKnown()) { markOffline(); return phoneVoice(text, o); }
  cannotRead(o, noVoiceMessage(o.language));
}

const recordedNarration: SpeechDriver = {
  speak(text, o) {
    const official = o.narration as RecordedNarration | undefined;
    void loadVoicePrefs(); void loadVoiceDefaults(); // after sign-in (cheap when already loaded)
    // Official narration first (unless the listener chose their P2P Voice over it); otherwise their P2P Voice
    // (offline: a kept copy, else the phone's voice — owner 2026-11-19).
    const chosen = isEligibleKind(o.kind ?? "general") ? chosenVoiceFor(o.language) : null;
    // Bible recordings are the translation's own licensed audio: always first (never swapped for a generated voice).
    const authorised = o.kind === "bible" || o.kind === "playlist";
    if (!official || (chosen && !getVoicePrefs().preferOfficial && !authorised)) { recStop(true); return p2pSpeak(text, o); }
    cloudStop(false);
    const n = official;
    const viaP2P = () => { recStop(true); p2pSpeak(text, o); };
    // 2026-11-18: the sentence's stretch comes from ONE in-order alignment of the whole content (contiguous,
    // tolerant of small wording differences); the old per-sentence exact search is kept only for callers
    // that don't pass the sentence list.
    const seg = n && o.source && !recBroken.has(n.url)
      ? (o.chunkSources && typeof o.chunkIndex === "number" ? alignedSegments(n, o.chunkSources)[o.chunkIndex] ?? null : segmentFor(n, o.source, recCursor))
      : null;
    if (!seg) return viaP2P();
    setReadingSource({ mode: "official", voice: n.voice });
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
        playbackSession(!!o.background);
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
      let heard = false;
      recSub = p.addListener("playbackStatusUpdate", (s) => {
        if (token !== recToken) return;
        if (s.didJustFinish || s.currentTime >= seg.end - 0.02) finish();
        // Paused from OUTSIDE the app (lock screen, headset, Bluetooth, a call): P2P Listen pauses at the same place.
        else if (heard && !done && !s.playing && !s.isBuffering) systemPause();
        else if (s.playing) heard = true;
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
      lockScreenFor(p, o);
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
          recBroken.add(n.url); viaP2P();
        } else if (started && still >= 25) { // stuck mid-sentence for 25 s: stop and say so (no skipping)
          done = true; if (recWatch) { clearInterval(recWatch); recWatch = null; }
          recPausedAt = { url: n.url, chunk, time: t };
          recStop(true); o.onError?.(new Error("the recording stopped loading — check your connection, then tap play to continue"));
        }
      }, 1000);
    } catch {
      viaP2P();
    }
  },
  stop: () => { recStop(false); cloudStop(true); return phoneSpeech.stop(); },
  capabilities: SENTENCE_CAPABILITIES,
  // No phone voices are offered (the phone's voice reads only offline, chosen automatically). Waiting here (≤2.5 s, raced by the engine) makes sure the listener's
  // P2P Voice choices and P2P's default voices are known before the engine decides whether anything can read.
  getVoices: async () => { await Promise.all([loadVoicePrefs(), loadVoiceDefaults()]).catch(() => {}); return []; },
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

/** The one shared player: a P2P Voice, or a chapter's studio recording when it has one (the phone's voice only offline). */
export const listen = createListenEngine(recordedNarration, {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
}, Date.now, {
  // Something can read this content: the listener's P2P Voice for its language, its official narration, or —
  // offline only — the phone's voice.
  externalVoice: (language, kind, content) => (isEligibleKind(kind ?? "general") && !!chosenVoiceFor(language)) || !!content?.narration || isOffline() || !voiceDefaultsKnown(),
  noVoiceMessage,
});
void loadVoicePrefs(); void loadVoiceDefaults();

// ── LOCK SCREEN, NOTIFICATION AND HEADSET CONTROLS (owner brief 2026-11-19 "Lock screen audio controls") ──────
// ONE implementation for every kind of content, on the SAME two players P2P Listen already uses (studio / Bible
// recordings and P2P Voice). expo-audio shows the iOS Now Playing / lock screen and the Android media notification
// (its config plugin declares the foreground media-playback service; iOS declares UIBackgroundModes: audio).
//   • metadata = the content's own title and subtitle (a Scripture reference, a story chapter, a lesson) and P2P
//     Global — never private text; artwork only when the content has a web image;
//   • play / pause from the lock screen, notification, headset or Bluetooth act on the player itself; P2P Listen
//     follows (pauses at the same place, and continues from there) — the controls never disagree with the app;
//   • Previous / Next are NOT shown: this audio library offers no track commands for one player, and seek buttons
//     would jump inside a single sentence — no misleading controls;
//   • only with Background playback on, and never during a live call or Gathering (call audio is untouched);
//   • cleared when listening stops or finishes (no lingering notification, no idle service).
// The phone's own voice (offline only) speaks through the system speech engine and has no lock-screen controls.
let lockPlayer: AudioPlayer | null = null;
let lockKey = "";
let systemPaused = false;
const watched = new WeakSet<AudioPlayer>();
function lockScreenFor(p: AudioPlayer, o: Parameters<SpeechDriver["speak"]>[1]) {
  if (Platform.OS === "web" || !o.background || getActiveGathering()) return;
  const c = listen.getState().content;
  const art = c?.artwork && typeof c.artwork === "object" && /^https:\/\//.test(c.artwork.uri) ? c.artwork.uri : undefined;
  const meta = { title: c?.title ?? "P2P Listen", artist: c?.subtitle ?? "P2P Global", albumTitle: "P2P Global", ...(art ? { artworkUrl: art } : {}) };
  const key = JSON.stringify(meta);
  try {
    if (lockPlayer !== p) {
      try { lockPlayer?.setActiveForLockScreen(false); } catch { /* already inactive */ }
      p.setActiveForLockScreen(true, meta, { showSeekForward: false, showSeekBackward: false });
      lockPlayer = p; lockKey = key;
      if (!watched.has(p)) {
        watched.add(p);
        // Resumed from outside the app after a system pause: P2P Listen continues from the same place.
        p.addListener("playbackStatusUpdate", (s) => {
          if (s.playing && systemPaused && listen.getState().status === "paused") { systemPaused = false; listen.resume(); }
        });
      }
    } else if (key !== lockKey) { p.updateLockScreenMetadata(meta); lockKey = key; }
  } catch { /* lock-screen controls unavailable here: playback itself is unaffected */ }
}
/** The player was paused from the lock screen, notification, headset or an interruption. */
function systemPause() {
  if (listen.getState().status !== "playing") return;
  systemPaused = true;
  listen.pause();
}
function clearLockScreen() {
  const p = lockPlayer;
  lockPlayer = null; lockKey = ""; systemPaused = false;
  if (!p) return;
  try { p.clearLockScreenControls(); } catch { try { p.setActiveForLockScreen(false); } catch { /* gone */ } }
}
// Listening stopped, finished or failed: the lock screen and media notification go away. A pause keeps them, so
// the listener can continue from the lock screen. Content changes update the shown title.
let lastContentKey = "";
listen.subscribe(() => {
  const st = listen.getState();
  if (st.status === "idle" || st.status === "completed" || st.status === "error" || !st.content) { if (lockPlayer) clearLockScreen(); lastContentKey = ""; return; }
  if (st.content.key !== lastContentKey) { lastContentKey = st.content.key; lockKey = ""; }
  if (st.status === "playing") systemPaused = false;
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
