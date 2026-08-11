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
import { useAuth, supabase } from "@/contexts/AuthContext";
import {
  useData,
  Module,
  getModuleProgressCounts,
  getFoundationProgress,
  getKingdomSchoolStatus,
  recordFoundationCompletion,
} from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import CompletionCard from "@/components/CompletionCard";
import { PLAN_CATEGORIES } from "@/lib/planCategories";

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

type KingdomSchoolSection = "foundation" | null;

// The two-card selector at the top of Kingdom School — designed to feel
// like tabs but built as premium cards, not a generic segmented control.
// Only one of Foundation/Electives is expanded below at a time; tapping the
// already-expanded card collapses it.
function KingdomSchoolCards({
  selected,
  onSelect,
  modulesCompleted,
  totalModules,
  foundationPct,
  plansCount,
  enrolledCount,
}: {
  selected: KingdomSchoolSection;
  onSelect: (s: KingdomSchoolSection) => void;
  modulesCompleted: number;
  totalModules: number;
  foundationPct: number;
  plansCount: number;
  enrolledCount: number;
}) {
  const router = useRouter();
  return (
    <View style={cardSelectorStyles.row}>
      <TouchableOpacity
        style={[cardSelectorStyles.card, cardSelectorStyles.foundationCard, selected === "foundation" && cardSelectorStyles.cardSelected]}
        activeOpacity={0.9}
        onPress={() => onSelect(selected === "foundation" ? null : "foundation")}
      >
        <Ionicons name="book" size={22} color="#fff" />
        <Text style={cardSelectorStyles.cardTitle}>Foundation</Text>
        <Text style={cardSelectorStyles.cardSubtitle}>Core Curriculum</Text>
        <Text style={cardSelectorStyles.cardInfo}>{modulesCompleted} of {totalModules} modules</Text>
        <View style={cardSelectorStyles.progressBg}>
          <View style={[cardSelectorStyles.progressFill, { width: `${foundationPct}%` as any }]} />
        </View>
      </TouchableOpacity>

      {/* Navigates straight to Find Plans (Categories sub-tab, its default)
          instead of expanding inline, since Electives is now a full
          10-category/144-plan browsing experience of its own. */}
      <TouchableOpacity
        style={[cardSelectorStyles.card, cardSelectorStyles.electivesCard]}
        activeOpacity={0.9}
        onPress={() => router.push("/plans?tab=find" as any)}
      >
        <Ionicons name="star" size={22} color="#fff" />
        <Text style={cardSelectorStyles.cardTitle}>Electives</Text>
        <Text style={cardSelectorStyles.cardSubtitle}>Plans & Courses</Text>
        <Text style={cardSelectorStyles.cardInfo}>{PLAN_CATEGORIES.length} categories</Text>
        <Text style={cardSelectorStyles.cardInfo}>{plansCount} plan{plansCount === 1 ? "" : "s"}</Text>
        {enrolledCount > 0 && (
          <Text style={cardSelectorStyles.cardInfo}>{enrolledCount} in progress</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const cardSelectorStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  card: { flex: 1, borderRadius: 18, padding: 16, minHeight: 148, justifyContent: "space-between" },
  cardSelected: { borderWidth: 2, borderColor: "rgba(255,255,255,0.6)" },
  foundationCard: { backgroundColor: "#1D4E2B" },
  electivesCard: { backgroundColor: "#B8860B" },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 10 },
  cardSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_500Medium", marginTop: 2 },
  cardInfo: { fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_600SemiBold", marginTop: 8 },
  progressBg: { height: 4, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: "#fff", borderRadius: 2 },
});

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
  const { modules, isLoading, plans } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const [completionCard, setCompletionCard] = useState<{ date: string } | null>(null);
  const [selectedSection, setSelectedSection] = useState<KingdomSchoolSection>("foundation");
  const [enrolledCount, setEnrolledCount] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("p2p_plan_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .then(({ count }) => setEnrolledCount(count ?? 0));
  }, [profile?.id]);

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
          <KingdomSchoolCards
            selected={selectedSection}
            onSelect={setSelectedSection}
            modulesCompleted={modulesCompleted}
            totalModules={totalModules}
            foundationPct={foundationPct}
            plansCount={plans.length}
            enrolledCount={enrolledCount}
          />

          {/* ── Section 1: Foundation ── */}
          {selectedSection === "foundation" && (
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
          )}

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
