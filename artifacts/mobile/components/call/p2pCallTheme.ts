import type { AppColors } from "@/constants/themes";
import { lighten, darken, withAlpha } from "@/lib/colorUtils";

// The P2P Call signature visual language, derived from the app's EXISTING
// theme system (contexts/ThemeContext.tsx / constants/appStyles.ts) rather
// than a second, hardcoded theme. Every one of the 19 existing App Styles
// (in both light and dark mode) already resolves a full AppColors object
// via useTheme() — this just maps those same tokens onto the call screen's
// specific visual roles (orbit background, node surfaces, speaking-ring
// accent, etc.), the same way `makeStyles(colors)` is already used
// elsewhere in this codebase (e.g. app/family/calls.tsx).
//
// "Electric blue" is not hardcoded here: `accent` below is
// colors.accentGreen — whatever the user's actual selected style resolves
// that to (blue for Ocean/Global/Winter/Midnight, green for the default
// Original Dark, etc.). In dark mode this still lands close to the
// original navy/blue direction for anyone on a blue-leaning style, and
// for everyone else it correctly follows their own theme instead of
// overriding it — exactly what was asked for.
export interface P2PCallColors {
  bg: string;
  surface: string; // node / control-button background
  surfaceBorder: string;
  textPrimary: string;
  textMuted: string;
  accent: string; // the resolved "electric" accent — theme's own accent color
  accentSoft: string; // a lighter/darker cousin of accent, used for the softer node ring
  accentBorder: string; // translucent accent, for node/pill borders
  pillBg: string;
  endRed: string; // ALWAYS "#DC2626" — never derived from the theme, see below
}

// The End Call button is a deliberate, fixed safety/recognition
// convention (mandate: "must remain RED... unless required by the
// existing approved design"). This is the exact literal this codebase's
// own call screens already used before any redesign work — never sourced
// from a theme token, so a differently-accented style can never change it.
export const P2P_END_CALL_RED = "#DC2626";

export function getP2PCallColors(colors: AppColors, resolvedMode: "light" | "dark"): P2PCallColors {
  const isDark = resolvedMode === "dark";
  return {
    // darkBg/lightCream are already the correct "screen background" token
    // for each mode in every existing style — reusing them directly avoids
    // ever placing a hardcoded dark rectangle inside a light theme.
    bg: isDark ? colors.darkBg : colors.lightCream,
    surface: colors.card,
    surfaceBorder: colors.borderBeige,
    textPrimary: colors.textDark, // already the correct light/dark-mode foreground per the theme engine
    textMuted: colors.textMuted,
    accent: colors.accentGreen,
    accentSoft: isDark ? lighten(colors.accentGreen, 0.18) : darken(colors.accentGreen, 0.08),
    accentBorder: withAlpha(colors.accentGreen, isDark ? 0.4 : 0.35),
    pillBg: withAlpha(colors.accentGreen, isDark ? 0.16 : 0.12),
    endRed: P2P_END_CALL_RED,
  };
}
