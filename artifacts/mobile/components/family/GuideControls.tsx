import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { colors, radii, spacing, type } from "@/lib/togetherTheme";
import type { WorshipMode } from "@/lib/familyApi";

interface Props {
  modes: { key: WorshipMode; label: string; icon: string }[];
  currentMode: WorshipMode;
  onChange: (mode: WorshipMode) => void;
}

// The Guide's mode switcher — moves the whole Gathering between Worship,
// Scripture, Prayer Space, Teaching, etc. Visible only to the Guide (the
// caller decides that), so this component only renders the row itself.
export default function GuideControls({ modes, currentMode, onChange }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {modes.map((m) => {
        const active = currentMode === m.key;
        return (
          <TouchableOpacity
            key={m.key}
            style={[styles.btn, active && styles.btnActive]}
            onPress={() => onChange(m.key)}
            accessibilityRole="tab"
            accessibilityLabel={`Switch the Gathering to ${m.label}`}
            accessibilityState={{ selected: active }}
          >
            <Text style={styles.icon}>{m.icon}</Text>
            <Text style={styles.label}>{m.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  btn: { alignItems: "center", gap: 2, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: radii.md, minWidth: 44 },
  btnActive: { backgroundColor: colors.lightSoft },
  icon: { fontSize: 16 },
  label: { color: colors.textSecondary, ...type.micro },
});
