import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder } from "react-native";
import { clampVolume } from "@/lib/togetherAudio/mixer";
import { VOLUME_STEP } from "@/lib/togetherAudio/types";

interface Props {
  label: string;
  value: number; // 0-1
  onChange: (v: number) => void;
  accentColor: string;
  disabled?: boolean;
}

// An original P2P control — a plain track + dot, not a copy of any
// platform's/competitor's slider chrome. Tap anywhere on the track to jump
// there; drag the thumb to fine-tune. accessibilityRole="adjustable" is
// what actually makes this a real slider to a screen reader (VoiceOver/
// TalkBack swipe up/down triggers increment/decrement below) — the visual
// drag is a bonus, not the only way to operate it.
export default function AudioSlider({ label, value, onChange, accentColor, disabled }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const startValueRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        if (trackWidth <= 0) return;
        const x = evt.nativeEvent.locationX;
        const next = clampVolume(x / trackWidth);
        startValueRef.current = next;
        onChange(next);
      },
      onPanResponderMove: (_evt, gesture) => {
        if (trackWidth <= 0) return;
        onChange(clampVolume(startValueRef.current + gesture.dx / trackWidth));
      },
    })
  ).current;

  function handleAccessibilityAction(actionName: string) {
    if (actionName === "increment") onChange(clampVolume(valueRef.current + VOLUME_STEP));
    else if (actionName === "decrement") onChange(clampVolume(valueRef.current - VOLUME_STEP));
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.valueText}>{Math.round(value * 100)}%</Text>
      </View>
      <View
        style={[styles.hitArea, disabled && styles.disabled]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => handleAccessibilityAction(e.nativeEvent.actionName)}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${value * 100}%`, backgroundColor: accentColor }]} />
        </View>
        <View style={[styles.thumb, { left: `${value * 100}%`, borderColor: accentColor }]} pointerEvents="none" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "Inter_500Medium" },
  valueText: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular" },
  hitArea: { minHeight: 44, justifyContent: "center" },
  disabled: { opacity: 0.4 },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2 },
  thumb: {
    position: "absolute", top: "50%", marginTop: -9, marginLeft: -9,
    width: 18, height: 18, borderRadius: 9, backgroundColor: "#0B120E", borderWidth: 3,
  },
});