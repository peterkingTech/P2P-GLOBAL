import React, { useEffect, useRef } from "react";
import { Animated, Easing, View, StyleSheet } from "react-native";
import type { P2PCallColors } from "./p2pCallTheme";

const BAR_COUNT = 5;

// A restrained, few-bar waveform beneath the central speaker — reacts to
// real speaking state (from the existing, unmodified Agora volume
// indication via useActiveSpeaker), not a decorative always-on animation.
// Deliberately minimal: 5 bars, small amplitude, no "equalizer" look.
// Bar color is the caller's resolved theme accent, not a fixed hex.
export function P2PAudioWaveform({ active, volume, colors }: { active: boolean; volume: number; colors: P2PCallColors }) {
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.25))).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => Animated.timing(b, { toValue: 0.2, duration: 400, useNativeDriver: false }).start());
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 0.4 + Math.random() * 0.6, duration: 260 + i * 40, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(b, { toValue: 0.2 + Math.random() * 0.3, duration: 260 + i * 40, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no">
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            { backgroundColor: colors.accentSoft, height: b.interpolate({ inputRange: [0, 1], outputRange: [4, 22] }), opacity: active ? 1 : 0.35 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 22, marginTop: 8 },
  bar: { width: 3, borderRadius: 2 },
});
