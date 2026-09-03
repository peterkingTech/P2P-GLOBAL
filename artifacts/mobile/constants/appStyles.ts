import { ThemeName, AppColors, THEMES } from "./themes";
import { lighten, darken, withAlpha } from "../lib/colorUtils";

// ── The approved design-token list (App Style spec §31) ─────────────────────
// Every non-Original style is defined purely in these tokens; deriveLegacyColors
// below maps them onto the existing AppColors fields so all 51 screens already
// using useTheme() work with any style, unchanged.
export interface StyleTokens {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  surface: string;
  surfaceSecondary: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  divider: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  navigation: string;
  navigationActive: string;
  input: string;
  focusRing: string;
}

export type AppStyleCategory = "original" | "fruits" | "nature" | "p2p_global" | "seasonal";

interface AppStyleBase {
  id: string;
  name: string;
  emoji: string;
  category: AppStyleCategory;
  description: string;
  personality: string;
  /** Also surfaced under the Seasonal section even though its primary category is elsewhere (Spring lives in Nature and Seasonal both, per spec). */
  alsoInSeasonal?: boolean;
  isSeasonal?: boolean;
  /** Emoji used for the Balanced/Expressive decorative accent (empty states, splash, onboarding). */
  illustrationAccent: string;
}

export interface OriginalAppStyle extends AppStyleBase {
  category: "original";
  isExisting: true;
  legacyThemeName: ThemeName;
}

export interface PairedAppStyle extends AppStyleBase {
  isExisting?: false;
  light: StyleTokens;
  dark: StyleTokens;
}

export type AppStyle = OriginalAppStyle | PairedAppStyle;

// ── Shared semantic colors ───────────────────────────────────────────────────
// Success/warning/error/info stay consistent across every style — these are
// safety-relevant signals (e.g. crisis/verification states), not personality.
const SEMANTIC = { success: "#1D9E75", warning: "#BA7517", error: "#C0392B", info: "#1D6FA8" };

// The "Upper Room" (prayer) sub-experience is deliberately a fixed warm,
// candlelit palette across every existing theme today — preserved exactly,
// reused by every new style rather than reinvented per-style.
export const UPPER_ROOM = {
  light: { bg: "#100B06", card: "#140D07", border: "#3A2C14", amber: "#E0A441", amberLight: "#EFB659", cream: "#F4ECD8", muted: "#C9B48A" },
  dark: { bg: "#030608", card: "#080D0A", border: "#1A3020", amber: "#D4922A", amberLight: "#E8A835", cream: "#EDE8DE", muted: "#4E7A62" },
};

interface StyleSeed {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  secondary: string;
  bgLight: string;
  bgDark: string;
}

function buildTokens(seed: StyleSeed, mode: "light" | "dark"): StyleTokens {
  const isDark = mode === "dark";
  const background = isDark ? seed.bgDark : seed.bgLight;
  const surface = isDark ? lighten(background, 0.05) : darken(background, 0.035);
  const surfaceSecondary = isDark ? lighten(background, 0.09) : darken(background, 0.065);
  const cardForeground = isDark ? lighten(background, 0.86) : darken(seed.primary, 0.7);
  // Deliberately conservative — WCAG AA (4.5:1) is verified for real via
  // scripts/checkStyleContrast.ts, not eyeballed.
  const mutedForeground = isDark ? lighten(background, 0.5) : lighten(cardForeground, 0.22);
  const border = isDark ? lighten(background, 0.14) : darken(background, 0.1);
  const divider = isDark ? lighten(background, 0.1) : darken(background, 0.07);
  const navigation = darken(seed.primary, isDark ? 0.72 : 0.55);

  return {
    // Every existing screen renders primary/accent buttons with hardcoded
    // white text (not a themed foreground token), so primary/accent must
    // themselves be dark enough for white text to clear AA contrast in
    // both modes — hence the small, fixed dark-mode brightening rather
    // than a larger one that would fail that check.
    primary: isDark ? lighten(seed.primary, 0.04) : seed.primary,
    primaryForeground: seed.primaryForeground,
    secondary: isDark ? darken(seed.secondary, 0.55) : lighten(seed.secondary, 0.55),
    secondaryForeground: cardForeground,
    accent: isDark ? lighten(seed.accent, 0.04) : seed.accent,
    accentForeground: seed.accentForeground,
    background,
    surface,
    surfaceSecondary,
    card: surface,
    cardForeground,
    muted: surfaceSecondary,
    mutedForeground,
    border,
    divider,
    ...SEMANTIC,
    navigation,
    navigationActive: isDark ? lighten(seed.accent, 0.1) : seed.accent,
    input: surface,
    focusRing: seed.accent,
  };
}

function paired(
  base: Omit<AppStyleBase, "category"> & { category: PairedAppStyle["category"] },
  seed: StyleSeed
): PairedAppStyle {
  return { ...base, light: buildTokens(seed, "light"), dark: buildTokens(seed, "dark") };
}

// ── ORIGINAL — the 4 existing P2P Global themes, unchanged ─────────────────
// These keep their exact current single-palette behavior (see
// contexts/ThemeContext.tsx's resolveAppStyleColors) rather than being
// forced into a light/dark pair — "do not change their existing behavior
// unnecessarily."
const ORIGINAL_STYLES: OriginalAppStyle[] = [
  { id: "original-light", name: "Light", emoji: "☀️", category: "original", isExisting: true, legacyThemeName: "light", description: "The classic P2P Global look.", personality: "Warm and familiar.", illustrationAccent: "☀️" },
  { id: "original-dark", name: "Dark", emoji: "🌙", category: "original", isExisting: true, legacyThemeName: "dark", description: "The classic P2P Global look, after dark.", personality: "Warm and familiar.", illustrationAccent: "🌙" },
  { id: "original-sepia", name: "Sepia", emoji: "📜", category: "original", isExisting: true, legacyThemeName: "sepia", description: "A warm, paper-like reading tone.", personality: "Gentle and timeless.", illustrationAccent: "📜" },
  { id: "original-midnight", name: "Midnight", emoji: "🌌", category: "original", isExisting: true, legacyThemeName: "midnight", description: "A cool, deep-blue night mode.", personality: "Calm and focused.", illustrationAccent: "🌌" },
];

// ── FRUITS ────────────────────────────────────────────────────────────────
const FRUIT_STYLES: PairedAppStyle[] = [
  paired(
    { id: "orange", name: "Orange", emoji: "🍊", category: "fruits", description: "Warm, energetic and welcoming.", personality: "Warm · Energetic · Welcoming", illustrationAccent: "🍊" },
    { primary: "#B05410", primaryForeground: "#FFFFFF", accent: "#F2A33D", accentForeground: "#3A1E05", secondary: "#F7C948", bgLight: "#FDF3E7", bgDark: "#170F07" }
  ),
  paired(
    { id: "apple", name: "Apple", emoji: "🍎", category: "fruits", description: "Fresh, clean and balanced.", personality: "Fresh · Clean · Balanced", illustrationAccent: "🍎" },
    { primary: "#C8402E", primaryForeground: "#FFFFFF", accent: "#5FA35A", accentForeground: "#FFFFFF", secondary: "#8FC98A", bgLight: "#FBF6EF", bgDark: "#130E0B" }
  ),
  paired(
    { id: "banana", name: "Banana", emoji: "🍌", category: "fruits", description: "Bright, friendly and cheerful.", personality: "Bright · Friendly · Cheerful", illustrationAccent: "🍌" },
    { primary: "#8A6900", primaryForeground: "#FFFFFF", accent: "#F2C94C", accentForeground: "#3A2E05", secondary: "#F7E1A0", bgLight: "#FDF8E9", bgDark: "#161305" }
  ),
  paired(
    { id: "grape", name: "Grape", emoji: "🍇", category: "fruits", description: "Calm, rich and elegant.", personality: "Calm · Rich · Elegant", illustrationAccent: "🍇" },
    { primary: "#6A3D9A", primaryForeground: "#FFFFFF", accent: "#9B7BC7", accentForeground: "#FFFFFF", secondary: "#D9C8EC", bgLight: "#F7F2FB", bgDark: "#120B18" }
  ),
  paired(
    { id: "strawberry", name: "Strawberry", emoji: "🍓", category: "fruits", description: "Friendly, vibrant and warm.", personality: "Friendly · Vibrant · Warm", illustrationAccent: "🍓" },
    { primary: "#CA3054", primaryForeground: "#FFFFFF", accent: "#F08CA0", accentForeground: "#3A0F18", secondary: "#8FC98A", bgLight: "#FDF1EF", bgDark: "#180B0D" }
  ),
  paired(
    { id: "watermelon", name: "Watermelon", emoji: "🍉", category: "fruits", description: "Fresh, fun and summer-like.", personality: "Fresh · Fun · Summer-like", illustrationAccent: "🍉" },
    { primary: "#2C7A3A", primaryForeground: "#FFFFFF", accent: "#E8555B", accentForeground: "#FFFFFF", secondary: "#B7E0AE", bgLight: "#F3FAF0", bgDark: "#0C140C" }
  ),
  paired(
    { id: "mango", name: "Mango", emoji: "🥭", category: "fruits", description: "Warm, tropical and positive.", personality: "Warm · Tropical · Positive", illustrationAccent: "🥭" },
    { primary: "#946317", primaryForeground: "#3A2205", accent: "#3EA07A", accentForeground: "#FFFFFF", secondary: "#F7D08A", bgLight: "#FDF6E9", bgDark: "#171106" }
  ),
  paired(
    { id: "pineapple", name: "Pineapple", emoji: "🍍", category: "fruits", description: "Bright, distinctive and tropical.", personality: "Bright · Distinctive · Tropical", illustrationAccent: "🍍" },
    { primary: "#8A6A10", primaryForeground: "#FFFFFF", accent: "#3A7D44", accentForeground: "#FFFFFF", secondary: "#EBD98A", bgLight: "#FBF7E6", bgDark: "#141205" }
  ),
];

// ── NATURE ────────────────────────────────────────────────────────────────
const NATURE_STYLES: PairedAppStyle[] = [
  paired(
    { id: "forest", name: "Forest", emoji: "🌿", category: "nature", description: "Peaceful, natural and calm.", personality: "Peaceful · Natural · Calm", illustrationAccent: "🌿" },
    { primary: "#2F6E3E", primaryForeground: "#FFFFFF", accent: "#6FA26C", accentForeground: "#FFFFFF", secondary: "#B9CDAE", bgLight: "#F5F7EF", bgDark: "#0B120C" }
  ),
  paired(
    { id: "ocean", name: "Ocean", emoji: "🌊", category: "nature", description: "Calm, fresh and open.", personality: "Calm · Fresh · Open", illustrationAccent: "🌊" },
    { primary: "#1E6E8C", primaryForeground: "#FFFFFF", accent: "#3FB6C4", accentForeground: "#052024", secondary: "#BFE6EA", bgLight: "#EFF7F8", bgDark: "#081419" }
  ),
  paired(
    { id: "sunset", name: "Sunset", emoji: "🌅", category: "nature", description: "Tasteful warmth, used sparingly.", personality: "Warm · Reflective · Tasteful", illustrationAccent: "🌅" },
    { primary: "#B14A28", primaryForeground: "#FFFFFF", accent: "#C25B8C", accentForeground: "#FFFFFF", secondary: "#F0C6A8", bgLight: "#FCF1E9", bgDark: "#160D10" }
  ),
  paired(
    { id: "spring", name: "Spring", emoji: "🌸", category: "nature", alsoInSeasonal: true, description: "Fresh, hopeful and light.", personality: "Fresh · Hopeful · Light", illustrationAccent: "🌸" },
    { primary: "#AB5168", primaryForeground: "#FFFFFF", accent: "#6FB37A", accentForeground: "#FFFFFF", secondary: "#BEE0EE", bgLight: "#FBF4F6", bgDark: "#150F12" }
  ),
];

// ── P2P GLOBAL ────────────────────────────────────────────────────────────
const P2P_GLOBAL_STYLES: PairedAppStyle[] = [
  paired(
    { id: "global", name: "Global", emoji: "🌍", category: "p2p_global", description: "Professional, connected, worldwide.", personality: "Professional · Connected · Global", illustrationAccent: "🌍" },
    { primary: "#1D6FA8", primaryForeground: "#FFFFFF", accent: "#1D9E75", accentForeground: "#FFFFFF", secondary: "#CFE3EF", bgLight: "#F3F8FB", bgDark: "#08121A" }
  ),
  paired(
    { id: "kingdom", name: "Kingdom", emoji: "🙏", category: "p2p_global", description: "Hope, purpose, light and faith.", personality: "Hope · Purpose · Light · Faith", illustrationAccent: "🙏" },
    { primary: "#2C3E6B", primaryForeground: "#FFFFFF", accent: "#C79A3C", accentForeground: "#2A1E05", secondary: "#D9C9A3", bgLight: "#F7F4EC", bgDark: "#0A0E1A" }
  ),
  paired(
    { id: "kingdom-school", name: "Kingdom School", emoji: "📖", category: "p2p_global", description: "Learning, growth and wisdom.", personality: "Learning · Growth · Wisdom · Study", illustrationAccent: "📖" },
    { primary: "#1D4E7A", primaryForeground: "#FFFFFF", accent: "#C79A3C", accentForeground: "#2A1E05", secondary: "#E8DDC4", bgLight: "#FAF6EC", bgDark: "#0A0F16" }
  ),
];

// ── SEASONAL — Spring is shared with Nature (see alsoInSeasonal above) ─────
const SEASONAL_STYLES: PairedAppStyle[] = [
  paired(
    { id: "summer", name: "Summer", emoji: "☀️", category: "seasonal", isSeasonal: true, description: "Fresh and bright.", personality: "Fresh · Bright · Warm", illustrationAccent: "☀️" },
    { primary: "#8A6900", primaryForeground: "#FFFFFF", accent: "#3FB6C4", accentForeground: "#052024", secondary: "#BFE6EA", bgLight: "#FCFAEC", bgDark: "#141405" }
  ),
  paired(
    { id: "autumn", name: "Autumn", emoji: "🍂", category: "seasonal", isSeasonal: true, description: "Warm and calm.", personality: "Warm · Calm · Grounded", illustrationAccent: "🍂" },
    { primary: "#B5541F", primaryForeground: "#FFFFFF", accent: "#C79A3C", accentForeground: "#2A1E05", secondary: "#E0C29A", bgLight: "#FAF2E6", bgDark: "#170F09" }
  ),
  paired(
    { id: "winter", name: "Winter", emoji: "❄️", category: "seasonal", isSeasonal: true, description: "Calm and clean.", personality: "Calm · Clean · Crisp", illustrationAccent: "❄️" },
    { primary: "#3A5A8C", primaryForeground: "#FFFFFF", accent: "#8FB8D9", accentForeground: "#0A1620", secondary: "#DCE6EE", bgLight: "#F4F7FA", bgDark: "#0A0E14" }
  ),
];

export const APP_STYLES: AppStyle[] = [
  ...ORIGINAL_STYLES,
  ...FRUIT_STYLES,
  ...NATURE_STYLES,
  ...P2P_GLOBAL_STYLES,
  ...SEASONAL_STYLES,
];

export const DEFAULT_APP_STYLE_ID = "original-dark";

export function getAppStyle(id: string | null | undefined): AppStyle {
  return APP_STYLES.find((s) => s.id === id) ?? APP_STYLES.find((s) => s.id === DEFAULT_APP_STYLE_ID)!;
}

// Styles shown under the "Seasonal" section (Spring included via alsoInSeasonal).
export function getSeasonalStyles(): AppStyle[] {
  return APP_STYLES.filter((s) => s.category === "seasonal" || s.alsoInSeasonal);
}

export function getStylesByCategory(category: AppStyleCategory): AppStyle[] {
  if (category === "seasonal") return getSeasonalStyles();
  return APP_STYLES.filter((s) => s.category === category);
}

// Maps a style's approved tokens onto every legacy AppColors field so the
// 51 screens already built against useTheme()'s `colors` object work
// unchanged with any of the 19 styles, in either mode.
export function deriveLegacyColors(tokens: StyleTokens, mode: "light" | "dark"): AppColors {
  const isDark = mode === "dark";
  return {
    lightCream: tokens.background,
    card: tokens.card,
    cream: tokens.card,
    cardBeige: tokens.surfaceSecondary,
    warmBeige: tokens.secondary,
    borderBeige: tokens.border,
    textDark: tokens.cardForeground,
    textMid: tokens.mutedForeground,
    textMuted: withAlpha(tokens.mutedForeground, 0.85),
    textMutedLight: withAlpha(tokens.mutedForeground, 0.6),
    primaryGreen: tokens.primary,
    accentGreen: tokens.accent,
    lightGreen: lighten(tokens.accent, isDark ? 0.15 : 0.4),
    amber: tokens.warning,
    brightYellow: lighten(tokens.warning, 0.25),
    navBg: tokens.navigation,
    navBorder: lighten(tokens.navigation, 0.15),
    darkBg: darken(tokens.navigation, 0.2),
    progressFill: tokens.accent,
    progressTrack: tokens.border,
    upperRoomBg: isDark ? UPPER_ROOM.dark.bg : UPPER_ROOM.light.bg,
    upperRoomCard: isDark ? UPPER_ROOM.dark.card : UPPER_ROOM.light.card,
    upperRoomBorder: isDark ? UPPER_ROOM.dark.border : UPPER_ROOM.light.border,
    upperRoomAmber: isDark ? UPPER_ROOM.dark.amber : UPPER_ROOM.light.amber,
    upperRoomAmberLight: isDark ? UPPER_ROOM.dark.amberLight : UPPER_ROOM.light.amberLight,
    upperRoomCream: isDark ? UPPER_ROOM.dark.cream : UPPER_ROOM.light.cream,
    upperRoomMuted: isDark ? UPPER_ROOM.dark.muted : UPPER_ROOM.light.muted,
    radius: 16,
  };
}

// The single entry point ThemeContext uses to go from (style, mode) ->
// the AppColors object every existing screen renders with.
export function resolveAppStyleColors(style: AppStyle, resolvedMode: "light" | "dark"): AppColors {
  if (style.isExisting) return THEMES[style.legacyThemeName];
  const tokens = resolvedMode === "dark" ? style.dark : style.light;
  return deriveLegacyColors(tokens, resolvedMode);
}