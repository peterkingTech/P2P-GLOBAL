import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BibleChapter, BibleTranslation } from "@/lib/bibleReaderApi";

// Bible Compare: the same chapter in up to four licensed translations at once.
// Only translations the server lists (licensed through API.Bible) can be
// chosen; text is fetched per chapter like normal reading and never stored.
// A translation that lacks a verse or chapter shows that — another
// translation is never substituted. The chosen set is remembered on this
// device only.

export const MAX_TRANSLATIONS = 4;          // the one being read + up to 3 more
const KEY = "p2p.bible.compare.v1";

/** Extra translations to show beside `primary`: licensed, unique, not the primary, at most 3. */
export function sanitizeCompare(primary: string, codes: unknown, licensed: Pick<BibleTranslation, "code">[]): string[] {
  const ok = new Set(licensed.map((t) => t.code));
  const out: string[] = [];
  for (const c of Array.isArray(codes) ? codes : []) {
    if (typeof c === "string" && ok.has(c) && c !== primary && !out.includes(c)) out.push(c);
    if (out.length === MAX_TRANSLATIONS - 1) break;
  }
  return out;
}

export async function loadCompare(): Promise<string[]> {
  try { const v = await AsyncStorage.getItem(KEY); const p = v ? JSON.parse(v) : null; return Array.isArray(p?.codes) ? p.codes : []; }
  catch { return []; }
}
export function saveCompare(codes: string[]) {
  AsyncStorage.setItem(KEY, JSON.stringify({ codes })).catch(() => {});
}

export type PanelState = { status: "loading" } | { status: "ok"; chapter: BibleChapter } | { status: "error"; message: string; httpStatus: number };
export interface CompareRow { verse: number; cells: { code: string; text: string | null; state: PanelState["status"] }[] }

/**
 * One row per verse, one cell per translation, in the order given. A cell is
 * null when that translation has no such verse (or hasn't loaded / failed).
 */
export function alignVerses(order: string[], panels: Record<string, PanelState>): CompareRow[] {
  const verses = new Set<number>();
  for (const code of order) { const p = panels[code]; if (p?.status === "ok") for (const v of p.chapter.verses) verses.add(v.verse); }
  return [...verses].sort((a, b) => a - b).map((verse) => ({
    verse,
    cells: order.map((code) => {
      const p = panels[code];
      const text = p?.status === "ok" ? p.chapter.verses.find((v) => v.verse === verse)?.text.replace(/\n/g, " ") ?? null : null;
      return { code, text, state: p?.status ?? "loading" };
    }),
  }));
}

/** Side by side only when every column gets a comfortable width; otherwise stacked per verse. */
export const MIN_COLUMN = 300;
export function compareColumns(width: number, count: number): number {
  if (count <= 1) return 1;
  return width >= MIN_COLUMN * count ? count : 1;
}
