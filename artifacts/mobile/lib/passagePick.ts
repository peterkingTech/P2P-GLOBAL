// P2P PLANS — "Add Scripture" through the EXISTING Bible reader (brief §9). The builder opens the reader with
// `pick=plan`; the person chooses a book, chapter and verses there exactly as they read; "Add to plan" hands
// back a reference (never text) and returns to the builder, which collects it here. One pending pick at a time.
import type { Passage } from "@/lib/studyPlansApi";

let pending: Passage | null = null;
const listeners = new Set<(p: Passage) => void>();

/** Called by the Bible reader when the person confirms a passage. */
export function deliverPick(p: Passage) {
  pending = { book: p.book, chapter: p.chapter, ...(p.startVerse ? { startVerse: p.startVerse, endVerse: p.endVerse ?? p.startVerse } : {}) };
  for (const l of listeners) l(pending);
}
/** The builder takes the passage once (so returning to the builder twice never adds it twice). */
export function takePick(): Passage | null { const p = pending; pending = null; return p; }
export function onPick(l: (p: Passage) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
/** The reader route that opens in passage-choosing mode (at an existing passage when editing one). */
export function pickRoute(at?: Passage | null) {
  return { pathname: "/bible", params: { pick: "plan", ...(at ? { book: at.book, chapter: String(at.chapter), ...(at.startVerse ? { v: String(at.startVerse), ve: String(at.endVerse ?? at.startVerse) } : {}) } : {}) } };
}
