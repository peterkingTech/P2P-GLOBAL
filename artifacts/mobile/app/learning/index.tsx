import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { COMPREHENSIVE_CHECKS } from "@/lib/terminology";
import { getLearningOverview, SOURCE_LABEL, STATE_LABEL, needsAction, dueLabel, type LearningOverview, type WorkItem } from "@/lib/learningCentreApi";

// Learning Centre: my Comprehensive Checks from Kingdom School, Kingdom
// Stories, Family Circle and Church in one place — what to do, what waits
// for review, feedback I've received, and reviews waiting for me. Each row
// opens the existing screen where that work lives; nothing is answered,
// reviewed or marked complete here.

type Section = { key: keyof LearningOverview; title: string; empty: string };
const SECTIONS: Section[] = [
  { key: "toDo", title: "To do", empty: "Nothing waiting for you. Well done." },
  { key: "toReview", title: "Waiting for your review", empty: "" },
  { key: "awaitingReview", title: "Submitted — waiting for review", empty: "Nothing waiting for review." },
  { key: "feedback", title: "Feedback received", empty: "Feedback from your reviewers will appear here." },
];

export default function LearningCentreScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<LearningOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getLearningOverview()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your learning."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (x: WorkItem) => router.push({ pathname: x.route.pathname, params: x.route.params } as any);

  const row = (x: WorkItem, section: Section["key"]) => {
    const due = section === "toDo" ? dueLabel(x.dueAt) : null;
    const urgent = needsAction(x.state) || (due ?? "").startsWith("Overdue");
    const label = section === "toReview" ? `${x.waiting ?? 1} waiting` : STATE_LABEL[x.state];
    return (
      <TouchableOpacity key={x.key} style={s.card} onPress={() => open(x)} accessibilityRole="button"
        accessibilityLabel={`${x.title}, ${x.context ?? SOURCE_LABEL[x.source]}. ${label}${due ? `. ${due}` : ""}`}>
        <Text style={s.kicker}>{SOURCE_LABEL[x.source]}</Text>
        <View style={s.row}>
          <Text style={[s.cardTitle, { flex: 1 }]}>{x.title}</Text>
          <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
        </View>
        {x.context ? <Text style={s.meta} numberOfLines={2}>{x.context}</Text> : null}
        <View style={s.row}>
          <View style={[s.pill, urgent && s.pillUrgent]}><Text style={[s.pillText, urgent && s.pillTextUrgent]}>{label}</Text></View>
          {due ? <Text style={[s.meta, (due ?? "").startsWith("Overdue") && s.overdue]}>{due}</Text> : null}
        </View>
        {section === "feedback" && x.feedback ? <Text style={s.feedback} numberOfLines={4}>{x.feedback}</Text> : null}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "Learning Centre" }} />
      <Text style={s.title} accessibilityRole="header">Learning Centre</Text>
      <Text style={s.meta}>Your {COMPREHENSIVE_CHECKS} from Kingdom School, Kingdom Stories, Family Circle and Church in one place. Tap one to open it where you answer it.</Text>
      {error ? (
        <View style={s.card}>
          <Text style={s.error} accessibilityRole="alert">{error}</Text>
          <TouchableOpacity style={s.btnSecondary} onPress={load} accessibilityRole="button"><Text style={s.btnSecondaryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : null}
      {!data && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={c.accentGreen} /> : null}

      {data ? SECTIONS.map((sec) => {
        const items = data[sec.key];
        if (!items.length && !sec.empty) return null;
        return (
          <View key={sec.key} style={{ gap: 10 }}>
            <Text style={s.section} accessibilityRole="header">{sec.title}{items.length ? ` (${items.length})` : ""}</Text>
            {items.length ? items.map((x) => row(x, sec.key)) : <Text style={s.meta}>{sec.empty}</Text>}
          </View>
        );
      }) : null}

      {data ? (
        <View style={[s.row, { marginTop: 8 }]}>
          <TouchableOpacity style={s.btnSecondary} onPress={() => router.push("/(tabs)/learn" as any)} accessibilityRole="button">
            <Text style={s.btnSecondaryText}>Kingdom School</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} onPress={() => router.push("/kingdom-stories" as any)} accessibilityRole="button">
            <Text style={s.btnSecondaryText}>Kingdom Stories</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} onPress={() => router.push("/my-discipleship/journal" as any)} accessibilityRole="button">
            <Text style={s.btnSecondaryText}>My Journal</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 48, width: "100%", maxWidth: 760, alignSelf: "center" },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 12 },
    meta: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overdue: { color: "#B91C1C", fontFamily: "Inter_600SemiBold" },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 6 },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    feedback: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular", borderLeftWidth: 3, borderLeftColor: c.accentGreen, paddingLeft: 10 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
    pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: "rgba(29,158,117,0.1)" },
    pillUrgent: { backgroundColor: "rgba(217,164,65,0.18)" },
    pillText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    pillTextUrgent: { color: c.textDark },
    btnSecondary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
    btnSecondaryText: { color: c.textDark, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  });
}
