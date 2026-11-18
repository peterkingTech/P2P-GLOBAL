// DAILY WORD (owner brief 2026-11-18 §8). Today's entry from the catalogue (constants/dailyVerses: 400
// scriptures, each with a theme and "Today's Instruction"), chosen by the SAME rule Home and the home-screen
// widgets use (lib/widgetSnapshot.verseForDay), so all three always show the same verse.
// Only TODAY's entry is ever offered to the person — there is no list to browse, so each day is a surprise.
// The verse is shown in the PERSON'S OWN translation, fetched live; the stored Berean Standard Bible text
// (public domain) is the fallback offline or before a translation is chosen.
import { DAILY_VERSES, DAILY_VERSE_TRANSLATION, type DailyVerse } from "@/constants/dailyVerses";
import { verseForDay } from "@/lib/widgetSnapshot";
import { readerTarget } from "@/lib/bibleReaderApi";

export interface DailyWord extends DailyVerse {
  /** Book code / chapter / verses for live text and the reader. */
  target: { book: string; chapter: number; v?: number; ve?: number } | null;
}
export const DAILY_WORD_FALLBACK_TRANSLATION = DAILY_VERSE_TRANSLATION;

const withTarget = (v: DailyVerse): DailyWord => ({ ...v, target: readerTarget(v.ref) });
/** Today's entry (same rule as Home and the widgets). */
export function dailyWordFor(day: Date = new Date()): DailyWord | null {
  const v = verseForDay(DAILY_VERSES, day);
  return v ? withTarget(v) : null;
}
/** The entry for a verse already on screen (Home passes its verse), so its instruction matches it. */
export function dailyWordByRef(ref: string): DailyWord | null {
  const v = DAILY_VERSES.find((x) => x.ref === ref);
  return v ? withTarget(v) : null;
}
