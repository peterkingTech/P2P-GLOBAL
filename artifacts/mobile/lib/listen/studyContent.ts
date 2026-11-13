// Listen: Deep Study, Commentaries and Study Tools as speakable sections for the shared P2P Listen player.
// Exactly the text the screen shows — nothing summarised, translated or invented. These resources are in
// English (their licences don't cover translation), so they are read in English and the screen says so.
// Each listening ends with the source's attribution, so the credit is heard as well as seen.
//
// Rights: read aloud on the listener's own device by the device's voice; NO audio file is generated,
// stored or shared. Public-domain commentaries, and CC BY / CC BY-SA resources shown unmodified with
// their attribution, allow this. (Generating and caching audio files is a separate decision — see
// lib/listen/originalLanguage.ts audioCacheKey.)
import type { ListenSection } from "./chunking";
import { speakableGreek, speakableHebrew } from "./originalLanguage";

const sentence = (s: string) => { const t = s.trim(); return !t ? "" : /[.!?:;…]$/.test(t) ? t : `${t}.`; };
const credit = (attribution: string | null | undefined, id: string): ListenSection[] =>
  attribution ? [{ id: `${id}:credit`, title: "Source", parts: [{ key: `${id}:credit`, text: `Source: ${attribution}` }] }] : [];

/** One commentary's sections on a passage (and its chapter introduction, when shown), then its credit. */
export function commentarySections(c: {
  id: string; name: string; chapter: number; attribution?: string | null;
  introduction?: string | null; sections: { start: number; end: number | null; paragraphs: string[] }[];
}): ListenSection[] {
  const out: ListenSection[] = [];
  if (c.introduction?.trim()) {
    out.push({ id: `${c.id}:intro`, title: `${c.name}: chapter introduction`, parts: [
      { key: `${c.id}:intro:h`, text: sentence(`${c.name}. Chapter introduction`) },
      ...c.introduction.split(/\n{2,}/).map((p, i) => ({ key: `${c.id}:intro:${i}`, text: p.trim() })).filter((p) => p.text),
    ] });
  }
  for (const s of c.sections) {
    const range = s.end && s.end > s.start ? `${c.chapter}:${s.start} to ${s.end}` : `${c.chapter}:${s.start}`;
    out.push({ id: `${c.id}:${s.start}`, title: `${c.name} — ${range}`, parts: [
      { key: `${c.id}:${s.start}:h`, text: sentence(`${c.name}, on verse ${range}`) },
      ...s.paragraphs.map((p, i) => ({ key: `${c.id}:${s.start}:${i}`, text: p.trim() })).filter((p) => p.text),
    ] });
  }
  return out.length ? [...out, ...credit(c.attribution, c.id)] : [];
}

/** A lexicon entry: Strong's number, then each sense — gloss, part of speech, definition — then the credit. */
export function lexiconSections(e: {
  id: string; languageName: string; attribution?: string | null;
  senses: { id: string; transliteration: string | null; gloss: string | null; partOfSpeech: string | null; definition: string | null }[];
}): ListenSection[] {
  const senses = e.senses.filter((s) => s.gloss || s.definition);
  if (!senses.length) return [];
  const out: ListenSection[] = [{ id: `${e.id}:h`, title: `${e.id}`, parts: [{ key: `${e.id}:h`, text: sentence(`Strong's ${e.id.replace(/^([HG])0*/, "$1 ")}, ${e.languageName}. ${senses.length === 1 ? "One sense" : `${senses.length} senses`}`) }] }];
  senses.forEach((s, n) => out.push({ id: s.id, title: `Sense ${n + 1}`, parts: [
    { key: `${s.id}:g`, text: sentence(`Sense ${n + 1}${s.transliteration ? `, ${s.transliteration}` : ""}${s.gloss ? `: ${s.gloss}` : ""}`) },
    ...(s.partOfSpeech ? [{ key: `${s.id}:p`, text: sentence(`Part of speech: ${s.partOfSpeech}`) }] : []),
    ...(s.definition ? [{ key: `${s.id}:d`, text: s.definition.replace(/\n{2,}/g, "\n").trim() }] : []),
  ] }));
  return [...out, ...credit(e.attribution, e.id)];
}

/** People, places and events in a passage, grouped as on screen. */
export function peopleSections(items: { name: string; kind: "person" | "place" | "event"; verses: number[] }[], chapter: number, attribution?: string | null): ListenSection[] {
  const groups: [string, string][] = [["person", "People"], ["place", "Places"], ["event", "Events"]];
  const out: ListenSection[] = [];
  for (const [k, label] of groups) {
    const list = items.filter((i) => i.kind === k);
    if (!list.length) continue;
    out.push({ id: `pp:${k}`, title: label, parts: [
      { key: `pp:${k}:h`, text: sentence(label) },
      ...list.map((i, n) => ({ key: `pp:${k}:${n}`, text: sentence(`${i.name}, in verse${i.verses.length > 1 ? "s" : ""} ${i.verses.map((v) => `${chapter}:${v}`).join(", ")}`) })),
    ] });
  }
  return out.length ? [...out, ...credit(attribution, "pp")] : [];
}

/** Cross references, verse by verse: the related passages by name (the reference list, not their text). */
export function crossRefSections(verses: { verse: number; references: string[] }[], chapter: number, attribution?: string | null): ListenSection[] {
  const out = verses.filter((v) => v.references.length).map((v) => ({ id: `x:${v.verse}`, title: `${chapter}:${v.verse}`, parts: [
    { key: `x:${v.verse}`, text: sentence(`Verse ${chapter}:${v.verse} is connected with ${v.references.join("; ")}`) },
  ] }));
  return out.length ? [...out, ...credit(attribution, "x")] : [];
}

/**
 * Continuous original-language reading (built, but only offered when ORIGINAL_AUDIO.continuous is on):
 * each verse's words in the original script, joined — Hebrew/Greek only (never Aramaic as Hebrew).
 */
export function originalSections(verses: { verse: number; words: { text: string; language: string }[] }[], chapter: number): { language: "he" | "el" | null; sections: ListenSection[] } {
  const langs = new Set(verses.flatMap((v) => v.words.map((w) => w.language)));
  if (langs.has("aramaic") || langs.size !== 1) return { language: null, sections: [] };
  const lang = [...langs][0];
  if (lang !== "hebrew" && lang !== "greek") return { language: null, sections: [] };
  const prep = lang === "hebrew" ? speakableHebrew : speakableGreek;
  return {
    language: lang === "hebrew" ? "he" : "el",
    sections: verses.filter((v) => v.words.length).map((v) => ({ id: `o:${v.verse}`, title: `${chapter}:${v.verse}`, parts: [{ key: String(v.verse), text: prep(v.words.map((w) => w.text).join(" ")) }] })),
  };
}
