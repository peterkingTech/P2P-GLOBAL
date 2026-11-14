// Bible version & language selection (owner request 2026-11-09): shared logic for the Bible Versions and
// Bible Languages screens. Everything comes from the translations the server actually licenses for P2P
// Global (getTranslations) — no hard-coded lists or counts. "Audio" means RECORDED audio the provider
// supplies AND the licence permits (server: canPlayRecordedAudio → recordedAudio); the phone's read-aloud
// is not counted. Pure apart from the tiny hand-off store at the end.
import type { BibleTranslation } from "@/lib/bibleReaderApi";
import { getLanguageName } from "@/lib/languageNames";
import { LANGUAGE_DISPLAY } from "@/lib/i18n";
import { languageEntry, languageMatches } from "@/lib/languageRegistry";

export interface BibleLanguage {
  code: string;
  /** The language's own name (Deutsch, Español) where known, else its English name. */
  native: string;
  /** English name, shown under the native one when they differ. */
  english: string | null;
  count: number;
  /** At least one of its translations has licensed recorded audio. */
  audio: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** English name of a language: the app's own list, else the server's name, else the code. */
function englishName(code: string, serverName: string | null | undefined): string {
  const known = (LANGUAGE_DISPLAY as Record<string, { label: string } | undefined>)[code]?.label;
  if (known) return known;
  if (code === "en") return "English";
  const reg = languageEntry(code)?.english;
  if (reg) return reg;
  const g = getLanguageName(code);
  return g && g !== code ? g : serverName || code;
}
/** Native name: the app's own list, else the platform's (Intl.DisplayNames), else null. */
function nativeName(code: string): string | null {
  const known = (LANGUAGE_DISPLAY as Record<string, { native: string } | undefined>)[code]?.native ?? languageEntry(code)?.native;
  if (known) return known;
  try {
    const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string | undefined } }).DisplayNames;
    const n = DN ? new DN([code], { type: "language" }).of(code) : undefined;
    return n && n.toLowerCase() !== code.toLowerCase() ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : null;
  } catch { return null; }
}

/** Every language that has at least one licensed translation, alphabetical by its displayed name. */
export function bibleLanguages(list: BibleTranslation[]): BibleLanguage[] {
  const by = new Map<string, BibleTranslation[]>();
  for (const t of list) by.set(t.language, [...(by.get(t.language) ?? []), t]);
  return [...by.entries()].map(([code, ts]) => {
    const english = englishName(code, ts.find((t) => t.languageName)?.languageName);
    const native = nativeName(code) ?? english;
    return { code, native, english: norm(native) === norm(english) ? null : english, count: ts.length, audio: ts.some((t) => t.recordedAudio === true) };
  }).sort((a, b) => a.native.localeCompare(b.native));
}

/**
 * Suggested languages: only ones with translations, from what this person is actually using —
 * the translation being read, their content language, their app language — then English.
 */
export function suggestedLanguages(langs: BibleLanguage[], prefs: { current?: string | null; contentLanguage?: string | null; appLanguage?: string | null }): BibleLanguage[] {
  const want = [prefs.current, prefs.contentLanguage, prefs.appLanguage, "en"].map((c) => (c ?? "").toLowerCase().split(/[-_]/)[0]).filter(Boolean);
  const out: BibleLanguage[] = [];
  for (const c of want) {
    const l = langs.find((x) => x.code === c);
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** Search over native and English names, the code, and the language registry's other codes and names
 *  (e.g. "Farsi", "Tagalog", "deu") — one result per language, never a duplicate. */
export function filterLanguages(langs: BibleLanguage[], query: string): BibleLanguage[] {
  const q = norm(query.trim());
  return q ? langs.filter((l) => [l.native, l.english ?? "", l.code].some((x) => norm(x).includes(q)) || languageMatches(l.code, query)) : langs;
}

/** First letter used for the A–Z index (accents folded, non-Latin scripts under "#"). */
export const indexLetter = (name: string) => { const c = norm(name).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };

/** Translations grouped by language (the one being read first), filtered by search, language and audio. */
export function versionSections(list: BibleTranslation[], opts: { query?: string; language?: string | null; audioOnly?: boolean; current?: string | null }): { language: BibleLanguage; translations: BibleTranslation[] }[] {
  const langs = new Map(bibleLanguages(list).map((l) => [l.code, l]));
  const q = norm((opts.query ?? "").trim());
  const matches = list.filter((t) => (!opts.language || t.language === opts.language)
    && (!opts.audioOnly || t.recordedAudio === true)
    && (!q || [t.name, t.abbreviation ?? "", t.code, langs.get(t.language)?.native ?? "", langs.get(t.language)?.english ?? "", t.language].some((x) => norm(x).includes(q)) || languageMatches(t.language, opts.query ?? "")));
  const by = new Map<string, BibleTranslation[]>();
  for (const t of matches) by.set(t.language, [...(by.get(t.language) ?? []), t]);
  const currentLang = list.find((t) => t.code === opts.current)?.language;
  return [...by.entries()]
    .map(([code, ts]) => ({ language: { ...langs.get(code)!, count: ts.length }, translations: [...ts].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.language.code === currentLang ? -1 : b.language.code === currentLang ? 1 : a.language.native.localeCompare(b.language.native)));
}

// ── Hand-off between the pickers and the reader ─────────────────────────────
// The reader applies a chosen translation when it is in front again (after Back), so the choice
// never lands while another screen or sheet is still closing over it.
let pendingTranslation: string | null = null;
let chosenLanguage: string | null = null;
export const chooseTranslation = (code: string) => { pendingTranslation = code; };
export const takeChosenTranslation = (): string | null => { const c = pendingTranslation; pendingTranslation = null; return c; };
export const setVersionLanguage = (code: string | null) => { chosenLanguage = code; };
export const versionLanguage = () => chosenLanguage;
