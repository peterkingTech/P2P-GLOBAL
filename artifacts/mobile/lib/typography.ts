// Shared text-layout helpers. Deliberately small: the app's font sizes and
// colours live in each screen's StyleSheet and the theme (constants/themes.ts);
// this file only holds the wrapping/measure rules that every explanatory
// paragraph should share, so they're decided once instead of per screen.

// Comfortable reading measures (dp). Applied as maxWidth, never width, so
// narrow phones still use their full available width and long translations
// are never forced into a fixed English-sized box.
export const READABLE_WIDTH = {
  heading: 360,
  body: 340,
  caption: 320,
} as const;

// Native wrapping that avoids a lone last word: iOS 14+ "push-out" moves a
// word down from the previous line instead of leaving an orphan; Android's
// "balanced" evens out line lengths across the paragraph. Both only change
// where lines break — never the text itself.
export const BALANCED_WRAP = {
  lineBreakStrategyIOS: "push-out",
  textBreakStrategy: "balanced",
} as const;

const NBSP = " ";

// Digits in Latin, Arabic-Indic and Extended (Persian/Urdu) forms.
const D = "[0-9٠-٩۰-۹]";
// A book-name word: any run of non-space, non-digit, non-punctuation
// characters, so it works for every script the app ships (Latin, Cyrillic,
// Arabic, Devanagari, CJK, Ethiopic…) without a per-language book list.
const W = "[^\\s0-9٠-٩۰-۹:;,.!?()\\[\\]\"'“”«»—–-]+";
// [1-3] book prefix ("1 Corinthians", German "2. Timotheus"), the book name
// (optionally "Song of Solomon"-style), then chapter + separator + verse,
// with an optional range. Separators cover ":" and the "," used by German,
// Dutch, Scandinavian and other Bibles.
const REFERENCE = new RegExp(
  `(?:[1-3]\\.?\\s)?${W}(?:\\s(?:of|de|des|du|der|di)\\s${W})?\\s${D}{1,3}[:,.]${D}{1,3}(?:[-–]${D}{1,3}(?:[:,.]${D}{1,3})?)?`,
);

// Keeps each Scripture reference on one line ("2 Timothy 2:2" never splits
// into "2" / "Timothy 2:2"): the spaces *inside* a detected reference become
// non-breaking spaces at render time, and a dash introducing the reference
// stays attached to it. Same string length and same visible characters — the
// stored/translated content is never modified.
export function keepScriptureReferencesTogether(text: string): string {
  // "multiplies — 2 Timothy 2:2": the dash's trailing space is bound too, so
  // the dash never ends a line on its own above the reference.
  return text.replace(
    new RegExp(`([—–] )?(${REFERENCE.source})`, "g"),
    (_m, dash: string | undefined, ref: string) => (dash ? dash.trimEnd() + NBSP : "") + ref.replace(/\s/g, NBSP),
  );
}
