import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo-modules-core";
import { DEFAULT_WIDGET_PREFS, type WidgetPrefs, type WidgetSnapshot, snapshotKey } from "@/lib/widgetSnapshot";

// The bridge between the app and the native home-screen widgets
// (modules/p2p-widgets). The app writes one JSON snapshot into storage the
// widgets can read — an iOS App Group / Android SharedPreferences — and asks
// the system to redraw them. When a build doesn't include the native module
// (web, Expo Go, an older build) every call here is a safe no-op.

interface NativeWidgets {
  setSnapshot(json: string): void;
  clearSnapshot(): void;
  /** Whether the system shows at least one P2P widget (best effort; false when unknown). */
  hasInstalledWidgets(): Promise<boolean>;
}
const native: NativeWidgets | null = Platform.OS === "web" ? null : requireOptionalNativeModule<NativeWidgets>("P2PWidgets");

/** True when this build can show widgets at all. */
export const widgetsSupported = (): boolean => !!native;

const LAST_KEY = "widgets:lastSnapshotKey";
const LAST_AT = "widgets:lastWrittenAt";

/** Writes the snapshot when it changed (no redundant writes, no battery cost). Returns whether it wrote. */
export async function writeWidgetSnapshot(s: WidgetSnapshot): Promise<boolean> {
  if (!native) return false;
  const key = snapshotKey(s);
  const prev = await AsyncStorage.getItem(LAST_KEY).catch(() => null);
  if (prev === key) return false;
  native.setSnapshot(JSON.stringify(s));
  await AsyncStorage.multiSet([[LAST_KEY, key], [LAST_AT, s.updatedAt]]).catch(() => {});
  return true;
}

/** Removes everything the widgets know (sign-out). */
export async function clearWidgetSnapshot(): Promise<void> {
  native?.clearSnapshot();
  await AsyncStorage.multiRemove([LAST_KEY, LAST_AT]).catch(() => {});
}

/** Whether at least one P2P widget is on the home screen (false when unknown or unsupported). */
export async function hasInstalledWidgets(): Promise<boolean> {
  try { return native ? await native.hasInstalledWidgets() : false; } catch { return false; }
}

/** When the widgets were last given fresh data on this phone (ISO), or null. */
export async function lastWidgetSync(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_AT).catch(() => null);
}

const prefsKey = (userId: string) => `widgets:prefs:${userId}`;
export async function loadWidgetPrefs(userId: string): Promise<WidgetPrefs> {
  try {
    const raw = await AsyncStorage.getItem(prefsKey(userId));
    const p = raw ? JSON.parse(raw) : {};
    return {
      personalGreeting: typeof p.personalGreeting === "boolean" ? p.personalGreeting : DEFAULT_WIDGET_PREFS.personalGreeting,
      showCommunity: typeof p.showCommunity === "boolean" ? p.showCommunity : DEFAULT_WIDGET_PREFS.showCommunity,
      lockScreenDetails: typeof p.lockScreenDetails === "boolean" ? p.lockScreenDetails : DEFAULT_WIDGET_PREFS.lockScreenDetails,
    };
  } catch {
    return DEFAULT_WIDGET_PREFS;
  }
}
export async function saveWidgetPrefs(userId: string, p: WidgetPrefs): Promise<void> {
  await AsyncStorage.setItem(prefsKey(userId), JSON.stringify(p)).catch(() => {});
}
