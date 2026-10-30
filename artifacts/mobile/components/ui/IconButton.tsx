import React, { useMemo, useState } from "react";
import { Pressable, Platform, ActivityIndicator, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useButtonTokens, type ButtonPalette } from "./ButtonTheme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { createPressGuard } from "@/lib/pressGuard";
import { DISABLED_OPACITY, hitSlopFor, type IconButtonVariant } from "@/lib/buttonTheme";

// A compact action shown as an icon: Search, Close, More, Edit, Previous…
//   plain   — no surface, for headers and toolbars;
//   tinted  — a soft surface, for standalone actions;
//   overlay — a dark scrim and white glyph, readable over artwork and video.
// The label is required (it is what a screen reader says). Small (36) still
// offers a 44-point target. `selected` is announced, never shown by colour alone
// (pass a different `selectedIcon`, e.g. "bookmark" vs "bookmark-outline").

type IconName = keyof typeof Ionicons.glyphMap;
export interface IconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: (e: GestureResponderEvent) => unknown;
  variant?: IconButtonVariant;
  size?: "sm" | "md";
  selected?: boolean;
  selectedIcon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Overrides the glyph colour (e.g. a red heart). */
  color?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  palette?: ButtonPalette;
}

export default function IconButton({
  icon, accessibilityLabel, onPress, variant = "plain", size = "md", selected, selectedIcon, disabled = false, loading = false,
  color, accessibilityHint, style, testID, palette,
}: IconButtonProps) {
  const t = useButtonTokens(palette);
  const reduceMotion = useReduceMotion();
  const [running, setRunning] = useState(false);
  const guard = useMemo(() => createPressGuard(setRunning), []);
  const v = t.icon[variant];
  const box = size === "sm" ? 36 : 44;
  const busy = loading || running;
  const inactive = disabled || busy;
  const fg = color ?? v.fg;
  return (
    <Pressable
      testID={testID}
      onPress={(e) => { if (!inactive && onPress) guard.press(() => onPress(e)); }}
      disabled={inactive}
      hitSlop={hitSlopFor(box)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy, ...(selected === undefined ? {} : { selected }) }}
      style={(state) => {
        const hovered = Platform.OS === "web" && (state as { hovered?: boolean }).hovered;
        const focused = Platform.OS === "web" && (state as { focused?: boolean }).focused;
        return [
          { width: box, height: box, borderRadius: box / 2, alignItems: "center", justifyContent: "center", backgroundColor: state.pressed ? v.pressedBg : hovered ? v.hoverBg : v.bg } as ViewStyle,
          disabled ? { opacity: DISABLED_OPACITY } : null,
          state.pressed && !reduceMotion ? { transform: [{ scale: 0.94 }] } : null,
          focused ? ({ outlineColor: t.focus, outlineWidth: 2, outlineStyle: "solid", outlineOffset: 2 } as ViewStyle) : null,
          style,
        ];
      }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} />
        : <Ionicons name={selected && selectedIcon ? selectedIcon : icon} size={size === "sm" ? 18 : 22} color={fg} />}
    </Pressable>
  );
}
