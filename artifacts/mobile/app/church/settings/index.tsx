import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

// Same stacked-list -> pushed-sub-screen shape as app/settings/index.tsx,
// reusing the church feature's own static `colors` (matching every other
// church/*.tsx screen) rather than the useTheme() system settings/* uses
// elsewhere in the app.

interface Section {
  emoji: string; title: string; subtitle: string; route: string; creatorOnly?: boolean;
}

const SECTIONS: Section[] = [
  { emoji: "⛪", title: "General", subtitle: "Church name, type, description", route: "/church/settings/general", creatorOnly: true },
  { emoji: "📍", title: "Profile", subtitle: "Location, contact, website", route: "/church/settings/profile", creatorOnly: true },
  { emoji: "🎨", title: "Branding", subtitle: "Church logo", route: "/church/settings/branding", creatorOnly: true },
  { emoji: "🔗", title: "Social Media", subtitle: "Facebook, Instagram, YouTube, and more", route: "/church/settings/social-media", creatorOnly: true },
  { emoji: "🛡️", title: "Church Admins", subtitle: "Add or remove church administrators", route: "/church/settings/admins", creatorOnly: true },
  { emoji: "🎯", title: "Learning", subtitle: "Lesson of the day/week/month, learning goals", route: "/church/settings/learning" },
  { emoji: "📢", title: "Announcements", subtitle: "Drafts, scheduled, and published posts", route: "/church/settings/announcements" },
  { emoji: "🔒", title: "Privacy", subtitle: "Location visibility", route: "/church/settings/privacy", creatorOnly: true },
];

export default function ChurchSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isChurchCreator } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Church Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((s) => {
          const locked = s.creatorOnly && !isChurchCreator;
          return (
            <TouchableOpacity key={s.route} style={styles.row} activeOpacity={0.8} onPress={() => router.push(s.route as any)}>
              <Text style={styles.rowEmoji}>{s.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTitleRow}>
                  <Text style={styles.rowTitle}>{s.title}</Text>
                  {locked && <Ionicons name="lock-closed" size={12} color={colors.textMuted} />}
                </View>
                <Text style={styles.rowSubtitle} numberOfLines={1}>{s.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.borderBeige} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 10,
  },
  rowEmoji: { fontSize: 24 },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  rowSubtitle: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
});