import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { EnvironmentSetting } from "./TreeEnvironment";
import colors from "@/constants/colors";

const OPTIONS: { id: EnvironmentSetting; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "auto", label: "Auto", icon: "partly-sunny-outline" },
  { id: "garden", label: "Garden", icon: "flower-outline" },
  { id: "mountain", label: "Mountain", icon: "triangle-outline" },
  { id: "countryside", label: "Countryside", icon: "trail-sign-outline" },
  { id: "forest", label: "Forest", icon: "leaf-outline" },
  { id: "riverside", label: "Riverside", icon: "water-outline" },
];

interface EnvironmentPickerProps {
  value: EnvironmentSetting;
  onChange: (setting: EnvironmentSetting) => void;
}

// Purely cosmetic: changing this only changes the backdrop behind the tree.
// It never touches growth score, stage, or fruit — the same tree exists
// underneath regardless of which setting is chosen.
export default function EnvironmentPicker({ value, onChange }: EnvironmentPickerProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {OPTIONS.map((opt) => {
        const active = opt.id === value;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(opt.id)}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label} environment${active ? ", selected" : ""}`}
          >
            <Ionicons name={opt.icon} size={14} color={active ? "#fff" : colors.textMid} />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 4 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  chipTextActive: { color: "#fff" },
});