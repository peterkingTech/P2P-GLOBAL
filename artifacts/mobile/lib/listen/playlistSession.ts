// Scripture playlist listening — the queue around the ONE shared player
// (lib/listen). Not a second player: it decides the ORDER of passages
// (playlist order, a shuffled order, "Play next" / "Add to queue"), hands the
// player that content, and keeps track of what was listened to:
//   • shuffle changes only this session's order — the saved playlist never changes;
//   • repeat (off / this passage / everything) is the player's own setting;
//   • history: one entry per passage, finished only when the passage was heard
//     to its end; no entry per progress tick;
//   • resume: where I am, my order, shuffle / repeat / speed — saved on the
//     server when the passage changes, when I pause, and at most every 30 s;
//   • nothing ever starts by itself after the app restarts — the Library
//     offers "Continue listening" and the listener taps it;
//   • passages that couldn't be loaded are listed (with Try again), never
//     skipped silently.
import { useSyncExternalStore } from "react";
import { listen, type ListenState } from "@/lib/listen";
import type { RepeatMode } from "@/lib/listen/engine";
import { loadLocale } from "@/lib/i18n";
import { getTranslations, type NewRef } from "@/lib/bibleReaderApi";
import { createCollection, getCollection } from "@/lib/scriptureCollectionsApi";
import { getResume, historyCompleted, historyStarted, saveResume, type ListenSource } from "@/lib/scriptureLibraryApi";
import { applyQueueOp, shuffleOrder, type QueueOp } from "@/lib/libraryRules";
import { entryOf, playlistContent, type PlaylistMeta, type QueueEntry } from "./collectionContent";

export interface SessionState {
  meta: PlaylistMeta | null;
  /** Every passage in the session, by key (playlist order). */
  entries: QueueEntry[];
  /** The listening order (keys). */
  order: string[];
  shuffle: boolean;
  /** Passages that couldn't be loaded this time. */
  unavailable: QueueEntry[];
  busy: boolean;
}
let session: SessionState = { meta: null, entries: [], order: [], shuffle: false, unavailable: [], busy: false };
const listeners = new Set<() => void>();
const set = (p: Partial<SessionState>) => { session = { ...session, ...p }; listeners.forEach((l) => l()); };
export const getSession = () => session;
export function usePlaylistSession(): SessionState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getSession, getSession);
}

let translations: Promise<Map<string, string>> | null = null;
const languageOf = async (code: string) => {
  translations ??= getTranslations().then((r) => new Map(r.translations.map((t) => [t.code, t.language]))).catch(() => { translations = null; return new Map<string, string>(); });
  return (await translations).get(code) ?? "en";
};
const contentKey = (meta: PlaylistMeta | null) => (meta?.id ? `collection:${meta.id}` : null);
const isMine = (st: ListenState) => !!session.meta && st.content?.owner === "scripture-collection" && (!session.meta.id || st.content.key === contentKey(session.meta));

/** (Re)start the player on the session's current order, at a passage / place. */
async function start(at: { partKey?: string | null; key?: string | null }) {
  const byKey = new Map(session.entries.map((e) => [e.key, e]));
  const ordered = session.order.map((k) => byKey.get(k)).filter((e): e is QueueEntry => !!e);
  if (!ordered.length || !session.meta) return;
  set({ busy: true });
  try {
    const language = await languageOf(ordered[0].ref.translationCode);
    const [{ content, unavailable }] = await Promise.all([playlistContent(session.meta, ordered, language), loadLocale(language)]);
    set({ unavailable });
    const startAt = at.partKey && content.sections.some((s) => s.parts.some((p) => p.key === at.partKey)) ? { partKey: at.partKey }
      : at.key && content.sections.some((s) => s.id === at.key) ? { section: content.sections.findIndex((s) => s.id === at.key) } : "start" as const;
    await listen.play(content, startAt, { present: listen.getState().presented || !at.partKey });
  } finally { set({ busy: false }); }
}

/** Play a list of passages as a playlist session (the one entry point). */
export async function playEntries(meta: PlaylistMeta, entries: QueueEntry[], o: { startKey?: string | null; shuffle?: boolean; repeat?: RepeatMode; order?: string[]; partKey?: string | null; source?: ListenSource } = {}) {
  recorder.flush();
  const keys = entries.map((e) => e.key);
  // A saved order (resume) is used when it still matches the playlist; new passages go at the end.
  const saved = (o.order ?? []).filter((k) => keys.includes(k));
  const order = saved.length ? [...saved, ...keys.filter((k) => !saved.includes(k))] : o.shuffle ? shuffleOrder(keys, o.startKey ?? null) : keys;
  set({ meta, entries, order, shuffle: !!o.shuffle, unavailable: [] });
  recorder.source = o.source ?? (meta.kind === "queue" ? "library" : meta.kind);
  if (o.repeat) listen.setRepeat(o.repeat);
  await start({ key: o.startKey ?? null, partKey: o.partKey ?? null });
}

/** Play a saved playlist / collection from the server (Play / Shuffle buttons). */
export async function playSavedCollection(id: string, o: { shuffle?: boolean; startKey?: string | null } = {}) {
  const d = await getCollection(id);
  if (!d.items.length) throw new Error("There are no passages here yet.");
  await playEntries({ id: d.id, title: d.title, kind: d.kind }, d.items.map(entryOf), { shuffle: o.shuffle, startKey: o.startKey ?? null });
}

/** Continue where I stopped (my own tap from the Library). */
export async function resumePlaylist(id: string) {
  const [d, r] = await Promise.all([getCollection(id), getResume(id).catch(() => ({ state: null }))]);
  if (!d.items.length) throw new Error("There are no passages here yet.");
  const s = r.state;
  if (s?.rate && s.rate !== listen.getState().rate) listen.setRate(s.rate);
  await playEntries({ id: d.id, title: d.title, kind: d.kind }, d.items.map(entryOf), {
    order: s?.queue, shuffle: s?.shuffle, repeat: s?.repeat ?? "off", startKey: s?.itemId ?? null, partKey: s?.partKey ?? null,
  });
}

/** Play passages that aren't a saved playlist (search results, a memorisation list…). */
export async function playRefs(title: string, refs: { ref: NewRef; reference: string }[], source: ListenSource = "library") {
  const entries = refs.map((r, i) => ({ key: `q${i}-${r.ref.bookCode}${r.ref.chapter}.${r.ref.startVerse}-${r.ref.endVerse}`, itemId: null, ref: r.ref, reference: r.reference }));
  await playEntries({ id: null, title, kind: "queue" }, entries, { source });
}

// ── Controls ────────────────────────────────────────────────────────────────
const currentKey = () => { const st = listen.getState(); return isMine(st) ? st.content?.sections[st.section]?.id ?? null : null; };

/** Shuffle on/off for this session: the passage playing carries on; the saved order never changes. */
export async function setShuffle(on: boolean) {
  if (!session.meta) return;
  const here = currentKey(), partKey = listen.getState().partKey;
  const keys = session.entries.map((e) => e.key);
  set({ shuffle: on, order: on ? shuffleOrder(keys, here) : keys });
  await start({ key: here, partKey });
  recorder.saveSoon(true);
}
export function setRepeat(mode: RepeatMode) { listen.setRepeat(mode); recorder.saveSoon(true); }
export const cycleRepeat = () => setRepeat(({ off: "all", all: "one", one: "off" } as const)[listen.getState().repeat]);

/** Queue changes (Play next / Add to queue / Remove / Move / Clear) — this session only. */
export async function changeQueue(o: QueueOp, entry?: QueueEntry) {
  if (!session.meta) return;
  const here = currentKey(), partKey = listen.getState().partKey;
  const entries = entry && !session.entries.some((e) => e.key === entry.key) ? [...session.entries, entry] : session.entries;
  const order = applyQueueOp(session.order, o.op === "playNext" ? { ...o, after: o.after ?? here } : o);
  if (o.op === "remove" && o.id === here) {
    // Removing what's playing moves on to the next passage.
    const next = order[session.order.indexOf(here)] ?? order[0];
    set({ entries, order });
    if (!order.length) return listen.stop();
    return start({ key: next ?? null });
  }
  set({ entries, order });
  if (!order.length) return listen.stop();
  await start({ key: here, partKey });
}
/** Keep this listening order as a new playlist of my own. */
export async function saveQueueAsPlaylist(title: string) {
  const byKey = new Map(session.entries.map((e) => [e.key, e]));
  const refs = session.order.map((k) => byKey.get(k)?.ref).filter((r): r is NewRef => !!r);
  return createCollection("playlist", title, refs);
}
/** Try the passages that couldn't be loaded again. */
export async function retryUnavailable() { await start({ key: currentKey(), partKey: listen.getState().partKey }); }

// ── History and resume (subscribes to the player; writes are few and small) ─
const recorder = {
  source: "playlist" as ListenSource,
  cur: null as null | { key: string; historyId: Promise<string | null>; playingSince: number | null; seconds: number; reachedEnd: boolean },
  lastSave: 0,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  /** Close the current passage's history entry (completed only if heard to its end). */
  flush() {
    const c = this.cur;
    if (!c) return;
    if (c.playingSince) { c.seconds += (Date.now() - c.playingSince) / 1000; c.playingSince = null; }
    if (c.reachedEnd) void c.historyId.then((id) => { if (id) historyCompleted(id, Math.round(c.seconds)).catch(() => {}); });
    this.cur = null;
  },
  saveSoon(now = false) {
    const id = session.meta?.id;
    if (!id) return;
    const go = () => {
      this.saveTimer = null; this.lastSave = Date.now();
      const st = listen.getState();
      const key = currentKey();
      const entry = session.entries.find((e) => e.key === key);
      void saveResume(id, { itemId: entry?.itemId ?? null, partKey: st.partKey, offset: 0, queue: session.order.filter((k) => session.entries.find((e) => e.key === k)?.itemId), shuffle: session.shuffle, repeat: st.repeat, rate: st.rate }).catch(() => {});
    };
    if (now || Date.now() - this.lastSave > 30_000) { if (this.saveTimer) clearTimeout(this.saveTimer); go(); }
    else if (!this.saveTimer) this.saveTimer = setTimeout(go, 30_000 - (Date.now() - this.lastSave));
  },
  onState(st: ListenState) {
    if (!isMine(st)) { if (this.cur) this.flush(); return; }
    const key = st.content?.sections[st.section]?.id ?? null;
    const playing = st.status === "playing";
    if (this.cur && this.cur.key !== key) { this.flush(); this.saveSoon(true); }
    if (!this.cur && key && playing) {
      const entry = session.entries.find((e) => e.key === key);
      this.cur = {
        key, playingSince: Date.now(), seconds: 0, reachedEnd: false,
        historyId: entry ? historyStarted(entry.ref, { collectionId: session.meta?.id ?? undefined, itemId: entry.itemId ?? undefined, source: this.source }).then((r) => r.id).catch(() => null) : Promise.resolve(null),
      };
    }
    const c = this.cur;
    if (!c) return;
    if (playing && !c.playingSince) c.playingSince = Date.now();
    if (!playing && c.playingSince) { c.seconds += (Date.now() - c.playingSince) / 1000; c.playingSince = null; this.saveSoon(true); }
    // Heard to its end: the last sentence of this passage has started (or the whole session completed).
    const lastOfSection = st.chunks.reduce((m, ch, i) => (ch.section === st.section ? i : m), -1);
    if ((playing && st.chunk === lastOfSection) || st.status === "completed") c.reachedEnd = true;
    if (st.status === "completed" || st.status === "idle") this.flush();
    if (playing) this.saveSoon();
  },
};
listen.subscribe(() => recorder.onState(listen.getState()));
