import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useData } from "@/contexts/DataContext";
import { isSmallPhone } from "@/lib/responsive";
import "@/lib/i18n";

// "Kingdom School" only actually needs shortening on narrow phones — every
// other locale already uses a short generic word for this tab (e.g.
// "Apprendre"/"Lernen"/"Jifunza"), so the swap only applies in English.
function getLearnTabLabel(fullLabel: string, language: string): string {
  if (isSmallPhone && language.startsWith("en")) return "K-School";
  return fullLabel;
}

// No locale has a tabs.profile key yet; every locale already translates
// home.myProfile, so that is the fallback rather than an English-only label.
function profileTabLabel(t: (key: string, opts?: Record<string, unknown>) => string): string {
  return t("tabs.profile", { defaultValue: t("home.myProfile") });
}

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
  const { t, i18n } = useTranslation();
  const { totalUnreadCount } = useData();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.home")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <NativeTabs.Trigger.Icon sf={{ default: "book", selected: "book.fill" }} />
        <NativeTabs.Trigger.Label>{getLearnTabLabel(t("tabs.learn"), i18n.language)}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf={{ default: "message", selected: "message.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.messages")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={totalUnreadCount === 0}>{String(totalUnreadCount)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="prayer">
        <NativeTabs.Trigger.Icon sf={{ default: "hands.sparkles", selected: "hands.sparkles.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.prayer")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Icon sf={{ default: "safari", selected: "safari.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.discover")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>{profileTabLabel(t)}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { t, i18n } = useTranslation();
  const { totalUnreadCount } = useData();
  // Take the larger of the real device inset and the previous flat value —
  // preserves existing look on devices the old constants already covered,
  // and fixes the gap on devices (e.g. some Android gesture nav) where the
  // real home-indicator/gesture-bar inset exceeds it.
  const bottomInset = Math.max(insets.bottom, isWeb ? 34 : 8);

  const TAB_ITEMS = [
    { name: "index", label: t("tabs.home"), icon: "home" as const, iconActive: "home" as const },
    { name: "learn", label: getLearnTabLabel(t("tabs.learn"), i18n.language), icon: "book-outline" as const, iconActive: "book" as const },
    { name: "messages", label: t("tabs.messages"), icon: "chatbubbles-outline" as const, iconActive: "chatbubbles" as const },
    // Wi-Fi/connectivity icon, not the prior hotspot-style "radio" icon —
    // "God is the Hotspot and we are connecting to Him." Label/route/nav
    // all unchanged; only the icon glyphs changed.
    { name: "prayer", label: t("tabs.prayer"), icon: "wifi-outline" as const, iconActive: "wifi" as const },
    { name: "discover", label: t("tabs.discover"), icon: "compass-outline" as const, iconActive: "compass" as const },
    { name: "profile", label: profileTabLabel(t), icon: "person-circle-outline" as const, iconActive: "person-circle" as const },
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
