import { useWindowDimensions } from "react-native";

export const TABLET_BREAKPOINT = 768;
export const MAX_CONTENT_WIDTH = 600;

export function useLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  return { screenWidth: width, isTablet };
}
