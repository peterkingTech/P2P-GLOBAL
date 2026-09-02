import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { useTranslation } from "react-i18next";

const HERO_HEIGHT = 230;

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
  const { modules, lessons, refreshCurriculumData, loadModuleWithLessons } = useData();
  const { profile } = useAuth();

  // This screen only ever renders a core-curriculum module — Plans (System A,
  // p2p_curriculums.type='plan') have their own dedicated screen at
  // plan/[id].tsx, which renders module/lesson lists itself and links lessons
  // straight to lesson/[id].tsx. DataContext.loadCurriculum also excludes
  // type='plan' rows from the global modules/lessons arrays, so `id` here can
  // only ever resolve against a real core-curriculum module.
  const globalModule = modules.find((m) => m.id === id);

  // Curriculum redesign — the global modules/lessons state only ever holds
  // ONE "active" curriculum's modules (still Foundations of Christianity,
  // unchanged). A module belonging to any other stand-alone curriculum
  // (Peer-to-Peer Orientation, Identity in Christ, The Gospel & Salvation)
  // won't be in that array, so fall back to fetching it directly by id —
  // same real progress/locking rules, just fetched on demand instead of
  // from the shared "active curriculum" snapshot.
  const [fallback, setFallback] = useState<{ module: typeof globalModule; lessons: typeof lessons } | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  const loadFallback = useCallback(async () => {
    if (!id || globalModule) return;
    setFallbackLoading(true);
    const result = await loadModuleWithLessons(id, profile?.id);
    setFallback(result);
    setFallbackLoading(false);
  }, [id, globalModule, profile?.id, loadModuleWithLessons]);

  useFocusEffect(useCallback(() => { loadFallback(); }, [loadFallback]));

  const coreModule = globalModule ?? fallback?.module;
  const coreLessons = coreModule
    ? (globalModule ? lessons : (fallback?.lessons ?? [])).filter((l) => l.moduleId === coreModule.id).sort((a, b) => a.order - b.order)
    : [];

  // Refresh core curriculum lock state on every focus — covers the case where
  // an evaluator approved a submission while the user had the app backgrounded
  // and the realtime event was missed (OS suspended the network connection).
  useFocusEffect(useCallback(() => {
    if (globalModule) refreshCurriculumData();
  }, [refreshCurriculumData, globalModule]));

  // Count submitted (pending review) lessons toward the progress bar — same
  // rule as unlock: a submitted lesson counts as done for progress purposes.
  const completed = coreLessons.filter((l) => {
    if (l.isCompleted) return true;
    const evalSt = (l as { evaluationStatus?: string }).evaluationStatus;
    return evalSt === "pending";
  }).length;
  const pct = coreLessons.length > 0 ? Math.round((completed / coreLessons.length) * 100) : 0;
  const isLocked = coreModule?.isLocked ?? false;
  const { t } = useTranslation();
  const levelLabel = t("module.level", { n: coreModule?.level ?? 1 });
  const heroImageUri = coreModule?.imageUrl;

  const topOffset = insets.top + (Platform.OS === "web" ? 67 : 0);

  if (!coreModule && fallbackLoading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

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
              {coreModule?.title ?? "Module"}
            </Text>
          </View>
        </View>

        {/* ── Progress / locked banner ── */}
        <View style={styles.metaBlock}>
          {coreModule?.description ? (
            <Text style={styles.moduleDesc}>{coreModule.description}</Text>
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
                  {t("module.lessonsOfTotal", { done: completed, total: coreLessons.length })}
                </Text>
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
              </View>
            </View>
          )}
        </View>

        {/* ── Lessons list ── */}
        <View style={styles.lessonsBlock}>
          <Text style={styles.sectionTitle}>{t("module.lessons")}</Text>
          <View style={styles.lessonList}>
            {coreLessons.map((lesson, idx) => {
              const locked = (lesson as { isLocked?: boolean }).isLocked ?? false;
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },

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
