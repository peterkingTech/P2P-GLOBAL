import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import de from "@/locales/de.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import pt from "@/locales/pt.json";
import zh from "@/locales/zh.json";
import zhTW from "@/locales/zh-TW.json";
import ar from "@/locales/ar.json";
import hi from "@/locales/hi.json";
import sw from "@/locales/sw.json";
import it from "@/locales/it.json";
import nl from "@/locales/nl.json";
import pl from "@/locales/pl.json";
import ro from "@/locales/ro.json";
import el from "@/locales/el.json";
import ru from "@/locales/ru.json";
import uk from "@/locales/uk.json";
import tr from "@/locales/tr.json";
import he from "@/locales/he.json";
import fa from "@/locales/fa.json";
import bn from "@/locales/bn.json";
import ur from "@/locales/ur.json";
import ta from "@/locales/ta.json";
import te from "@/locales/te.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import th from "@/locales/th.json";
import vi from "@/locales/vi.json";
import id from "@/locales/id.json";
import ms from "@/locales/ms.json";
import ha from "@/locales/ha.json";
import yo from "@/locales/yo.json";
import ig from "@/locales/ig.json";
import tl from "@/locales/tl.json";
import zu from "@/locales/zu.json";

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
export const SUPPORTED_LANGUAGES = [
  "en", "de", "es", "fr", "pt", "it", "nl", "pl", "ro", "el",
  "ru", "uk", "tr", "ar", "he", "fa", "hi", "bn", "ur", "ta",
  "te", "zh", "zh-TW", "ja", "ko", "th", "vi", "id", "ms", "sw",
  "ha", "yo", "ig", "tl", "zu",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_DISPLAY: Record<SupportedLanguage, { label: string; native: string; rtl: boolean }> = {
  en: { label: "English", native: "English", rtl: false },
  de: { label: "German", native: "Deutsch", rtl: false },
  es: { label: "Spanish", native: "Español", rtl: false },
  fr: { label: "French", native: "Français", rtl: false },
  pt: { label: "Portuguese", native: "Português", rtl: false },
  it: { label: "Italian", native: "Italiano", rtl: false },
  nl: { label: "Dutch", native: "Nederlands", rtl: false },
  pl: { label: "Polish", native: "Polski", rtl: false },
  ro: { label: "Romanian", native: "Română", rtl: false },
  el: { label: "Greek", native: "Ελληνικά", rtl: false },
  ru: { label: "Russian", native: "Русский", rtl: false },
  uk: { label: "Ukrainian", native: "Українська", rtl: false },
  tr: { label: "Turkish", native: "Türkçe", rtl: false },
  zh: { label: "Chinese (Simplified)", native: "中文(简体)", rtl: false },
  "zh-TW": { label: "Chinese (Traditional)", native: "中文(繁體)", rtl: false },
  ar: { label: "Arabic", native: "العربية", rtl: true },
  he: { label: "Hebrew", native: "עברית", rtl: true },
  fa: { label: "Persian", native: "فارسی", rtl: true },
  hi: { label: "Hindi", native: "हिन्दी", rtl: false },
  bn: { label: "Bengali", native: "বাংলা", rtl: false },
  ur: { label: "Urdu", native: "اردو", rtl: true },
  ta: { label: "Tamil", native: "தமிழ்", rtl: false },
  te: { label: "Telugu", native: "తెలుగు", rtl: false },
  ja: { label: "Japanese", native: "日本語", rtl: false },
  ko: { label: "Korean", native: "한국어", rtl: false },
  th: { label: "Thai", native: "ภาษาไทย", rtl: false },
  vi: { label: "Vietnamese", native: "Tiếng Việt", rtl: false },
  id: { label: "Indonesian", native: "Bahasa Indonesia", rtl: false },
  ms: { label: "Malay", native: "Bahasa Melayu", rtl: false },
  sw: { label: "Swahili", native: "Kiswahili", rtl: false },
  ha: { label: "Hausa", native: "Hausa", rtl: false },
  yo: { label: "Yoruba", native: "Yorùbá", rtl: false },
  ig: { label: "Igbo", native: "Igbo", rtl: false },
  tl: { label: "Filipino", native: "Filipino", rtl: false },
  zu: { label: "Zulu", native: "isiZulu", rtl: false },
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
    de: { translation: de },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
    it: { translation: it },
    nl: { translation: nl },
    pl: { translation: pl },
    ro: { translation: ro },
    el: { translation: el },
    ru: { translation: ru },
    uk: { translation: uk },
    tr: { translation: tr },
    zh: { translation: zh },
    "zh-TW": { translation: zhTW },
    ar: { translation: ar },
    he: { translation: he },
    fa: { translation: fa },
    hi: { translation: hi },
    bn: { translation: bn },
    ur: { translation: ur },
    ta: { translation: ta },
    te: { translation: te },
    ja: { translation: ja },
    ko: { translation: ko },
    th: { translation: th },
    vi: { translation: vi },
    id: { translation: id },
    ms: { translation: ms },
    sw: { translation: sw },
    ha: { translation: ha },
    yo: { translation: yo },
    ig: { translation: ig },
    tl: { translation: tl },
    zu: { translation: zu },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
