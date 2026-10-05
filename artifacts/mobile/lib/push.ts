import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, AppState } from "react-native";
import { authedFetch } from "@/lib/adminFetch";
import { registerIncomingCallCategory } from "@/lib/callNotifications";
import { callSystemInstalled } from "@/lib/callSystem";

const LAST_TOKEN_KEY = "p2p_last_push_token";

// Foreground behavior: DataContext already drives an in-app banner
// (MessageBannerHost, see app/_layout.tsx) for new messages while the app
// is open, so the OS banner/sound is suppressed whenever the app is
// active -- otherwise a foregrounded user would see the in-app banner AND
// hear/see the system notification for the exact same event. Background
// and killed states have no in-app banner to compete with, so the OS
// notification behaves normally there.
// An incoming call is the one exception to "still list it while open": the
// in-app ringing screen (IncomingCallHost) already handles it, so a tray
// entry would just be a duplicate that outlives the call.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isForeground = AppState.currentState === "active";
    const isIncomingCall = (notification.request.content.data as Record<string, unknown> | undefined)?.notificationType === "incoming_call";
    return {
      shouldShowBanner: !isForeground,
      shouldShowList: !(isForeground && isIncomingCall),
      shouldPlaySound: !isForeground,
      shouldSetBadge: false,
    };
  },
});

// Accept/Decline buttons — must exist before an incoming-call push arrives.
void registerIncomingCallCategory();

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Emulators/simulators without real push services (and web) can't get a
  // genuine Expo push token -- Device.isDevice is Expo's own check for
  // this, avoiding a guaranteed-to-fail native call.
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // A separate, MAX-importance channel for incoming calls — the existing
    // "default" channel intentionally stays at DEFAULT importance for
    // everything else (messages, invitations, etc.), matching how every
    // other notification type in this app has always behaved. Only
    // incoming-call pushes (routes/calls.ts's /calls/start,
    // pushDispatch.ts sets channelId: "calls" for notification_type
    // "incoming_call") use this one, so ringing gets a heads-up
    // display/sound/vibration without changing anything else's behavior.
    await Notifications.setNotificationChannelAsync("calls", {
      name: "Incoming calls",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let finalStatus = current.status;
  if (current.status !== "granted") {
    // Never re-prompt after a real denial — canAskAgain is false once the
    // OS has decided the user must go to Settings instead (both Android
    // 13+ and iOS behave this way natively, but this guard also keeps our
    // own call from looking like a repeat nag on platforms/versions where
    // the OS would technically allow asking again).
    if (!current.canAskAgain) return null;
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const res = await authedFetch("/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token, platform: Platform.OS, deviceId: await getInstallId(),
        // Builds with the native call system get silent call-state pushes.
        callSystem: callSystemInstalled(),
      }),
    });
    if (res.ok) await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.error("Push registration failed", e);
    return null;
  }
}

const INSTALL_ID_KEY = "p2p_install_id";

/**
 * A stable id for this app install. It ties this device's Expo push token to
 * its iOS VoIP token, so the server skips the ordinary incoming-call push on
 * a device that CallKit is already ringing.
 */
async function getInstallId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
  await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  return id;
}

/** iOS PushKit VoIP token — lets an incoming call ring through CallKit with the app closed. */
export async function registerVoipTokenAsync(token: string): Promise<void> {
  if (Platform.OS !== "ios" || !token) return;
  try {
    // 409 until migration 172 is applied — the server can't store it yet.
    await authedFetch("/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "ios_voip", deviceId: await getInstallId(), callSystem: true }),
    });
  } catch (e) {
    console.warn("VoIP token registration failed", e);
  }
}

// Called on logout, before the session is torn down (needs a valid JWT to
// authorize the unregister call). Reads back whichever token this device
// last successfully registered rather than re-requesting one from the OS —
// cheaper, and correct even if permissions changed since registration.
export async function unregisterCurrentPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (!token) return;
    await authedFetch("/push/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  } catch {}
}

// Section 8's deep-link map. Deliberately narrow: only types with a
// destination that can never "expire" (a conversation thread always
// exists) get a direct link. Everything else — Study Together's
// invitation/session family, admin/church events — lands on the
// Notification Center, reusing its existing handlePress logic (which
// already does the "is this session still live" check and falls back
// safely) instead of duplicating that validation here.
export function pathForNotification(
  notificationType: string | null,
  data: Record<string, unknown> | null | undefined,
  // Accept/Decline pressed on an incoming-call notification; the ringing
  // screen runs that action itself once it has confirmed the call is live.
  callAction?: "accept" | "decline",
): string {
  const conversationId = data?.conversationId as string | undefined;
  const contactMessageId = data?.messageId as string | undefined;

  if ((notificationType === "new_message" || notificationType === "official_message_received") && conversationId) {
    return `/messages/${conversationId}`;
  }
  if (notificationType === "contact_message_replied" && contactMessageId) {
    return `/messages/contact-thread/${contactMessageId}`;
  }
  // Incoming call — /calls/start (calls.ts) writes this notification's data
  // payload as the exact same field set IncomingCallHost (app/_layout.tsx)
  // passes to /call/incoming when it detects the call over realtime, so a
  // background/killed-app push tap reconstructs the identical ringing
  // screen a foreground user would already be looking at. call/incoming.tsx
  // itself decides whether the call is still live (a stale/answered/
  // declined/expired call is handled there, same as the realtime path) —
  // this function only routes, it never assumes the call is still ringing.
  if (notificationType === "incoming_call" && data?.callId) {
    const p = new URLSearchParams({
      callId: String(data.callId ?? ""), channelName: String(data.channelName ?? ""),
      callType: String(data.callType ?? "audio"), callerId: String(data.callerId ?? ""),
      callerName: String(data.callerName ?? ""), conversationId: String(data.conversationId ?? ""),
      callLogId: String(data.callLogId ?? ""), invitationId: String(data.invitationId ?? ""),
      callerPhotoUrl: String(data.callerPhotoUrl ?? ""),
    });
    if (callAction) p.set("action", callAction);
    return `/call/incoming?${p.toString()}`;
  }
  // Missed call — the thread holds the missed-call card (tap to call back);
  // history covers a call with no conversation.
  if (notificationType === "missed_call") {
    return conversationId ? `/messages/${conversationId}` : "/call/history";
  }
  return "/notifications";
}