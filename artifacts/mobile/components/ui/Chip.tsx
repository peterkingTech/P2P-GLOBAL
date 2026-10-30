import React from "react";
import { Pressable, Text, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useButtonTokens } from "./ButtonTheme";
import { DISABLED_OPACITY, LABEL_FONT, hitSlopFor } from "@/lib/buttonTheme";

// Chips — the only rounded "pill" shapes in the button system.
//   Chip       — a small action (e.g. a topic, "Add filter"); announced as a button.
//   FilterChip — a choice that is on or off. `selection="multiple"` (any number
//                on) is announced as a checkbox; `selection="single"` (one of a
//                set) as a radio button. Selected chips show a check mark as well
//                as the filled colour, so the state never relies on colour alone.

type IconName = keyof typeof Ionicons.glyphMap;
const HEIGHT = 36;

function chipStyle(bg: string, border: string, pressedBg: string, focus: string, disabled?: boolean, style?: StyleProp<ViewStyle>) {
  return (state: { pressed: boolean }) => {
    const focused = Platform.OS === "web" && (state as { focused?: boolean }).focused;
    return [
      { minHeight: HEIGHT, paddingHorizontal: 14, borderRadius: HEIGHT / 2, borderWidth: 1, borderColor: border, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: state.pressed ? pressedBg : bg } as ViewStyle,
      disabled ? { opacity: DISABLED_OPACITY } : null,
      focused ? ({ outlineColor: focus, outlineWidth: 2, outlineStyle: "solid", outlineOffset: 2 } as ViewStyle) : null,
      style,
    ];
  };
}

export function Chip({ label, onPress, icon, disabled, accessibilityLabel, style }: {
  label: string; onPress?: () => void; icon?: IconName; disabled?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useButtonTokens();
  const c = t.chip;
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={hitSlopFor(HEIGHT)} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }} style={chipStyle(c.bg, c.border, c.pressedBg, t.focus, disabled, style)}>
      {icon ? <Ionicons name={icon} size={15} color={c.fg} /> : null}
      <Text style={{ color: c.fg, fontSize: 13, fontFamily: LABEL_FONT }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function FilterChip({ label, selected, onPress, selection = "multiple", disabled, icon, accessibilityLabel, style }: {
  label: string; selected: boolean; onPress: () => void; selection?: "single" | "multiple"; disabled?: boolean; icon?: IconName; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useButtonTokens();
  const c = t.chip;
  const fg = selected ? c.selectedFg : c.fg;
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={hitSlopFor(HEIGHT)}
      accessibilityRole={selection === "single" ? "radio" : "checkbox"} accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, selected, disabled: !!disabled }} aria-checked={selected} aria-selected={selected}
      style={chipStyle(selected ? c.selectedBg : c.bg, selected ? c.selectedBg : c.border, selected ? c.selectedBg : c.pressedBg, t.focus, disabled, style)}>
      {selected ? <Ionicons name="checkmark" size={15} color={fg} /> : icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 13, fontFamily: LABEL_FONT }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** A row of chips that wraps; use for filter groups. */
export function ChipRow({ children, accessibilityLabel, single }: { children: React.ReactNode; accessibilityLabel: string; single?: boolean }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole={single ? "radiogroup" : undefined} accessibilityLabel={accessibilityLabel}>{children}</View>;
}
