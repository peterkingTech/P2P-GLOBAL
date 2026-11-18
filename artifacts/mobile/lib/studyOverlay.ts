// STUDY-WIDE HIGHLIGHTING IN THE BIBLE (owner brief 2026-11-18 §6). While someone studies a subject (My Plan),
// they can choose to SEE that study's highlights in the normal Bible reader — temporarily. Nothing is written
// into their Bible highlights (that stays a separate, deliberate "Save as my highlights"), the reader shows a
// banner naming the study, and "Hide" turns it off. Off by default; kept on this phone only (lib/offline kv).
import { useEffect, useState } from "react";
import { kvGet, kvSet } from "@/lib/offline";

export interface StudyOverlay {
  title: string;
  studyId: string | null;
  passages: { book: string; chapter: number; startVerse: number; endVerse: number; area?: string | null; group?: string }[];
}
const KEY = "study:overlay";
const subs = new Set<(o: StudyOverlay | null) => void>();
let current: StudyOverlay | null | undefined;

export async function getStudyOverlay(): Promise<StudyOverlay | null> {
  if (current === undefined) current = (await kvGet<StudyOverlay>(KEY)) ?? null;
  return current;
}
export async function setStudyOverlay(o: StudyOverlay | null) {
  current = o;
  await kvSet(KEY, o);
  for (const f of subs) f(o);
}
export function useStudyOverlay(): StudyOverlay | null {
  const [o, setO] = useState<StudyOverlay | null>(current ?? null);
  useEffect(() => { subs.add(setO); void getStudyOverlay().then(setO); return () => { subs.delete(setO); }; }, []);
  return o;
}
/** Verses of this chapter that the study marks, with their area (if the person gave one). */
export function overlayVerses(o: StudyOverlay | null, book: string, chapter: number): Map<number, string | null> {
  const m = new Map<number, string | null>();
  if (!o) return m;
  for (const p of o.passages) if (p.book === book && p.chapter === chapter) for (let v = p.startVerse; v <= p.endVerse; v++) m.set(v, p.area ?? null);
  return m;
}
