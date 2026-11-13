// Listen: the ONE shared player behind every "Listen" button (Bible,
// Kingdom Stories, Kingdom School / Core Curriculum, Learning Plans) and the
// P2P Global Read & Listen screen. The phone's own speech voice reads the text
// the screen already shows. The one exception: content with a studio recording
// (`narration`, Kingdom Stories — lib/listen/narration) plays each sentence from
// that recording instead; everything else is still the phone's voice.
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
//    ONCE more after a short, visible countdown — never a loop;
//  • a Scripture PLAYLIST (kind "playlist") is the one exception the listener
//    chose: it plays on from passage to passage, and Repeat (off / this
//    passage / the whole queue) is their explicit setting for that session.
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
import { baseLanguage, chooseVoice, narrationVoices, voicesFor, type DeviceVoice, type VoiceChoice } from "./voices";

export type ListenStatus = "idle" | "loading" | "playing" | "paused" | "completed" | "error";

export interface SpeakOptions {
  language: string; voice?: string; rate: number;
  /** Keep speaking when the app goes to the background (the driver sets up the platform audio session). */
  background?: boolean;
  onStart?: () => void; onDone?: () => void; onStopped?: () => void;
  onError?: (e: Error) => void; onBoundary?: (e: { charIndex: number }) => void;
  /** The chunk exactly as displayed (before speech preparation) — lets a recording find it. */
  source?: string;
  /** The content's recorded narration, when it has one (opaque here; see lib/listen/narration). */
  narration?: unknown;
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
  /** Pause / interrupt the current utterance (the session may continue). */
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
/** "playlist": a Scripture playlist / collection — one section per passage; plays on through them (Repeat applies). */
export type ListenKind = "bible" | "story" | "story-intro" | "lesson" | "plan" | "playlist" | "study";
/** Playlists only: off · the current passage again · the whole queue again. */
export type RepeatMode = "off" | "one" | "all";
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
  /** Where the text lives in the app ("Go to the text" from anywhere). */
  route?: { pathname: string; params?: Record<string, string> } | null;
  /**
   * Bible only: the NEXT chapter of the SAME book (null at the end of a book or
   * for a selected passage). Used only when the listener chose "Continue to
   * next chapter", and only within their reading range.
   */
  continueTo?: { chapter: number; label: string; load: () => Promise<ListenContent | null> } | null;
  /** Remember "last listened" for a group (e.g. "bible"), with screen-specific details. */
  resumeGroup?: string;
  /** Bible: { t, book, chapter, lastChapter } — lastChapter = the book's final chapter. */
  meta?: Record<string, string | number>;
  /** A studio recording of this content (Kingdom Stories); sentences it doesn't contain use the phone's voice. */
  narration?: unknown;
}
/** Bible: what happens when a chapter finishes (separate from Auto Listen Again). */
export type BibleContinue = "stop" | "again" | "next";
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
  /** Seconds until the automatic replay / next chapter starts (null when none is pending). */
  replayCountdown: number | null;
  /** What the countdown leads to: the next chapter's name, or null for a replay. */
  upNext: string | null;
  /** The full Read & Listen screen is open. */
  presented: boolean;
  /** Bible: stop / listen again / continue — and the chapter range continuing stays within. */
  bibleContinue: BibleContinue;
  range: { book: string; end: number } | null;
  /** A voice being previewed (the narration is paused meanwhile). */
  previewing: string | null;
  /** Keep listening when the app goes to the background (where the platform allows). */
  background: boolean;
  /** The Listen screen currently in front (its own bar shows; elsewhere a floating mini player). */
  focusedOwner: string | null;
  /** Playlists: Repeat off / this passage / the whole queue (this listening session only). */
  repeat: RepeatMode;
}

export const RATES = [0.75, 1, 1.25, 1.5] as const;
const POS = "p2p.listen.v1.pos:";
const LAST = "p2p.listen.v1.last:";
const PREFS = "p2p.listen.v1.prefs";
interface Prefs { rate: number; voices: Record<string, string>; autoAgain: boolean; bibleContinue: BibleContinue; background: boolean }
const CONTINUE_MODES: BibleContinue[] = ["stop", "again", "next"];
export interface SavedPosition { partKey: string; offset: number; updatedAt: number }
export interface LastListened { key: string; partKey: string; meta: Record<string, string | number>; updatedAt: number }
const DEVICE_SPEECH: NarrationCapabilities = { seekSeconds: false, duration: false, timing: "sentence" };
/** Previous in a playlist: before this many sentences of a passage, go to the passage before; after, restart it. */
export const PREVIOUS_RESTART_AFTER = 2;

export function createListenEngine(driver: SpeechDriver, store: ListenStore, now: () => number = Date.now, opts: { replayDelaySeconds?: number } = {}) {
  const replayDelay = opts.replayDelaySeconds ?? 3;
  let state: ListenState = {
    status: "idle", content: null, section: 0, partKey: null, chunk: 0, chunkCount: 0, chunks: [],
    rate: 1, voice: null, voices: [], allVoices: [], error: null,
    capabilities: driver.capabilities ?? DEVICE_SPEECH, autoAgain: false, replayed: false, replayCountdown: null, upNext: null, presented: false,
    bibleContinue: "stop", range: null, previewing: null, background: true, focusedOwner: null, repeat: "off",
  };
  let content: ListenContent | null = null;
  let chunks: Chunk[] = [];
  let gen = 0;               // current utterance; older callbacks are ignored
  let request = 0;           // current play() request; older async work is dropped
  let spokenFrom = 0;        // offset in the chunk's text this utterance started at
  let boundary: number | null = null; // last word the engine reported, in chunk text
  let override: string | null = null; // explicit voice for this content
  let prefs: Prefs = { rate: 1, voices: {}, autoAgain: false, bibleContinue: "stop", background: true };
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
      if (p) prefs = {
        rate: RATES.includes(p.rate as any) ? p.rate : 1, voices: p.voices && typeof p.voices === "object" ? p.voices : {}, autoAgain: p.autoAgain === true,
        bibleContinue: CONTINUE_MODES.includes(p.bibleContinue) ? p.bibleContinue : "stop", background: p.background !== false,
      };
      set({ rate: prefs.rate, autoAgain: prefs.autoAgain, bibleContinue: prefs.bibleContinue, background: prefs.background });
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
    set({ status: "playing", chunk: index, section: c.section, partKey: c.partKey, error: null, replayCountdown: null, upNext: null, previewing: null });
    savePosition(c);
    try {
      driver.speak(text, {
        language: state.voice.language,
        voice: state.voice.voice ?? undefined,
        rate: state.rate,
        background: prefs.background,
        source: content.sections[c.section]?.parts[c.part]?.text.slice(c.start, c.end),
        narration: content.narration,
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
  /** Which chunk plays after this one (a playlist on "Repeat this passage" loops within its passage). */
  function nextIndex(i: number): number {
    const here = chunks[i];
    if (content?.kind === "playlist" && state.repeat === "one" && here && chunks[i + 1]?.section !== here.section) return firstChunkOfSection(chunks, here.section);
    return i + 1;
  }
  function advance() {
    const next = nextIndex(state.chunk);
    if (next < chunks.length) return speakFrom(next);
    // A playlist on "Repeat all" starts again from its first passage — the listener's explicit choice.
    if (content?.kind === "playlist" && state.repeat === "all") { clearPosition(content.key); return speakFrom(0); }
    halt();
    const finished = content;
    if (!finished) return;
    clearPosition(finished.key);
    // ONE decision when content ends — never two handlers. The Bible has its own
    // setting (stop / listen again / next chapter within the range, same book
    // only); everything else uses Auto Listen Again. Each automatic step waits
    // through a visible countdown that can be cancelled, and happens at most once
    // per item (a continued chapter is a new item with its own decision).
    if (finished.kind === "bible") {
      const mode = prefs.bibleContinue;
      const nextCh = finished.continueTo;
      const book = String(finished.meta?.book ?? "");
      const here = Number(finished.meta?.chapter);
      const inRange = !!nextCh && !!state.range && state.range.book === book && nextCh.chapter === here + 1 && nextCh.chapter <= state.range.end;
      if (mode === "next" && inRange) return countdown(finished, nextCh!.label, () => continueTo(finished, nextCh!));
      if (mode === "again" && !state.replayed) return countdown(finished, null, () => { set({ replayed: true }); fromTheTop(); });
      return set({ status: "completed", replayCountdown: null, upNext: null });
    }
    if (prefs.autoAgain && !state.replayed) return countdown(finished, null, () => { set({ replayed: true }); fromTheTop(); });
    set({ status: "completed", replayCountdown: null, upNext: null });
  }
  /** A short visible countdown, then `then()` — dropped if anything else happens first. */
  function countdown(finished: ListenContent, upNext: string | null, then: () => void) {
    const g = gen;
    set({ status: "completed", replayCountdown: replayDelay, upNext });
    const tick = () => {
      if (g !== gen || content !== finished) return; // stopped, replaced or cancelled
      const left = (state.replayCountdown ?? 0) - 1;
      if (left > 0) { set({ replayCountdown: left }); replayTimer = setTimeout(tick, 1000); return; }
      replayTimer = null;
      set({ replayCountdown: null, upNext: null });
      then();
    };
    replayTimer = setTimeout(tick, 1000);
  }
  /** Bible "Continue to next chapter": load it (no screen needed) and listen from its start. */
  async function continueTo(finished: ListenContent, nextCh: NonNullable<ListenContent["continueTo"]>) {
    const my = request;
    let next: ListenContent | null = null;
    try { next = await nextCh.load(); } catch { next = null; }
    if (my !== request || content !== finished) return; // the listener did something else meanwhile
    if (!next) return set({ status: "completed", upNext: null, error: null });
    await play(next, "start", { present: state.presented });
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
      error: null, replayed: false, replayCountdown: null, upNext: null, previewing: null, presented: how.present ?? true,
    });
    if (!chunks.length) return set({ status: "error", error: { kind: "empty", message: "There's no text to read aloud here." } });
    await loadPrefs();
    set({ range: rangeFor(c) });
    const voices = await loadVoices();
    if (my !== request) return; // replaced while loading
    const choice = chooseVoice(c.language, voices, prefs.voices[baseLanguage(c.language)] ?? null, override);
    set({ voice: choice, voices: voicesFor(c.language, voices), allVoices: narrationVoices(voices), rate: prefs.rate, autoAgain: prefs.autoAgain });
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

  /**
   * The Bible reading range for this chapter: kept while continuing within the
   * same book; otherwise, when "Continue to next chapter" is on, to the end of
   * this book (the listener can shorten it). Never crosses into another book.
   */
  function rangeFor(c: ListenContent): ListenState["range"] {
    const book = c.kind === "bible" ? String(c.meta?.book ?? "") : "";
    const ch = Number(c.meta?.chapter);
    if (!book || !ch || c.continueTo === undefined) return null;
    const r = state.range;
    if (r && r.book === book && ch <= r.end) return r;
    return prefs.bibleContinue === "next" ? { book, end: Math.max(ch, Number(c.meta?.lastChapter) || ch) } : null;
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
    set({ status: "idle", content: null, chunk: 0, chunkCount: 0, chunks: [], partKey: null, error: null, replayCountdown: null, upNext: null, replayed: false, presented: false, previewing: null, range: null });
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
    cancelReplay() { cancelReplayTimer(); if (state.replayCountdown != null) set({ replayCountdown: null, upNext: null }); },
    /** Auto Listen Again on/off — remembered; never restarts anything by itself. */
    setAutoAgain(on: boolean) {
      prefs = { ...prefs, autoAgain: !!on };
      savePrefs();
      set({ autoAgain: prefs.autoAgain });
      if (!on) { cancelReplayTimer(); if (state.replayCountdown != null) set({ replayCountdown: null }); }
    },
    /**
     * Bible: what happens when a chapter ends — remembered; never restarts or
     * moves what's playing now. Turning "next" on sets the range to the end of
     * this book (unless one is already set); turning it off cancels a pending step.
     */
    setBibleContinue(mode: BibleContinue) {
      if (!CONTINUE_MODES.includes(mode)) return;
      prefs = { ...prefs, bibleContinue: mode };
      savePrefs();
      set({ bibleContinue: mode });
      if (content?.kind === "bible") set({ range: mode === "next" ? (state.range ?? rangeFor(content)) : state.range });
      if (state.replayCountdown != null) { cancelReplayTimer(); set({ replayCountdown: null, upNext: null }); }
    },
    /** Bible: continue up to this chapter of the current book (from this chapter to the book's last). */
    setBibleRange(end: number) {
      if (content?.kind !== "bible") return;
      const book = String(content.meta?.book ?? "");
      const here = Number(content.meta?.chapter), last = Number(content.meta?.lastChapter) || here;
      if (!book || !here) return;
      set({ range: { book, end: Math.min(last, Math.max(here, Math.round(end))) } });
    },
    /** Keep listening in the background (where the platform allows) — remembered. */
    setBackground(on: boolean) {
      prefs = { ...prefs, background: !!on };
      savePrefs();
      set({ background: prefs.background });
    },
    /** Playlists: Repeat off / this passage / the whole queue. Takes effect at the next passage boundary. */
    setRepeat(mode: RepeatMode) { if (mode === "off" || mode === "one" || mode === "all") set({ repeat: mode }); },
    /** Which Listen screen is in front (its own bar shows; elsewhere the floating mini player). */
    setFocusedOwner(owner: string | null) { if (state.focusedOwner !== owner) set({ focusedOwner: owner }); },
    clearFocusedOwner(owner: string) { if (state.focusedOwner === owner) set({ focusedOwner: null }); },
    /**
     * Hear a voice before choosing it: the narration pauses (keeping its place),
     * the current sentence is read in that voice, then the narration carries on
     * if it was playing. Same single speech session — never two at once.
     */
    previewVoice(identifier: string) {
      if (!content) return;
      const v = state.allVoices.find((x) => x.identifier === identifier);
      if (!v) return;
      const wasPlaying = state.status === "playing";
      if (wasPlaying) pause();
      halt();
      const g = gen;
      const sample = (chunks[state.chunk] ?? chunks[0])?.text ?? "";
      if (!sample) return;
      set({ previewing: identifier, replayCountdown: null, upNext: null });
      const end = () => {
        if (g !== gen) return;
        set({ previewing: null });
        if (wasPlaying) speakFrom(state.chunk, spokenFrom);
      };
      try {
        driver.speak(sample.slice(0, 220), { language: v.language, voice: v.identifier, rate: state.rate, background: prefs.background, onDone: end, onError: end });
      } catch { end(); }
    },
    /**
     * One short utterance — e.g. a single original-language word (Deep Study) — through the SAME speech
     * session: a playing narration pauses (keeping its place) and carries on afterwards; never two at once.
     * Spoken only with a device voice FOR THAT LANGUAGE: when there is none it reports "no_voice" (a
     * Hebrew word is never read by an English voice). Resolves with the voice used, so the screen can say
     * exactly what was heard (device voice, language).
     */
    async speakSnippet(text: string, o: { language: string; rate?: number }): Promise<{ result: "spoken" | "no_voice" | "error"; voice?: { name: string; language: string } }> {
      const sample = text.trim();
      if (!sample) return { result: "error" };
      const v = voicesFor(o.language, await loadVoices())[0];
      if (!v) return { result: "no_voice" };
      const wasPlaying = state.status === "playing";
      if (wasPlaying) pause();
      halt();
      const g = gen;
      const voice = { name: v.name, language: v.language };
      return new Promise((resolve) => {
        let settled = false;
        const end = (result: "spoken" | "error") => {
          if (settled) return;
          settled = true;
          if (g === gen && wasPlaying) speakFrom(state.chunk, spokenFrom);
          resolve({ result, voice });
        };
        try {
          driver.speak(sample.slice(0, 400), { language: v.language, voice: v.identifier, rate: o.rate ?? state.rate, background: prefs.background,
            onDone: () => end("spoken"), onStopped: () => end("spoken"), onError: () => end("error") });
        } catch { end("error"); }
      });
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
      // Playlists: within the first couple of sentences of a passage, Previous goes to the passage
      // before; later on it starts this passage again. Elsewhere: only at the very start.
      const goBack = content.kind === "playlist" ? state.chunk - startOfThis < PREVIOUS_RESTART_AFTER : state.chunk === startOfThis && spokenFrom === 0;
      if (goBack) {
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
