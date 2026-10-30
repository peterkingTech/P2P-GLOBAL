import React from "react";
import { View, Pressable, Text, Platform, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useButtonTokens } from "./ButtonTheme";
import { LABEL_FONT } from "@/lib/buttonTheme";

// Choose one of two to five related options (e.g. In progress / Completed).
// Announced as a radio group: each option says whether it is chosen. The
// chosen option is raised, bold and announced — never colour alone.

type IconName = keyof typeof Ionicons.glyphMap;
export interface SegmentOption<V extends string> { value: V; label: string; icon?: IconName }

export default function SegmentedControl<V extends string>({ options, value, onChange, accessibilityLabel, style }: {
  options: SegmentOption<V>[]; value: V; onChange: (v: V) => void; accessibilityLabel: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useButtonTokens();
  const s = t.segment;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}
      style={[{ flexDirection: "row", padding: 3, gap: 3, borderRadius: 12, backgroundColor: s.track, alignSelf: "flex-start", maxWidth: "100%" }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => { if (!on) onChange(o.value); }} accessibilityRole="radio" accessibilityLabel={o.label}
            accessibilityState={{ checked: on, selected: on }}
            style={(state) => {
              const focused = Platform.OS === "web" && (state as { focused?: boolean }).focused;
              return [
                { flexShrink: 1, minHeight: 38, paddingHorizontal: 14, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: on ? s.selectedBg : "transparent" } as ViewStyle,
                on ? ({ borderWidth: 1, borderColor: s.border, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } as ViewStyle) : null,
                state.pressed && !on ? { opacity: 0.7 } : null,
                focused ? ({ outlineColor: t.focus, outlineWidth: 2, outlineStyle: "solid" } as ViewStyle) : null,
              ];
            }}>
            {o.icon ? <Ionicons name={o.icon} size={15} color={on ? s.selectedFg : s.fg} /> : null}
            <Text style={{ fontSize: 13, color: on ? s.selectedFg : s.fg, fontFamily: on ? "Inter_700Bold" : LABEL_FONT }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
