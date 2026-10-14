// The notification the user tapped to launch the app (cold start).
//
// expo-notifications' getLastNotificationResponseAsync is native-only: on web
// it throws "ExpoNotifications.getLastNotificationResponse is not available
// on web", which surfaced as an uncaught error (and Expo's development error
// overlay) on every web page. Web has no tapped-push launch to recover, so it
// resolves to null there. On iOS/Android the native call is made exactly as
// before; a failure is logged instead of becoming an unhandled rejection.

type Platform = "ios" | "android" | "web" | "windows" | "macos" | string;

export async function getLaunchNotificationResponse<T>(
  platform: Platform,
  getLast: () => Promise<T | null>,
  log: (message: string, err: unknown) => void = (m, e) => console.warn(m, e),
): Promise<T | null> {
  if (platform === "web") return null;
  try {
    return await getLast();
  } catch (err) {
    log("getLastNotificationResponseAsync failed", err);
    return null;
  }
}
