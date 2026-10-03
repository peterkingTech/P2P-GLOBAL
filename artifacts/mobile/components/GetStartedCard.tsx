import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useGetStartedProgress } from "@/hooks/useGetStartedProgress";

// Home entry to the "How to use P2P" guide. Hidden once every step is done;
// the guide stays reachable from Profile after that.
export function GetStartedCard() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { completedCount, total } = useGetStartedProgress();

  if (completedCount >= total) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push("/get-started" as any)}
      accessibilityRole="button"
      accessibilityLabel={`How to use P2P, ${completedCount} of ${total} steps done`}
    >
      <View style={styles.icon}>
        <Ionicons name="map-outline" size={20} color={colors.accentGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Get Started — How to use P2P</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(completedCount / total) * 100}%` }]} />
        </View>
        <Text style={styles.sub}>{completedCount} of {total} steps done</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: {
      flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card,
      borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 16,
    },
    icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
    title: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    track: { height: 5, borderRadius: 3, backgroundColor: c.borderBeige, overflow: "hidden", marginTop: 8 },
    fill: { height: 5, borderRadius: 3, backgroundColor: c.accentGreen },
    sub: { fontSize: 12, color: c.textMuted, marginTop: 5, fontFamily: "Inter_400Regular" },
  });
}
