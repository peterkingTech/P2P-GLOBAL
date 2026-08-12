import React, { useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData, PlanWithLockStatus } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { shareCategory } from "@/lib/sharing";

type PlanCategory = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  colorTheme: string;
  displayOrder: number | null;
  planCount: number;
  totalLessons: number;
};

export default function CategoryDetailScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { getCategoryPlans } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [plans, setPlans] = useState<PlanWithLockStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState<string | null>(null);
  const previouslyLockedIds = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    try {
      const [categoriesRes, planData] = await Promise.all([
        fetch(`${getApiUrl()}/plans/categories`),
        getCategoryPlans(categoryId),
      ]);
      const categories = (await categoriesRes.json()) as PlanCategory[];
      const match = Array.isArray(categories) ? categories.find((c) => c.id === categoryId) : null;
      setCategory(match ?? null);

      // A plan that was locked on the previous load and is unlocked now —
      // the user just completed its prerequisite. Celebrate once, on the
      // first load after the transition (not on the very first load ever,
      // when previouslyLockedIds is still null).
      if (previouslyLockedIds.current) {
        const newlyUnlocked = planData.find((p) => !p.locked && previouslyLockedIds.current!.has(p.id));
        if (newlyUnlocked) setCelebration(`🎉 ${newlyUnlocked.title} is now unlocked!`);
      }
      previouslyLockedIds.current = new Set(planData.filter((p) => p.locked).map((p) => p.id));

      setPlans(planData);
    } catch {
      setCategory(null);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [categoryId, getCategoryPlans]);

  // Refetch on focus — enrollment/completion status can change after
  // returning from a lesson, which is exactly when a new plan may unlock.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goToPlanOrQuestions = useCallback(async (planId: string) => {
    if (!profile?.id) { router.push(`/plan/${planId}` as any); return; }
    const { data } = await supabase
      .from("p2p_plan_enrollments")
      .select("id")
      .eq("user_id", profile.id)
      .eq("plan_id", planId)
      .maybeSingle();
    if (data) router.push(`/plan/${planId}` as any);
    else router.push(`/plans/pre-plan-questions?planId=${planId}` as any);
  }, [profile?.id, router]);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (!category) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.errorText}>Category not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: category.colorTheme }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => shareCategory({ id: category.id, title: category.title, planCount: category.planCount })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="share-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{category.title}</Text>
        {category.description ? <Text style={styles.headerDescription}>{category.description}</Text> : null}
        <Text style={styles.headerCount}>
          {category.planCount} plan{category.planCount === 1 ? "" : "s"}
        </Text>
      </View>

      {celebration && (
        <TouchableOpacity style={styles.celebrationBanner} onPress={() => setCelebration(null)} activeOpacity={0.85}>
          <Text style={styles.celebrationText}>{celebration}</Text>
          <Ionicons name="close" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {plans.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="albums-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>No plans in this category yet.</Text>
          </View>
        ) : (
          plans.map((p) => {
            const isCompleted = p.progressPercent === 100;
            const isInProgress = !isCompleted && p.progressPercent > 0;
            const firstLine = (p.description ?? "").split("\n")[0];
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.planCard, p.locked && styles.planCardLocked]}
                activeOpacity={0.88}
                onPress={() => (p.locked ? undefined : router.push(`/plan/${p.id}` as any))}
              >
                <View style={styles.planCardTopRow}>
                  {p.topicNumber ? (
                    <View style={[styles.topicBadge, { borderColor: p.locked ? colors.textMuted : category.colorTheme }]}>
                      <Text style={[styles.topicBadgeText, { color: p.locked ? colors.textMuted : category.colorTheme }]}>Topic {p.topicNumber}</Text>
                    </View>
                  ) : null}
                  {isCompleted ? (
                    <View style={styles.completedBadge}>
                      <Ionicons name="checkmark-circle" size={13} color={colors.accentGreen} />
                      <Text style={styles.completedBadgeText}>Completed</Text>
                    </View>
                  ) : p.locked ? (
                    <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  ) : (
                    <Ionicons name="lock-open" size={16} color={category.colorTheme} />
                  )}
                </View>
                <Text style={[styles.planTitle, p.locked && styles.planTitleLocked]} numberOfLines={2}>{p.title}</Text>
                {p.locked && p.unlockMessage ? (
                  <Text style={styles.lockMessage}>{p.unlockMessage}</Text>
                ) : firstLine ? (
                  <Text style={styles.planDesc} numberOfLines={2}>{firstLine}</Text>
                ) : null}

                {isInProgress && (
                  <View style={styles.progressRow}>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${p.progressPercent}%` as any, backgroundColor: category.colorTheme }]} />
                    </View>
                    <Text style={styles.progressPctText}>{p.progressPercent}%</Text>
                  </View>
                )}

                <View style={styles.planMetaRow}>
                  <Text style={styles.planMetaText}>
                    {p.moduleCount} module{p.moduleCount === 1 ? "" : "s"} · {p.lessonCount} lesson{p.lessonCount === 1 ? "" : "s"}
                  </Text>
                  {p.estimatedWeeks ? (
                    <Text style={styles.planMetaText}>~{p.estimatedWeeks} wk{p.estimatedWeeks === 1 ? "" : "s"}</Text>
                  ) : null}
                </View>

                {p.locked ? (
                  <View style={styles.actionBtnLocked}>
                    <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
                    <Text style={styles.actionBtnLockedText}>Locked</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: category.colorTheme }]}
                    onPress={(e) => { e.stopPropagation?.(); goToPlanOrQuestions(p.id); }}
                  >
                    <Text style={styles.actionBtnText}>{isCompleted ? "Do Again" : isInProgress ? "Continue" : "Start Plan"}</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    errorText: { fontSize: 15, color: c.textMuted, fontFamily: "Inter_400Regular" },

    header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20, gap: 8 },
    headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerTitle: { fontSize: 22, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 10 },
    headerDescription: { fontSize: 13, color: "rgba(255,255,255,0.88)", fontFamily: "Inter_400Regular", lineHeight: 19 },
    headerCount: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_500Medium", marginTop: 2 },

    celebrationBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1D9E75", paddingHorizontal: 16, paddingVertical: 10 },
    celebrationText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1 },

    scroll: { padding: 20 },
    emptyState: { alignItems: "center", paddingVertical: 40, gap: 10 },
    emptyStateText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },

    planCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 14 },
    planCardLocked: { backgroundColor: c.cardBeige, opacity: 0.85 },
    planCardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    topicBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    topicBadgeText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
    completedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    completedBadgeText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },

    planTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 10 },
    planTitleLocked: { color: c.textMuted },
    planDesc: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 18 },
    lockMessage: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 4, fontStyle: "italic" },

    progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    progressBarBg: { flex: 1, height: 5, backgroundColor: c.progressTrack, borderRadius: 3, overflow: "hidden" },
    progressBarFill: { height: 5, borderRadius: 3 },
    progressPctText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", minWidth: 30 },

    planMetaRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
    planMetaText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },

    actionBtn: { borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 14 },
    actionBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    actionBtnLocked: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, paddingVertical: 10, marginTop: 14, backgroundColor: c.borderBeige },
    actionBtnLockedText: { color: c.textMuted, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}