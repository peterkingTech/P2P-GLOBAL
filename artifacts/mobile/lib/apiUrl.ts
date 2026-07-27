/**
 * Returns the base URL of the API server (no trailing slash).
 *
 * Resolution order:
 * 1. EXPO_PUBLIC_API_URL  — explicit override (required for native Expo Go /
 *                           EAS builds — see eas.json's per-profile "env").
 * 2. EXPO_PUBLIC_DOMAIN   — injected by the Replit workflow from $REPLIT_DEV_DOMAIN;
 *                           gives us the correct picard.replit.dev host at dev time.
 * 3. http://localhost:5000/api — local-dev-only fallback (matches the
 *    api-server's documented local dev port in replit.md). Gated on __DEV__,
 *    so it's never used in a production build — a genuinely missing config
 *    there surfaces via the loud error below instead of silently pointing a
 *    real device at an unreachable "localhost".
 * 4. Empty string — callers guard against this with early returns.
 *
 * Every path is logged loudly if it resolves to something empty or
 * non-http(s) — a missing/invalid config should never fail silently.
 */
export function getApiUrl(): string {
  let resolved = "";

  if (process.env.EXPO_PUBLIC_API_URL) {
    resolved = process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, "");
  } else if (process.env.EXPO_PUBLIC_DOMAIN) {
    // Replit dev: EXPO_PUBLIC_DOMAIN = $REPLIT_DEV_DOMAIN (the picard host, not the expo host).
    // The api-server mounts all routes at /api.
    resolved = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  } else if (__DEV__) {
    resolved = "http://localhost:5000/api";
  }

  if (!resolved || !/^https?:\/\//.test(resolved)) {
    console.error(
      `EXPO_PUBLIC_API_URL is not set or invalid — API calls will fail. Current value: ${resolved || "(empty)"}`
    );
  }

  return resolved;
}
