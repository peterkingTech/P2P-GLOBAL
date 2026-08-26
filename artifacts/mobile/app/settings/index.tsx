import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useData } from "@/contexts/DataContext";

// Phone-style nested Settings — this screen shows only category rows, each
// navigating to its own sub-screen (settings/account.tsx, settings/language.tsx,
// etc). Nothing else lives here; all the actual fields moved into the
// sub-screens listed below.

interface Category {
  emoji: string;
  title: string;
  subtitle: string;
  route: string;
}

const CATEGORIES: Category[] = [
  { emoji: "🔔", title: "Notification Center", subtitle: "See your notifications, including study leadership updates", route: "/notifications" },
  { emoji: "⚙️", title: "Account", subtitle: "Profile, Email, Password, Delete Account", route: "/settings/account" },
  { emoji: "🌍", title: "Language and Region", subtitle: "App Language, Content Language, Date Format", route: "/settings/language" },
  { emoji: "🔔", title: "Notifications", subtitle: "Session Reminders, Peer Guide Alerts, Fruit Awards, Weekly Encouragement, Elijah Protocol", route: "/settings/notifications" },
  { emoji: "🔒", title: "Privacy", subtitle: "Profile Visibility, Data and Analytics", route: "/settings/privacy" },
  { emoji: "🎯", title: "My Goals", subtitle: "View and update your discipleship goals", route: "/settings/goals" },
  { emoji: "📖", title: "Kingdom School", subtitle: "Learning preferences, Session format", route: "/settings/kingdom-school" },
  { emoji: "🙏", title: "Prayer", subtitle: "Morning confession reminder, Prayer notification", route: "/settings/prayer" },
  { emoji: "ℹ️", title: "About", subtitle: "App version, Terms, Privacy Policy, Contact", route: "/settings/about" },
];

export default function SettingsIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { unreadNotificationCount } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.route}
            style={styles.row}
            activeOpacity={0.8}
            onPress={() => router.push(cat.route as any)}
          >
            <Text style={styles.rowEmoji}>{cat.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{cat.title}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>{cat.subtitle}</Text>
            </View>
            {cat.route === "/notifications" && unreadNotificationCount > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{unreadNotificationCount}</Text></View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.borderBeige} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    content: { paddingHorizontal: 20, paddingTop: 16 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 10,
    },
    rowEmoji: { fontSize: 24 },
    rowTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    rowSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    badge: { backgroundColor: "#C0392B", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}