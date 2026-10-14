import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { Href, useRouter, useSegments } from "expo-router";
import React from "react";
import { Platform, PlatformColor, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// iPad-only floating tab capsule.
//
// iPadOS draws native tabs as its own floating top bar, sizes it itself and
// overflows our sixth tab behind an arrow — no supported NativeTabs /
// react-native-screens / UIKit option controls its width, spacing or overflow.
// So on iPad the native bar is hidden (NativeTabs `hidden`, same navigator,
// same routes and state) and this capsule takes its place: same position,
// glass material, text labels and selected pill, with the six tabs sharing
// the capsule width evenly.
//
// Below CAPSULE_MIN_WINDOW_WIDTH (narrow Split View / Slide Over) the native
// bar is used unchanged, as iPadOS itself moves to a compact bar there.

const CAPSULE_MIN_WINDOW_WIDTH = 600;
const CAPSULE_HEIGHT = 48;
const CAPSULE_TOP_GAP = 8; // below the status bar
const CAPSULE_BOTTOM_GAP = 8; // space before the screen content starts
const CAPSULE_SIDE_MARGIN = 24;
const ITEM_MAX_WIDTH = 140;
const PILL_INSET = 4;

const isIPad = Platform.OS === "ios" && Platform.isPad;

// iOS system colours, as the native bar uses (they follow light/dark mode).
// This module is also imported on Android/web (for the inset hook), where
// PlatformColor names don't exist, so plain fallbacks are used there.
const C = Platform.OS === "ios"
  ? { label: PlatformColor("label"), selected: PlatformColor("systemBlue"), pill: PlatformColor("tertiarySystemFill"), badge: PlatformColor("systemRed") }
  : { label: "#000000", selected: "#007AFF", pill: "rgba(118,118,128,0.12)", badge: "#FF3B30" };

/** True when the capsule replaces the native tab bar (iPad, wide enough). */
export function useIPadTabCapsuleVisible(): boolean {
  const { width } = useWindowDimensions();
  return isIPad && isLiquidGlassAvailable() && width >= CAPSULE_MIN_WINDOW_WIDTH;
}

/**
 * Window y-coordinate where tab-screen content may start while the capsule is
 * shown (just below it), or null when it isn't. Provided by the tabs layout,
 * which measures the status bar with the root safe-area provider.
 */
export const TabCapsuleContentTopContext = React.createContext<number | null>(null);

export function capsuleContentTop(statusBarInset: number): number {
  return statusBarInset + CAPSULE_TOP_GAP + CAPSULE_HEIGHT + CAPSULE_BOTTOM_GAP;
}

/**
 * Extra top padding a tab screen needs so its content starts below the
 * capsule. Takes the screen's own safe-area top inset: whatever space the
 * native safe area already provides is not added again, so the result never
 * double-counts — whether or not iPadOS still reserves room for the hidden
 * native bar. 0 whenever the capsule isn't shown (iPhone, Android, web).
 */
export function useTabCapsuleTopInset(screenInsetTop: number): number {
  const contentTop = React.useContext(TabCapsuleContentTopContext);
  return contentTop == null ? 0 : Math.max(0, contentTop - screenInsetTop);
}

// Tapping the active tab again: the native tab bar scrolls that screen to the
// top itself; the capsule can't trigger that native behaviour, so it tells the
// screen through this emitter and the screen scrolls its own list.
export interface TabReselectEmitter {
  subscribe(tab: string, listener: () => void): () => void;
  emit(tab: string): void;
}

export function createTabReselectEmitter(): TabReselectEmitter {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe(tab, listener) {
      if (!listeners.has(tab)) listeners.set(tab, new Set());
      listeners.get(tab)!.add(listener);
      return () => { listeners.get(tab)?.delete(listener); };
    },
    emit(tab) {
      listeners.get(tab)?.forEach((listener) => listener());
    },
  };
}

export const TabReselectContext = React.createContext<TabReselectEmitter | null>(null);

// Either a ScrollView (scrollTo) or a FlatList (scrollToOffset).
type ScrollableRef = {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void;
  scrollToOffset?: (params: { offset: number; animated?: boolean }) => void;
} | null;

export function scrollToTop(target: ScrollableRef): void {
  if (!target) return;
  if (typeof target.scrollToOffset === "function") target.scrollToOffset({ offset: 0, animated: true });
  else if (typeof target.scrollTo === "function") target.scrollTo({ y: 0, animated: true });
}

/**
 * Scrolls the screen's main list to the top when its tab is tapped again in
 * the iPad capsule. A no-op everywhere else (no emitter on iPhone/Android/web,
 * where the native or classic tab bar already handles this).
 */
export function useScrollToTopOnTabReselect(tab: string, ref: React.RefObject<ScrollableRef>): void {
  const emitter = React.useContext(TabReselectContext);
  React.useEffect(() => emitter?.subscribe(tab, () => scrollToTop(ref.current)), [emitter, tab, ref]);
}

export interface TabCapsuleItem {
  /** Route name inside app/(tabs) ("index", "learn", ...). */
  name: string;
  label: string;
  badge?: number;
}

export function IPadTabCapsule({ items }: { items: TabCapsuleItem[] }) {
  const router = useRouter();
  const reselect = React.useContext(TabReselectContext);
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Segments describe the focused screen app-wide; while a screen outside the
  // tabs is on top (e.g. a transparent modal), keep the last tab highlighted.
  const lastActive = React.useRef<string | null>(null);
  if (segments[0] === "(tabs)") lastActive.current = segments[1] ?? "index";
  const active = lastActive.current;
  const capsuleWidth = Math.min(width - CAPSULE_SIDE_MARGIN * 2, ITEM_MAX_WIDTH * items.length);

  const Material = isGlassEffectAPIAvailable() ? (
    <GlassView glassEffectStyle="regular" isInteractive style={StyleSheet.absoluteFill} />
  ) : (
    <BlurView intensity={80} tint="systemChromeMaterial" style={StyleSheet.absoluteFill} />
  );

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + CAPSULE_TOP_GAP }]}>
      <View style={[styles.capsule, { width: capsuleWidth }]} accessibilityRole="tablist">
        {Material}
        {items.map((item) => {
          const selected = item.name === active;
          const href = (item.name === "index" ? "/(tabs)" : `/(tabs)/${item.name}`) as Href;
          return (
            <Pressable
              key={item.name}
              style={styles.item}
              // The item is 40pt tall inside the capsule's padding; extend the
              // touch area to the capsule edges (48pt, above the 44pt minimum).
              hitSlop={{ top: PILL_INSET, bottom: PILL_INSET }}
              onPress={() => {
                if (selected) reselect?.emit(item.name);
                else router.navigate(href);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.badge ? `${item.label}, ${item.badge} unread` : item.label}
            >
              <View style={[styles.pill, selected && styles.pillSelected]}>
                <Text
                  style={[styles.label, selected && styles.labelSelected]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  // Like the native tab bar: fixed label size (Dynamic Type
                  // would overflow the fixed-height capsule).
                  allowFontScaling={false}
                >
                  {item.label}
                </Text>
                {item.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText} numberOfLines={1} allowFontScaling={false}>{item.badge > 99 ? "99+" : String(item.badge)}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  capsule: {
    height: CAPSULE_HEIGHT,
    borderRadius: CAPSULE_HEIGHT / 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "stretch",
    padding: PILL_INSET,
  },
  item: { flex: 1, minWidth: 0 },
  pill: {
    flex: 1,
    borderRadius: (CAPSULE_HEIGHT - PILL_INSET * 2) / 2,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pillSelected: { backgroundColor: C.pill },
  label: { fontSize: 15, fontWeight: "500", color: C.label, flexShrink: 1 },
  labelSelected: { fontWeight: "600", color: C.selected },
  badge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: C.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
});
