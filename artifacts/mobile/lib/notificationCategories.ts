import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerIncomingCallCategory } from "@/lib/callNotifications";

// Notification categories, registered one after another (expo-notifications
// reads the current set and replaces only the category it is given — see
// CategoriesModule.swift — so two registrations running at once could drop
// one; sequencing avoids that).
//
//   incoming_call — Accept / Decline (lib/callNotifications.ts), unchanged.
//   p2p_message   — iPhone only: message pushes carry it when the recipient
//                   shows sender identity, so iOS uses the P2P long-press view
//                   (Notification Content Extension, plugins/notification-content).
//                   No actions: tapping keeps opening the conversation through
//                   the existing tap handler (mark-read / count / badge once).
export const MESSAGE_CATEGORY = "p2p_message";

export async function registerNotificationCategories(): Promise<void> {
  if (Platform.OS === "web") return;
  await registerIncomingCallCategory();
  if (Platform.OS !== "ios") return;
  try {
    await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, []);
  } catch (e) {
    console.warn("notificationCategories: message category registration failed", e instanceof Error ? e.message : String(e));
  }
}
