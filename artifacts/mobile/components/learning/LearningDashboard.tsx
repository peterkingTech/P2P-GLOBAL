import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { AppColors } from "@/constants/themes";
import { useData, getModuleProgressCounts } from "@/contexts/DataContext";
import { COMPREHENSIVE_CHECKS } from "@/lib/terminology";
import type { LearningOverview } from "@/lib/learningCentreApi";
import { ProgressBar, ProgressStat } from "@/components/learning/LearningCards";

// The learning dashboard at the top of the Learning Centre (formerly "Your Learning Journey" on the
// Learning tab): Kingdom School progress from the modules already loaded, and the Comprehensive
// Checks counts from the Learning Centre overview the screen has loaded. No requests of its own.
export default function LearningDashboard({ overview, failed, colors }: { overview: LearningOverview | null; failed: boolean; colors: AppColors }) {
  const { modules } = useData();
  const { modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  const lessonsCompleted = modules.reduce((n, m) => n + m.completedLessons, 0);
  const checks = overview ? [
    { key: "todo", label: "To do", n: overview.toDo.length, icon: "create-outline", highlight: true },
    { key: "review", label: "Awaiting review", n: overview.awaitingReview.length, icon: "hourglass-outline", highlight: false },
    { key: "feedback", label: "Feedback received", n: overview.feedback.length, icon: "chatbubble-ellipses-outline", highlight: true },
    { key: "toReview", label: "Waiting for your review", n: overview.toReview.length, icon: "people-outline", highlight: true },
  ] : [];
  return (
    <View style={[s.card, { backgroundColor: colors.card }]} accessible accessibilityRole="summary"
      accessibilityLabel={`${modulesCompleted} of ${totalModules} Kingdom School modules complete, ${lessonsCompleted} lessons completed${overview ? `. ${COMPREHENSIVE_CHECKS}: ${checks.map((j) => `${j.n} ${j.label}`).join(", ")}` : ""}`}>
      <View style={s.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.kicker, { color: colors.amber }]}>Kingdom School</Text>
          <Text style={[s.figure, { color: colors.textDark }]}>
            {modulesCompleted}<Text style={[s.of, { color: colors.textMuted }]}> of {totalModules} modules complete</Text>
          </Text>
        </View>
        <View style={[s.lessons, { backgroundColor: colors.lightCream }]}>
          <Text style={[s.lessonsN, { color: colors.accentGreen }]}>{lessonsCompleted}</Text>
          <Text style={[s.lessonsLabel, { color: colors.textMuted }]}>{lessonsCompleted === 1 ? "lesson" : "lessons"}{"\n"}completed</Text>
        </View>
      </View>
      {totalModules > 0 ? <ProgressBar value={modulesCompleted / totalModules} color={colors.progressFill} track={colors.progressTrack} height={6} /> : null}

      <Text style={[s.kicker, { color: colors.amber, marginTop: 18 }]}>{COMPREHENSIVE_CHECKS}</Text>
      {overview ? (
        <View style={s.stats}>
          {checks.map((j) => <ProgressStat key={j.key} value={j.n} label={j.label} icon={j.icon} colors={colors} highlight={j.highlight} wide={false} />)}
        </View>
      ) : failed ? <Text style={[s.meta, { color: colors.textMuted, marginTop: 6 }]}>Your {COMPREHENSIVE_CHECKS} couldn't load.</Text>
        : <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 12 }} />}
      <Text style={[s.meta, { color: colors.textMuted, marginTop: 12 }]}>From Kingdom School, Kingdom Stories, Family Circle and Church</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 16, borderRadius: 20 },
  top: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 10 },
  kicker: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_700Bold", letterSpacing: 1, textTransform: "uppercase" },
  figure: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.6 },
  of: { fontSize: 14, fontFamily: "Inter_500Medium", letterSpacing: 0 },
  lessons: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  lessonsN: { fontSize: 20, lineHeight: 24, fontFamily: "Inter_700Bold" },
  lessonsLabel: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_500Medium" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  meta: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular" },
});
