import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);
const supabaseRead  = createClient(SUPABASE_URL, ANON_KEY);

const API_BIBLE_BASE = "https://api.scripture.api.bible/v1";

// ── Book name → USFM code ──────────────────────────────────────────────────────
// Covers full names, common abbreviations, and numbered books

const BOOK_CODES: Record<string, string> = {
  genesis:"GEN",gen:"GEN",gn:"GEN",
  exodus:"EXO",exo:"EXO",ex:"EXO",
  leviticus:"LEV",lev:"LEV",
  numbers:"NUM",num:"NUM",
  deuteronomy:"DEU",deut:"DEU",dt:"DEU",
  joshua:"JOS",jos:"JOS",josh:"JOS",
  judges:"JDG",judg:"JDG",jdg:"JDG",
  ruth:"RUT",rut:"RUT",
  "1 samuel":"1SA","1samuel":"1SA","1sa":"1SA","1sam":"1SA",
  "2 samuel":"2SA","2samuel":"2SA","2sa":"2SA","2sam":"2SA",
  "1 kings":"1KI","1kings":"1KI","1ki":"1KI","1kgs":"1KI",
  "2 kings":"2KI","2kings":"2KI","2ki":"2KI","2kgs":"2KI",
  "1 chronicles":"1CH","1chronicles":"1CH","1ch":"1CH","1chr":"1CH",
  "2 chronicles":"2CH","2chronicles":"2CH","2ch":"2CH","2chr":"2CH",
  ezra:"EZR",ezr:"EZR",
  nehemiah:"NEH",neh:"NEH",
  esther:"EST",est:"EST",esth:"EST",
  job:"JOB",
  psalms:"PSA",psalm:"PSA",ps:"PSA",psa:"PSA",
  proverbs:"PRO",prov:"PRO",pr:"PRO",pro:"PRO",
  ecclesiastes:"ECC",eccl:"ECC",ec:"ECC",qoh:"ECC",
  "song of solomon":"SNG","song of songs":"SNG",song:"SNG",ss:"SNG",sng:"SNG",
  isaiah:"ISA",isa:"ISA",
  jeremiah:"JER",jer:"JER",
  lamentations:"LAM",lam:"LAM",
  ezekiel:"EZK",ezek:"EZK",ez:"EZK",ezk:"EZK",
  daniel:"DAN",dan:"DAN",
  hosea:"HOS",hos:"HOS",
  joel:"JOL",joe:"JOL",jl:"JOL",
  amos:"AMO",am:"AMO",amo:"AMO",
  obadiah:"OBA",oba:"OBA",ob:"OBA",
  jonah:"JON",jon:"JON",
  micah:"MIC",mic:"MIC",
  nahum:"NAM",nah:"NAM",na:"NAM",
  habakkuk:"HAB",hab:"HAB",
  zephaniah:"ZEP",zeph:"ZEP",zep:"ZEP",
  haggai:"HAG",hag:"HAG",
  zechariah:"ZEC",zech:"ZEC",zec:"ZEC",
  malachi:"MAL",mal:"MAL",
  matthew:"MAT",matt:"MAT",mt:"MAT",
  mark:"MRK",mk:"MRK",mr:"MRK",
  luke:"LUK",lk:"LUK",
  john:"JHN",jn:"JHN",
  acts:"ACT",ac:"ACT",
  romans:"ROM",rom:"ROM",
  "1 corinthians":"1CO","1corinthians":"1CO","1cor":"1CO","1co":"1CO",
  "2 corinthians":"2CO","2corinthians":"2CO","2cor":"2CO","2co":"2CO",
  galatians:"GAL",gal:"GAL",
  ephesians:"EPH",eph:"EPH",
  philippians:"PHP",phil:"PHP",php:"PHP",
  colossians:"COL",col:"COL",
  "1 thessalonians":"1TH","1thessalonians":"1TH","1thess":"1TH","1th":"1TH",
  "2 thessalonians":"2TH","2thessalonians":"2TH","2thess":"2TH","2th":"2TH",
  "1 timothy":"1TI","1timothy":"1TI","1tim":"1TI","1ti":"1TI",
  "2 timothy":"2TI","2timothy":"2TI","2tim":"2TI","2ti":"2TI",
  titus:"TIT",tit:"TIT",
  philemon:"PHM",phlm:"PHM",phm:"PHM",
  hebrews:"HEB",heb:"HEB",
  james:"JAS",jas:"JAS",
  "1 peter":"1PE","1peter":"1PE","1pet":"1PE","1pe":"1PE",
  "2 peter":"2PE","2peter":"2PE","2pet":"2PE","2pe":"2PE",
  "1 john":"1JN","1john":"1JN","1jn":"1JN",
  "2 john":"2JN","2john":"2JN","2jn":"2JN",
  "3 john":"3JN","3john":"3JN","3jn":"3JN",
  jude:"JUD",jd:"JUD",jud:"JUD",
  revelation:"REV",rev:"REV",rv:"REV",
};

export interface ParsedRef {
  raw: string;
  bookCode: string;
  book: string;
  chapter: number;
  verse: number;
  verseId: string; // e.g. "JHN.3.16"
}

/** Parse "John 3:16" → { bookCode: "JHN", chapter: 3, verse: 16, ... } */
export function parseVerseRef(raw: string): ParsedRef | null {
  const trimmed = raw.trim();
  // Matches: optional leading digit + space + book words + space + chapter:verse
  const match = trimmed.match(/^(\d\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s+(\d+):(\d+)/);
  if (!match) return null;

  const prefix = (match[1] ?? "").trim(); // "1", "2", "3" etc.
  const bookName = ((prefix ? prefix + " " : "") + match[2]).toLowerCase().trim();
  const chapter  = parseInt(match[3], 10);
  const verse    = parseInt(match[4], 10);
  const bookCode = BOOK_CODES[bookName];
  if (!bookCode) return null;

  return {
    raw: trimmed,
    bookCode,
    book: bookName,
    chapter,
    verse,
    verseId: `${bookCode}.${chapter}.${verse}`,
  };
}

// ── Cache lookup ───────────────────────────────────────────────────────────────

async function getCachedVerse(
  translationCode: string,
  bookCode: string,
  chapter: number,
  verse: number
): Promise<string | null> {
  const { data } = await supabaseRead
    .from("p2p_bible_verses_cache")
    .select("verse_text")
    .eq("translation_code", translationCode)
    .eq("book", bookCode)
    .eq("chapter", chapter)
    .eq("verse", verse)
    .maybeSingle();
  return (data?.verse_text as string) ?? null;
}

async function cacheVerse(
  translationCode: string,
  bookCode: string,
  chapter: number,
  verse: number,
  verseText: string
): Promise<void> {
  await supabaseAdmin
    .from("p2p_bible_verses_cache")
    .upsert(
      { translation_code: translationCode, book: bookCode, chapter, verse, verse_text: verseText, fetched_at: new Date().toISOString() },
      { onConflict: "translation_code,book,chapter,verse" }
    );
}

// ── API.Bible fetch ────────────────────────────────────────────────────────────

async function fetchFromApiBible(
  apiBibleId: string,
  verseId: string
): Promise<string | null> {
  const apiKey = process.env.API_Bible ?? process.env.API_BIBLE_KEY;
  if (!apiKey) {
    console.warn("API_Bible / API_BIBLE_KEY not set — cannot fetch live verse text");
    return null;
  }

  const params = new URLSearchParams({
    "content-type": "text",
    "include-notes": "false",
    "include-titles": "false",
    "include-chapter-numbers": "false",
    "include-verse-numbers": "false",
    "include-verse-spans": "false",
  });

  const url = `${API_BIBLE_BASE}/bibles/${apiBibleId}/verses/${verseId}?${params}`;

  const res = await fetch(url, {
    headers: { "api-key": apiKey },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`API.Bible ${res.status} for ${verseId} in ${apiBibleId}: ${body}`);
    return null;
  }

  const json = await res.json() as { data?: { content?: string } };
  const raw = json.data?.content ?? "";
  // API.Bible sometimes includes leading/trailing whitespace and newlines
  return raw.replace(/\s+/g, " ").trim() || null;
}

// ── Translation lookup ─────────────────────────────────────────────────────────

interface TranslationRow {
  translation_code: string;
  api_bible_id: string | null;
  provider: string;
  is_licensed_confirmed: boolean;
}

async function getDefaultTranslation(languageCode: string): Promise<TranslationRow | null> {
  const { data } = await supabaseRead
    .from("p2p_bible_translations")
    .select("translation_code,api_bible_id,provider,is_licensed_confirmed")
    .eq("language", languageCode)
    .eq("is_default_for_language", true)
    .eq("is_licensed_confirmed", true)
    .maybeSingle();
  return data as TranslationRow | null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface VerseResult {
  text: string;
  translationCode: string;
  language: string;
  fromCache: boolean;
  fallback: boolean;
}

/**
 * Fetch verse text for a reference in the given language.
 * Fallback chain: target language → English KJV → null
 * Never makes an AI call — Bible text comes from licensed providers only.
 */
export async function getVerseText(
  rawRef: string,
  languageCode: string
): Promise<VerseResult | null> {
  const parsed = parseVerseRef(rawRef);
  if (!parsed) return null;

  const { bookCode, chapter, verse } = parsed;

  // Try requested language, then fall back to English
  const langOrder = languageCode !== "en" ? [languageCode, "en"] : ["en"];

  for (const lang of langOrder) {
    const translation = await getDefaultTranslation(lang);
    if (!translation) continue;

    const { translation_code: tCode, api_bible_id: apiBibleId } = translation;
    const isFallback = lang !== languageCode;

    // 1. Cache hit
    const cached = await getCachedVerse(tCode, bookCode, chapter, verse);
    if (cached) {
      return { text: cached, translationCode: tCode, language: lang, fromCache: true, fallback: isFallback };
    }

    // 2. Live fetch
    if (apiBibleId) {
      const live = await fetchFromApiBible(apiBibleId, parsed.verseId);
      if (live) {
        await cacheVerse(tCode, bookCode, chapter, verse, live);
        return { text: live, translationCode: tCode, language: lang, fromCache: false, fallback: isFallback };
      }
    }
  }

  return null;
}

/** Batch fetch for multiple references in a language — cache-first, parallel */
export async function getBatchVerseText(
  refs: Array<{ id: string; ref: string }>,
  languageCode: string
): Promise<Map<string, VerseResult>> {
  const results = new Map<string, VerseResult>();
  await Promise.all(
    refs.map(async ({ id, ref }) => {
      const result = await getVerseText(ref, languageCode);
      if (result) results.set(id, result);
    })
  );
  return results;
}

/** List all available translations for a language */
export async function getAvailableTranslations(languageCode: string): Promise<TranslationRow[]> {
  const { data } = await supabaseRead
    .from("p2p_bible_translations")
    .select("translation_code,api_bible_id,provider,is_licensed_confirmed")
    .eq("language", languageCode);
  return (data ?? []) as TranslationRow[];
}
