import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";

// "Pray the Word" Stage 6 — "What are you carrying today?" This is a
// curated Life Situation -> Topic mapping, NOT an AI chat and NOT a
// diagnosis of any kind. Selecting a situation opens the EXISTING Pray the
// Word topic flow (Stage 2) for the matching curated topic — no duplicate
// category system, no separate content pipeline.
const SITUATIONS: { key: string; label: string; target: { type: "topic"; slug: string } | { type: "missions" } }[] = [
  { key: "peace", label: "I need peace.", target: { type: "topic", slug: "peace" } },
  { key: "afraid", label: "I'm afraid.", target: { type: "topic", slug: "fear-anxiety" } },
  { key: "healing", label: "I need healing.", target: { type: "topic", slug: "healing" } },
  { key: "waiting", label: "I'm waiting on God.", target: { type: "topic", slug: "waiting-on-god" } },
  { key: "strength", label: "I need strength.", target: { type: "topic", slug: "strength" } },
  { key: "direction", label: "I need direction.", target: { type: "topic", slug: "guidance" } },
  { key: "discouraged", label: "I'm discouraged.", target: { type: "topic", slug: "hope" } },
  { key: "grieving", label: "I'm grieving.", target: { type: "topic", slug: "grief" } },
  { key: "grow", label: "I want to grow.", target: { type: "topic", slug: "spiritual-growth" } },
  { key: "trustgod", label: "I want to trust God.", target: { type: "topic", slug: "trust" } },
  { key: "thankful", label: "I'm thankful.", target: { type: "topic", slug: "gratitude" } },
  { key: "family", label: "I'm praying for my family.", target: { type: "topic", slug: "family" } },
  { key: "someone", label: "I'm praying for someone.", target: { type: "topic", slug: "love" } },
  { key: "missions", label: "I'm praying for missions.", target: { type: "missions" } },
];

export default function PrayerDiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  function handleSelect(target: (typeof SITUATIONS)[number]["target"]) {
    if (target.type === "missions") router.push("/(tabs)/missions" as any);
    else router.push(`/prayer/pray-the-word/${target.slug}` as any);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Pray the Word</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.question}>What are you carrying today?</Text>
        <Text style={styles.subtext}>Choose what's on your heart. Here are Scriptures curated for this topic.</Text>

        <View style={styles.grid}>
          {SITUATIONS.map((s) => (
            <TouchableOpacity key={s.key} style={styles.situationCard} onPress={() => handleSelect(s.target)} activeOpacity={0.85}>
              <Text style={styles.situationText}>{s.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 6 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    question: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 20, marginBottom: 8 },
    subtext: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 24, lineHeight: 19, paddingHorizontal: 12 },
    grid: { gap: 10 },
    situationCard: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card,
      borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18,
    },
    situationText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
