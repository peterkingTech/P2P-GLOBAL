import React, { useEffect, useRef } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View, Animated, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CategoryCompletion } from "@/contexts/DataContext";

interface Props {
  completion: CategoryCompletion;
  onContinue: () => void;
}

export function CategoryCompletionModal({ completion, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(0);
    opacity.setValue(0);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [completion.categoryId, scale, opacity]);

  async function handleShare() {
    try {
      await Share.share({
        message: `I just completed every plan in "${completion.categoryTitle}" (${completion.planCount} plans) on Kingdom School! 🎉`,
      });
    } catch {}
  }

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onContinue}>
      <View style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <Animated.View style={{ transform: [{ scale }], alignItems: "center" }}>
          <View style={[styles.badge, { borderColor: completion.categoryColorTheme }]}>
            <Text style={styles.badgeIcon}>🏆</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity, alignItems: "center" }}>
          <Text style={styles.headline}>Category Complete!</Text>
          <Text style={styles.subheadline}>
            You've finished all {completion.planCount} plan{completion.planCount === 1 ? "" : "s"} in{"\n"}
            <Text style={{ color: completion.categoryColorTheme, fontFamily: "Inter_700Bold" }}>{completion.categoryTitle}</Text>
          </Text>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: completion.categoryColorTheme }]} activeOpacity={0.85} onPress={handleShare}>
            <Text style={styles.primaryBtnText}>Share This Milestone</Text>
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
  badge: {
    width: 140, height: 140, borderRadius: 70, borderWidth: 4,
    alignItems: "center", justifyContent: "center", marginBottom: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  badgeIcon: { fontSize: 60 },
  headline: {
    fontSize: 24, fontFamily: "Inter_700Bold", color: "#F4EFE4",
    textAlign: "center", marginBottom: 10,
  },
  subheadline: {
    fontSize: 15, fontFamily: "Inter_400Regular", color: "#B9CFC3",
    textAlign: "center", lineHeight: 22, marginBottom: 30,
  },
  primaryBtn: {
    borderRadius: 28, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 12,
  },
  primaryBtnText: { color: "#04140D", fontSize: 16, fontFamily: "Inter_700Bold" },
  secondaryBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  secondaryBtnText: { color: "#7C9186", fontSize: 14, fontFamily: "Inter_500Medium" },
});