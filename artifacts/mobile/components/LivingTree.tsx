import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import colors from "@/constants/colors";

interface LivingTreeProps {
  level?: number; // 0-5
  size?: number;
}

const STAGE_LABELS = [
  "Seed",
  "Sprout",
  "Sapling",
  "Young Tree",
  "Mature Tree",
  "Ancient Tree",
];

export function LivingTree({ level = 0, size = 180 }: LivingTreeProps) {
  const sway = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const swayRotation = sway.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-3deg", "3deg"],
  });

  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.9],
  });

  const scale = 0.5 + (level / 5) * 0.5;
  const trunkH = 20 + level * 8;
  const canopySize = 60 + level * 18;

  const fruitCount = Math.min(level * 2, 8);
  const leafColor = level === 0 ? colors.lightGreen : colors.accentGreen;

  return (
    <View style={[styles.container, { height: size }]}>
      {/* Glow */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: canopySize * 1.6 * scale,
            height: canopySize * 1.6 * scale,
            borderRadius: (canopySize * 1.6 * scale) / 2,
            opacity: glowOpacity,
          },
        ]}
      />

      {/* Tree */}
      <Animated.View
        style={[
          styles.tree,
          { transform: [{ rotate: swayRotation }] },
        ]}
      >
        {/* Canopy layers */}
        {level >= 0 && (
          <View
            style={[
              styles.canopyLayer,
              {
                width: canopySize * scale,
                height: canopySize * scale,
                borderRadius: (canopySize * scale) / 2,
                backgroundColor: leafColor,
                marginBottom: -10 * scale,
              },
            ]}
          />
        )}

        {level >= 2 && (
          <View
            style={[
              styles.canopyLayer,
              {
                width: canopySize * 0.75 * scale,
                height: canopySize * 0.75 * scale,
                borderRadius: (canopySize * 0.75 * scale) / 2,
                backgroundColor: colors.primaryGreen,
                marginBottom: -8 * scale,
                alignSelf: "center",
                position: "absolute",
                top: 4 * scale,
              },
            ]}
          />
        )}

        {/* Trunk */}
        {level >= 1 && (
          <View
            style={[
              styles.trunk,
              {
                height: trunkH * scale,
                width: (6 + level * 2) * scale,
                borderRadius: 4 * scale,
                backgroundColor: colors.amber,
              },
            ]}
          />
        )}

        {/* Roots */}
        {level >= 1 && (
          <View style={styles.rootsRow}>
            {[...Array(Math.min(3 + level, 5))].map((_, i) => (
              <View
                key={i}
                style={[
                  styles.root,
                  {
                    height: (10 + level * 2) * scale,
                    width: 3 * scale,
                    transform: [{ rotate: `${(i - 2) * 20}deg` }],
                    backgroundColor: colors.textMid,
                    borderRadius: 2,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </Animated.View>

      {/* Fruit dots */}
      {fruitCount > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {[...Array(fruitCount)].map((_, i) => {
            const angle = (i / fruitCount) * Math.PI * 2;
            const r = (canopySize * 0.35 * scale);
            const x = size / 2 + r * Math.cos(angle) - 4;
            const y = size / 2 - (canopySize * 0.5 * scale) + r * Math.sin(angle) * 0.5;
            return (
              <View
                key={i}
                style={[
                  styles.fruit,
                  { left: x, top: y, backgroundColor: colors.brightYellow },
                ]}
              />
            );
          })}
        </View>
      )}

      {level === 0 && (
        <View style={styles.seedContainer}>
          <View style={styles.seed} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    position: "relative",
  },
  glow: {
    position: "absolute",
    backgroundColor: colors.accentGreen,
    opacity: 0.15,
    bottom: 20,
  },
  tree: {
    alignItems: "center",
    justifyContent: "flex-end",
    transformOrigin: "bottom center",
  },
  canopyLayer: {
    opacity: 0.92,
  },
  trunk: {},
  rootsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 3,
    marginTop: -2,
  },
  root: {},
  fruit: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.9,
  },
  seedContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  seed: {
    width: 18,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.amber,
  },
});
