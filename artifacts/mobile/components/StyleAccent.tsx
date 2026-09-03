import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/contexts/ThemeContext";

// The App Style illustration system — deliberately code-only (emoji + a
// soft gradient wash), never an image asset. Renders nothing at Minimal.
// Only ever mount this in the explicitly-approved decorative zones (empty
// states, welcome/splash screens, onboarding, profile header) — never in
// forms, admin screens, data tables, or crisis/safeguarding UI.
export default function StyleAccent({
  size = 72, style,
}: { size?: number; style?: any }) {
  const { style: appStyle, illustrationLevel, colors } = useTheme();

  if (illustrationLevel === "minimal") return null;

  if (illustrationLevel === "balanced") {
    return (
      <View
        style={[styles.balancedWrap, { width: size, height: size, backgroundColor: `${colors.accentGreen}14` }, style]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Text style={{ fontSize: size * 0.42, opacity: 0.9 }}>{appStyle.illustrationAccent}</Text>
      </View>
    );
  }

  // expressive
  return (
    <View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no">
      <LinearGradient
        colors={[`${colors.accentGreen}33`, `${colors.primaryGreen}00`]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.balancedWrap, { width: size, height: size, backgroundColor: "transparent" }]}>
        <Text style={{ fontSize: size * 0.5 }}>{appStyle.illustrationAccent}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  balancedWrap: { borderRadius: 999, alignItems: "center", justifyContent: "center" },
});