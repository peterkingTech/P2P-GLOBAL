import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";

interface CircleSessionBannerProps {
  circleName: string;
  onPress: () => void;
  onDismiss: () => void;
}

export function CircleSessionBanner({ circleName, onPress, onDismiss }: CircleSessionBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity]);

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY }], opacity }]}>
      <TouchableOpacity style={styles.pill} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.iconCircle}>
          <Ionicons name="videocam" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{circleName} is starting</Text>
          <Text style={styles.subtitle}>Tap to join the group call</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 1000, alignItems: "center" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 10, width: "100%",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: "#000", shadowOpacity: 0.12, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 4,
  },
  iconCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
});