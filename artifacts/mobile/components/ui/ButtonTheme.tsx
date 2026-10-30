import React, { createContext, useContext, useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { THEMES, type AppColors } from "@/constants/themes";
import { buttonTokens, type ButtonTokens, type Mode } from "@/lib/buttonTheme";

// Which colours the shared buttons use. By default they follow the reader's
// theme (light / dark / app style). A screen that is still drawn in the fixed
// light palette wraps itself in <FixedLightButtons> so its buttons match it
// (those screens are a documented exception until they become theme-aware).
// The preview screen uses <ButtonThemeProvider> to show light and dark side
// by side.

const Override = createContext<{ colors: AppColors; mode: Mode } | null>(null);

export function ButtonThemeProvider({ colors, mode, children }: { colors: AppColors; mode: Mode; children: React.ReactNode }) {
  const value = useMemo(() => ({ colors, mode }), [colors, mode]);
  return <Override.Provider value={value}>{children}</Override.Provider>;
}

/** Buttons inside match a screen still drawn in the fixed light palette. */
export function FixedLightButtons({ children }: { children: React.ReactNode }) {
  return <ButtonThemeProvider colors={THEMES.light} mode="light">{children}</ButtonThemeProvider>;
}

/**
 * Which palette a single button uses: the reader's theme (default), or a fixed
 * one for screens not yet theme-aware — "fixedLight" (screens in the fixed light
 * palette) or "fixedDark" (always-dark screens such as calls).
 */
export type ButtonPalette = "theme" | "fixedLight" | "fixedDark";

export function useButtonTokens(palette: ButtonPalette = "theme"): ButtonTokens {
  const override = useContext(Override);
  const { colors, resolvedMode } = useTheme();
  const fixed = palette === "fixedLight" ? { colors: THEMES.light, mode: "light" as Mode } : palette === "fixedDark" ? { colors: THEMES.dark, mode: "dark" as Mode } : null;
  const c = fixed?.colors ?? override?.colors ?? colors;
  const mode = fixed?.mode ?? override?.mode ?? resolvedMode;
  return useMemo(() => buttonTokens(c, mode), [c, mode]);
}
