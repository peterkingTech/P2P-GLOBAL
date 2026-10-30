import React from "react";
import { Pressable, Text, View, Platform, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CALL_TOKENS, MIN_TOUCH } from "@/lib/buttonTheme";

// A call control (mute, camera, speaker, end). Presentation only: it calls
// the handler it is given — the existing Agora call hooks are untouched.
//   kind="toggle" — `active` shows the "on" look (white disc, dark glyph) AND
//                   switches to `activeIcon`, and is announced as selected;
//                   the caption under it says the state in words too.
//   kind="end"    — red, always recognisable as leaving the call.
// Same look in every app theme: call screens are always dark.

type IconName = keyof typeof Ionicons.glyphMap;
export interface CallControlProps {
  icon: IconName;
  /** Spoken + shown under the control; should describe the current state, e.g. "Unmute". */
  label: string;
  onPress: () => void;
  kind?: "toggle" | "end";
  active?: boolean;
  activeIcon?: IconName;
  disabled?: boolean;
  size?: number;
  showCaption?: boolean;
}

export default function CallControl({ icon, label, onPress, kind = "toggle", active = false, activeIcon, disabled, size = 56, showCaption = true }: CallControlProps) {
  const tone = kind === "end" ? CALL_TOKENS.end : active ? CALL_TOKENS.active : CALL_TOKENS.idle;
  const d = Math.max(size, MIN_TOUCH);
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, ...(kind === "toggle" ? { selected: active } : {}) }}
        style={(state) => {
          const focused = Platform.OS === "web" && (state as { focused?: boolean }).focused;
          return [
            { width: d, height: d, borderRadius: d / 2, alignItems: "center", justifyContent: "center", backgroundColor: state.pressed ? tone.pressedBg : tone.bg } as ViewStyle,
            disabled ? { opacity: 0.45 } : null,
            focused ? ({ outlineColor: "#FFFFFF", outlineWidth: 2, outlineStyle: "solid", outlineOffset: 2 } as ViewStyle) : null,
          ];
        }}>
        <Ionicons name={active && activeIcon ? activeIcon : icon} size={Math.round(d * 0.43)} color={tone.fg}
          style={kind === "end" && icon === "call" ? { transform: [{ rotate: "135deg" }] } : undefined} />
      </Pressable>
      {showCaption ? <Text style={{ color: CALL_TOKENS.caption, fontSize: 12, fontFamily: "Inter_500Medium" }} numberOfLines={1} importantForAccessibility="no">{label}</Text> : null}
    </View>
  );
}
