import { useCallback, useState } from "react";
import { useWindowDimensions } from "react-native";
import type { DimensionValue, LayoutChangeEvent, ViewStyle } from "react-native";

// Breakpoints are measured on the live WINDOW width, not the device: an iPad
// in Split View / Slide Over / Stage Manager can be phone-narrow, and rotation
// changes the width, so every value below updates as the window resizes.
// Below TABLET_BREAKPOINT nothing here changes the layout (phones, narrow
// iPad windows): no caps, no grids, no extra views.
export const TABLET_BREAKPOINT = 768;
export const LARGE_TABLET_BREAKPOINT = 1024;

// Forms and bottom sheets stay this narrow on purpose at any size.
export const MAX_CONTENT_WIDTH = 600;
// Centered dialogs.
export const MAX_DIALOG_WIDTH = 560;
// Long-form reading (lessons, plan days) keeps a comfortable line length.
export const READING_MAX_WIDTH = 760;
// The page column never grows past this — wider windows center it.
export const PAGE_MAX_WIDTH = 1200;

// Space between the window edge and the page column on tablets; each screen's
// own padding sits inside it.
export function pageGutter(windowWidth: number): number {
  return windowWidth >= LARGE_TABLET_BREAKPOINT ? 24 : 16;
}

// Fluid page-column width for a window: fills the window (minus gutters) on
// tablets up to PAGE_MAX_WIDTH, then centers. undefined = phone, no cap.
export function pageContentWidth(windowWidth: number): number | undefined {
  if (windowWidth < TABLET_BREAKPOINT) return undefined;
  return Math.min(windowWidth - 2 * pageGutter(windowWidth), PAGE_MAX_WIDTH);
}

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  const isLargeTablet = width >= LARGE_TABLET_BREAKPOINT;
  const contentMaxWidth = pageContentWidth(width);
  return {
    screenWidth: width,
    screenHeight: height,
    isTablet,
    isLargeTablet,
    isLandscape: width > height,
    contentMaxWidth,
    readingMaxWidth: contentMaxWidth ? Math.min(READING_MAX_WIDTH, contentMaxWidth) : undefined,
    formMaxWidth: isTablet ? MAX_CONTENT_WIDTH : undefined,
  };
}

// Bottom sheets: the full available width in narrow windows (phones, and
// narrow iPad / foldable windows — exactly the phone behavior), and a
// centered panel of at most MAX_CONTENT_WIDTH once the window is tablet-wide.
// The sheet styles themselves carry width:"100%" + alignSelf:"center", so the
// panel can never be wider than the space it is laid out in.
const SHEET_WIDE: ViewStyle = { maxWidth: MAX_CONTENT_WIDTH };
const SHEET_NARROW: ViewStyle = {};
export function useSheetWidth(): ViewStyle {
  const { width } = useWindowDimensions();
  return width >= TABLET_BREAKPOINT ? SHEET_WIDE : SHEET_NARROW;
}

// Content-aware columns for card/tile grids. The column count comes from the
// grid's MEASURED width (onLayout) and the smallest comfortable card width, so
// it is right in portrait, landscape, Split View, Stage Manager and nested
// containers alike — no device-specific numbers. Inactive below the tablet
// breakpoint (callers keep their phone layout untouched).
// `columnChoices` restricts the count to values that suit the content (e.g.
// [1, 2, 4] for four tiles, so a row never ends with an orphan).
export function useAdaptiveColumns({ minItemWidth, maxColumns = 4, gap = 12, columnChoices }: { minItemWidth: number; maxColumns?: number; gap?: number; columnChoices?: number[] }) {
  const { width } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const active = width >= TABLET_BREAKPOINT;
  // Before the first layout pass: the page column minus a typical screen padding.
  const available = measured ?? (pageContentWidth(width) ?? width) - 40;
  let columns = active
    ? Math.max(1, Math.min(maxColumns, Math.floor((available + gap) / (minItemWidth + gap))))
    : 1;
  if (active && columnChoices?.length) {
    const fit = columns;
    columns = Math.max(1, ...columnChoices.filter((c) => c <= fit));
  }
  const itemWidth = active ? Math.floor((available - gap * (columns - 1)) / columns) : undefined;
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setMeasured((prev) => (prev === w ? prev : w));
  }, []);
  return { active, columns, itemWidth, gap, onLayout };
}

// For screens that already lay tiles out with flexWrap + percentage widths:
// on tablets, tiles get a measured pixel width and a real column gap instead
// of the fixed two-column percentage; on phones both styles are null, so the
// original percentage layout is untouched.
export function useAdaptiveTiles(opts: { minItemWidth: number; maxColumns?: number; gap?: number; columnChoices?: number[] }) {
  const { active, itemWidth, gap, onLayout } = useAdaptiveColumns(opts);
  return {
    onLayout,
    containerStyle: active ? ({ justifyContent: "flex-start", columnGap: gap } as ViewStyle) : null,
    tileStyle: active && itemWidth ? ({ width: itemWidth } as ViewStyle) : null,
  };
}

// Centered, width-capped container style; null (no style at all) when there
// is no cap, so phone layouts are untouched.
export function centeredMaxWidth(maxWidth: number | undefined): ViewStyle | null {
  return maxWidth ? { maxWidth, alignSelf: "center", width: "100%" } : null;
}

// Fixed-aspect media box (video players, photo previews). Phones: exactly the
// height these components always used — (window width − horizontal padding) ×
// heightFactor — but from the LIVE window, so it can't go stale. Tablets: the
// box sits in a width-capped column, so it follows its container's real width
// through aspectRatio instead of the (much wider) window.
export type MediaBoxStyle = { width?: DimensionValue; height?: number; aspectRatio?: number };
export function useMediaBox(horizontalPadding: number, heightFactor: number): MediaBoxStyle {
  const { width } = useWindowDimensions();
  return width >= TABLET_BREAKPOINT
    ? { width: "100%", aspectRatio: 1 / heightFactor }
    : { height: Math.round((width - horizontalPadding) * heightFactor) };
}

// Responsive width for the "photo column" card pattern used across Plans/
// Foundation curriculum cards (a protected text column + a dedicated photo
// block side by side): scales down on narrow phones instead of always
// reserving a flat pixel width, so the text column isn't left too cramped.
// `base` is the previous fixed-pixel width and doubles as the upper bound,
// so wider phones/tablets render exactly as before.
export function useCardPhotoWidth(base: number) {
  const { width } = useWindowDimensions();
  return Math.round(Math.min(base, Math.max(width * 0.28, 76)));
}
