import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useData } from "@/contexts/DataContext";
import {
  IPadTabCapsule, TabCapsuleContentTopContext, TabReselectContext, capsuleContentTop, createTabReselectEmitter, useIPadTabCapsuleVisible,
} from "@/components/IPadTabCapsule";
import { usePrayerBadge } from "@/hooks/usePrayerBadge";
import "@/lib/i18n";


// No locale has a tabs.profile key yet; every locale already translates
// home.myProfile, so that is the fallback rather than an English-only label.
function profileTabLabel(t: (key: string, opts?: Record<string, unknown>) => string): string {
  return t("tabs.profile", { defaultValue: t("home.myProfile") });
}

// Six tabs: Home, Learning, Bible, Messages, My Profile, More. Prayer and Discover live inside
// More (app/(tabs)/more.tsx); its badge counts new prayer activity (hooks/usePrayerBadge).
const bibleLabel = (t: (key: string, opts?: Record<string, unknown>) => string) => t("tabs.bible", { defaultValue: "Bible" });
const moreLabel = (t: (key: string, opts?: Record<string, unknown>) => string) => t("tabs.more", { defaultValue: "More" });

// Auto-shrinks to fit its slot instead of truncating — a fixed-size label
// (e.g. the old "K-School" abbreviation, added specifically to dodge
// truncation on small screens — see commit a36c5b4) always has some device
// width where it's either too cramped or clips anyway. adjustsFontSizeToFit
// solves this for any label length on any screen, not just the one word
// that prompted the original fix.
function TabLabel({ label, color, baseFontSize }: { label: string; color: string; baseFontSize: number }) {
  return (
    <Text
      style={{ fontSize: baseFontSize, fontFamily: "Inter_500Medium", marginTop: -2, color }}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {label}
    </Text>
  );
}

function NativeTabLayout() {
  const { t } = useTranslation();
  const { totalUnreadCount } = useData();
  const prayerBadge = usePrayerBadge();
  // iPad: the native floating top bar can only show five of the six tabs, so
  // it is hidden and IPadTabCapsule draws all six in its place (same
  // navigator, routes and state). iPhone and narrow iPad windows: unchanged.
  const capsuleVisible = useIPadTabCapsuleVisible();
  // Root (window) safe area: this layout sits outside the tab screens'
  // per-screen safe-area providers, so this is the status bar inset.
  const windowInsets = useSafeAreaInsets();
  const tabReselect = React.useMemo(createTabReselectEmitter, []);
  return (
    <TabReselectContext.Provider value={tabReselect}>
    <TabCapsuleContentTopContext.Provider value={capsuleVisible ? capsuleContentTop(windowInsets.top) : null}>
    <View style={{ flex: 1 }}>
    <NativeTabs hidden={capsuleVisible}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.home")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <NativeTabs.Trigger.Icon sf={{ default: "graduationcap", selected: "graduationcap.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.learn")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bible">
        <NativeTabs.Trigger.Icon sf={{ default: "book", selected: "book.fill" }} />
        <NativeTabs.Trigger.Label>{bibleLabel(t)}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf={{ default: "message", selected: "message.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.messages")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={totalUnreadCount === 0}>{String(totalUnreadCount)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>{profileTabLabel(t)}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }} />
        <NativeTabs.Trigger.Label>{moreLabel(t)}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={prayerBadge === 0}>{String(prayerBadge)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
    {capsuleVisible && (
      <IPadTabCapsule
        items={[
          { name: "index", label: t("tabs.home") },
          { name: "learn", label: t("tabs.learn") },
          { name: "bible", label: bibleLabel(t) },
          { name: "messages", label: t("tabs.messages"), badge: totalUnreadCount },
          { name: "profile", label: profileTabLabel(t) },
          { name: "more", label: moreLabel(t), badge: prayerBadge },
        ]}
      />
    )}
    </View>
    </TabCapsuleContentTopContext.Provider>
    </TabReselectContext.Provider>
  );
}

function ClassicTabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { t } = useTranslation();
  const { totalUnreadCount } = useData();
  const prayerBadge = usePrayerBadge();
  // Take the larger of the real device inset and the previous flat value —
  // preserves existing look on devices the old constants already covered,
  // and fixes the gap on devices (e.g. some Android gesture nav) where the
  // real home-indicator/gesture-bar inset exceeds it.
  const bottomInset = Math.max(insets.bottom, isWeb ? 34 : 8);

  const TAB_ITEMS = [
    { name: "index", label: t("tabs.home"), icon: "home" as const, iconActive: "home" as const },
    { name: "learn", label: t("tabs.learn"), icon: "school-outline" as const, iconActive: "school" as const },
    { name: "bible", label: bibleLabel(t), icon: "book-outline" as const, iconActive: "book" as const },
    { name: "messages", label: t("tabs.messages"), icon: "chatbubbles-outline" as const, iconActive: "chatbubbles" as const },
    { name: "profile", label: profileTabLabel(t), icon: "person-circle-outline" as const, iconActive: "person-circle" as const },
    // Prayer (its Wi-Fi icon: "God is the Hotspot and we are connecting to Him.") and Discover live here.
    { name: "more", label: moreLabel(t), icon: "ellipsis-horizontal-circle-outline" as const, iconActive: "ellipsis-horizontal-circle" as const },
  ];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentGreen,
        tabBarInactiveTintColor: "rgba(159,225,203,0.45)",
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.navBg,
          borderTopWidth: 1,
          borderTopColor: colors.navBorder,
          elevation: 0,
          height: (isWeb ? 50 : 54) + bottomInset,
          paddingBottom: bottomInset,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint="dark"
              style={[StyleSheet.absoluteFill, { backgroundColor: `${colors.navBg}D9` }]}
            />
          ) : null,
      }}
    >
      {TAB_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarLabel: ({ color }) => <TabLabel label={tab.label} color={color} baseFontSize={10} />,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={22}
                color={color}
              />
            ),
            ...(tab.name === "messages" && totalUnreadCount > 0
              ? { tabBarBadge: totalUnreadCount, tabBarBadgeStyle: { backgroundColor: "#C0392B" } }
              : {}),
            ...(tab.name === "more" && prayerBadge > 0
              ? { tabBarBadge: prayerBadge, tabBarBadgeStyle: { backgroundColor: "#C0392B" } }
              : {}),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
