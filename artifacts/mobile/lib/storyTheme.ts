import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { colors as dark } from "@/lib/togetherTheme";

// Kingdom Stories follows the reader's light/dark choice (Settings →
// Appearance). Dark is the existing cinematic "gathered room" palette,
// unchanged; light takes the same token names from the reader's app style.
// Text laid over artwork never uses these — it keeps its own dark scrim and
// white text in both modes (see ART_TEXT), so it always stays readable.
export type StoryPalette = { [K in keyof typeof dark]: string };

export function lightStoryPalette(c: AppColors): StoryPalette {
  return {
    ...dark,
    background: c.lightCream,
    sheet: c.cardBeige,
    surface: "rgba(0,0,0,0.035)",
    surfaceRaised: c.card,
    surfaceInset: "rgba(0,0,0,0.05)",
    border: c.borderBeige,
    borderFaint: c.borderBeige,
    growth: c.primaryGreen,
    light: c.amber,
    textPrimary: c.textDark,
    textSecondary: c.textMid,
    textTertiary: c.textMuted,
    textFaint: c.textMutedLight,
  };
}

export function storyPalette(mode: "light" | "dark", c: AppColors): StoryPalette {
  return mode === "light" ? lightStoryPalette(c) : { ...dark };
}

/** The palette plus styles built from it, rebuilt only when the theme changes. */
export function useStoryStyles<S>(make: (T: StoryPalette) => S): { T: StoryPalette; s: S; isLight: boolean } {
  const { resolvedMode, colors } = useTheme();
  return useMemo(() => {
    const T = storyPalette(resolvedMode, colors);
    return { T, s: make(T), isLight: resolvedMode === "light" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedMode, colors]);
}

/** Text and controls laid over artwork: the same in both modes. */
export const ART_TEXT = { text: "#FFFFFF", scrim: "rgba(0,0,0,0.55)", control: "rgba(0,0,0,0.38)" } as const;
