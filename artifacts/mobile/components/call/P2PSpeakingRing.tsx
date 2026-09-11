import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import type { P2PCallColors } from "./p2pCallTheme";

// A restrained pulsing ring used by both P2PCentralSpeaker and
// P2PParticipantNode — one shared implementation, not two. Smooth,
// low-amplitude, 60fps-friendly (native driver only: opacity + scale).
// Colors come from the caller's already-resolved theme (see
// p2pCallTheme.ts) — nothing here is a fixed hex value.
export function P2PSpeakingRing({ active, size, strong, colors }: { active: boolean; size: number; strong?: boolean; colors: P2PCallColors }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      Animated.timing(pulse, { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, strong ? 1.14 : 1.08] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, strong ? 0.9 : 0.7] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size, height: size, borderRadius: size / 2,
          borderColor: strong ? colors.accent : colors.accentSoft,
          borderWidth: strong ? 2.5 : 2,
          transform: [{ scale }], opacity,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: { position: "absolute" },
});
