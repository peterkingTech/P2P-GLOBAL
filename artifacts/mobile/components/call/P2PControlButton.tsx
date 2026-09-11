import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import type { P2PCallColors } from "./p2pCallTheme";
import { P2P_END_CALL_RED } from "./p2pCallTheme";

// One shared circular control-button style for both Audio and Video call
// screens — the "same design language" requirement. Callers pass their own
// icon and onPress; this owns only shape/color/sizing.
//
// `danger` (End Call) is the one deliberate exception to "colors come from
// the theme": it is hardcoded to P2P_END_CALL_RED regardless of the active
// style or light/dark mode, per the mandate's explicit "must remain RED,
// do NOT theme the End Call button" instruction — every other state here
// (normal/active/disabled) derives from the caller's resolved theme.
export function P2PControlButton({
  onPress, disabled, danger, active, children, label, accessibilityLabel, colors,
}: {
  onPress: () => void; disabled?: boolean; danger?: boolean; active?: boolean;
  children: React.ReactNode; label?: string; accessibilityLabel: string; colors: P2PCallColors;
}) {
  const bg = danger ? P2P_END_CALL_RED : active ? colors.pillBg : colors.surface;
  const border = danger ? P2P_END_CALL_RED : active ? colors.accent : colors.surfaceBorder;

  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: bg, borderColor: border }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
      {!!label && <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", gap: 2,
    borderWidth: 1,
  },
  disabled: { opacity: 0.4 },
  label: { position: "absolute", bottom: -18, fontSize: 10, fontFamily: "Inter_500Medium" },
});
