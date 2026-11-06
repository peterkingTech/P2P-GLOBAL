import { rewriteLegacyTabPath } from "@/lib/moreRoutes";

// Incoming deep links (home-screen widgets, notifications, shared links) before routing.
// Prayer and Discover moved into the More tab: their old tab links still land in the right place.
// Accepts a path ("/(tabs)/prayer") or a URL ("p2pglobal:///(tabs)/prayer", "p2pglobal://prayer";
// for app-scheme URLs the host is the first path segment).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?]*)([^?]*)(\?.*)?$/i.exec(path);
    if (!m) return rewriteLegacyTabPath(path);
    const [, scheme, host, rest, query = ""] = m;
    // http(s) and Expo Go (exp://host/--/path) carry a real host; app-scheme links don't.
    const hasHost = /^(https?|exps?)$/i.test(scheme);
    const routePath = (hasHost ? rest.replace(/^\/--(?=\/|$)/, "") : `/${host}${rest}`).replace(/\/{2,}/g, "/") || "/";
    const rewritten = rewriteLegacyTabPath(routePath + query);
    return rewritten === routePath + query ? path : rewritten;
  } catch {
    return path;
  }
}
