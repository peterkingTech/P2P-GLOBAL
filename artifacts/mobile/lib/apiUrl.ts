/**
 * Returns the base URL of the API server.
 * In Expo web (Replit dev): derives from window.location.origin + /api-server
 * In native: reads EXPO_PUBLIC_API_URL env var
 */
export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location) {
    // Expo web on Replit — API server is at /api-server on the same dev domain
    return `${window.location.origin}/api-server`;
  }
  return "";
}
