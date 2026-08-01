import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import {
  useData,
  Module,
  Plan,
  getModuleProgressCounts,
  getFoundationProgress,
  getKingdomSchoolStatus,
  recordFoundationCompletion,
} from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import CompletionCard from "@/components/CompletionCard";

function ModuleThumbnail({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        style={[styles.thumb, isLocked && styles.thumbLocked]}
        resizeMode="cover"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbPlaceholder, isLocked && styles.thumbLocked]}>
      <Ionicons name="book-outline" size={18} color={isLocked ? colors.borderBeige : colors.accentGreen} />
    </View>
  );
}

function ModuleCard({ module, isCurrent, onPress }: { module: Module; isCurrent: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const submitted = module.submittedLessons ?? module.completedLessons;
  const pct = module.lessonCount > 0 ? (module.completedLessons / module.lessonCount) * 100 : 0;
  const submittedPct = module.lessonCount > 0 ? (submitted / module.lessonCount) * 100 : 0;
  const isStarted = submitted > 0;
  const isComplete = pct === 100;
  const isLocked = module.isLocked;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.borderBeige },
        isLocked && styles.cardLocked,
        isCurrent && { borderColor: colors.accentGreen, borderWidth: 2, backgroundColor: `${colors.accentGreen}0D` },
      ]}
      onPress={onPress}
      activeOpacity={isLocked ? 1 : 0.85}
      disabled={isLocked}
    >
      <View style={styles.cardLeft}>
        <ModuleThumbnail uri={module.imageUrl} isLocked={isLocked} />
        <View style={[styles.levelBadge, { backgroundColor: isLocked ? colors.borderBeige : isComplete ? colors.accentGreen : isStarted ? colors.amber : colors.borderBeige }]}>
          <Text style={[styles.levelText, { color: isComplete || isStarted ? colors.cream : colors.textMuted }]}>
            L{module.level}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.moduleTitleRow}>
          <Text style={[styles.moduleTitle, { color: colors.textDark }, isLocked && { color: colors.textMuted }]}>{module.title}</Text>
          {isCurrent && (
            <View style={styles.currentPill}>
              <Text style={styles.currentPillText}>Current</Text>
            </View>
          )}
        </View>
        <Text style={[styles.moduleDesc, { color: colors.textMuted }]}>{module.description}</Text>
        {!isLocked && (
          <>
            <View style={styles.progressRow}>
              {/* Two-layer bar: amber = submitted, green overlay = approved */}
              <View style={[styles.progressBg, { backgroundColor: colors.progressTrack, position: "relative", overflow: "hidden" }]}>
                <View style={[styles.progressFill, { position: "absolute", left: 0, top: 0, width: `${submittedPct}%` as any, backgroundColor: colors.amber, opacity: 0.55 }]} />
                <View style={[styles.progressFill, { position: "absolute", left: 0, top: 0, width: `${pct}%` as any, backgroundColor: colors.progressFill }]} />
              </View>
              <Text style={[styles.progressText, { color: colors.textMuted }]}>
                {submitted}/{module.lessonCount}
              </Text>
            </View>
            {submitted > module.completedLessons && (
              <Text style={[styles.progressSubText, { color: colors.textMuted }]}>
                {module.completedLessons} approved · {submitted - module.completedLessons} awaiting review
              </Text>
            )}
          </>
        )}
      </View>
      <View style={styles.cardRight}>
        {isLocked ? (
          <Ionicons name="lock-closed" size={18} color={colors.textMuted} />
        ) : isComplete ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// Unified plan card — a Plan is a p2p_curriculums row (type='plan') now, see
// migration 041_unify_plans_system.sql. Title/description arrive already
// translated (DataContext.loadPlans does the on-demand translation), and
// progress is looked up via getPlanProgress rather than carried on the
// object itself, since it depends on the current user.
function PlanCard({ plan, progress, onPress }: { plan: Plan; progress: number; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [imgErr, setImgErr] = useState(false);
  const isComplete = progress === 100;
  const hasProgress = plan.lessonCount > 0 && progress > 0;
  return (
    <TouchableOpacity style={styles.planCard} onPress={onPress} activeOpacity={0.85}>
      {plan.coverImageUrl && !imgErr ? (
        <Image source={{ uri: plan.coverImageUrl }} style={styles.planThumb} resizeMode="cover" onError={() => setImgErr(true)} />
      ) : (
        <View style={[styles.planThumb, styles.planThumbPlaceholder, { backgroundColor: `${plan.colorTheme}1A` }]}>
          <Ionicons name="book-outline" size={22} color={plan.colorTheme} />
        </View>
      )}
      <View style={styles.planCardBody}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planTitle} numberOfLines={1}>{plan.title}</Text>
          {plan.isFeatured && (
            <View style={styles.featuredPill}>
              <Ionicons name="star" size={9} color="#fff" />
              <Text style={styles.featuredPillText}>Featured</Text>
            </View>
          )}
        </View>
        {plan.description ? <Text style={styles.planDesc} numberOfLines={2}>{plan.description}</Text> : null}
        <View style={styles.planMetaRow}>
          <View style={[styles.difficultyBadge, { borderColor: plan.colorTheme }]}>
            <Text style={[styles.difficultyBadgeText, { color: plan.colorTheme }]}>{plan.difficultyLevel}</Text>
          </View>
          <Text style={styles.planMetaText}>
            {plan.moduleCount} module{plan.moduleCount === 1 ? "" : "s"} · {plan.lessonCount} lesson{plan.lessonCount === 1 ? "" : "s"}
          </Text>
        </View>
        {hasProgress && (
          <View style={[styles.progressRow, { marginTop: 6 }]}>
            <View style={[styles.progressBg, { backgroundColor: colors.progressTrack }]}>
              <View style={[styles.progressFill, { width: `${progress}%` as any, backgroundColor: isComplete ? colors.accentGreen : colors.amber }]} />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>{progress}%</Text>
          </View>
        )}
      </View>
      {isComplete ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingBottom: 100 },

    sectionBlock: { paddingHorizontal: 20, paddingTop: 24 },
    sectionHeaderRow: { marginBottom: 4 },
    sectionHeaderTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionHeaderSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 4, lineHeight: 19, fontFamily: "Inter_400Regular" },

    foundationProgressBlock: { marginTop: 18, marginBottom: 4 },
    foundationProgressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    foundationProgressPct: { fontSize: 15, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    foundationBarBg: { height: 8, backgroundColor: c.progressTrack, borderRadius: 4, overflow: "hidden" },
    foundationBarFill: { height: 8, backgroundColor: c.accentGreen, borderRadius: 4 },

    continueCard: {
      marginTop: 18,
      backgroundColor: c.primaryGreen, borderRadius: 16,
      padding: 16, flexDirection: "row", alignItems: "center", gap: 12,
    },
    continueLabel: { fontSize: 11, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
    continueTitle: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 2 },
    continueBtn: {
      backgroundColor: "#fff", borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 9,
      flexDirection: "row", alignItems: "center", gap: 4,
    },
    continueBtnText: { fontSize: 13, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },

    allModulesHeading: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 24, marginBottom: 12 },
    modulesList: { gap: 8 },

    plansList: { gap: 12, marginTop: 16 },
    planCard: {
      backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    planCardLocked: { opacity: 0.55 },
    planCardBody: { flex: 1 },
    planThumb: { width: 56, height: 56, borderRadius: 12, flexShrink: 0 },
    planThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    planTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
    planTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    featuredPill: {
      flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: c.amber,
      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0,
    },
    featuredPillText: { fontSize: 9, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    planDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    planMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    difficultyBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    difficultyBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
    planMetaText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },

    findElectivesBtn: {
      marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 14,
      paddingVertical: 13,
    },
    findElectivesBtnText: { fontSize: 14, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },

    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },

    card: {
      borderRadius: 16, borderWidth: 1,
      padding: 14, flexDirection: "row", gap: 12, alignItems: "center",
    },
    cardLocked: { opacity: 0.55 },
    cardLeft: { alignItems: "center", gap: 6 },
    thumb: { width: 48, height: 48, borderRadius: 10 },
    thumbLocked: { opacity: 0.4 },
    thumbPlaceholder: { backgroundColor: "rgba(29,158,117,0.08)", alignItems: "center", justifyContent: "center" },
    levelBadge: {
      width: 36, height: 36, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
    },
    levelText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
    cardBody: { flex: 1 },
    moduleTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
    moduleTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    currentPill: { backgroundColor: c.accentGreen, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    currentPillText: { fontSize: 9, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    moduleDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressBg: { flex: 1, height: 4, borderRadius: 2 },
    progressFill: { height: 4, borderRadius: 2 },
    progressText: { fontSize: 11, fontFamily: "Inter_400Regular", minWidth: 28 },
    progressSubText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 3 },
    cardRight: {},
  });
}

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  // Title/description arrive already translated — DataContext.loadPlans
  // does the on-demand translation fetch itself (parallel, English fallback
  // always), so there's nothing left for this screen to fetch.
  const { modules, isLoading, plans, plansLoading, getPlanProgress } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const [completionCard, setCompletionCard] = useState<{ date: string } | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);

  const { modulesStarted, modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  const foundationPct = getFoundationProgress(modulesCompleted, totalModules);
  // No persistent "active mentee" relationship exists in this codebase yet —
  // Prompt 1 explicitly rules out DB changes for this rebrand, so this is
  // always false until a real peer-guide/mentee tracking system exists.
  const hasActiveMentee = false;
  const status = getKingdomSchoolStatus(modulesStarted, modulesCompleted, totalModules, hasActiveMentee);

  const currentModule = modules.find((m) => !m.isLocked && m.completedLessons < m.lessonCount) ?? null;

  // Celebrate reaching Foundation completion exactly once per user, on-device
  // (no DB column for this — see recordFoundationCompletion's own comment).
  useEffect(() => {
    if (!profile?.id) return;
    if (status !== "foundation_complete" && status !== "guiding_others") return;
    recordFoundationCompletion(profile.id).then(({ date, isFirstTime }) => {
      if (isFirstTime) setCompletionCard({ date });
    });
  }, [status, profile?.id]);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" } : { flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {/* ── Section 1: Foundation ── */}
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderTitle}>{t("learn.foundationHeader")}</Text>
              <Text style={styles.sectionHeaderSubtitle}>
                {t("learn.foundationSubtitle", { modules: totalModules, lessons: totalLessons })}
              </Text>
            </View>

            <View style={styles.foundationProgressBlock}>
              <View style={styles.foundationProgressRow}>
                <Text style={styles.foundationProgressPct}>{t("learn.foundationPctComplete", { pct: foundationPct })}</Text>
              </View>
              <View style={styles.foundationBarBg}>
                <View style={[styles.foundationBarFill, { width: `${foundationPct}%` as any }]} />
              </View>
            </View>

            {currentModule && (
              <TouchableOpacity
                style={styles.continueCard}
                activeOpacity={0.9}
                onPress={() => router.push(`/module/${currentModule.id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.continueLabel}>{t("learn.currentModule")}</Text>
                  <Text style={styles.continueTitle} numberOfLines={1}>{currentModule.title}</Text>
                </View>
                <View style={styles.continueBtn}>
                  <Text style={styles.continueBtnText}>{t("learn.continueBtn")}</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
                </View>
              </TouchableOpacity>
            )}

            <Text style={styles.allModulesHeading}>{t("learn.allModules")}</Text>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={colors.accentGreen} />
              </View>
            ) : (
              <View style={styles.modulesList}>
                {modules.map((item) => (
                  <ModuleCard
                    key={item.id}
                    module={item}
                    isCurrent={currentModule?.id === item.id}
                    onPress={() => router.push(`/module/${item.id}`)}
                  />
                ))}
              </View>
            )}
          </View>

          {/* ── Section 2: Electives ── */}
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderTitle}>{t("learn.electivesHeader")}</Text>
              <Text style={styles.sectionHeaderSubtitle}>{t("learn.electivesSubtitle")}</Text>
            </View>

            {plansLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={colors.accentGreen} />
              </View>
            ) : plans.length === 0 ? (
              <View style={styles.loadingContainer}>
                <Ionicons name="radio-outline" size={40} color={colors.textMuted} />
                <Text style={[styles.sectionHeaderSubtitle, { textAlign: "center", marginTop: 12 }]}>
                  {t("learn.noPlans")}
                </Text>
              </View>
            ) : (
              <View style={styles.plansList}>
                {plans.map((item) => (
                  <PlanCard
                    key={item.id}
                    plan={item}
                    progress={getPlanProgress(item.id)}
                    onPress={() => router.push(`/plan/${item.id}` as any)}
                  />
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.findElectivesBtn} activeOpacity={0.85} onPress={() => router.push("/plans" as any)}>
              <Ionicons name="search" size={16} color={colors.accentGreen} />
              <Text style={styles.findElectivesBtnText}>{t("learn.findElectives")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {completionCard && profile && (
        <CompletionCard
          visible
          firstName={profile.displayName?.split(" ")[0] ?? "Friend"}
          completionDate={completionCard.date}
          onClose={() => setCompletionCard(null)}
        />
      )}
    </View>
  );
}
