import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import colors from "@/constants/colors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <Icon sf={{ default: "book", selected: "book.fill" }} />
        <Label>Learn</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="connect">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Connect</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="forest">
        <Icon sf={{ default: "tree", selected: "tree.fill" }} />
        <Label>Forest</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="prayer">
        <Icon sf={{ default: "hands.sparkles", selected: "hands.sparkles.fill" }} />
        <Label>Prayer</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="missions">
        <Icon sf={{ default: "globe.americas", selected: "globe.americas.fill" }} />
        <Label>Missions</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colorScheme = useColorScheme();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const TAB_ITEMS = [
    { name: "index", label: "Home", icon: "home" as const, iconActive: "home" as const },
    { name: "learn", label: "Learn", icon: "book-outline" as const, iconActive: "book" as const },
    { name: "connect", label: "Connect", icon: "people-outline" as const, iconActive: "people" as const },
    { name: "forest", label: "Forest", icon: "git-branch-outline" as const, iconActive: "git-branch" as const },
    { name: "prayer", label: "Prayer", icon: "radio-outline" as const, iconActive: "radio" as const },
    { name: "missions", label: "Missions", icon: "earth-outline" as const, iconActive: "earth" as const },
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
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(11,58,46,0.85)" }]}
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
