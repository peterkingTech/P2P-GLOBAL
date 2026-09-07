import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radii, spacing, type } from "@/lib/togetherTheme";

interface Props {
  icon: string;
  label: string;
}

// A small, warm pill naming where the Gathering is right now (Worship,
// Scripture, Prayer Space, Teaching…) — the room's current posture, not
// a notification/status badge in the alert-count sense.
export default function GatheringBadge({ icon, label }: Props) {
  return (
    <View style={styles.badge} accessible accessibilityRole="text" accessibilityLabel={`Currently: ${label}`}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: colors.lightSoft, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: "flex-start",
  },
  icon: { fontSize: 11 },
  label: { color: colors.light, ...type.micro, fontFamily: "Inter_700Bold" },
});
