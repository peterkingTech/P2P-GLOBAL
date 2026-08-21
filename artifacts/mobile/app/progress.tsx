import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, Plan } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// Kingdom Impact's all-time discipleship metrics moved to My Discipleship
// (app/my-discipleship/index.tsx) — same RPCs (p2p_get_growth_dashboard,
// p2p_get_activity_timeline), same numbers, single source of truth. My
// Progress is now purely "what's in progress right now."

// ── Unified plan-in-progress card — all plans (p2p_curriculums type='plan')
// now share one schema and one progress source (DataContext.getPlanProgress),
// so there is no more legacy/v2 split here. ──
function PlanProgressCard({ plan, progress, styles, router }: { plan: Plan; progress: number; styles: ReturnType<typeof makeStyles>; router: ReturnType<typeof useRouter> }) {
  return (
    <TouchableOpacity
      style={styles.planCard}
      onPress={() => router.push(`/plan/${plan.id}` as any)}
      activeOpacity={0.82}
    >
      <Text style={styles.planTitle}>{plan.title}</Text>
      <View style={styles.planBar}>
        <View style={[styles.planBarFill, { width: `${progress}%` as any }]} />
      </View>
      <Text style={styles.planProgress}>{progress}% complete</Text>
    </TouchableOpacity>
  );
}

export default function ProgressDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules, lessons, plans, getPlanProgress } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const plansInProgress = plans.filter(p => {
    const progress = getPlanProgress(p.id);
    return progress > 0 && progress < 100;
  });

  // Core curriculum: the first lesson that's neither completed nor locked is
  // "current" — everything before it is done, this is what the user should
  // work on next.
  const currentCoreLesson = lessons.find(l => !l.isCompleted && !l.isLocked);
  const currentCoreModule = currentCoreLesson ? modules.find(m => m.id === currentCoreLesson.moduleId) : null;
  const coreCompletedLessons = lessons.filter(l => l.isCompleted).length;
  const coreHasStarted = coreCompletedLessons > 0 || Boolean(currentCoreLesson);

  const nothingToShow = plansInProgress.length === 0 && !currentCoreModule;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Progress</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Core Curriculum In Progress ── */}
        {currentCoreModule && currentCoreLesson && (
          <>
            <Text style={styles.sectionHeader}>Core Curriculum In Progress</Text>
            <TouchableOpacity
              style={styles.planCard}
              onPress={() => router.push(`/module/${currentCoreModule.id}` as any)}
              activeOpacity={0.82}
            >
              <Text style={styles.planTitle}>{currentCoreModule.title}</Text>
              <Text style={styles.planCurrent}>Current lesson: {currentCoreLesson.title}</Text>
              <View style={styles.planBar}>
                <View style={[styles.planBarFill, { width: `${lessons.length > 0 ? Math.round((coreCompletedLessons / lessons.length) * 100) : 0}%` as any }]} />
              </View>
              <Text style={styles.planProgress}>{coreCompletedLessons}/{lessons.length} lessons approved</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Plans In Progress ── */}
        {plansInProgress.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Plans In Progress</Text>
            {plansInProgress.map(p => (
              <PlanProgressCard key={p.id} plan={p} progress={getPlanProgress(p.id)} styles={styles} router={router} />
            ))}
          </>
        )}

        {/* Empty state when nothing is actively in progress */}
        {nothingToShow && (
          <View style={[styles.empty, { marginTop: 20 }]}>
            <Ionicons name="leaf-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {coreHasStarted
                ? "Nothing in progress right now.\nStart a plan or continue your curriculum to track it here."
                : "Nothing to show yet.\nStart a lesson to track your progress here."}
            </Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

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

    planCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
    },
    planTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    planCurrent: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 4 },
    planBar: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 8 },
    planBarFill: { height: 4, backgroundColor: c.accentGreen, borderRadius: 2 },
    planProgress: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
    emptyText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}