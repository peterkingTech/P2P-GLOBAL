import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, type } from "@/lib/togetherTheme";
import type { VoicePhase } from "@/hooks/useVoiceSpace";

interface Props {
  phase: VoicePhase;
  compact?: boolean;
}

const STATE: Record<VoicePhase, { label: string; color: string }> = {
  idle: { label: "Voice Space not joined", color: colors.textFaint },
  connecting: { label: "Connecting…", color: colors.light },
  connected: { label: "Connection Health: Good", color: colors.growth },
  failed: { label: "Connection lost", color: colors.rest },
};

// A dot alone never carries meaning on its own — every state also has a
// plain-language label, both for sighted users glancing quickly and for
// screen readers (accessibilityLabel mirrors the visible text exactly,
// via accessibilityValue.text so it reads as a live status, not a static label).
export default function ConnectionHealth({ phase, compact }: Props) {
  const state = STATE[phase];
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel="Voice connection status"
      accessibilityValue={{ text: state.label }}
    >
      <View style={[styles.dot, { backgroundColor: state.color }]} />
      {!compact && <Text style={styles.label}>{state.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: colors.textSecondary, ...type.caption },
});
