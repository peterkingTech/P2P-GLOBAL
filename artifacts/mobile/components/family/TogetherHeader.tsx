import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import GatheringBadge from "./GatheringBadge";
import type { FamilyIconName } from "./FamilyIcon";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import { AppButton } from "@/components/ui";

interface Props {
  onBack: () => void;
  title: string;
  modeIcon: FamilyIconName;
  modeLabel: string;
  participantCount: number;
  showEnd: boolean;
  onEnd: () => void;
  showShare?: boolean;
  onShare?: () => void;
}

// The Gathering's own header — a title, the live GatheringBadge, and a
// participant count on the left; End (Guide/Shepherd only) on the right.
// No app-icon rail, no channel/server switcher — this is the top of one
// room, not navigation chrome.
export default function TogetherHeader({ onBack, title, modeIcon, modeLabel, participantCount, showEnd, onEnd, showShare, onShare }: Props) {
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Leave Family Circle Gathering">
        <Ionicons name="chevron-down" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.metaRow}>
          <GatheringBadge icon={modeIcon} label={modeLabel} />
          <Text style={styles.count}>{participantCount} together</Text>
        </View>
      </View>
      {showShare && (
        <TouchableOpacity onPress={onShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Share Room">
          <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      )}
      {showEnd && (
        <AppButton label="End" onPress={onEnd} variant="secondary" icon="call" accessibilityLabel="End this Gathering for everyone" palette="fixedDark" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  center: { flex: 1, marginLeft: spacing.sm, gap: spacing.xs },
  title: { color: colors.textPrimary, ...type.display },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  count: { color: colors.textSecondary, ...type.caption },
  // The universal hang-up glyph: the phone handset turned down.
  endIcon: { transform: [{ rotate: "135deg" }] },
});
