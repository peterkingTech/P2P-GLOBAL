import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, AppearanceMode } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

const MODES: { id: AppearanceMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "light", label: "Light", icon: "sunny" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "phone-portrait" },
];

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, style, mode, setMode } = useTheme();
  const styles = makeStyles(colors);

  const modeLocked = style.isExisting;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appearance</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>THEME MODE</Text>
        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modeOption, active && styles.modeOptionActive, modeLocked && styles.modeOptionDisabled]}
                onPress={() => !modeLocked && setMode(m.id)}
                disabled={modeLocked}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${m.label} mode${active ? ", selected" : ""}`}
              >
                <Ionicons name={m.icon} size={18} color={active ? "#fff" : colors.textMid} />
                <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {modeLocked && (
          <Text style={styles.modeHint}>
            "{style.name}" is one of the original P2P Global looks with a fixed light or dark appearance. Choose a different App Style below to use Light/Dark/System mode.
          </Text>
        )}

        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>APP STYLE</Text>
        <TouchableOpacity
          style={styles.styleRow}
          activeOpacity={0.85}
          onPress={() => router.push("/settings/app-style" as any)}
          accessibilityRole="button"
          accessibilityLabel={`App Style. Currently ${style.name}. Tap to change.`}
        >
          <Text style={styles.styleEmoji}>{style.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.styleTitle}>{style.name}</Text>
            <Text style={styles.styleSubtitle} numberOfLines={1}>{style.description}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.borderBeige} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.detailsRow}
          activeOpacity={0.85}
          onPress={() => router.push("/settings/style-details" as any)}
          accessibilityRole="button"
          accessibilityLabel="Style Details — illustration level"
        >
          <Ionicons name="sparkles-outline" size={18} color={colors.primaryGreen} />
          <Text style={styles.detailsText}>Style Details</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
        </TouchableOpacity>
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
    content: { paddingHorizontal: 20, paddingTop: 20 },
    sectionLabel: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 10 },
    modeRow: { flexDirection: "row", gap: 10 },
    modeOption: {
      flex: 1, alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 14,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    modeOptionActive: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    modeOptionDisabled: { opacity: 0.5 },
    modeLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    modeLabelActive: { color: "#fff" },
    modeHint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 10 },
    styleRow: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16,
    },
    styleEmoji: { fontSize: 28 },
    styleTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    styleSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    detailsRow: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginTop: 12,
    },
    detailsText: { flex: 1, fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}