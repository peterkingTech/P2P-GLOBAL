// Recorded voice-message playback (components/VoiceMessageBubble.tsx).
//
// Root cause of "can't seek backwards / drag the playhead": the bubble's
// progress bar was a drawn View with no touch handling and the code never
// called seekTo; the only control was play/pause. There was also no speed
// control and several messages could play at once.
//
// This controller drives the REAL expo-audio player (seekTo, playbackRate) —
// nothing here only moves a bar or a label. It is plain logic, independent of
// React, so it can be tested without a device. It never touches audio mode or
// Agora: live calls keep their own engine and settings.

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const SKIP_SECONDS = 5;
/** Give up waiting for a file that never loads (deleted, offline). */
export const LOAD_TIMEOUT_MS = 15000;

/** The subset of expo-audio's AudioPlayer this uses. */
export interface VoicePlayerLike {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  setPlaybackRate(rate: number, pitchCorrectionQuality?: "low" | "medium" | "high"): void;
  shouldCorrectPitch: boolean;
  remove(): void;
  addListener(event: "playbackStatusUpdate", cb: (s: VoiceStatusLike) => void): { remove(): void } | void;
}
export interface VoiceStatusLike {
  isLoaded: boolean; currentTime: number; duration: number; playing: boolean; didJustFinish: boolean;
  isBuffering?: boolean; error?: string | null;
}

export type VoicePhase = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export interface VoiceState { phase: VoicePhase; position: number; duration: number; rate: PlaybackSpeed; buffering: boolean }

// ── Listening session: one speed for every message, one message at a time ──
type Listener = () => void;
const session = {
  rate: 1 as PlaybackSpeed,
  active: null as null | { pause(): void },
  listeners: new Set<Listener>(),
};
export function sessionRate(): PlaybackSpeed { return session.rate; }
export function onSessionRateChange(fn: Listener): () => void { session.listeners.add(fn); return () => { session.listeners.delete(fn); }; }
function setSessionRate(r: PlaybackSpeed) { session.rate = r; for (const fn of session.listeners) fn(); }
/** Tests only. */
export function __resetVoiceSession() { session.rate = 1; session.active = null; session.listeners.clear(); }

// ── Pure helpers ────────────────────────────────────────────────────────────
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  return duration > 0 ? Math.min(t, duration) : t;
}
/** Seek target for a touch at x on a bar `width` wide. */
export function timeAtX(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return clampTime((Math.max(0, Math.min(x, width)) / width) * duration, duration);
}
export function nextSpeed(r: PlaybackSpeed): PlaybackSpeed {
  const i = PLAYBACK_SPEEDS.indexOf(r);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length];
}
export const speedLabel = (r: number) => `${Number.isInteger(r) ? r : r.toString().replace(/0$/, "")}×`;
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Controller ──────────────────────────────────────────────────────────────
export interface ControllerDeps {
  uri: string;
  /** Duration stored with the message; may be null or wrong — the file's own wins once loaded. */
  initialDuration: number | null;
  createPlayer(uri: string): VoicePlayerLike;
  onChange(state: VoiceState): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export function createVoiceController(deps: ControllerDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let player: VoicePlayerLike | null = null;
  let sub: { remove(): void } | void;
  let loaded = false;
  let pendingSeek: number | null = null;
  let playWhenLoaded = false;
  let scrubbing = false;
  // While a seekTo is in flight the player may still report the old time;
  // trust the target until it completes so the playhead doesn't jump back.
  let seekingTo: number | null = null;
  let loadTimer: unknown = null;
  let disposed = false;
  const initial = deps.initialDuration && deps.initialDuration > 0 ? deps.initialDuration : 0;
  let state: VoiceState = { phase: "idle", position: 0, duration: initial, rate: session.rate, buffering: false };

  const emit = (patch: Partial<VoiceState>) => { state = { ...state, ...patch }; if (!disposed) deps.onChange(state); };
  const handle = { pause: () => pause() };

  function applyRate(r: PlaybackSpeed) {
    if (!player) return;
    player.shouldCorrectPitch = true;         // keep voices natural at other speeds
    player.setPlaybackRate(r, "high");
  }

  function ensurePlayer(): VoicePlayerLike {
    if (player) return player;
    player = deps.createPlayer(deps.uri);
    sub = player.addListener("playbackStatusUpdate", onStatus);
    applyRate(state.rate);
    loadTimer = setTimer(() => {
      if (!loaded && !disposed) { playWhenLoaded = false; emit({ phase: "error", buffering: false }); }
    }, LOAD_TIMEOUT_MS);
    return player;
  }

  function onStatus(s: VoiceStatusLike) {
    if (disposed) return;
    if (s.error) { playWhenLoaded = false; emit({ phase: "error", buffering: false }); return; }
    if (!s.isLoaded) return;
    if (!loaded) {
      loaded = true;
      if (loadTimer) { clearTimer(loadTimer); loadTimer = null; }
      if (pendingSeek !== null) { const t = pendingSeek; pendingSeek = null; startSeek(t); }
      if (playWhenLoaded) { playWhenLoaded = false; player!.play(); }
    }
    const duration = s.duration > 0 ? s.duration : state.duration;
    if (s.didJustFinish) { emit({ phase: "ended", position: duration, duration, buffering: false }); return; }
    let phase = state.phase;
    if (s.playing) phase = "playing";
    else if (phase === "playing") phase = "paused";                       // paused by the system (call, headphones out)
    else if (phase === "loading" && !playWhenLoaded) phase = "paused";
    emit({
      duration,
      position: scrubbing ? state.position : seekingTo !== null ? seekingTo : clampTime(s.currentTime, duration),
      phase,
      buffering: !!s.isBuffering,
    });
  }

  function startSeek(t: number) {
    seekingTo = t;
    const done = () => { if (seekingTo === t) seekingTo = null; };
    void player!.seekTo(t).then(done, done);
    emit({ position: t });
  }

  function setRate(r: PlaybackSpeed) {
    if (!PLAYBACK_SPEEDS.includes(r)) return;
    setSessionRate(r);
    applyRate(r);                             // position and play state untouched
    emit({ rate: r });
  }

  function claimSession() {
    if (session.active && session.active !== handle) session.active.pause();
    session.active = handle;
  }

  function play() {
    claimSession();
    const p = ensurePlayer();
    if (state.rate !== session.rate) { state = { ...state, rate: session.rate }; applyRate(session.rate); }
    if (state.phase === "ended") startSeek(0);
    if (!loaded) { playWhenLoaded = true; emit({ phase: "loading" }); return; }
    p.play();
    emit({ phase: "playing" });
  }

  function pause() {
    playWhenLoaded = false;
    if (player && loaded) player.pause();
    if (state.phase === "playing" || state.phase === "loading") emit({ phase: "paused", buffering: false });
  }

  function seek(t: number) {
    const target = clampTime(t, state.duration);
    ensurePlayer();
    if (!loaded) { pendingSeek = target; emit({ position: target, phase: state.phase === "idle" ? "paused" : state.phase }); return; }
    startSeek(target);
    if (state.phase === "ended") emit({ phase: "paused" });
  }

  return {
    get state() { return state; },
    toggle() { if (state.phase === "playing" || (state.phase === "loading" && playWhenLoaded)) pause(); else play(); },
    play, pause, seek,
    skip(delta: number) { seek(state.position + delta); },
    replay() { seek(0); play(); },
    /** Drag start/end: the bar shows the finger, not the player, until release. */
    beginScrub() { scrubbing = true; },
    previewScrub(t: number) { emit({ position: clampTime(t, state.duration) }); },
    endScrub(t: number) { scrubbing = false; seek(t); },
    setRate,
    cycleRate() { setRate(nextSpeed(state.rate)); },
    resetRate() { setRate(1); },
    /** The session speed was changed from another message: take it on. */
    syncRate() { if (state.rate !== session.rate) { applyRate(session.rate); emit({ rate: session.rate }); } },
    retry() {
      if (player) { try { sub?.remove(); player.remove(); } catch { /* already gone */ } }
      player = null; loaded = false; pendingSeek = null;
      emit({ phase: "idle", position: 0 });
      play();
    },
    dispose() {
      disposed = true;
      if (loadTimer) clearTimer(loadTimer);
      if (session.active === handle) session.active = null;
      try { sub?.remove(); player?.remove(); } catch { /* already gone */ }
      player = null;
    },
  };
}
export type VoiceController = ReturnType<typeof createVoiceController>;
