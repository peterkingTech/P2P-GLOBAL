import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, PlanModule } from "@/contexts/DataContext";
import { supabase, useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { useTranslation } from "react-i18next";

type AttributionStyle = "plaque" | "credit-line";
interface Attribution {
  style: AttributionStyle;
  honorLine: string;
  orgLine: string;
  socialLine: string;
  socialUrls?: { youtube?: string; instagram?: string };
  handles?: { youtube?: string; instagram?: string };
}

const ATTRIBUTION_MAP: Record<string, Attribution> = {
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
    style: "credit-line",
    honorLine: "In honor of Dr. Myles Munroe",
    orgLine: "Bahamas Faith Ministries International · Nassau, The Bahamas",
    socialLine: "@MunroeGlobal (YouTube)  ·  @munroeglobal (Instagram)",
    socialUrls: {
      youtube: "https://www.youtube.com/@MunroeGlobal",
      instagram: "https://www.instagram.com/munroeglobal",
    },
    handles: { youtube: "@MunroeGlobal", instagram: "@munroeglobal" },
  },
};

const VICTORY_CURRICULUM_ID = "c2000000-0000-0000-0000-000000000002";
const VICTORY_ATTRIBUTION: Attribution = {
  style: "credit-line",
  honorLine: "Teaching credit: Pastor Dolapo Lawal",
  orgLine: "Lead Pastor, Zoe Household Global · Austell, GA / Lagos, Nigeria",
  socialLine: "@PastorDolapoLawal (YouTube)  ·  @thedolapolawal (Instagram)",
  socialUrls: {
    youtube: "https://www.youtube.com/@PastorDolapoLawal",
    instagram: "https://www.instagram.com/thedolapolawal",
  },
  handles: { youtube: "@PastorDolapoLawal", instagram: "@thedolapolawal" },
};

const HERO_HEIGHT = 230;

interface PlanLesson {
  id: string;
  title: string;
  subtitle: string;
  order: number;
  isCompleted: boolean;
  isLocked: boolean;
  evaluationStatus?: "pending" | "needs_revision";
}

function AttributionBlock({ attr }: { attr: Attribution }) {
  const isPlaque = attr.style === "plaque";

  if (isPlaque) {
    return (
      <View style={attrStyles.plaque}>
        <View style={attrStyles.plaqueInner}>
          <Text style={attrStyles.plaqueDecor}>✦</Text>
          <Text style={attrStyles.plaqueHonor}>{attr.honorLine}</Text>
          <Text style={attrStyles.plaqueOrg}>{attr.orgLine}</Text>
          <View style={attrStyles.plaqueDivider} />
          <View style={attrStyles.plaqueHandles}>
            {attr.socialUrls?.youtube && (
              <TouchableOpacity
                onPress={() => Linking.openURL(attr.socialUrls!.youtube!)}
                style={attrStyles.plaqueHandle}
              >
                <Ionicons name="logo-youtube" size={14} color="#BA7517" />
                <Text style={attrStyles.plaqueHandleText}>@MunroeGlobal</Text>
              </TouchableOpacity>
            )}
            {attr.socialUrls?.instagram && (
              <TouchableOpacity
                onPress={() => Linking.openURL(attr.socialUrls!.instagram!)}
                style={attrStyles.plaqueHandle}
              >
                <Ionicons name="logo-instagram" size={14} color="#BA7517" />
                <Text style={attrStyles.plaqueHandleText}>@munroeglobal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={attrStyles.creditLine}>
      <View style={attrStyles.creditBar} />
      <Text style={attrStyles.creditHonor}>{attr.honorLine}</Text>
      <Text style={attrStyles.creditOrg}>{attr.orgLine}</Text>
      <View style={attrStyles.creditHandles}>
        {attr.socialUrls?.youtube && (
          <TouchableOpacity
            onPress={() => Linking.openURL(attr.socialUrls!.youtube!)}
            style={attrStyles.creditHandle}
          >
            <Ionicons name="logo-youtube" size={12} color={colors.textMuted} />
            <Text style={attrStyles.creditHandleText}>{attr.handles?.youtube ?? ""}</Text>
          </TouchableOpacity>
        )}
        {attr.socialUrls?.instagram && (
          <TouchableOpacity
            onPress={() => Linking.openURL(attr.socialUrls!.instagram!)}
            style={attrStyles.creditHandle}
          >
            <Ionicons name="logo-instagram" size={12} color={colors.textMuted} />
            <Text style={attrStyles.creditHandleText}>{attr.handles?.instagram ?? ""}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function HeroImage({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity: isLocked ? 0.45 : 1 }]}
        resizeMode="cover"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.heroPlaceholder]}>
      <Ionicons name="book-outline" size={52} color="rgba(157,225,203,0.25)" />
    </View>
  );
}

export default function ModuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { modules, lessons, plans, refreshCurriculumData } = useData();
  const { profile } = useAuth();

  // ── Detection: three possible view modes ────────────────────────────────
  // 1. Core curriculum module (from global modules array)
  const coreModule = modules.find((m) => m.id === id);
  // 2. Curriculum overview — id is a curriculum id (multi-module plan)
  const curriculumPlan = !coreModule ? plans.find((p) => p.id === id) : undefined;
  // 3. Plan module lesson list — id is a module id inside a plan
  const parentPlan = !coreModule && !curriculumPlan
    ? plans.find((p) => p.modules.some((m: PlanModule) => m.id === id))
    : undefined;
  const planModuleInfo = parentPlan?.modules.find((m: PlanModule) => m.id === id);

  const isCurriculumOverview = !!curriculumPlan;
  const isPlanLesson = !!planModuleInfo;

  // Core module path — use existing global lessons
  const coreLessons = coreModule
    ? lessons.filter((l) => l.moduleId === coreModule.id).sort((a, b) => a.order - b.order)
    : [];

  // Plan lesson path — fetch lessons from Supabase (id is a plan module id)
  const [planLessons, setPlanLessons] = useState<PlanLesson[]>([]);
  const [planLoading, setPlanLoading] = useState(false);

  const fetchPlanLessons = useCallback(async () => {
    if (!isPlanLesson || !id) return;
    setPlanLoading(true);
    try {
      const [{ data: lessonRows }, { data: progressRows }, { data: evalRows }] = await Promise.all([
        supabase
          .from("p2p_lessons")
          .select("id,title,subtitle,order_index")
          .eq("module_id", id)
          .eq("status", "published")
          .order("order_index", { ascending: true }),
        profile?.id
          ? supabase
              .from("p2p_lesson_progress")
              .select("lesson_id,completed")
              .eq("user_id", profile.id)
          : Promise.resolve({ data: [] }),
        profile?.id
          ? supabase
              .from("p2p_lesson_evaluations")
              .select("lesson_id,status")
              .eq("submitter_id", profile.id)
              .in("status", ["pending", "needs_revision"])
          : Promise.resolve({ data: [] }),
      ]);
      const progressMap = new Map<string, boolean>();
      for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
        progressMap.set(p.lesson_id as string, Boolean(p.completed));
      }
      const evalMap = new Map<string, "pending" | "needs_revision">();
      for (const e of (evalRows ?? []) as Record<string, unknown>[]) {
        const st = e.status as "pending" | "needs_revision";
        if (st === "needs_revision" || !evalMap.has(e.lesson_id as string))
          evalMap.set(e.lesson_id as string, st);
      }
      const built = ((lessonRows ?? []) as Record<string, unknown>[]).map((l) => ({
        id: l.id as string,
        title: l.title as string,
        subtitle: (l.subtitle as string) ?? "",
        order: l.order_index as number,
        isCompleted: progressMap.get(l.id as string) ?? false,
        isLocked: false,
        evaluationStatus: progressMap.get(l.id as string) ? undefined : evalMap.get(l.id as string),
      }));
      // Unlock the next lesson as soon as the previous is submitted (pending)
      // or approved — no waiting on peer review to continue learning.
      for (let i = 1; i < built.length; i++) {
        const prev = built[i - 1];
        const prevPassed = prev.isCompleted || prev.evaluationStatus === "pending";
        built[i].isLocked = !prevPassed;
      }
      setPlanLessons(built);
    } finally {
      setPlanLoading(false);
    }
  }, [isPlanLesson, id, profile?.id]);

  // Refetch plan-lesson eval status on every focus — returning from a lesson
  // after submission/approval must immediately show the updated unlock state.
  useFocusEffect(useCallback(() => {
    fetchPlanLessons();
  }, [fetchPlanLessons]));

  // Refresh core curriculum lock state on every focus — covers the case where
  // an evaluator approved a submission while the user had the app backgrounded
  // and the realtime event was missed (OS suspended the network connection).
  useFocusEffect(useCallback(() => {
    if (!isPlanLesson) {
      refreshCurriculumData();
    }
  }, [isPlanLesson, refreshCurriculumData]));

  // Unified display data
  const displayTitle = isCurriculumOverview
    ? curriculumPlan!.title
    : isPlanLesson
      ? (planModuleInfo!.title)
      : (coreModule?.title ?? "Module");
  const displayDesc = isCurriculumOverview
    ? curriculumPlan!.description
    : isPlanLesson
      ? (planModuleInfo!.description)
      : (coreModule?.description ?? "");
  const displayLessons = isPlanLesson ? planLessons : coreLessons;
  // Count submitted (pending review) lessons toward the progress bar — same
  // rule as unlock: a submitted lesson counts as done for progress purposes.
  const completed = displayLessons.filter((l) => {
    if (l.isCompleted) return true;
    const evalSt = (l as { evaluationStatus?: string }).evaluationStatus;
    return evalSt === "pending";
  }).length;
  const pct = displayLessons.length > 0 ? Math.round((completed / displayLessons.length) * 100) : 0;
  const isLocked = !isCurriculumOverview && !isPlanLesson && (coreModule?.isLocked ?? false);
  const isLoading = isPlanLesson && planLoading;
  const { t } = useTranslation();
  const levelLabel = (isCurriculumOverview || isPlanLesson) ? t("module.studyPlan") : t("module.level", { n: coreModule?.level ?? 1 });

  const heroImageUri = isCurriculumOverview
    ? curriculumPlan!.imageUrl
    : isPlanLesson
      ? planModuleInfo!.imageUrl
      : coreModule?.imageUrl;

  const attribution = useMemo<Attribution | null>(() => {
    if (isCurriculumOverview) {
      if (curriculumPlan?.id === VICTORY_CURRICULUM_ID) return VICTORY_ATTRIBUTION;
      return null;
    }
    if (isPlanLesson) {
      if (id && ATTRIBUTION_MAP[id]) return ATTRIBUTION_MAP[id];
      if (parentPlan?.id === VICTORY_CURRICULUM_ID) return VICTORY_ATTRIBUTION;
      return null;
    }
    return null;
  }, [isCurriculumOverview, isPlanLesson, id, curriculumPlan?.id, parentPlan?.id]);

  const topOffset = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* ── Hero ── */}
        <View style={[styles.hero, { height: HERO_HEIGHT + topOffset }]}>
          <HeroImage uri={heroImageUri} isLocked={isLocked} />
          <View style={styles.heroOverlay} />

          <TouchableOpacity
            style={[styles.backBtn, { top: topOffset + 12 }]}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.cream} />
          </TouchableOpacity>

          <View style={styles.heroCopy}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>{levelLabel}</Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.75}>
              {displayTitle}
            </Text>
          </View>
        </View>

        {/* ── Progress / locked banner ── */}
        <View style={styles.metaBlock}>
          {displayDesc ? (
            <Text style={styles.moduleDesc}>{displayDesc}</Text>
          ) : null}

          {isLocked ? (
            <View style={styles.lockedBanner}>
              <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
              <Text style={styles.lockedBannerText}>
                {t("module.finishPrevious")}
              </Text>
            </View>
          ) : (
            <View style={styles.progressBlock}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>{t("module.pctComplete", { pct })}</Text>
                <Text style={styles.progressCount}>
                  {t("module.lessonsOfTotal", { done: completed, total: displayLessons.length })}
                </Text>
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
              </View>
            </View>
          )}
        </View>

        {/* ── Curriculum overview: module cards ── */}
        {isCurriculumOverview ? (
          <View style={styles.lessonsBlock}>
            <Text style={styles.sectionTitle}>{t("module.modules")}</Text>
            <View style={styles.lessonList}>
              {curriculumPlan!.modules.map((mod: PlanModule, idx: number) => {
                const locked = mod.isLocked;
                const pctMod = mod.lessonCount > 0
                  ? Math.round((mod.completedLessons / mod.lessonCount) * 100)
                  : 0;
                const done = pctMod === 100;
                return (
                  <TouchableOpacity
                    key={mod.id}
                    style={[styles.lessonRow, locked && styles.lessonRowLocked]}
                    onPress={() => !locked && router.push(`/module/${mod.id}`)}
                    activeOpacity={locked ? 1 : 0.85}
                  >
                    <View style={[
                      styles.lessonBullet,
                      done && styles.lessonBulletDone,
                      locked && styles.lessonBulletLocked,
                    ]}>
                      {done ? (
                        <Ionicons name="checkmark" size={12} color={colors.cream} />
                      ) : (
                        <Text style={styles.lessonBulletText}>{idx + 1}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lessonTitle, locked && styles.lessonTitleLocked]}>
                        {mod.title}
                      </Text>
                      {!locked && (
                        <Text style={styles.lessonSubCount}>
                          {t("module.lessonsOfTotal", { done: mod.completedLessons, total: mod.lessonCount })}
                          {pctMod > 0 && pctMod < 100 ? `  ·  ${pctMod}%` : ""}
                        </Text>
                      )}
                    </View>
                    {locked ? (
                      <Ionicons name="lock-closed" size={15} color={colors.borderBeige} />
                    ) : done ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : (
          /* ── Lessons list ── */
          <View style={styles.lessonsBlock}>
            <Text style={styles.sectionTitle}>{t("module.lessons")}</Text>
            {isLoading ? (
              <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} />
            ) : (
              <View style={styles.lessonList}>
                {displayLessons.map((lesson, idx) => {
                  const locked = (lesson as { isLocked?: boolean }).isLocked ?? false;
                  // Only core-curriculum lessons carry evaluationStatus today (see
                  // Lesson in DataContext) — plan lessons don't use this peer
                  // evaluation system, so this is undefined for those and the
                  // row falls back to the existing not-started/done look.
                  const evalStatus = (lesson as { evaluationStatus?: "pending" | "needs_revision" | null }).evaluationStatus;
                  const awaitingReview = !lesson.isCompleted && !!evalStatus;
                  const reviewColor = evalStatus === "needs_revision" ? "#C0392B" : colors.amber;
                  return (
                    <TouchableOpacity
                      key={lesson.id}
                      style={[styles.lessonRow, locked && styles.lessonRowLocked]}
                      onPress={() => !locked && router.push(`/lesson/${lesson.id}`)}
                      activeOpacity={locked ? 1 : 0.8}
                    >
                      <View style={[
                        styles.lessonBullet,
                        lesson.isCompleted && styles.lessonBulletDone,
                        awaitingReview && { backgroundColor: reviewColor },
                        locked && styles.lessonBulletLocked,
                      ]}>
                        {lesson.isCompleted ? (
                          <Ionicons name="checkmark" size={12} color={colors.cream} />
                        ) : awaitingReview ? (
                          <Ionicons name={evalStatus === "needs_revision" ? "alert" : "time"} size={12} color={colors.cream} />
                        ) : (
                          <Text style={styles.lessonBulletText}>{idx + 1}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.lessonTitle, locked && styles.lessonTitleLocked]}>
                          {lesson.title}
                        </Text>
                        {awaitingReview && (
                          <Text style={[styles.lessonSubCount, { color: reviewColor }]}>
                            {evalStatus === "needs_revision" ? t("module.needsRevision") : t("module.waitingPeerReview")}
                          </Text>
                        )}
                      </View>
                      {locked ? (
                        <Ionicons name="lock-closed" size={15} color={colors.borderBeige} />
                      ) : awaitingReview ? (
                        <Ionicons name={evalStatus === "needs_revision" ? "alert-circle" : "time-outline"} size={20} color={reviewColor} />
                      ) : (
                        <Ionicons
                          name="play-circle"
                          size={20}
                          color={lesson.isCompleted ? colors.accentGreen : colors.textMuted}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── Attribution ── */}
        {attribution && !isLoading && (
          <AttributionBlock attr={attribution} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },

  hero: {
    width: "100%",
    backgroundColor: colors.navBg,
    overflow: "hidden",
    position: "relative",
  },
  heroPlaceholder: {
    backgroundColor: "#0B3A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(6,17,13,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 60,
    backgroundColor: "rgba(6,17,13,0.58)",
  },
  levelBadge: {
    backgroundColor: "rgba(29,158,117,0.85)",
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  levelBadgeText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },

  metaBlock: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 14,
  },
  moduleDesc: {
    fontSize: 14,
    color: colors.textMid,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderBeige,
  },
  lockedBannerText: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  progressBlock: { gap: 8 },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryGreen,
    fontFamily: "Inter_600SemiBold",
  },
  progressCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  progressBg: {
    height: 7,
    backgroundColor: colors.progressTrack,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 7,
    backgroundColor: colors.progressFill,
    borderRadius: 4,
  },

  lessonsBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  lessonList: { gap: 8 },
  lessonRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lessonRowLocked: { opacity: 0.5 },
  lessonBullet: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.borderBeige,
    alignItems: "center",
    justifyContent: "center",
  },
  lessonBulletDone: { backgroundColor: colors.accentGreen },
  lessonBulletLocked: { backgroundColor: colors.borderBeige },
  lessonBulletText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMid,
    fontFamily: "Inter_700Bold",
  },
  lessonTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textDark,
    fontFamily: "Inter_600SemiBold",
  },
  lessonTitleLocked: { color: colors.textMuted },
  lessonSubCount: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
});

const attrStyles = StyleSheet.create({
  plaque: {
    marginHorizontal: 16,
    marginTop: 28,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(186,117,23,0.35)",
    backgroundColor: "rgba(186,117,23,0.06)",
    overflow: "hidden",
  },
  plaqueInner: {
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  plaqueDecor: {
    fontSize: 16,
    color: "#BA7517",
    marginBottom: 6,
    letterSpacing: 6,
  },
  plaqueHonor: {
    fontSize: 15,
    fontWeight: "700",
    color: "#7A4A0A",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  plaqueOrg: {
    fontSize: 12,
    color: "#9A6010",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 2,
    lineHeight: 18,
  },
  plaqueDivider: {
    width: 40,
    height: 1,
    backgroundColor: "rgba(186,117,23,0.3)",
    marginVertical: 10,
  },
  plaqueHandles: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  plaqueHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  plaqueHandleText: {
    fontSize: 12,
    color: "#BA7517",
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },

  creditLine: {
    marginHorizontal: 16,
    marginTop: 28,
    marginBottom: 8,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryGreen,
    gap: 3,
  },
  creditBar: { display: "none" },
  creditHonor: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textDark,
    fontFamily: "Inter_600SemiBold",
  },
  creditOrg: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  creditHandles: {
    flexDirection: "row",
    gap: 14,
    marginTop: 6,
    flexWrap: "wrap",
  },
  creditHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  creditHandleText: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
});
