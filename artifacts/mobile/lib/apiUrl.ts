/**
 * Returns the base URL of the API server (no trailing slash).
 *
 * Resolution order:
 * 1. EXPO_PUBLIC_API_URL  — explicit override (required for native Expo Go / production)
 * 2. EXPO_PUBLIC_DOMAIN   — injected by the Replit workflow from $REPLIT_DEV_DOMAIN;
 *                           gives us the correct picard.replit.dev host at dev time
 * 3. Empty string         — callers guard against this with early returns
 */
export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, "");
  }
  // Replit dev: EXPO_PUBLIC_DOMAIN = $REPLIT_DEV_DOMAIN (the picard host, not the expo host).
  // The api-server mounts all routes at /api.
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "";
}
