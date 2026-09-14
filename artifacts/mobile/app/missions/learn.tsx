import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { MISSION_FOCUS_LABELS, type MissionFocusTag } from "@/lib/missionsApi";

// Missions Stage 6 — LEARN. Reuses the existing mission-focus taxonomy
// (no second topic system) and the existing Curriculum for "Study" —
// nothing here is a new study system.
const LEARN_TOPICS: MissionFocusTag[] = [
  "evangelism", "discipleship", "church_planting", "cross_cultural_missions", "bible_translation",
  "persecuted_church", "leadership_development", "unreached_peoples", "digital_missions",
];

export default function MissionLearnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Learn</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.intro}>Mission stories are opportunities to learn what God is doing — and to grow in your own walk.</Text>

        <Text style={styles.sectionHeading}>Mission Learning Topics</Text>
        {LEARN_TOPICS.map((topic) => (
          <TouchableOpacity key={topic} style={styles.topicRow} onPress={() => router.push(`/missions/focus/${topic}` as any)}>
            <Ionicons name="book-outline" size={16} color={c.accentGreen} />
            <Text style={styles.topicText}>{MISSION_FOCUS_LABELS[topic]}</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.studyBtn} onPress={() => router.push("/curriculum" as any)}>
          <Ionicons name="school-outline" size={16} color="#fff" />
          <Text style={styles.studyBtnText}>Explore Study & Curriculum</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.studySecondary} onPress={() => router.push("/prayer/pray-the-word" as any)}>
          <Ionicons name="sparkles-outline" size={16} color={c.accentGreen} />
          <Text style={styles.studySecondaryText}>Pray the Word</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.studySecondary} onPress={() => router.push("/my-discipleship/journey" as any)}>
          <Ionicons name="leaf-outline" size={16} color={c.accentGreen} />
          <Text style={styles.studySecondaryText}>Discipleship Journey</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 6 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 8, marginBottom: 18 },
    sectionHeading: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    topicRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, marginBottom: 8 },
    topicText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    studyBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 20 },
    studyBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    studySecondary: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
    studySecondaryText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
