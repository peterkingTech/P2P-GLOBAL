import React, { useEffect, useRef } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FruitCelebration } from "@/contexts/DataContext";

const PARTICLES = ["✨", "🌿", "✨", "🍃", "✨", "🌟", "✨", "🍇"];

function Particle({ index, active }: { index: number; active: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 1400 + (index % 4) * 200,
      delay: index * 60,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [active, anim, index]);

  const angle = (index / PARTICLES.length) * Math.PI * 2;
  const distance = 120 + (index % 3) * 30;
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * distance] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * distance - 40] });
  const opacity = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] });
  const scale = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1, 0.7] });

  return (
    <Animated.Text
      style={[
        styles.particle,
        { transform: [{ translateX }, { translateY }, { scale }], opacity },
      ]}
    >
      {PARTICLES[index]}
    </Animated.Text>
  );
}

interface Props {
  celebration: FruitCelebration;
  onViewFruits: () => void;
  onContinue: () => void;
}

export function FruitCelebrationModal({ celebration, onViewFruits, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  const iconScale = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    iconScale.setValue(0);
    contentOpacity.setValue(0);
    Animated.sequence([
      Animated.spring(iconScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.9, duration: 1100, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.4, duration: 1100, useNativeDriver: true }),
      ])
    ).start();
  }, [celebration.fruitKey, iconScale, contentOpacity, glow]);

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onContinue}>
      <View style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.particleField}>
          {PARTICLES.map((_, i) => <Particle key={i} index={i} active />)}
          <Animated.View style={[styles.iconGlow, { opacity: glow }]} />
          <Animated.View style={{ transform: [{ scale: iconScale }] }}>
            <Text style={styles.icon}>{celebration.icon}</Text>
          </Animated.View>
        </View>

        <Animated.View style={{ opacity: contentOpacity, alignItems: "center" }}>
          <Text style={styles.headline}>
            {celebration.menteeName
              ? `Your mentee ${celebration.menteeName} helped you earn ${celebration.name}!`
              : `You earned ${celebration.name}`}
          </Text>
          {celebration.themeVerse && <Text style={styles.verse}>{celebration.themeVerse}</Text>}
          {celebration.evidenceSummary && (
            <Text style={styles.evidence}>{celebration.evidenceSummary}</Text>
          )}

          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85} onPress={onViewFruits}>
            <Text style={styles.primaryBtnText}>View My Fruits</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7} onPress={onContinue}>
            <Text style={styles.secondaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(4,14,10,0.97)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  particleField: {
    width: 260, height: 260, alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  particle: { position: "absolute", fontSize: 22 },
  iconGlow: {
    position: "absolute", width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(247,201,72,0.35)",
  },
  icon: { fontSize: 84 },
  headline: {
    fontSize: 22, fontFamily: "Inter_700Bold", color: "#F4EFE4",
    textAlign: "center", marginBottom: 14, lineHeight: 30,
  },
  verse: {
    fontSize: 14, fontFamily: "Inter_500Medium", color: "#F7C948",
    textAlign: "center", marginBottom: 14,
  },
  evidence: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: "#B9CFC3",
    textAlign: "center", lineHeight: 20, marginBottom: 30, paddingHorizontal: 10,
  },
  primaryBtn: {
    backgroundColor: "#2FBE8F", borderRadius: 28,
    paddingVertical: 14, paddingHorizontal: 32, marginBottom: 12,
  },
  primaryBtnText: { color: "#04140D", fontSize: 16, fontFamily: "Inter_700Bold" },
  secondaryBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  secondaryBtnText: { color: "#7C9186", fontSize: 14, fontFamily: "Inter_500Medium" },
});
