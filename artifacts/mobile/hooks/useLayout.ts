import { useWindowDimensions } from "react-native";

export const TABLET_BREAKPOINT = 768;
export const MAX_CONTENT_WIDTH = 600;

export function useLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  return { screenWidth: width, isTablet };
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
