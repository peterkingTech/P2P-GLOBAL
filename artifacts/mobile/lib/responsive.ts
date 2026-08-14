import { Dimensions } from "react-native";
import { TABLET_BREAKPOINT, MAX_CONTENT_WIDTH, useLayout } from "@/hooks/useLayout";

// Deliberately NOT a second responsive system — isTablet here is derived
// from the exact same TABLET_BREAKPOINT (768) hooks/useLayout.ts already
// uses in 6+ screens. Any screen that needs to react live to rotation or
// tablet split-screen should call useLayout() (re-exported below) instead
// of these module-level constants, which are computed once at import time —
// fine for StyleSheet.create() values (themselves static and non-reactive
// regardless) but stale after a resize.
const { width: INITIAL_WIDTH, height: INITIAL_HEIGHT } = Dimensions.get("window");
const BASE_WIDTH = 390; // iPhone 14 — the width these screens were designed against
const BASE_HEIGHT = 844;

export const isSmallPhone = INITIAL_WIDTH < 375; // iPhone SE, older/narrow Android
export const isStandardPhone = INITIAL_WIDTH >= 375 && INITIAL_WIDTH < 414;
export const isLargePhone = INITIAL_WIDTH >= 414 && INITIAL_WIDTH < TABLET_BREAKPOINT;
export const isTablet = INITIAL_WIDTH >= TABLET_BREAKPOINT;

export const SCREEN_W = INITIAL_WIDTH;
export const SCREEN_H = INITIAL_HEIGHT;

// Scale a size proportionally to screen width.
export function sw(size: number): number {
  return (INITIAL_WIDTH / BASE_WIDTH) * size;
}

// Scale a size proportionally to screen height.
export function sh(size: number): number {
  return (INITIAL_HEIGHT / BASE_HEIGHT) * size;
}

// Font scaling — never shrinks/grows more than 15% off the base size, so
// text stays readable on a 320px phone and doesn't balloon on a tablet.
export function fs(size: number): number {
  const scaled = sw(size);
  const minSize = size * 0.85;
  const maxSize = size * 1.15;
  return Math.max(minSize, Math.min(maxSize, scaled));
}

export const spacing = {
  xs: sw(4),
  sm: sw(8),
  md: sw(16),
  lg: sw(24),
  xl: sw(32),
  xxl: sw(48),
};

export const screenPadding = isSmallPhone ? 14 : isTablet ? 40 : 20;

// Even column width for a grid, accounting for screen padding + inter-item gaps.
export function columnWidth(columns: number, gap: number = 12): number {
  const totalGap = gap * (columns - 1);
  const totalPadding = screenPadding * 2;
  return (INITIAL_WIDTH - totalPadding - totalGap) / columns;
}

// Re-exported so screens needing live tablet/rotation awareness (not just
// the static constants above) import from one place — same hook, same
// breakpoint, same MAX_CONTENT_WIDTH the rest of the app already relies on.
export { useLayout, MAX_CONTENT_WIDTH, TABLET_BREAKPOINT };