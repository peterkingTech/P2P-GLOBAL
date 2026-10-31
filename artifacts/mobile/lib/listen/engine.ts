// Listen: the ONE shared player behind every "Listen" button (Bible,
// Kingdom Stories, Kingdom School / Core Curriculum, Learning Plans) and the
// P2P Global Read & Listen screen. The phone's own speech voice reads the text
// the screen already shows — no recorded files, no paid or AI voices, nothing
// generated server-side.
//
// Guarantees:
//  • one speech session at a time — every utterance carries a generation
//    number, and callbacks from an older one are ignored, so stop/replace,
//    rapid taps and navigation can never overlap or "jump back";
//  • one utterance per SENTENCE (lib/listen/chunking), so the reading view can
//    highlight exactly what is being said — the engine's own start/finish of
//    each utterance, never a guess from character counts or a timer;
//  • pause works the same everywhere: speech is stopped and the place is
//    kept (the last word the engine reported, else the sentence's start), so
//    resume continues there — Android has no native pause;
//  • listening position is saved per content identity (never the text) and
//    is NOT learning progress: nothing here completes a lesson or chapter,
//    and nothing here moves on to another chapter, lesson or story by itself;
//  • "Listen Again" restarts the current content; "Auto Listen Again" plays it
//    ONCE more after a short, visible countdown — never a loop.
//
// Narration sources: the engine talks to a `SpeechDriver` (device speech
// today — lib/listen/index.ts). Its `capabilities` say honestly what it can
// do: device speech has no duration, elapsed time or second-based seeking,
// so the player shows sentence steps instead. A recorded-audio source (e.g.
// licensed Bible audio with verse timing) can supply real timing later.
//
// Framework-free: the speech driver and storage are passed in (tests pass fakes).

import { buildChunks, chunkIndexFor, firstChunkOfSection, resumeOffset, CHUNK_MAX, type Chunk, type ListenSection } from "./chunking";
import { prepareSpeech } from "./pronounce";
import { baseLanguage, chooseVoice, voicesFor, type DeviceVoice, type VoiceChoice } from "./voices";

export type ListenStatus = "idle" | "loading" | "playing" | "paused" | "completed" | "error";

export interface SpeakOptions {
  language: string; voice?: string; rate: number;
  onStart?: () => void; onDone?: () => void; onStopped?: () => void;
  onError?: (e: Error) => void; onBoundary?: (e: { charIndex: number }) => void;
}
/** What a narration source can honestly report. */
export interface NarrationCapabilities {
  /** Seek by seconds (±10 s). */
  seekSeconds: boolean;
  /** Total length and elapsed time. */
  duration: boolean;
  /** Finest reliable position: per utterance (sentence) for device speech; verse/word timing only from real metadata. */
  timing: "sentence" | "verse" | "word";
}
export interface SpeechDriver {
  speak(text: string, opts: SpeakOptions): void;
  stop(): void | Promise<void>;
  getVoices(): Promise<DeviceVoice[]>;
  capabilities?: NarrationCapabilities;
}
export interface ListenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ListenLink { label: string; open: () => void }
/** After listening: the next learning step on the same screen (never automatic). */
export interface ListenAction { label: string; icon?: string; open: () => void }
export type ListenKind = "bible" | "story" | "story-intro" | "lesson" | "plan";
export type ArtworkSource = number | { uri: string };

/** A content adapter: what a screen hands the shared player. */
export interface ListenContent {
  /** Stable identity: "bible:<translation>:<BOOK>.<chapter>", "story:<id>:<chapterId>", "lesson:<id>:<lang>"… */
  key: string;
  /** The screen that started it — only that screen shows the player. */
  owner: string;
  kind?: ListenKind;
  title: string;
  subtitle?: string;
  /** Language of the TEXT (not the app's interface language). */
  language: string;
  sections: ListenSection[];
  /** What the reading view highlights: the whole part (a Bible verse) or the sentence. */
  highlight?: "part" | "sentence";
  /** Moving on is always the listener's choice — shown as buttons, never automatic. */
  previous?: ListenLink | null;
  next?: ListenLink | null;
  /** Shown when listening finishes (e.g. "Continue to Personal Reflections"). */
  completionActions?: ListenAction[];
  artwork?: ArtworkSource | null;
  /** Remember "last listened" for a group (e.g. "bible"), with screen-specific details. */
  resumeGroup?: string;
  meta?: Record<string, string | number>;
}
export type StartAt = { partKey: string; offset?: number } | { section: number } | "saved" | "start";

export interface ListenError { kind: "empty" | "unavailable_language" | "speech"; message: string }
/** Where each spoken sentence sits in the displayed text (for highlighting and tap-to-listen). */
export interface ChunkPosition { section: number; part: number; partKey: string; start: number; end: number }
export interface ListenState {
  status: ListenStatus;
  content: (Omit<ListenContent, "sections"> & { sectionTitles: string[]; sections: ListenSection[] }) | null;
  section: number;
  partKey: string | null;
  chunk: number;
  chunkCount: number;
  chunks: ChunkPosition[];
  rate: number;
  voice: VoiceChoice | null;
  /** Voices for the content's language, and every voice (for an explicit choice when none match). */
  voices: DeviceVoice[];
  allVoices: DeviceVoice[];
  error: ListenError | null;
  capabilities: NarrationCapabilities;
  /** Auto Listen Again preference, and whether this session has used its one replay. */
  autoAgain: boolean;
  replayed: boolean;
  /** Seconds until the automatic replay starts (null when none is pending). */
  replayCountdown: number | null;
  /** The full Read & Listen screen is open. */
  presented: boolean;
}

export const RATES = [0.75, 1, 1.25, 1.5] as const;
const POS = "p2p.listen.v1.pos:";
const LAST = "p2p.listen.v1.last:";
const PREFS = "p2p.listen.v1.prefs";
interface Prefs { rate: number; voices: Record<string, string>; autoAgain: boolean }
export interface SavedPosition { partKey: string; offset: number; updatedAt: number }
export interface LastListened { key: string; partKey: string; meta: Record<string, string | number>; updatedAt: number }
const DEVICE_SPEECH: NarrationCapabilities = { seekSeconds: false, duration: false, timing: "sentence" };

export function createListenEngine(driver: SpeechDriver, store: ListenStore, now: () => number = Date.now, opts: { replayDelaySeconds?: number } = {}) {
  const replayDelay = opts.replayDelaySeconds ?? 3;
  let state: ListenState = {
    status: "idle", content: null, section: 0, partKey: null, chunk: 0, chunkCount: 0, chunks: [],
    rate: 1, voice: null, voices: [], allVoices: [], error: null,
    capabilities: driver.capabilities ?? DEVICE_SPEECH, autoAgain: false, replayed: false, replayCountdown: null, presented: false,
  };
  let content: ListenContent | null = null;
  let chunks: Chunk[] = [];
  let gen = 0;               // current utterance; older callbacks are ignored
  let request = 0;           // current play() request; older async work is dropped
  let spokenFrom = 0;        // offset in the chunk's text this utterance started at
  let boundary: number | null = null; // last word the engine reported, in chunk text
  let override: string | null = null; // explicit voice for this content
  let prefs: Prefs = { rate: 1, voices: {}, autoAgain: false };
  let prefsLoaded: Promise<void> | null = null;
  let voiceCache: DeviceVoice[] = [];
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<ListenState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
  const json = <T,>(s: string | null): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };
  const quiet = (p: Promise<unknown> | void) => { if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => {}); };
  const cancelReplayTimer = () => { if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; } };
  const halt = () => { gen++; cancelReplayTimer(); try { quiet(driver.stop()); } catch { /* engine already idle */ } };
  const savePrefs = () => quiet(store.set(PREFS, JSON.stringify(prefs)));

  function loadPrefs() {
    prefsLoaded ??= store.get(PREFS).then((s) => {
      const p = json<Prefs>(s);
      if (p) prefs = { rate: RATES.includes(p.rate as any) ? p.rate : 1, voices: p.voices && typeof p.voices === "object" ? p.voices : {}, autoAgain: p.autoAgain === true };
      set({ rate: prefs.rate, autoAgain: prefs.autoAgain });
    }).catch(() => {});
    return prefsLoaded;
  }
  async function loadVoices(): Promise<DeviceVoice[]> {
    if (voiceCache.length) return voiceCache;
    try {
      const v = await Promise.race([driver.getVoices(), new Promise<DeviceVoice[]>((r) => setTimeout(() => r([]), 2500))]);
      voiceCache = Array.isArray(v) ? v.filter((x) => x && x.identifier && x.language) : [];
    } catch { voiceCache = []; }
    return voiceCache;
  }

  // ── Position (listening only — never learning progress) ──────────────────
  function savePosition(at: Chunk | undefined) {
    if (!content || !at) return;
    const pos: SavedPosition = { partKey: at.partKey, offset: at.start, updatedAt: now() };
    quiet(store.set(POS + content.key, JSON.stringify(pos)));
    if (content.resumeGroup) {
      const last: LastListened = { key: content.key, partKey: at.partKey, meta: content.meta ?? {}, updatedAt: pos.updatedAt };
      quiet(store.set(LAST + content.resumeGroup, JSON.stringify(last)));
    }
  }
  const clearPosition = (key: string) => quiet(store.remove(POS + key));

  // ── Speaking ──────────────────────────────────────────────────────────────
  function speakFrom(index: number, offset = 0) {
    if (!content || index < 0 || index >= chunks.length || !state.voice || state.voice.kind === "unavailable") return;
    halt();
    const g = gen;
    const c = chunks[index];
    spokenFrom = Math.max(0, Math.min(offset, c.text.length - 1));
    boundary = null;
    const text = c.text.slice(spokenFrom);
    set({ status: "playing", chunk: index, section: c.section, partKey: c.partKey, error: null, replayCountdown: null });
    savePosition(c);
    try {
      driver.speak(text, {
        language: state.voice.language,
        voice: state.voice.voice ?? undefined,
        rate: state.rate,
        onBoundary: (e) => { if (g === gen && typeof e?.charIndex === "number") boundary = spokenFrom + e.charIndex; },
        onDone: () => { if (g === gen) advance(); },
        onError: (e) => { if (g === gen) fail("speech", `Listening stopped: ${e?.message || "the speech engine reported a problem"}.`); },
      });
    } catch (e: any) {
      fail("speech", `Listening couldn't start: ${e?.message || "the speech engine isn't available"}.`);
    }
  }
  function fail(kind: ListenError["kind"], message: string) {
    halt();
    set({ status: "error", error: { kind, message } });
  }
  /** Restart the current content from its beginning (Listen Again / the one automatic replay). */
  function fromTheTop() {
    if (!content) return;
    clearPosition(content.key);
    speakFrom(0);
  }
  function advance() {
    const next = state.chunk + 1;
    if (next < chunks.length) return speakFrom(next);
    halt();
    const finished = content;
    if (finished) clearPosition(finished.key);
    // Auto Listen Again: once per session, after a short visible countdown. Never another item.
    if (finished && prefs.autoAgain && !state.replayed) {
      const g = gen;
      set({ status: "completed", replayCountdown: replayDelay });
      const tick = () => {
        if (g !== gen || content !== finished) return; // stopped, replaced or cancelled
        const left = (state.replayCountdown ?? 0) - 1;
        if (left > 0) { set({ replayCountdown: left }); replayTimer = setTimeout(tick, 1000); return; }
        replayTimer = null;
        set({ replayed: true, replayCountdown: null });
        fromTheTop();
      };
      replayTimer = setTimeout(tick, 1000);
      return;
    }
    set({ status: "completed", replayCountdown: null });
  }

  async function play(c: ListenContent, at: StartAt = "saved", how: { present?: boolean } = {}) {
    const my = ++request;
    halt();
    if (content && (state.status === "playing" || state.status === "paused")) savePosition(chunks[state.chunk]);
    if (!content || content.key !== c.key) override = null;
    content = c;
    // One utterance per sentence; spoken copy prepared for the TEXT's language. The screen is untouched.
    chunks = buildChunks(c.sections, CHUNK_MAX, (t) => prepareSpeech(t, c.language));
    const { sections, ...rest } = c;
    set({
      status: "loading", content: { ...rest, sections, sectionTitles: sections.map((s) => s.title) },
      section: 0, partKey: null, chunk: 0, chunkCount: chunks.length,
      chunks: chunks.map(({ section, part, partKey, start, end }) => ({ section, part, partKey, start, end })),
      error: null, replayed: false, replayCountdown: null, presented: how.present ?? true,
    });
    if (!chunks.length) return set({ status: "error", error: { kind: "empty", message: "There's no text to read aloud here." } });
    await loadPrefs();
    const voices = await loadVoices();
    if (my !== request) return; // replaced while loading
    const choice = chooseVoice(c.language, voices, prefs.voices[baseLanguage(c.language)] ?? null, override);
    set({ voice: choice, voices: voicesFor(c.language, voices), allVoices: voices, rate: prefs.rate, autoAgain: prefs.autoAgain });
    if (choice.kind === "unavailable") {
      return set({ status: "error", error: { kind: "unavailable_language", message: "This phone has no voice for this language. Choose another voice to listen anyway, or keep reading." } });
    }
    let index = 0;
    if (at === "saved") {
      const pos = json<SavedPosition>(await store.get(POS + c.key).catch(() => null));
      if (my !== request) return;
      if (pos?.partKey) index = Math.max(0, chunkIndexFor(chunks, pos.partKey, pos.offset));
    } else if (at !== "start") {
      index = "section" in at ? firstChunkOfSection(chunks, at.section) : chunkIndexFor(chunks, at.partKey, at.offset ?? 0);
      if (index < 0) index = 0;
    }
    speakFrom(index);
  }

  function pause() {
    if (state.status !== "playing") return;
    const c = chunks[state.chunk];
    const resumeAt = c ? resumeOffset(c.text, boundary) : 0;
    halt();
    spokenFrom = resumeAt;
    savePosition(c);
    set({ status: "paused" });
  }
  /** Listen Again: a fresh listening session of the same content (its one automatic replay is available again). */
  function listenAgain() {
    if (!content || !state.voice || state.voice.kind === "unavailable") return;
    set({ replayed: false, replayCountdown: null });
    fromTheTop();
  }
  function resume() {
    if (state.status === "paused") speakFrom(state.chunk, spokenFrom);
    else if (state.status === "completed") listenAgain();
    else if (state.status === "error" && state.error?.kind === "speech") speakFrom(state.chunk, spokenFrom);
  }
  function stop() {
    request++;
    halt();
    if (content && state.status === "playing") savePosition(chunks[state.chunk]);
    content = null; chunks = []; override = null;
    set({ status: "idle", content: null, chunk: 0, chunkCount: 0, chunks: [], partKey: null, error: null, replayCountdown: null, replayed: false, presented: false });
  }
  const restartHere = () => { if (state.status === "playing") { const at = resumeOffset(chunks[state.chunk]?.text ?? "", boundary); speakFrom(state.chunk, at); } };

  return {
    getState: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    play,
    pause,
    resume,
    stop,
    listenAgain,
    toggle() { if (state.status === "playing") pause(); else resume(); },
    /** Stop only if `owner`'s content is the one playing (screen left or unmounted). */
    release(owner: string, how: "pause" | "stop") {
      if (state.content?.owner !== owner) return;
      if (how === "pause") { pause(); cancelReplayTimer(); set({ presented: false, replayCountdown: null }); } else stop();
    },
    /** Open / close the full Read & Listen screen (playback is unaffected). */
    present() { if (state.content) set({ presented: true }); },
    dismiss() { set({ presented: false }); },
    /** Don't play the pending automatic replay. */
    cancelReplay() { cancelReplayTimer(); if (state.replayCountdown != null) set({ replayCountdown: null }); },
    /** Auto Listen Again on/off — remembered; never restarts anything by itself. */
    setAutoAgain(on: boolean) {
      prefs = { ...prefs, autoAgain: !!on };
      savePrefs();
      set({ autoAgain: prefs.autoAgain });
      if (!on) { cancelReplayTimer(); if (state.replayCountdown != null) set({ replayCountdown: null }); }
    },
    nextSection() {
      if (!content) return;
      let target = -1;
      for (let s = state.section + 1; s < content.sections.length && target < 0; s++) target = firstChunkOfSection(chunks, s);
      if (target >= 0) speakFrom(target);
    },
    previousSection() {
      if (!content) return;
      const startOfThis = firstChunkOfSection(chunks, state.section);
      let target = startOfThis;
      if (state.chunk === startOfThis && spokenFrom === 0) {
        for (let s = state.section - 1; s >= 0; s--) { const f = firstChunkOfSection(chunks, s); if (f >= 0) { target = f; break; } }
      }
      speakFrom(Math.max(0, target));
    },
    /** One sentence back / forward (the reliable step for device speech). */
    previousSentence() { if (content && chunks.length) speakFrom(Math.max(0, state.chunk - (spokenFrom === 0 ? 1 : 0))); },
    nextSentence() { if (content && state.chunk + 1 < chunks.length) speakFrom(state.chunk + 1); },
    /** Start from a sentence the listener tapped. */
    seekChunk(index: number) { if (index >= 0 && index < chunks.length) speakFrom(index); },
    /** Jump to a part (a verse, a paragraph) — e.g. "Listen from here". */
    seekPart(partKey: string) {
      const i = chunkIndexFor(chunks, partKey, 0);
      if (i >= 0) speakFrom(i);
    },
    setRate(rate: number) {
      if (!RATES.includes(rate as any)) return;
      prefs = { ...prefs, rate };
      savePrefs();
      set({ rate });
      restartHere();
    },
    /** A voice the person picked. Same language → remembered for that language; another language → only for this content. */
    setVoice(identifier: string) {
      if (!content) return;
      const v = state.allVoices.find((x) => x.identifier === identifier);
      if (!v) return;
      if (baseLanguage(v.language) === baseLanguage(content.language)) {
        prefs = { ...prefs, voices: { ...prefs.voices, [baseLanguage(content.language)]: identifier } };
        savePrefs();
        override = null;
      } else {
        override = identifier;
      }
      const choice = chooseVoice(content.language, state.allVoices, prefs.voices[baseLanguage(content.language)] ?? null, override);
      set({ voice: choice });
      if (state.status === "playing") restartHere();
      else if (state.status === "error" && state.error?.kind === "unavailable_language") speakFrom(state.chunk);
    },
    async savedPosition(key: string): Promise<SavedPosition | null> { return json<SavedPosition>(await store.get(POS + key).catch(() => null)); },
    async lastListened(group: string): Promise<LastListened | null> { return json<LastListened>(await store.get(LAST + group).catch(() => null)); },
  };
}
export type ListenEngine = ReturnType<typeof createListenEngine>;
