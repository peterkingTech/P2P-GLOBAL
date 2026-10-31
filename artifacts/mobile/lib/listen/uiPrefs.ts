// Listen: how the Read & Listen screen looks for this person (this phone):
// the listening mode (Read & Listen first, then whatever they last chose),
// text size, and — in Read Along — whether the current sentence is
// highlighted and followed. Kept on the device (no account data, no
// migration); playback itself lives in the engine and is never touched here.

export type ListenMode = "read-listen" | "audio" | "read-along";
export const LISTEN_MODES: { value: ListenMode; label: string }[] = [
  { value: "read-listen", label: "Read & Listen" },
  { value: "audio", label: "Audio Only" },
  { value: "read-along", label: "Read Along" },
];
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const;

export interface ListenUiPrefs {
  mode: ListenMode;
  textScale: number;
  /** Read Along only: highlight the sentence being read / keep it in view. */
  highlight: boolean;
  autoScroll: boolean;
}
export const DEFAULT_UI: ListenUiPrefs = { mode: "read-listen", textScale: 1, highlight: true, autoScroll: false };
const KEY = "p2p.listen.v1.ui";

export function cleanUi(raw: unknown): ListenUiPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<ListenUiPrefs>;
  return {
    mode: LISTEN_MODES.some((m) => m.value === p.mode) ? (p.mode as ListenMode) : DEFAULT_UI.mode,
    textScale: TEXT_SCALES.includes(p.textScale as any) ? (p.textScale as number) : DEFAULT_UI.textScale,
    highlight: typeof p.highlight === "boolean" ? p.highlight : DEFAULT_UI.highlight,
    autoScroll: typeof p.autoScroll === "boolean" ? p.autoScroll : DEFAULT_UI.autoScroll,
  };
}

export function createUiPrefs(store: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> }) {
  let prefs = DEFAULT_UI;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const ready = store.get(KEY).then((s) => { try { if (s) { prefs = cleanUi(JSON.parse(s)); emit(); } } catch { /* defaults */ } }).catch(() => {});
  return {
    ready,
    get: () => prefs,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    update(patch: Partial<ListenUiPrefs>) {
      prefs = cleanUi({ ...prefs, ...patch });
      store.set(KEY, JSON.stringify(prefs)).catch(() => {});
      emit();
    },
  };
}
