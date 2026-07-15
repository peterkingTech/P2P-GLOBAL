import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData, MySubmission } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },

    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    sectionHeader: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 24 },

    card: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    cardUrgent: { borderColor: "#C0392B", backgroundColor: "rgba(192,57,43,0.04)" },
    cardPending: { borderColor: "rgba(217,164,65,0.4)", backgroundColor: "rgba(217,164,65,0.05)" },
    cardApproved: { borderColor: "rgba(29,158,117,0.3)", backgroundColor: "rgba(29,158,117,0.04)" },

    iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    iconBoxUrgent: { backgroundColor: "rgba(192,57,43,0.12)" },
    iconBoxPending: { backgroundColor: "rgba(217,164,65,0.12)" },
    iconBoxApproved: { backgroundColor: "rgba(29,158,117,0.12)" },
    iconBoxBlue: { backgroundColor: "rgba(52,152,219,0.12)" },

    cardTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    cardSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    cardFeedback: {
      fontSize: 12, color: "#C0392B", fontFamily: "Inter_400Regular",
      marginTop: 6, fontStyle: "italic",
    },

    badge: {
      backgroundColor: "#C0392B", borderRadius: 10, minWidth: 22, height: 22,
      paddingHorizontal: 6, alignItems: "center", justifyContent: "center",
    },
    badgeAmber: { backgroundColor: c.amber },
    badgeGreen: { backgroundColor: c.accentGreen },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

    reviewCard: {
      backgroundColor: "rgba(224,164,65,0.1)", borderRadius: 14,
      borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10,
    },

    planCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
    },
    planTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    planBar: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 8 },
    planBarFill: { height: 4, backgroundColor: c.accentGreen, borderRadius: 2 },
    planProgress: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
    emptyText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}

function sourceLabel(s: MySubmission["source"]): string {
  return s === "plan" ? "Plan" : "Core Curriculum";
}

export default function ProgressDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { getMySubmissions, pendingEvaluations, plans, plansV2 } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [submissions, setSubmissions] = useState<MySubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const subs = await getMySubmissions();
      setSubmissions(subs);
    } finally {
      setLoading(false);
    }
  }, [getMySubmissions]);

  useEffect(() => { load(); }, [load]);

  const needsRevision = submissions.filter(s => s.evaluationStatus === "needs_revision");
  const pending = submissions.filter(s => s.evaluationStatus === "pending");
  const approved = submissions.filter(s => s.evaluationStatus === "approved" || s.selfApproved).slice(0, 10);

  const plansInProgress = plans.filter(p => p.completedLessons > 0 && p.completedLessons < p.lessonCount);
  const plansV2InProgress = plansV2.filter(p => p.completedLessons > 0 && p.completedLessons < p.lessonCount);

  const totalActionNeeded = needsRevision.length + pendingEvaluations.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Progress</Text>
        {totalActionNeeded > 0 && (
          <View style={[styles.badge, { marginLeft: "auto" }]}>
            <Text style={styles.badgeText}>{totalActionNeeded}</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accentGreen} />}
      >
        {/* ── Needs Revision (action needed) ── */}
        {needsRevision.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>⚠ Needs Revision</Text>
            {needsRevision.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.card, styles.cardUrgent]}
                onPress={() => router.push((s.source === "plan" ? `/plan/lesson/${s.lessonId}` : `/lesson/${s.lessonId}`) as any)}
                activeOpacity={0.82}
              >
                <View style={[styles.iconBox, styles.iconBoxUrgent]}>
                  <Ionicons name="alert-circle" size={18} color="#C0392B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{s.lessonTitle}</Text>
                  <Text style={styles.cardSub}>{sourceLabel(s.source)} · Tap to revise and resubmit</Text>
                  {s.feedback ? <Text style={styles.cardFeedback}>"{s.feedback}"</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color="#C0392B" />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── To Review (evaluations assigned to me) ── */}
        {pendingEvaluations.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>To Review — Assigned to You</Text>
            <TouchableOpacity
              style={styles.reviewCard}
              onPress={() => router.push("/evaluations" as any)}
              activeOpacity={0.85}
            >
              <View style={{ position: "relative" }}>
                <Ionicons name="people-circle" size={28} color={colors.upperRoomAmber} />
                <View style={[styles.badge, { position: "absolute", top: -6, right: -8 }]}>
                  <Text style={styles.badgeText}>{pendingEvaluations.length}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.textDark }]}>
                  {pendingEvaluations.length} peer submission{pendingEvaluations.length === 1 ? "" : "s"} waiting for your review
                </Text>
                <Text style={styles.cardSub}>Tap to open the Evaluations screen</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.amber} />
            </TouchableOpacity>
          </>
        )}

        {/* ── Submitted / Awaiting Evaluation ── */}
        <Text style={styles.sectionHeader}>Submitted — Awaiting Evaluation</Text>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 12 }} />
        ) : pending.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No submissions currently awaiting evaluation</Text>
          </View>
        ) : pending.map(s => (
          <TouchableOpacity
            key={s.id}
            style={[styles.card, styles.cardPending]}
            onPress={() => router.push((s.source === "plan" ? `/plan/lesson/${s.lessonId}` : `/lesson/${s.lessonId}`) as any)}
            activeOpacity={0.82}
          >
            <View style={[styles.iconBox, styles.iconBoxPending]}>
              <Ionicons name="time-outline" size={18} color={colors.amber} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{s.lessonTitle}</Text>
              <Text style={styles.cardSub}>{sourceLabel(s.source)} · Pending peer review and evaluation</Text>
            </View>
            <Ionicons name="hourglass-outline" size={16} color={colors.amber} />
          </TouchableOpacity>
        ))}

        {/* ── Recent Approvals ── */}
        {approved.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Recently Approved</Text>
            {approved.map(s => (
              <View key={s.id} style={[styles.card, styles.cardApproved]}>
                <View style={[styles.iconBox, styles.iconBoxApproved]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{s.lessonTitle}</Text>
                  <Text style={styles.cardSub}>
                    {sourceLabel(s.source)}
                    {s.selfApproved ? " · Approved (first through this lesson)" : " · Approved ✓"}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Plans In Progress ── */}
        {(plansInProgress.length > 0 || plansV2InProgress.length > 0) && (
          <>
            <Text style={styles.sectionHeader}>Plans In Progress</Text>
            {plansInProgress.map(p => {
              const pct = p.lessonCount > 0 ? Math.round((p.completedLessons / p.lessonCount) * 100) : 0;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.planCard}
                  onPress={() => router.push(`/module/${p.singleModuleId ?? p.id}` as any)}
                  activeOpacity={0.82}
                >
                  <Text style={styles.planTitle}>{p.title}</Text>
                  <View style={styles.planBar}>
                    <View style={[styles.planBarFill, { width: `${pct}%` as any }]} />
                  </View>
                  <Text style={styles.planProgress}>{p.completedLessons}/{p.lessonCount} lessons approved · {pct}%</Text>
                </TouchableOpacity>
              );
            })}
            {plansV2InProgress.map(p => {
              const pct = p.lessonCount > 0 ? Math.round((p.completedLessons / p.lessonCount) * 100) : 0;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.planCard}
                  onPress={() => router.push(`/plan/${p.id}` as any)}
                  activeOpacity={0.82}
                >
                  <Text style={styles.planTitle}>{p.title}</Text>
                  <View style={styles.planBar}>
                    <View style={[styles.planBarFill, { width: `${pct}%` as any }]} />
                  </View>
                  <Text style={styles.planProgress}>{p.completedLessons}/{p.lessonCount} lessons approved · {pct}%</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Empty state when nothing is happening */}
        {!loading && needsRevision.length === 0 && pending.length === 0 && approved.length === 0 && pendingEvaluations.length === 0 && plansInProgress.length === 0 && plansV2InProgress.length === 0 && (
          <View style={[styles.empty, { marginTop: 40 }]}>
            <Ionicons name="leaf-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nothing to show yet.{"\n"}Start a lesson to track your progress here.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
