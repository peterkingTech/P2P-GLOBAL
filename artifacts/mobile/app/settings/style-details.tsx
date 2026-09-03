import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, IllustrationLevel } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

const LEVELS: { id: IllustrationLevel; label: string; description: string }[] = [
  { id: "minimal", label: "Minimal", description: "Color palette only — no decorative artwork." },
  { id: "balanced", label: "Balanced", description: "Subtle decorative touches in a few places, like empty states and welcome screens. Recommended." },
  { id: "expressive", label: "Expressive", description: "More visual personality, while core screens stay fully readable." },
];

export default function StyleDetailsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, illustrationLevel, setIllustrationLevel } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Style Details</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Choose how much decorative personality your App Style shows.</Text>
        {LEVELS.map((lvl) => {
          const active = illustrationLevel === lvl.id;
          return (
            <TouchableOpacity
              key={lvl.id}
              style={[styles.row, active && styles.rowActive]}
              onPress={() => setIllustrationLevel(lvl.id)}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${lvl.label}. ${lvl.description}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, active && { color: colors.primaryGreen }]}>{lvl.label}</Text>
                <Text style={styles.rowDesc}>{lvl.description}</Text>
              </View>
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={active ? colors.primaryGreen : colors.borderBeige}
              />
            </TouchableOpacity>
          );
        })}
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
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 16 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 10,
    },
    rowActive: { borderColor: c.primaryGreen },
    rowTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 3 },
    rowDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
  });
}