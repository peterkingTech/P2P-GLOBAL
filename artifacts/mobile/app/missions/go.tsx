import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";

const REFLECTION_QUESTIONS = [
  "What has this story stirred in you?",
  "Where has God already placed you to serve — at home, at work, in your church?",
  "What would it look like to pray faithfully for a mission field over the next month?",
  "Is there a next step of obedience God is asking of you, even a small one?",
];

// Missions Stage 6 — GO. Deliberately makes no calling claims and uses no
// AI to determine anyone's calling — that belongs to the user's own
// relationship with God and their community. SERVE has no fabricated
// opportunity listings; it's informational until a real, verified
// opportunity source exists.
export default function MissionGoScreen() {
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
        <Text style={styles.title}>Go</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.question}>How can you participate in God's mission?</Text>
        <Text style={styles.subtext}>
          Your calling belongs to your relationship with God and your real community. This isn't a quiz or an algorithm —
          just stories, Scripture, and questions to sit with.
        </Text>

        <TouchableOpacity style={styles.card} onPress={() => router.push("/(tabs)/prayer" as any)}>
          <Ionicons name="hand-left-outline" size={20} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Pray</Text>
            <Text style={styles.cardSub}>Commit to pray for a mission field or worker.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push("/missions/learn" as any)}>
          <Ionicons name="school-outline" size={20} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Learn</Text>
            <Text style={styles.cardSub}>Read mission stories and study what Scripture says about mission.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>

        <View style={styles.card}>
          <Ionicons name="hammer-outline" size={20} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Serve</Text>
            <Text style={styles.cardSub}>No verified serving opportunities are listed here yet. Talk with your church or a mission organization about real, local ways to serve.</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push("/missions/create" as any)}
        >
          <Ionicons name="megaphone-outline" size={20} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Share</Text>
            <Text style={styles.cardSub}>Authorized contributors can share a real mission story or testimony.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>

        <Text style={styles.sectionHeading}>Questions for Reflection</Text>
        {REFLECTION_QUESTIONS.map((q, i) => (
          <View key={i} style={styles.questionRow}>
            <Text style={styles.questionBullet}>•</Text>
            <Text style={styles.questionText}>{q}</Text>
          </View>
        ))}

        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/prayer/journal?compose=true" as any)}>
          <Ionicons name="book-outline" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Write in Your Journal</Text>
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
    question: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 10, marginBottom: 8 },
    subtext: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 20 },
    card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 16, marginBottom: 10 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSub: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
    sectionHeading: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    questionRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
    questionBullet: { color: c.accentGreen, fontSize: 14 },
    questionText: { flex: 1, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
    primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
