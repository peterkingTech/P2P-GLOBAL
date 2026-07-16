import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import "@/lib/i18n";

function NativeTabLayout() {
  const { t } = useTranslation();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>{t("tabs.home")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <Icon sf={{ default: "book", selected: "book.fill" }} />
        <Label>{t("tabs.learn")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="prayer">
        <Icon sf={{ default: "hands.sparkles", selected: "hands.sparkles.fill" }} />
        <Label>{t("tabs.prayer")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <Icon sf={{ default: "message", selected: "message.fill" }} />
        <Label>{t("tabs.messages")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="missions">
        <Icon sf={{ default: "globe.americas", selected: "globe.americas.fill" }} />
        <Label>{t("tabs.missions")}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { colors } = useTheme();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { t } = useTranslation();

  const TAB_ITEMS = [
    { name: "index", label: t("tabs.home"), icon: "home" as const, iconActive: "home" as const },
    { name: "learn", label: t("tabs.learn"), icon: "book-outline" as const, iconActive: "book" as const },
    { name: "prayer", label: t("tabs.prayer"), icon: "radio-outline" as const, iconActive: "radio" as const },
    { name: "messages", label: t("tabs.messages"), icon: "chatbubbles-outline" as const, iconActive: "chatbubbles" as const },
    { name: "missions", label: t("tabs.missions"), icon: "earth-outline" as const, iconActive: "earth" as const },
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
          height: isWeb ? 84 : 62,
          paddingBottom: isWeb ? 34 : 8,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint="dark"
              style={[StyleSheet.absoluteFill, { backgroundColor: `${colors.navBg}D9` }]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "Inter_500Medium",
          marginTop: -2,
        },
      }}
    >
      {TAB_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={22}
                color={color}
              />
            ),
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
