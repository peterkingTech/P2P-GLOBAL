// Listen: real background audio and lock-screen controls for the ONE shared
// player. Not a second player — a SpeechDriver the engine (lib/listen/engine)
// talks to, exactly like device speech:
//   • each sentence is spoken by the phone's OWN voice into a temporary audio
//     file (native module modules/p2p-speech-audio), then played through
//     expo-audio, whose session keeps playing with the screen locked (iOS
//     background "audio" mode; Android media foreground service) and shows the
//     lock-screen / Control Center / notification controls;
//   • the lock screen shows the passage as the title, the playlist as the
//     album, "P2P Global" as the artist, and the OFFICIAL P2P Global artwork —
//     assets/images/icon.png, the Listen player's own artwork — never a
//     generated picture;
//   • play / pause / next / previous from the lock screen, headphones or
//     Bluetooth go into the same engine (next/previous: iOS only — expo-audio's
//     Android media session has no track buttons);
//   • the next sentence is prepared while this one plays (no gap); files are
//     deleted after use and all of them when listening stops — licensed text
//     is never kept;
//   • during a call (Agora / CallKit) or with Background playback off it hands
//     over to plain device speech and never touches the audio session.
// Available only in a native build that includes the module; elsewhere (Expo
// Go, web, older builds) device speech is used and nothing changes.
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Asset } from "expo-asset";
import type { NowPlaying, RemoteControls, SpeakOptions, SpeechDriver } from "./engine";

interface NativeSpeechAudio {
  synthesize(text: string, language: string, voice: string | null, rate: number): Promise<{ uri: string; durationMs: number }>;
  remove(uri: string): void;
  clearAll(): void;
  setTrackCommands(enabled: boolean): void;
  trackCommandsSupported(): boolean;
  addListener?(event: "onRemoteCommand", cb: (e: { command: "next" | "previous" }) => void): { remove(): void };
}
const native: NativeSpeechAudio | null = Platform.OS === "web" ? null : requireOptionalNativeModule<NativeSpeechAudio>("P2PSpeechAudio");
export const fileSpeechAvailable = !!native;

/** The official artwork for the lock screen (the Listen player's own: the P2P Global app icon), as a local file. */
const OFFICIAL_ARTWORK = require("@/assets/images/icon.png");
let artworkUri: Promise<string | null> | null = null;
const officialArtwork = () => (artworkUri ??= Asset.fromModule(OFFICIAL_ARTWORK).downloadAsync().then((a) => a.localUri ?? a.uri ?? null).catch(() => null));

export interface FileSpeechDeps {
  native: NativeSpeechAudio | null;
  createPlayer: () => AudioPlayer;
  setAudioMode: typeof setAudioModeAsync;
  artwork: () => Promise<string | null>;
  /** True while a call is live — then nothing here touches audio. */
  inCall: () => boolean;
}
const defaults = (): FileSpeechDeps => ({ native, createPlayer: () => createAudioPlayer(null), setAudioMode: setAudioModeAsync, artwork: officialArtwork, inCall: () => false });

/**
 * A SpeechDriver over audio files, wrapping device speech as the fallback
 * (voices, previews, calls, background off, or a file that couldn't be made).
 */
export function createFileSpeechDriver(fallback: SpeechDriver, d: Partial<FileSpeechDeps> = {}): SpeechDriver {
  const deps = { ...defaults(), ...d };
  if (!deps.native) return fallback;
  const mod: NativeSpeechAudio = deps.native;
  let player: AudioPlayer | null = null;
  let token = 0;
  let current: { token: number; uri: string; opts: SpeakOptions; done: boolean } | null = null;
  let expectPlaying = false;     // what WE asked the player to do (anything else came from the lock screen / an interruption)
  let usingFallback = false;
  let lockScreen = false;
  let meta: NowPlaying | null = null;
  let remote: RemoteControls | null = null;
  let modeAt = 0;
  const prepared = new Map<string, Promise<{ uri: string } | null>>();
  const keyOf = (text: string, o: Pick<SpeakOptions, "language" | "voice" | "rate">) => `${o.language}|${o.voice ?? ""}|${o.rate}|${text}`;
  const forget = (uri: string | undefined) => { if (uri) { try { mod.remove(uri); } catch { /* already gone */ } } };

  function ensurePlayer(): AudioPlayer {
    if (player) return player;
    const p = deps.createPlayer();
    p.addListener("playbackStatusUpdate", (st) => {
      const c = current;
      if (!c || c.token !== token) return;
      if (st.didJustFinish && !c.done) {
        c.done = true; expectPlaying = false;
        forget(c.uri);
        c.opts.onDone?.();
        return;
      }
      // Paused by the lock screen, headphones being unplugged or an interruption (a phone call).
      if (!st.playing && expectPlaying && st.isLoaded && !st.didJustFinish && st.playbackState !== "loading" && st.playbackState !== "buffering") {
        expectPlaying = false;
        remote?.pause();
        return;
      }
      // Played from the lock screen / headphones while the engine was paused.
      if (st.playing && !expectPlaying) { expectPlaying = true; remote?.play(); }
    });
    player = p;
    return p;
  }
  async function session() {
    // Playback session (background, lock screen). Re-asserted now and then — a ringtone or call may have changed it.
    if (Date.now() - modeAt < 60_000) return;
    modeAt = Date.now();
    await deps.setAudioMode({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => { modeAt = 0; });
  }
  async function showOnLockScreen(p: AudioPlayer) {
    if (!meta) return;
    const art = await deps.artwork();
    const m = { title: meta.title, artist: meta.artist, albumTitle: meta.album || undefined, artworkUrl: art ?? undefined };
    try {
      if (!lockScreen) { p.setActiveForLockScreen(true, m, { showSeekForward: false, showSeekBackward: false }); lockScreen = true; mod.setTrackCommands(true); }
      else p.updateLockScreenMetadata(m);
    } catch { /* lock screen is optional */ }
  }
  function synth(text: string, o: Pick<SpeakOptions, "language" | "voice" | "rate">) {
    const k = keyOf(text, o);
    let job = prepared.get(k);
    if (!job) {
      job = mod.synthesize(text, o.language, o.voice ?? null, o.rate).then((r) => ({ uri: r.uri })).catch(() => null);
      prepared.set(k, job);
      // Keep only a couple of prepared sentences; drop (and delete) older ones.
      while (prepared.size > 3) { const [oldK, oldJ] = prepared.entries().next().value!; prepared.delete(oldK); void oldJ.then((r) => forget(r?.uri)); }
    }
    return { k, job };
  }

  const driver: SpeechDriver = {
    capabilities: fallback.capabilities,
    getVoices: () => fallback.getVoices(),
    speak(text, o) {
      const my = ++token;
      // Calls, Background playback off: plain device speech; the audio session is left alone.
      if (deps.inCall() || !o.background) {
        if (player && expectPlaying) { expectPlaying = false; player.pause(); }
        usingFallback = true;
        return fallback.speak(text, o);
      }
      usingFallback = false;
      const { k, job } = synth(text, o);
      void (async () => {
        await session();
        const r = await job;
        prepared.delete(k);
        if (my !== token) { forget(r?.uri); return; }
        if (!r) { usingFallback = true; return fallback.speak(text, o); }   // the file couldn't be made: speak it directly instead
        const p = ensurePlayer();
        const previous = current;
        current = { token: my, uri: r.uri, opts: o, done: false };
        p.replace({ uri: r.uri });
        expectPlaying = true;
        p.play();
        if (previous && previous.uri !== r.uri) forget(previous.uri);
        o.onStart?.();
        await showOnLockScreen(p);
      })();
    },
    stop() {
      token++;
      if (usingFallback) return fallback.stop();
      // Pause (the lock screen keeps showing what was playing, with Play).
      if (player && expectPlaying) { expectPlaying = false; player.pause(); }
    },
    prepare(text, o) { if (!deps.inCall()) synth(text, o); },
    nowPlaying(info) { meta = info; if (player && lockScreen) void showOnLockScreen(player); },
    release() {
      token++;
      expectPlaying = false;
      if (player) { try { player.pause(); player.clearLockScreenControls(); } catch { /* nothing showing */ } }
      lockScreen = false; meta = null; current = null;
      try { mod.setTrackCommands(false); } catch { /* not supported */ }
      for (const j of prepared.values()) void j.then((r) => forget(r?.uri));
      prepared.clear();
      try { mod.clearAll(); } catch { /* nothing to clear */ }
      fallback.release?.();
    },
    setRemote(controls) {
      remote = controls;
      mod.addListener?.("onRemoteCommand", (e) => { if (e.command === "next") controls.next(); else if (e.command === "previous") controls.previous(); });
    },
  };
  return driver;
}
