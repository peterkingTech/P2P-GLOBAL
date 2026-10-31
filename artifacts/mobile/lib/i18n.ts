import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";

// Multilingual Expansion Stage 2 — reconciliation. Display metadata (native
// name, RTL) lives here alongside the resource map itself so the two can
// never drift again the way the old separate `app/settings/language.tsx`
// LANGUAGES array did (that array silently omitted hi/sw, which already
// had real resources here, and offered es/fr/pt/zh with no way for the
// Settings screen to know they're only ~10% translated). Full completion
// percentages are Stage 4's job (a repeatable audit tool, not a hardcoded
// number here) — this file only records what actually has a resource.
//
// 39-language expansion (Prompt 1/2, approved list — see chat record):
// all 35 of the 39 canonical codes that have BOTH a p2p_languages row AND
// a locale file are wired in here (migration 158 added zu's row). Still
// explicitly NOT included, not silently substituted for:
//   - am, cs, mr, pcm: have a p2p_languages row but no locale file —
//     translation generation is blocked on Anthropic account credit
//     (external, non-code blocker, confirmed live-tested twice this
//     session). Documented as pending, not worked around by fabricating
//     content here.
// Five more locale files exist on disk (af, da, no, pa, sv) that were
// never part of either of this project's two source specs — left
// un-imported, not deleted, pending an explicit decision on whether to
// formally adopt them.
//
// tw (Twi/Akan, migration 159): registered as a genuine 40th language at
// explicit request, beyond the earlier 39-language target. Its resource
// (locales/tw.json) is deliberately an empty {} — real registration, zero
// fabricated translation content. Every UI string falls back to English
// via fallbackLng below until actual Twi translation work happens; do not
// treat its presence here as claiming any translation exists.
export const SUPPORTED_LANGUAGES = [
  "en", "de", "es", "fr", "pt", "it", "nl", "pl", "ro", "el",
  "ru", "uk", "tr", "ar", "he", "fa", "hi", "bn", "ur", "ta",
  "te", "zh", "zh-TW", "ja", "ko", "th", "vi", "id", "ms", "sw",
  "ha", "yo", "ig", "tl", "zu", "tw",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// `flag` values are copied verbatim from the live p2p_languages.flag_emoji
// column (fetched 2026-09-21) so this stays the one place onboarding and
// Settings can both source a language's flag from, instead of each
// maintaining its own copy.
export const LANGUAGE_DISPLAY: Record<SupportedLanguage, { label: string; native: string; rtl: boolean; flag: string }> = {
  en: { label: "English", native: "English", rtl: false, flag: "🇺🇸" },
  de: { label: "German", native: "Deutsch", rtl: false, flag: "🇩🇪" },
  es: { label: "Spanish", native: "Español", rtl: false, flag: "🇪🇸" },
  fr: { label: "French", native: "Français", rtl: false, flag: "🇫🇷" },
  pt: { label: "Portuguese", native: "Português", rtl: false, flag: "🇧🇷" },
  it: { label: "Italian", native: "Italiano", rtl: false, flag: "🇮🇹" },
  nl: { label: "Dutch", native: "Nederlands", rtl: false, flag: "🇳🇱" },
  pl: { label: "Polish", native: "Polski", rtl: false, flag: "🇵🇱" },
  ro: { label: "Romanian", native: "Română", rtl: false, flag: "🇷🇴" },
  el: { label: "Greek", native: "Ελληνικά", rtl: false, flag: "🇬🇷" },
  ru: { label: "Russian", native: "Русский", rtl: false, flag: "🇷🇺" },
  uk: { label: "Ukrainian", native: "Українська", rtl: false, flag: "🇺🇦" },
  tr: { label: "Turkish", native: "Türkçe", rtl: false, flag: "🇹🇷" },
  zh: { label: "Chinese (Simplified)", native: "中文(简体)", rtl: false, flag: "🇨🇳" },
  "zh-TW": { label: "Chinese (Traditional)", native: "中文(繁體)", rtl: false, flag: "🇹🇼" },
  ar: { label: "Arabic", native: "العربية", rtl: true, flag: "🇸🇦" },
  he: { label: "Hebrew", native: "עברית", rtl: true, flag: "🇮🇱" },
  fa: { label: "Persian", native: "فارسی", rtl: true, flag: "🇮🇷" },
  hi: { label: "Hindi", native: "हिन्दी", rtl: false, flag: "🇮🇳" },
  bn: { label: "Bengali", native: "বাংলা", rtl: false, flag: "🇧🇩" },
  ur: { label: "Urdu", native: "اردو", rtl: true, flag: "🇵🇰" },
  ta: { label: "Tamil", native: "தமிழ்", rtl: false, flag: "🇮🇳" },
  te: { label: "Telugu", native: "తెలుగు", rtl: false, flag: "🇮🇳" },
  ja: { label: "Japanese", native: "日本語", rtl: false, flag: "🇯🇵" },
  ko: { label: "Korean", native: "한국어", rtl: false, flag: "🇰🇷" },
  th: { label: "Thai", native: "ภาษาไทย", rtl: false, flag: "🇹🇭" },
  vi: { label: "Vietnamese", native: "Tiếng Việt", rtl: false, flag: "🇻🇳" },
  id: { label: "Indonesian", native: "Bahasa Indonesia", rtl: false, flag: "🇮🇩" },
  ms: { label: "Malay", native: "Bahasa Melayu", rtl: false, flag: "🇲🇾" },
  sw: { label: "Swahili", native: "Kiswahili", rtl: false, flag: "🇰🇪" },
  ha: { label: "Hausa", native: "Hausa", rtl: false, flag: "🇳🇬" },
  yo: { label: "Yoruba", native: "Yorùbá", rtl: false, flag: "🇳🇬" },
  ig: { label: "Igbo", native: "Igbo", rtl: false, flag: "🇳🇬" },
  tl: { label: "Filipino", native: "Filipino", rtl: false, flag: "🇵🇭" },
  zu: { label: "Zulu", native: "isiZulu", rtl: false, flag: "🇿🇦" },
  tw: { label: "Twi (Akan)", native: "Twi", rtl: false, flag: "🇬🇭" },
};

// Multilingual Expansion Stage 3 — Bible Study Language is a SEPARATE
// availability list from App Language (SUPPORTED_LANGUAGES above). It is
// NOT UI-translation-driven — a user's ability to study Scripture in a
// language has nothing to do with whether the app's own menus are
// translated. It also isn't curriculum-draft-driven: p2p_content_translations
// has unreviewed AI drafts for 15 languages, but that's not the same as a
// verified Bible source. This list is generated from the one table that
// actually records a licensed, confirmed Bible translation:
// p2p_bible_translations.is_licensed_confirmed (verified live 2026-09-21 —
// exactly these 8 languages have a confirmed row with a real api_bible_id;
// notably zh/zh-TW do NOT, despite having a full UI translation). Keeping
// this list scoped to confirmed sources means the picker can never offer a
// language with no real Scripture behind it — simpler and safer than
// building an "unavailable translation" banner across every content
// screen right now.
export const BIBLE_STUDY_LANGUAGES = ["en", "de", "es", "fr", "pt", "ar", "hi", "sw"] as const;
export type BibleStudyLanguage = (typeof BIBLE_STUDY_LANGUAGES)[number];

i18n.use(initReactI18next).init({
  compatibilityJSON: "v4",
  resources: {
    en: { translation: en },
  },
  partialBundledLanguages: true,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// Every other language is loaded only when someone uses it (it used to be: all
// 36 files — about 1.2 MB — parsed at every launch). English stays built in as
// the fallback, so text is never missing while a language arrives.
const LOADERS: Record<string, () => Promise<any>> = {
  de: () => import("@/locales/de.json"),
  es: () => import("@/locales/es.json"),
  fr: () => import("@/locales/fr.json"),
  pt: () => import("@/locales/pt.json"),
  it: () => import("@/locales/it.json"),
  nl: () => import("@/locales/nl.json"),
  pl: () => import("@/locales/pl.json"),
  ro: () => import("@/locales/ro.json"),
  el: () => import("@/locales/el.json"),
  ru: () => import("@/locales/ru.json"),
  uk: () => import("@/locales/uk.json"),
  tr: () => import("@/locales/tr.json"),
  zh: () => import("@/locales/zh.json"),
  "zh-TW": () => import("@/locales/zh-TW.json"),
  ar: () => import("@/locales/ar.json"),
  he: () => import("@/locales/he.json"),
  fa: () => import("@/locales/fa.json"),
  hi: () => import("@/locales/hi.json"),
  bn: () => import("@/locales/bn.json"),
  ur: () => import("@/locales/ur.json"),
  ta: () => import("@/locales/ta.json"),
  te: () => import("@/locales/te.json"),
  ja: () => import("@/locales/ja.json"),
  ko: () => import("@/locales/ko.json"),
  th: () => import("@/locales/th.json"),
  vi: () => import("@/locales/vi.json"),
  id: () => import("@/locales/id.json"),
  ms: () => import("@/locales/ms.json"),
  sw: () => import("@/locales/sw.json"),
  ha: () => import("@/locales/ha.json"),
  yo: () => import("@/locales/yo.json"),
  ig: () => import("@/locales/ig.json"),
  tl: () => import("@/locales/tl.json"),
  zu: () => import("@/locales/zu.json"),
  tw: () => import("@/locales/tw.json"),
};
const loading = new Map<string, Promise<boolean>>();

/** Load a language's strings (once). Resolves false for a language without a file. */
export function loadLocale(lng: string | null | undefined): Promise<boolean> {
  const code = String(lng ?? "");
  if (!code || code === "en" || i18n.hasResourceBundle(code, "translation")) return Promise.resolve(true);
  const load = LOADERS[code];
  if (!load) return Promise.resolve(false);
  let p = loading.get(code);
  if (!p) {
    p = load()
      .then((m) => { i18n.addResourceBundle(code, "translation", m?.default ?? m, true, true); return true; })
      .catch(() => { loading.delete(code); return false; });
    loading.set(code, p);
  }
  return p;
}

/** Switch the app's language, loading it first (so nothing flashes untranslated keys). */
export async function setAppLanguage(lng: string) {
  await loadLocale(lng);
  return i18n.changeLanguage(lng);
}

export default i18n;
