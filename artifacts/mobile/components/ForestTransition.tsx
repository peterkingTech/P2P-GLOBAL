import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Modal, StyleSheet, Text, View } from "react-native";
import colors from "@/constants/colors";

const { width: SW, height: SH } = Dimensions.get("window");
const PARTICLE_COUNT = 14;

interface ForestTransitionProps {
  onDone: () => void;
}

export function ForestTransition({ onDone }: ForestTransitionProps) {
  const particles = useRef(
    [...Array(PARTICLE_COUNT)].map(() => ({
      progress: new Animated.Value(0),
      angle: Math.random() * Math.PI * 2,
      distance: 90 + Math.random() * 160,
      delay: Math.random() * 400,
    }))
  ).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations = particles.map((p) =>
      Animated.timing(p.progress, {
        toValue: 1,
        duration: 1600,
        delay: p.delay,
        useNativeDriver: true,
      })
    );
    Animated.sequence([
      Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.parallel(animations),
      Animated.delay(300),
    ]).start(() => onDone());
  }, []);

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={styles.screen}>
        <View style={styles.center}>
          {particles.map((p, i) => {
            const translateX = p.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, Math.cos(p.angle) * p.distance],
            });
            const translateY = p.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, Math.sin(p.angle) * p.distance],
            });
            const opacity = p.progress.interpolate({
              inputRange: [0, 0.15, 0.8, 1],
              outputRange: [0, 1, 1, 0],
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.particle,
                  {
                    opacity,
                    transform: [{ translateX }, { translateY }],
                  },
                ]}
              />
            );
          })}
          <Text style={styles.emoji}>🌳</Text>
        </View>
        <Animated.Text style={[styles.caption, { opacity: textOpacity }]}>
          Your growth is reaching others now…
        </Animated.Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0B3A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    width: SW,
    height: SH * 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 88 },
  particle: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brightYellow,
    shadowColor: colors.brightYellow,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  caption: {
    position: "absolute",
    bottom: SH * 0.18,
    color: "#E8F5EE",
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
