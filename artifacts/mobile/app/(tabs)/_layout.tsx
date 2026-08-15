import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Badge, Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
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
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>{t("tabs.home")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <Icon sf={{ default: "book", selected: "book.fill" }} />
        <Label>{getLearnTabLabel(t("tabs.learn"), i18n.language)}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <Icon sf={{ default: "message", selected: "message.fill" }} />
        <Label>{t("tabs.messages")}</Label>
        <Badge hidden={totalUnreadCount === 0}>{String(totalUnreadCount)}</Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="prayer">
        <Icon sf={{ default: "hands.sparkles", selected: "hands.sparkles.fill" }} />
        <Label>{t("tabs.prayer")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="missions">
        <Icon sf={{ default: "globe.americas", selected: "globe.americas.fill" }} />
        <Label>{t("tabs.missions")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="discover">
        <Icon sf={{ default: "safari", selected: "safari.fill" }} />
        <Label>{t("tabs.discover")}</Label>
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
    { name: "prayer", label: t("tabs.prayer"), icon: "radio-outline" as const, iconActive: "radio" as const },
    { name: "missions", label: t("tabs.missions"), icon: "earth-outline" as const, iconActive: "earth" as const },
    { name: "discover", label: t("tabs.discover"), icon: "compass-outline" as const, iconActive: "compass" as const },
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
