// Explore Scripture by Topic — the editorial collection's shared rules (API + validator + tests).
// References only, never Bible text. Book names are the canonical 66-book names used by the P2P Bible reader
// (artifacts/mobile/lib/bibleBooks.ts) with their USFM codes; "Psalm" and "Song of Songs" are accepted aliases.
// A passage stays inside one chapter (the p2p_scripture_references shape: book, chapter, start_verse, end_verse).

export interface CanonBook { name: string; code: string; chapters: number }
export const BOOKS: CanonBook[] = [
  ["Genesis", "GEN", 50], ["Exodus", "EXO", 40], ["Leviticus", "LEV", 27], ["Numbers", "NUM", 36], ["Deuteronomy", "DEU", 34],
  ["Joshua", "JOS", 24], ["Judges", "JDG", 21], ["Ruth", "RUT", 4], ["1 Samuel", "1SA", 31], ["2 Samuel", "2SA", 24],
  ["1 Kings", "1KI", 22], ["2 Kings", "2KI", 25], ["1 Chronicles", "1CH", 29], ["2 Chronicles", "2CH", 36], ["Ezra", "EZR", 10],
  ["Nehemiah", "NEH", 13], ["Esther", "EST", 10], ["Job", "JOB", 42], ["Psalms", "PSA", 150], ["Proverbs", "PRO", 31],
  ["Ecclesiastes", "ECC", 12], ["Song of Solomon", "SNG", 8], ["Isaiah", "ISA", 66], ["Jeremiah", "JER", 52], ["Lamentations", "LAM", 5],
  ["Ezekiel", "EZK", 48], ["Daniel", "DAN", 12], ["Hosea", "HOS", 14], ["Joel", "JOL", 3], ["Amos", "AMO", 9],
  ["Obadiah", "OBA", 1], ["Jonah", "JON", 4], ["Micah", "MIC", 7], ["Nahum", "NAM", 3], ["Habakkuk", "HAB", 3],
  ["Zephaniah", "ZEP", 3], ["Haggai", "HAG", 2], ["Zechariah", "ZEC", 14], ["Malachi", "MAL", 4],
  ["Matthew", "MAT", 28], ["Mark", "MRK", 16], ["Luke", "LUK", 24], ["John", "JHN", 21], ["Acts", "ACT", 28],
  ["Romans", "ROM", 16], ["1 Corinthians", "1CO", 16], ["2 Corinthians", "2CO", 13], ["Galatians", "GAL", 6], ["Ephesians", "EPH", 6],
  ["Philippians", "PHP", 4], ["Colossians", "COL", 4], ["1 Thessalonians", "1TH", 5], ["2 Thessalonians", "2TH", 3], ["1 Timothy", "1TI", 6],
  ["2 Timothy", "2TI", 4], ["Titus", "TIT", 3], ["Philemon", "PHM", 1], ["Hebrews", "HEB", 13], ["James", "JAS", 5],
  ["1 Peter", "1PE", 5], ["2 Peter", "2PE", 3], ["1 John", "1JN", 5], ["2 John", "2JN", 1], ["3 John", "3JN", 1],
  ["Jude", "JUD", 1], ["Revelation", "REV", 22],
].map(([name, code, chapters]) => ({ name: name as string, code: code as string, chapters: chapters as number }));
const ALIASES: Record<string, string> = { psalm: "Psalms", "song of songs": "Song of Solomon" };

export const KINDS = ["teaching", "promise", "prayer", "example", "prophecy", "wisdom", "praise"] as const;
export type PassageKind = (typeof KINDS)[number];

export type ParsedPassage =
  | { ok: true; book: string; code: string; chapter: number; startVerse: number; endVerse: number; title: string; kind: PassageKind; note: string | null; display: string; key: string }
  | { ok: false; reason: string };

/** "Psalm 23:1-6 | The Lord is my shepherd | praise | optional note" → a structured reference. */
export function parsePassage(raw: string): ParsedPassage {
  const [ref = "", title = "", kind = "", note = ""] = String(raw).split("|").map((s) => s.trim());
  const m = /^((?:[1-3]\s)?[A-Za-z][A-Za-z ]*?)\s+(\d+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return { ok: false, reason: `not a single-chapter reference: "${ref}"` };
  const name = m[1].trim();
  const canonical = ALIASES[name.toLowerCase()] ?? name;
  const book = BOOKS.find((b) => b.name.toLowerCase() === canonical.toLowerCase());
  if (!book) return { ok: false, reason: `unknown book "${name}"` };
  const chapter = Number(m[2]), startVerse = Number(m[3]), endVerse = m[4] ? Number(m[4]) : startVerse;
  if (chapter < 1 || chapter > book.chapters) return { ok: false, reason: `${book.name} has ${book.chapters} chapters` };
  if (startVerse < 1 || endVerse < startVerse) return { ok: false, reason: "verse range is reversed or zero" };
  if (!title) return { ok: false, reason: "missing editorial title" };
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, reason: `unknown kind "${kind}"` };
  const shown = book.name === "Psalms" ? "Psalm" : book.name;
  const display = `${shown} ${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ""}`;
  return { ok: true, book: book.name, code: book.code, chapter, startVerse, endVerse, title, kind: kind as PassageKind, note: note || null, display, key: `${book.code}.${chapter}.${startVerse}-${endVerse}` };
}

/** Topic slug from a title, the same way for every topic ("Fear & Anxiety" → "fear-anxiety"). */
export const slugify = (title: string) => title.toLowerCase().replace(/&/g, " ").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Editorial statuses. Only approved and published passages are shown to participants. */
export const EDITORIAL_STATUSES = ["draft", "needs_review", "approved", "published"] as const;
export const VISIBLE_STATUSES = new Set(["approved", "published"]);
/** A passage link is visible unless it carries a non-visible editorial status (rows from before the status existed are published). */
export const isVisibleLink = (link: { editorial_status?: string | null } | null | undefined) => VISIBLE_STATUSES.has(link?.editorial_status ?? "published");
