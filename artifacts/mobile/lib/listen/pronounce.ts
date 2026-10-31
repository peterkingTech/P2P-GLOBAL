// Listen: preparing text so the phone's voice says it naturally.
//
// Speech engines read a word in CAPITALS as an acronym and spell it out
// ("LORD" → "L-O-R-D"). This step runs on the SPOKEN copy of each chunk only
// (lib/listen/chunking → buildChunks); the text on screen never changes.
//
// Controlled, language-aware rules — never a blanket "lowercase everything":
//  1. The Bible's small-capitals divine names (LORD, GOD, HERR, SEIGNEUR,
//     SEÑOR…) → the word in normal case, per the content's language.
//  2. Known abbreviations (KJV, NIV, USA, AD, BC…), Roman numerals (II, IV),
//     single letters and anything with digits (P2P, 3D) are left exactly as
//     written, so they keep their spoken form.
//  3. Shouted text — two or more capitalised words together, or a line that
//     is mostly capitals — and single capitalised words that are clearly words
//     (four or more letters with a vowel, or a common short word of that
//     language) → normal case, so they're pronounced as words.
//  4. Scripture references ("John 3:16–18") → "John chapter 3, verses 16 to
//     18" in the languages listed below; English book abbreviations expand
//     ("1 Cor" → "First Corinthians"). Other languages are left as written.
//  5. A few written abbreviations per language ("e.g.", "z. B.") → words.
// Punctuation, sentence ends and numbers are kept, so pauses stay natural.
// No Unicode property escapes (\p{…}) — every engine's regex supports this.

import { BIBLE_BOOKS } from "@/lib/bibleBooks";

const isLetter = (ch: string) => ch.toLowerCase() !== ch.toUpperCase();
const isUpperLetter = (ch: string) => isLetter(ch) && ch === ch.toUpperCase();
const VOWELS = "aeiouyäöüéèêëáàâãíìîïóòôõúùûåæøœаеёиоуыэюяαεηιουωάέήίόύώ";

const base = (language: string) => String(language ?? "").trim().toLowerCase().split(/[-_]/)[0];

/** A word whose letters are all capitals (at least two letters, no lower-case). */
export function isAllCaps(word: string): boolean {
  let letters = 0;
  for (const ch of word) {
    if (!isLetter(ch)) continue;
    if (!isUpperLetter(ch)) return false;
    letters++;
  }
  return letters >= 2;
}

// 1. Small-capitals divine names in printed Bibles, per language (with their forms).
const DIVINE: Record<string, Record<string, string>> = {
  en: { LORD: "Lord", "LORD'S": "Lord's", "LORD’S": "Lord’s", GOD: "God", "GOD'S": "God's", "GOD’S": "God’s", JEHOVAH: "Jehovah", YAHWEH: "Yahweh", JAH: "Jah" },
  de: { HERR: "Herr", HERRN: "Herrn", HERREN: "Herren", GOTT: "Gott", GOTTES: "Gottes", JAHWE: "Jahwe" },
  fr: { SEIGNEUR: "Seigneur", "ÉTERNEL": "Éternel", ETERNEL: "Éternel", DIEU: "Dieu" },
  es: { "SEÑOR": "Señor", DIOS: "Dios", "JEHOVÁ": "Jehová" },
  pt: { SENHOR: "Senhor", DEUS: "Deus", "JEOVÁ": "Jeová" },
  it: { SIGNORE: "Signore", DIO: "Dio" },
  nl: { HEERE: "Heere", HEER: "Heer", HERE: "Here", GOD: "God" },
  sw: { BWANA: "Bwana", MUNGU: "Mungu" },
  id: { TUHAN: "Tuhan", ALLAH: "Allah" },
  tl: { PANGINOON: "Panginoon", DIYOS: "Diyos" },
  ro: { DOMNUL: "Domnul", DUMNEZEU: "Dumnezeu" },
};

// 2. Abbreviations that must keep their letters (spoken as initials).
const KEEP = new Set([
  "KJV", "NKJV", "NIV", "ESV", "NLT", "NASB", "NRSV", "CSB", "HCSB", "AMP", "BSB", "WEB", "ASV", "RSV", "NET", "GNT", "MSG", "LSB", "LUT", "ELB", "SCH",
  "USA", "UK", "UN", "EU", "AD", "BC", "BCE", "CE", "TV", "PDF", "FAQ", "DNA", "NGO", "CEO", "HIV", "AIDS", "COVID", "NT", "OT", "P2P",
]);
// Initials only right after a number ("10 AM"); otherwise words ("I AM THAT I AM").
const AFTER_NUMBER = new Set(["AM", "PM"]);
const ROMAN = /^(I{2,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{1,3}|XIX|XX)$/;

// 3. Common short words (≤ 3 letters) that are emphasised words, not initials.
const SHORT_WORDS: Record<string, string[]> = {
  en: ["NOT", "ALL", "AND", "THE", "YOU", "ONE", "NOW", "WHO", "HIS", "HER", "ARE", "WAS", "HAS", "YES", "NO", "DO", "IS", "IT", "BE", "GO", "SO", "HE", "WE", "ME", "MY", "OF", "TO", "IN", "ON", "OR", "BUT", "FOR", "SIN", "SON", "WAY", "OUR", "OWN", "NEW", "LET", "SEE", "SAY", "MAN", "DAY", "CAN", "MAY", "HIM", "OUT", "WHY", "HOW", "BY", "AN", "AT", "AS", "IF", "UP", "US", "AM", "HIS"],
  de: ["NICHT", "UND", "DER", "DIE", "DAS", "IST", "ER", "SIE", "ES", "WIR", "IHR", "DU", "ICH", "IN", "AN", "AUF", "MIT", "VON", "ZU", "DEN", "DEM", "EIN", "JA", "NUR", "WIE", "WER", "WAS", "SO", "UM"],
  fr: ["NE", "PAS", "ET", "LE", "LA", "LES", "UN", "DE", "DU", "IL", "ELLE", "EST", "QUI", "QUE", "OUI", "NON", "EN", "AU", "SA", "SON", "SES", "TU", "JE"],
  es: ["NO", "Y", "EL", "LA", "LOS", "LAS", "UN", "DE", "DEL", "ES", "QUE", "SU", "SUS", "EN", "AL", "YO", "TU", "SE", "SI", "MI"],
  pt: ["NÃO", "E", "O", "A", "OS", "AS", "UM", "DE", "DO", "DA", "EM", "QUE", "SEU", "SUA", "ELE", "EU", "SIM"],
};

function titleCase(word: string, lang: string) {
  const lower = word.toLocaleLowerCase(lang || undefined);
  const i = [...lower].findIndex((ch) => isLetter(ch));
  if (i < 0) return lower;
  const chars = [...lower];
  chars[i] = chars[i].toLocaleUpperCase(lang || undefined);
  return chars.join("");
}
const hasVowel = (w: string) => [...w.toLowerCase()].some((ch) => VOWELS.includes(ch));
const hasDigit = (w: string) => /[0-9]/.test(w);

/** Split a token into leading punctuation, the word, trailing punctuation. */
function splitToken(tok: string): [string, string, string] {
  const chars = [...tok];
  let a = 0, b = chars.length;
  while (a < b && !isLetter(chars[a]) && !/[0-9]/.test(chars[a])) a++;
  while (b > a && !isLetter(chars[b - 1]) && !/[0-9]/.test(chars[b - 1])) b--;
  return [chars.slice(0, a).join(""), chars.slice(a, b).join(""), chars.slice(b).join("")];
}

/** Rules 1–3: capitals → spoken words, abbreviations kept. */
export function normalizeCapitals(text: string, language: string): string {
  const lang = base(language);
  const divine = DIVINE[lang] ?? {};
  const short = new Set(SHORT_WORDS[lang] ?? []);
  const parts = text.split(/(\s+)/);
  const words = parts.map((p, i) => (i % 2 === 0 ? splitToken(p) : null));
  const caps = words.map((w) => !!w && isAllCaps(w[1]) && !hasDigit(w[1]));
  // A line that is mostly capitals (a heading or shouted sentence).
  const letters = [...text].filter(isLetter);
  const mostlyCaps = letters.length >= 8 && letters.filter(isUpperLetter).length / letters.length > 0.7;
  const neighbourCaps = (i: number) => {
    for (const j of [i - 2, i + 2]) if (caps[j] && !KEEP.has(words[j]![1]) && !divine[words[j]![1]]) return true;
    return false;
  };
  return parts.map((p, i) => {
    const w = words[i];
    if (!w || !caps[i]) return p;
    const [lead, core, trail] = w;
    const afterNumber = i >= 2 && hasDigit(parts[i - 2]);
    // Hyphenated words: each piece on its own ("SELF-CONTROL").
    const fix = (piece: string): string => {
      // French/Italian elision ("L'ÉTERNEL", "DELL'UOMO"): the article stays, the word is fixed.
      const el = (lang === "fr" || lang === "it") ? piece.match(/^(\S{1,4}?['’])(\S{2,})$/) : null;
      if (el) return el[1] + fix(el[2]);
      if (!isAllCaps(piece)) return piece;
      if (divine[piece]) return divine[piece];
      if (AFTER_NUMBER.has(piece) && afterNumber) return piece;
      if (KEEP.has(piece) || ROMAN.test(piece)) return piece;
      const letterCount = [...piece].filter(isLetter).length;
      const wordLike = (letterCount >= 4 && hasVowel(piece)) || short.has(piece);
      if (mostlyCaps || neighbourCaps(i) || wordLike) return titleCase(piece, lang);
      return piece; // short, unknown, no context: most likely initials — keep
    };
    return lead + core.split(/([-–—])/).map((x, k) => (k % 2 ? x : fix(x))).join("") + trail;
  }).join("");
}

// 4. Scripture references.
const REF_WORDS: Record<string, { chapter: string; verse: string; verses: string; to: string; notBefore: string[] }> = {
  en: { chapter: "chapter", verse: "verse", verses: "verses", to: "to", notBefore: ["at", "by", "until", "from", "around", "about"] },
  de: { chapter: "Kapitel", verse: "Vers", verses: "Verse", to: "bis", notBefore: ["um", "bis", "ab", "gegen", "von"] },
  fr: { chapter: "chapitre", verse: "verset", verses: "versets", to: "à", notBefore: ["à", "vers", "de", "dès"] },
  es: { chapter: "capítulo", verse: "versículo", verses: "versículos", to: "al", notBefore: ["a", "las", "desde", "hasta"] },
  pt: { chapter: "capítulo", verse: "versículo", verses: "versículos", to: "a", notBefore: ["às", "as", "até", "desde"] },
  it: { chapter: "capitolo", verse: "versetto", verses: "versetti", to: "a", notBefore: ["alle", "dalle", "fino"] },
  nl: { chapter: "hoofdstuk", verse: "vers", verses: "verzen", to: "tot", notBefore: ["om", "tot", "vanaf"] },
  sw: { chapter: "sura", verse: "mstari", verses: "mistari", to: "hadi", notBefore: ["saa"] },
};
const ORDINAL_EN: Record<string, string> = { "1": "First", "2": "Second", "3": "Third" };
const EN_BOOKS = BIBLE_BOOKS.map((b) => b.name);

/** English book name from a written form ("Gen", "1 Cor", "Psalm") — null if it isn't a book. */
function englishBook(raw: string): string | null {
  const m = raw.trim().replace(/\.$/, "").match(/^([1-3])?\s*([A-Za-z][A-Za-z ]*)$/);
  if (!m) return null;
  const num = m[1] ?? "";
  const name = m[2].toLowerCase().replace(/\s+/g, " ").trim();
  if (name.length < 2) return null;
  const candidates = EN_BOOKS.filter((b) => (num ? b.startsWith(`${num} `) : !/^[1-3] /.test(b)));
  const rest = (b: string) => (num ? b.slice(2) : b).toLowerCase();
  const exact = candidates.find((b) => rest(b) === name) ?? (name === "psalm" ? "Psalm" : null);
  const hit = exact ?? (name.length >= 3 ? candidates.find((b) => rest(b).startsWith(name)) ?? null : null);
  if (!hit) return null;
  // Written in full ("Psalm", "John") → said as written; abbreviated ("Gen", "Cor") → the full name.
  const spoken = exact ? m[2].trim() : (num ? hit.slice(2) : hit);
  return num ? `${ORDINAL_EN[num]} ${spoken}` : spoken;
}

const REF = /((?:[1-3]\.?\s?)?[A-Za-zÀ-ÖØ-öø-ÿ]+\.?)\s+(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/g;

export function speakReferences(text: string, language: string): string {
  const lang = base(language);
  const w = REF_WORDS[lang];
  if (!w) return text;
  return text.replace(REF, (all, book: string, ch: string, v: string, ve: string | undefined, offset: number, whole: string) => {
    const bare = book.replace(/\.$/, "").replace(/^[1-3]\.?\s?/, "");
    let spokenBook: string;
    if (lang === "en") {
      const b = englishBook(book);
      if (!b) return all;
      spokenBook = b;
    } else {
      // Book names aren't known in this language: only a capitalised word,
      // never a time ("um 10:30") or a lower-case word before the numbers.
      if (!isUpperLetter([...bare][0] ?? "") || w.notBefore.includes(bare.toLowerCase())) return all;
      const after = whole.slice(offset + all.length, offset + all.length + 6).trim().toLowerCase();
      if (/^(uhr|h\b|heures?|horas?|ore|uur)/.test(after)) return all;
      spokenBook = book;
    }
    const verses = ve && ve !== v ? `${w.verses} ${v} ${w.to} ${ve}` : `${w.verse} ${v}`;
    return `${spokenBook} ${w.chapter} ${ch}, ${verses}`;
  });
}

// 5. Written abbreviations that engines read badly.
const ABBREVIATIONS: Record<string, [RegExp, string][]> = {
  en: [[/\be\.g\.,?/gi, "for example,"], [/\bi\.e\.,?/gi, "that is,"], [/\betc\./gi, "et cetera."], [/\bvv\.\s?(?=\d)/g, "verses "], [/\bv\.\s?(?=\d)/g, "verse "], [/\bcf\./gi, "compare"]],
  de: [[/\bz\.\s?B\./g, "zum Beispiel"], [/\bd\.\s?h\./g, "das heißt"], [/\busw\./g, "und so weiter."], [/\bvgl\./gi, "vergleiche"]],
  fr: [[/\bp\.\s?ex\./gi, "par exemple"], [/\bc\.-à-d\./gi, "c'est-à-dire"], [/\betc\./gi, "et cetera."]],
  es: [[/\bp\.\s?ej\./gi, "por ejemplo"], [/\betc\./gi, "etcétera."]],
  pt: [[/\bp\.\s?ex\./gi, "por exemplo"], [/\betc\./gi, "et cetera."]],
};

export function expandAbbreviations(text: string, language: string): string {
  let out = text;
  for (const [re, word] of ABBREVIATIONS[base(language)] ?? []) out = out.replace(re, word);
  return out;
}

/**
 * The spoken form of one chunk of displayed text, for the content's language.
 * Pure: the displayed text is passed in and never modified.
 */
export function prepareSpeech(text: string, language: string): string {
  if (!text) return text;
  return speakReferences(expandAbbreviations(normalizeCapitals(text, language), language), language).replace(/\s+/g, " ").trim();
}
