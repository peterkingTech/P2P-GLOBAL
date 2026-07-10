import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import pt from "@/locales/pt.json";
import zh from "@/locales/zh.json";
import ar from "@/locales/ar.json";

export const SUPPORTED_LANGUAGES = ["en", "es", "fr", "pt", "zh", "ar"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n.use(initReactI18next).init({
  compatibilityJSON: "v4",
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
    zh: { translation: zh },
    ar: { translation: ar },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
