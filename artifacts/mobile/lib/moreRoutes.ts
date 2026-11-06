// Prayer and Discover live inside the More tab (app/(tabs)/more.tsx). Use these instead of the
// old "/(tabs)/prayer" and "/(tabs)/discover" tab routes; app/+native-intent.tsx rewrites those
// old links (home-screen widgets, notifications from older builds) to these.
export const PRAYER_ROUTE = "/(tabs)/more?section=prayer";
export const DISCOVER_ROUTE = "/(tabs)/more?section=discover";

/** Old tab paths → their place in More (deep links arrive without the "(tabs)" group too). */
export function rewriteLegacyTabPath(path: string): string {
  const [p, q] = path.split("?");
  const clean = p.replace(/\/+$/, "") || "/";
  const target = /^\/?(\(tabs\)\/)?prayer$/.test(clean) ? PRAYER_ROUTE : /^\/?(\(tabs\)\/)?discover$/.test(clean) ? DISCOVER_ROUTE : null;
  if (!target) return path;
  return q ? `${target}&${q}` : target;
}
