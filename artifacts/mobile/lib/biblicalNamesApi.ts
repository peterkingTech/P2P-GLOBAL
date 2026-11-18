// Client for Biblical Names, Titles and Descriptions (api-server lib/biblicalNames.ts, routes /study-workspace/names).
// Verified data only: Scripture wording checked in BSB/KJV/ASV/WEB/YLT, lexicon data from STEPBible, Easton links.
// "note" / "interp" are DRAFT P2P study notes awaiting editor review — the screen says so.
import { apiRequest } from "@/lib/apiClient";
import { cached } from "@/lib/offline";

export type NamePerson = "father" | "son" | "spirit" | "god";
export type NameKind = "name" | "title" | "description" | "metaphor" | "attribute" | "form" | "devotional" | "worship";
export type NameSection = "father" | "son" | "spirit" | "god" | "attributes" | "devotional" | "original" | "history";
export interface NameRef { book: string; chapter: number; start: number; end: number; display: string; testament: "OT" | "NT"; connected?: boolean; person?: NamePerson | null; matched?: string[]; text?: string }
export interface NameSummary {
  id: string; name: string; kind: NameKind; persons: NamePerson[]; sections: NameSection[];
  original: { lemma: string; transliteration: string; language: string; strongs: string }[];
  primary: NameRef | null; testaments: ("OT" | "NT")[]; languages: string[]; status: "verified" | "needs_verification" | "no_scripture_wording"; interpretive: boolean;
}
export interface NameEntryFull extends Omit<NameSummary, "original" | "primary"> {
  also: string[];
  primary: (NameRef & { texts: Record<string, string> }) | null;
  refs: NameRef[];
  original: { strongs: string; lemma: string; transliteration: string; gloss: string; language: string; uses: number; inPrimary: boolean; occurrences: number }[];
  aramaicWord: { source: string; quote: string } | null;
  easton: { id: string; title: string } | null; eastonExcerpt: string | null;
  note: string | null; interp: string | null; noteLabel: string; issues: string[];
  related: (NameSummary & { why: "sameWord" | "sameArticle" | "sameVerse" | "sameName" })[];
  sources: { bible: { label: string; name: string; licence: string }[] };
}
export interface NamesCollection {
  section: NameSection | null; title: string; total: number; sectionTotal: number; entries: NameSummary[];
  facets: { person: { key: NamePerson; count: number }[]; language: { key: string; count: number }[]; testament: { key: "OT" | "NT"; count: number }[]; kind: { key: NameKind; count: number }[]; interpretive: number };
  sections: { key: NameSection; title: string; count: number }[];
  about: { builtAt: string; coverage: string; notesStatus: string; counts: Record<string, unknown>; sources: { bible: { label: string; name: string; licence: string }[]; easton: { name: string; licence: string } } };
}
/** What the study search returns about names (api-server namesForSearch). */
export interface NamesForSearch {
  matches: NameSummary[];
  collection: { section: NameSection; sections: NameSection[]; title: string; total: number; preview: NameSummary[]; devotional: number } | null;
  openCollection: boolean;
}

export type NamesFilter = { section?: NameSection | null; person?: NamePerson | null; language?: string | null; testament?: "OT" | "NT" | null; kind?: NameKind | null; interpretive?: boolean; q?: string; sort?: "canon" | "language" | "category" | "alpha" };
export const getNamesCollection = (f: NamesFilter) => {
  const qs = Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v === true ? "1" : String(v))}`).join("&");
  return cached(`names:col:${qs}`, () => apiRequest<NamesCollection>(`/study-workspace/names${qs ? `?${qs}` : ""}`, {}, { fallbackError: "Couldn't load the names." }));
};
export const getNameEntry = (id: string) =>
  cached(`names:entry:${id}`, () => apiRequest<{ entry: NameEntryFull }>(`/study-workspace/names/${encodeURIComponent(id)}`, {}, { fallbackError: "Couldn't open this entry." }));

export const KIND_LABEL: Record<NameKind, string> = { name: "Name in Scripture", title: "Title in Scripture", description: "Description from Scripture", metaphor: "Biblical image",
  attribute: "Attribute", form: "Language form / rendering", devotional: "Devotional expression (based on Scripture)", worship: "Later worship expression" };
export const PERSON_LABEL: Record<NamePerson, string> = { father: "God the Father", son: "Jesus Christ", spirit: "Holy Spirit", god: "God (persons not distinguished)" };
export const LANGUAGE_LABEL: Record<string, string> = { hebrew: "Hebrew", aramaic: "Aramaic", greek: "Greek" };
