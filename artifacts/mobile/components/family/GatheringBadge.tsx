import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radii, spacing, type } from "@/lib/togetherTheme";
import FamilyIcon, { type FamilyIconName } from "./FamilyIcon";

interface Props {
  icon: FamilyIconName;
  label: string;
}

export default function GatheringBadge({ icon, label }: Props) {
  return (
    <View style={styles.badge} accessible accessibilityRole="text" accessibilityLabel={`Currently: ${label}`}>
      <FamilyIcon name={icon} size={12} active color={colors.light} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: colors.lightSoft, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: "flex-start",
  },
  label: { color: colors.light, ...type.micro, fontFamily: "Inter_700Bold" },
});
