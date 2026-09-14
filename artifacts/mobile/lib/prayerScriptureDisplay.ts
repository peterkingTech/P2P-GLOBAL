import { fetchPassage, listBibleTranslations } from "@/lib/bibleClient";
import type { ScriptureReference } from "@/lib/prayerTopicsApi";

// "Pray the Word" (Stage 2) — resolves the actual verse TEXT for a
// structured p2p_scripture_references row via the EXISTING, licensed
// /bible/passage endpoint (bibleService.ts) — this file never stores or
// hardcodes Bible text itself, only requests it on demand.
//
// A reference's own translation_code is used when set; otherwise the
// language's confirmed default is resolved via GET /bible/translations.
// Today every seeded language has exactly one is_licensed_confirmed
// translation, so translations[0] is a safe, correct choice — if a
// language ever gains a second confirmed translation, this should be
// revisited to explicitly prefer is_default_for_language (bibleService.ts
// already tracks that flag; this endpoint just doesn't expose it today).
const translationCodeCache = new Map<string, string>();

async function resolveDefaultTranslationCode(lang: string): Promise<string> {
  if (translationCodeCache.has(lang)) return translationCodeCache.get(lang)!;
  const translations = await listBibleTranslations(lang);
  const code = translations[0]?.translation_code ?? (lang === "en" ? "KJV" : "KJV");
  translationCodeCache.set(lang, code);
  return code;
}

export interface ResolvedScriptureText {
  text: string;
  translationCode: string;
  translationName: string;
}

export async function getScriptureText(scripture: ScriptureReference, lang: string = "en"): Promise<ResolvedScriptureText | null> {
  const translationCode = scripture.translationCode ?? (await resolveDefaultTranslationCode(lang));
  const passage = await fetchPassage(scripture.book, scripture.chapter, scripture.startVerse, scripture.endVerse, translationCode);
  if (!passage || passage.verses.length === 0) return null;
  const text = passage.verses.map((v) => v.text).join(" ");
  return { text, translationCode: passage.translationCode, translationName: passage.translationName };
}
