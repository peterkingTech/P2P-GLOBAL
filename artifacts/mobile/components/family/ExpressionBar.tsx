import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { colors, radii, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";

interface Props {
  emojis: string[];
  onSend: (emoji: string) => void;
}

// Lightweight, ephemeral expressions — a row of plain emoji buttons, not
// a picker/tray UI borrowed from any chat app.
export default function ExpressionBar({ emojis, onSend }: Props) {
  return (
    <View style={styles.row}>
      {emojis.map((emoji) => (
        <TouchableOpacity
          key={emoji} style={styles.btn} onPress={() => onSend(emoji)}
          accessibilityRole="button" accessibilityLabel={`Send ${emoji} expression`}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  btn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 18 },
});
