import React, { useMemo, useState } from "react";
import { Pressable, Text, View, ActivityIndicator, Platform, StyleSheet, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useButtonTokens, type ButtonPalette } from "./ButtonTheme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { createPressGuard } from "@/lib/pressGuard";
import { SIZES, LABEL_FONT, DISABLED_OPACITY, hitSlopFor, type ButtonSize, type ButtonVariant } from "@/lib/buttonTheme";

// The P2P Global button. Five variants (primary, secondary, tertiary, outline,
// destructive), three sizes, an optional icon either side.
//   • Loading: a spinner over the (hidden) label, so the width never jumps.
//   • One action at a time: if onPress returns a promise, further presses are
//     ignored until it settles (lib/pressGuard) — no double submits.
//   • Pressed / hover (web) / keyboard focus (web) / disabled states; a slight
//     press-in that is off when the device asks for reduced motion.
//   • Always announced as a button with its label and disabled / busy state.
// Visual only: whatever onPress did before, it still does.

type IconName = keyof typeof Ionicons.glyphMap;
export interface AppButtonProps {
  label: string;
  /** Unchanged handler; receives the press event like any tappable. */
  onPress?: (e: GestureResponderEvent) => unknown;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: "leading" | "trailing";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Colours: the reader's theme (default) or a fixed palette for screens not yet theme-aware. */
  palette?: ButtonPalette;
}

export default function AppButton({
  label, onPress, variant = "primary", size = "md", icon, iconPosition = "leading", loading = false, disabled = false,
  fullWidth = false, accessibilityLabel, accessibilityHint, style, testID, palette,
}: AppButtonProps) {
  const t = useButtonTokens(palette);
  const reduceMotion = useReduceMotion();
  const [running, setRunning] = useState(false);
  const guard = useMemo(() => createPressGuard(setRunning), []);
  const v = t.variants[variant];
  const z = SIZES[size];
  const busy = loading || running;
  const inactive = disabled || busy;
  const iconEl = icon ? <Ionicons name={icon} size={z.icon} color={v.fg} /> : null;

  return (
    <Pressable
      testID={testID}
      onPress={(e) => { if (!inactive && onPress) guard.press(() => onPress(e)); }}
      disabled={inactive}
      hitSlop={hitSlopFor(z.height)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      style={(state) => {
        const { pressed } = state;
        const hovered = Platform.OS === "web" && (state as { hovered?: boolean }).hovered;
        const focused = Platform.OS === "web" && (state as { focused?: boolean }).focused;
        return [
          styles.base,
          { minHeight: z.height, paddingHorizontal: z.padX, borderRadius: z.radius, gap: z.gap, backgroundColor: pressed ? v.pressedBg : hovered ? v.hoverBg : v.bg },
          v.border ? { borderWidth: 1, borderColor: v.border } : null,
          fullWidth ? styles.full : null,
          disabled ? { opacity: DISABLED_OPACITY } : null,
          pressed && !reduceMotion ? styles.pressedScale : null,
          focused ? ({ outlineColor: t.focus, outlineWidth: 2, outlineStyle: "solid", outlineOffset: 2 } as ViewStyle) : null,
          style,
        ];
      }}
    >
      <View style={[styles.content, { gap: z.gap }, busy && styles.hidden]} importantForAccessibility="no-hide-descendants">
        {iconPosition === "leading" ? iconEl : null}
        <Text style={[styles.label, { color: v.fg, fontSize: z.font, lineHeight: Math.round(z.font * 1.3) }]} numberOfLines={2}>{label}</Text>
        {iconPosition === "trailing" ? iconEl : null}
      </View>
      {busy ? <View style={styles.spinner} pointerEvents="none"><ActivityIndicator size="small" color={t.spinner[variant]} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Like any tappable: a column stretches it, a row fits it to its label.
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", position: "relative" },
  full: { alignSelf: "stretch" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  hidden: { opacity: 0 },
  spinner: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: LABEL_FONT, textAlign: "center", flexShrink: 1 },
  pressedScale: { transform: [{ scale: 0.98 }] },
});
