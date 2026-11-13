// Translated labels for the Biblical Dictionary's original languages (the language NAMES are interface
// text and follow the person's P2P language; the original-language words themselves are never translated).
import type { TFunction } from "i18next";

export function dictLanguageLabel(t: TFunction, language: string): string {
  if (language === "hebrew") return t("dictionary.hebrew", { defaultValue: "Hebrew" });
  if (language === "aramaic") return t("dictionary.aramaic", { defaultValue: "Aramaic" });
  if (language === "greek") return t("dictionary.greek", { defaultValue: "Greek" });
  return language;
}
