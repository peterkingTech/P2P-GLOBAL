import React from "react";
import { Platform, Text, View, type StyleProp, type TextStyle } from "react-native";
import { languageFlag } from "@/lib/languageRegistry";

// The representative flag of a language (lib/languageRegistry.ts), for language-selection interfaces only.
// Decorative: hidden from screen readers — the language's name beside it is what is announced, so existing
// accessibility labels are unchanged. With no representative flag (e.g. Aramaic) it keeps the same width,
// so names stay aligned, and shows nothing — never an invented flag.
//
// iOS and Android draw flag emoji natively. Windows browsers have no flag glyphs (they show the two
// letters), so on web the flag is drawn with Google's Noto Color Emoji (SIL Open Font License), loaded once.
let webFontRequested = false;
function ensureWebFlagFont() {
  if (webFontRequested || Platform.OS !== "web" || typeof document === "undefined") return;
  webFontRequested = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap";
  // Google serves the font in pieces (unicode ranges); ask for the piece with the flags at once, otherwise the first
  // flags can be drawn with Windows' own emoji font (no flags: two letters) until that piece happens to load.
  link.onload = () => { try { (document as any).fonts?.load?.("20px 'Noto Color Emoji'", "\u{1F1E9}\u{1F1EA}\u{1F1F3}\u{1F1EC}"); } catch {} };
  document.head.appendChild(link);
}
const WEB_FONT = Platform.OS === "web" ? { fontFamily: "'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif" } : null;

export default function LanguageFlag({ language, size = 18, style }: { language: string | null | undefined; size?: number; style?: StyleProp<TextStyle> }) {
  const flag = languageFlag(language);
  ensureWebFlagFont();
  if (!flag) return <View style={{ width: size * 1.25 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  return (
    <Text style={[{ fontSize: size, lineHeight: size * 1.25, width: size * 1.25, textAlign: "center" }, WEB_FONT, style]}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      {flag}
    </Text>
  );
}
