// Responsive Admin Centre (2026-11-18): the shell shows a fixed sidebar from ADMIN_WIDE px; screens inside it
// must size themselves by the space they actually get (window minus the sidebar), not the whole window.
import { useWindowDimensions } from "react-native";

export const ADMIN_WIDE = 1024;
export const ADMIN_SIDEBAR = 248;
/** Width available to an admin screen's content. */
export const adminContentWidth = (windowWidth: number) => (windowWidth >= ADMIN_WIDE ? windowWidth - ADMIN_SIDEBAR : windowWidth);
export function useAdminContentWidth(): number {
  const { width } = useWindowDimensions();
  return adminContentWidth(width);
}
