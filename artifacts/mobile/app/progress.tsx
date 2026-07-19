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
import { useData, Plan, PlanV2 } from "@/contexts/DataContext";
import { supabase } from "@/contexts/AuthContext";
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

// ── Legacy (type='plan' curriculum) in-progress card — resolves current
// module + lesson name from the already-loaded modules array (no extra fetch). ──
function LegacyPlanCard({ plan, styles, router }: { plan: Plan; styles: ReturnType<typeof makeStyles>; router: ReturnType<typeof useRouter> }) {
  const currentModule = plan.modules.find(m => !m.isLocked && m.completedLessons < m.lessonCount) ?? plan.modules[0];
  const pct = plan.lessonCount > 0 ? Math.round((plan.completedLessons / plan.lessonCount) * 100) : 0;
  return (
    <TouchableOpacity
      style={styles.planCard}
      onPress={() => router.push(`/module/${plan.singleModuleId ?? plan.id}` as any)}
      activeOpacity={0.82}
    >
      <Text style={styles.planTitle}>{plan.title}</Text>
      {currentModule && (
        <Text style={styles.planCurrent}>
          Current: {currentModule.title} ({currentModule.completedLessons}/{currentModule.lessonCount} lessons)
        </Text>
      )}
      <View style={styles.planBar}>
        <View style={[styles.planBarFill, { width: `${pct}%` as any }]} />
      </View>
      <Text style={styles.planProgress}>{plan.completedLessons}/{plan.lessonCount} lessons approved · {pct}%</Text>
    </TouchableOpacity>
  );
}

// ── p2p_plans-based (plansV2) in-progress card — plansV2 only carries
// plan-level counts, so this resolves the current module/lesson name with a
// small local fetch, the same pattern app/plan/[id].tsx already uses. ──
function PlanV2Card({ plan, userId, styles, router }: { plan: PlanV2; userId: string; styles: ReturnType<typeof makeStyles>; router: ReturnType<typeof useRouter> }) {
  const [current, setCurrent] = useState<{ moduleTitle: string; lessonTitle: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: lessons }, { data: modules }, { data: progress }] = await Promise.all([
        supabase.from("p2p_plan_lessons").select("id,module_id,title,order_index").eq("plan_id", plan.id).order("order_index"),
        supabase.from("p2p_plan_modules").select("id,module_title,order_index").eq("plan_id", plan.id).order("order_index"),
        supabase.from("p2p_plan_lesson_progress").select("lesson_id,completed").eq("user_id", userId),
      ]);
      if (cancelled) return;
      const completedSet = new Set((progress ?? []).filter((p: any) => p.completed).map((p: any) => p.lesson_id));
      const nextLesson = (lessons ?? []).find((l: any) => !completedSet.has(l.id));
      if (nextLesson) {
        const mod = (modules ?? []).find((m: any) => m.id === nextLesson.module_id);
        setCurrent({ moduleTitle: mod?.module_title ?? "", lessonTitle: nextLesson.title });
      }
    })();
    return () => { cancelled = true; };
  }, [plan.id, userId]);

  const pct = plan.lessonCount > 0 ? Math.round((plan.completedLessons / plan.lessonCount) * 100) : 0;
  return (
    <TouchableOpacity
      style={styles.planCard}
      onPress={() => router.push(`/plan/${plan.id}` as any)}
      activeOpacity={0.82}
    >
      <Text style={styles.planTitle}>{plan.title}</Text>
      {current && (
        <Text style={styles.planCurrent}>
          {current.moduleTitle ? `${current.moduleTitle} — ` : ""}{current.lessonTitle}
        </Text>
      )}
      <View style={styles.planBar}>
        <View style={[styles.planBarFill, { width: `${pct}%` as any }]} />
      </View>
      <Text style={styles.planProgress}>{plan.completedLessons}/{plan.lessonCount} lessons approved · {pct}%</Text>
    </TouchableOpacity>
  );
}

export default function ProgressDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { modules, lessons, plans, plansV2 } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const plansInProgress = plans.filter(p => p.completedLessons > 0 && p.completedLessons < p.lessonCount);
  const plansV2InProgress = plansV2.filter(p => p.completedLessons > 0 && p.completedLessons < p.lessonCount);

  // Core curriculum: the first lesson that's neither completed nor locked is
  // "current" — everything before it is done, this is what the user should
  // work on next.
  const currentCoreLesson = lessons.find(l => !l.isCompleted && !l.isLocked);
  const currentCoreModule = currentCoreLesson ? modules.find(m => m.id === currentCoreLesson.moduleId) : null;
  const coreCompletedLessons = lessons.filter(l => l.isCompleted).length;
  const coreHasStarted = coreCompletedLessons > 0 || Boolean(currentCoreLesson);

  const nothingToShow = plansInProgress.length === 0 && plansV2InProgress.length === 0 && !currentCoreModule;

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
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
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
        {(plansInProgress.length > 0 || plansV2InProgress.length > 0) && (
          <>
            <Text style={styles.sectionHeader}>Plans In Progress</Text>
            {plansInProgress.map(p => (
              <LegacyPlanCard key={p.id} plan={p} styles={styles} router={router} />
            ))}
            {profile?.id && plansV2InProgress.map(p => (
              <PlanV2Card key={p.id} plan={p} userId={profile.id} styles={styles} router={router} />
            ))}
          </>
        )}

        {/* Empty state when nothing is in progress */}
        {nothingToShow && (
          <View style={[styles.empty, { marginTop: 40 }]}>
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
