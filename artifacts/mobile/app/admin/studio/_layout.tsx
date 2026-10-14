import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STUDIO_TABS, STUDIO_VIEW_ROLES } from "@/lib/studioModel";
import { StateView } from "@/components/studio/StudioUI";
import { StudioApiError } from "@/lib/studioApi";

// Publishing Studio section inside the existing admin shell (app/admin/
// _layout.tsx provides auth, the admin role gate and the top navigation).
// This adds the Studio's own sub-navigation and the Create Content entry
// point. The role check here only decides what to display; /api/studio
// enforces every rule on every request.

export default function StudioLayout() {
  const { profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  if (profile && !STUDIO_VIEW_ROLES.includes(profile.role)) {
    return (
      <View style={styles.root}>
        <StateView error={new StudioApiError("Your role does not include the Publishing Studio.", "permission", 403)} />
      </View>
    );
  }

  const createActive = pathname.startsWith("/admin/studio/create");
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.heading} accessibilityRole="header">Publishing Studio</Text>
          <TouchableOpacity
            style={[styles.create, createActive && styles.createActive]}
            onPress={() => router.push("/admin/studio/create" as any)}
            accessibilityRole="button"
            accessibilityLabel="Create content"
            accessibilityState={{ selected: createActive }}
            aria-selected={createActive}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.createText}>Create</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {STUDIO_TABS.map((t) => {
            const active = "exact" in t && t.exact ? pathname === t.path || pathname === `${t.path}/` : pathname.startsWith(t.path);
            return (
              <TouchableOpacity
                key={t.path}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => router.push(t.path as any)}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: active }}
                aria-selected={active}
              >
                <Ionicons name={t.icon as any} size={15} color={active ? "#fff" : colors.textMid} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}><Slot /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  header: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { fontSize: 18, color: colors.textDark, fontFamily: "Inter_700Bold", flexShrink: 1 },
  create: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 14, minHeight: 44 },
  createActive: { backgroundColor: colors.primaryGreen },
  createText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabs: { gap: 6 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  tabActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  tabText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  tabTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
});
