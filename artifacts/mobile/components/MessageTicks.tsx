import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { statusAccessibilityLabel, type OutgoingStatus } from "@/lib/messageReceipts";

// Compact status shown beside the time on the user's own message bubble
// (green, white text — see app/messages/[id].tsx bubbleMine):
//   sending   small spinner
//   sent      one grey tick
//   delivered two grey ticks
//   read      two blue ticks
//   failed    red alert + "Not sent · Retry"
// Every state has its own screen-reader label, so colour is never the only
// cue (delivered vs read differ only in colour visually, as in WhatsApp).

export const TICK_COLORS = {
  grey: "rgba(255,255,255,0.72)",
  read: "#8FD8FF",
  failed: "#FFD7D7",
};
// Emoji-only bubbles have no green background (cream page behind them).
export const TICK_COLORS_ON_LIGHT = {
  grey: "#8A7B5C",
  read: "#2563EB",
  failed: "#B91C1C",
};

export function MessageTicks({
  status,
  timeLabel,
  onPress,
  onLight = false,
}: {
  status: OutgoingStatus;
  timeLabel: string;
  /** Opens message info (persisted) or retries (failed). */
  onPress?: () => void;
  onLight?: boolean;
}) {
  const palette = onLight ? TICK_COLORS_ON_LIGHT : TICK_COLORS;
  const label = `${timeLabel}. ${statusAccessibilityLabel(status)}`;
  const hint = status === "failed" ? "Double tap to try sending again" : onPress ? "Double tap for message info" : undefined;
  const content = (
    <View style={styles.row}>
      {status === "failed" ? (
        <Text style={[styles.text, styles.failedText, { color: palette.failed }]} numberOfLines={1}>Not sent · Retry</Text>
      ) : (
        <Text style={[styles.text, { color: palette.grey }]} numberOfLines={1}>{timeLabel}</Text>
      )}
      <StatusGlyph status={status} palette={palette} />
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={styles.wrap} testID={`ticks-${status}`}>
        {content}
      </View>
    );
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 12 }}
      style={styles.wrap}
      testID={`ticks-${status}`}
    >
      {content}
    </TouchableOpacity>
  );
}

export function StatusGlyph({ status, size = 14, palette = TICK_COLORS }: {
  status: OutgoingStatus; size?: number; palette?: typeof TICK_COLORS;
}) {
  switch (status) {
    case "sending":
      return <ActivityIndicator size="small" color={palette.grey} style={{ transform: [{ scale: 0.6 }], width: size, height: size }} />;
    case "failed":
      return <Ionicons name="alert-circle" size={size} color={palette.failed} />;
    case "sent":
      return <Ionicons name="checkmark" size={size} color={palette.grey} />;
    case "delivered":
      return <Ionicons name="checkmark-done" size={size} color={palette.grey} />;
    case "read":
      return <Ionicons name="checkmark-done" size={size} color={palette.read} />;
  }
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-end", marginTop: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  text: { fontSize: 11, fontFamily: "Inter_400Regular" },
  failedText: { fontFamily: "Inter_600SemiBold" },
});
