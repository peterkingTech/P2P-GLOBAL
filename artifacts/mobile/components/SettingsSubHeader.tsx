import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

// Shared back-button + title header for every settings/* sub-screen, so each
// one doesn't hand-roll the same row.
export default function SettingsSubHeader({ title }: { title: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: colors.borderBeige }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.textDark} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.textDark }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
});