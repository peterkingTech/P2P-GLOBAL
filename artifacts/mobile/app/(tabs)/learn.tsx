import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
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
import { useData, Module, Plan, PlanV2 } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

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

function ModuleCard({ module, onPress }: { module: Module; onPress: () => void }) {
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
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderBeige }, isLocked && styles.cardLocked]}
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
        <Text style={[styles.moduleTitle, { color: colors.textDark }, isLocked && { color: colors.textMuted }]}>{module.title}</Text>
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

function PlanThumbnail({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const { colors } = useTheme();
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
        <Image
          source={{ uri }}
          style={{ width: 64, height: 64, opacity: isLocked ? 0.4 : 1 }}
          resizeMode="cover"
          onError={() => setErr(true)}
        />
        {isLocked && (
          <View style={{
            position: "absolute", inset: 0, alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.25)",
          }}>
            <Ionicons name="lock-closed" size={18} color="#fff" />
          </View>
        )}
      </View>
    );
  }
  return (
    <View style={{
      width: 64, height: 64, borderRadius: 12, flexShrink: 0,
      backgroundColor: isLocked ? colors.borderBeige : "rgba(29,158,117,0.08)",
      alignItems: "center", justifyContent: "center",
    }}>
      <Ionicons
        name={isLocked ? "lock-closed" : "book-outline"}
        size={22}
        color={isLocked ? colors.textMuted : colors.accentGreen}
      />
    </View>
  );
}

function PlanCard({ plan, onPress }: { plan: Plan; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const pct = plan.lessonCount > 0 ? (plan.completedLessons / plan.lessonCount) * 100 : 0;
  const isComplete = pct === 100;
  const isLocked = plan.isLocked;
  return (
    <TouchableOpacity
      style={[styles.planCard, isLocked && styles.planCardLocked]}
      onPress={onPress}
      activeOpacity={isLocked ? 1 : 0.85}
      disabled={isLocked}
    >
      <PlanThumbnail uri={plan.imageUrl} isLocked={isLocked} />
      <View style={styles.planCardBody}>
        <Text style={[styles.planTitle, isLocked && { color: colors.textMuted }]}>{plan.title}</Text>
        {isLocked ? (
          <Text style={[styles.planDesc, { fontStyle: "italic" }]}>{t("learn.unlockPlan")}</Text>
        ) : (
          <>
            <Text style={styles.planDesc} numberOfLines={2}>{plan.description}</Text>
            {plan.lessonCount > 0 && (
              <View style={[styles.progressRow, { marginTop: 6 }]}>
                <View style={[styles.progressBg, { backgroundColor: colors.progressTrack }]}>
                  <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: isComplete ? colors.accentGreen : colors.amber }]} />
                </View>
                <Text style={[styles.progressText, { color: colors.textMuted }]}>
                  {plan.completedLessons}/{plan.lessonCount}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
      {!isLocked && (
        isComplete ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )
      )}
    </TouchableOpacity>
  );
}

function PlanCardV2({ plan, onPress }: { plan: PlanV2; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const pct = plan.lessonCount > 0 ? (plan.completedLessons / plan.lessonCount) * 100 : 0;
  const isComplete = pct === 100;
  const teacher = plan.teachers[0];
  return (
    <TouchableOpacity style={styles.planCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.planIconWrap}>
        <Ionicons name="albums-outline" size={22} color={colors.accentGreen} />
      </View>
      <View style={styles.planCardBody}>
        <Text style={styles.planTitle}>{plan.title}</Text>
        {plan.tagline ? (
          <Text style={styles.planDesc} numberOfLines={2}>{plan.tagline}</Text>
        ) : null}
        {teacher ? (
          <Text style={[styles.planDesc, { color: colors.accentGreen, fontSize: 11 }]} numberOfLines={1}>
            {teacher.name}{teacher.ministryOrChurch ? ` · ${teacher.ministryOrChurch}` : ""}
          </Text>
        ) : null}
        {plan.lessonCount > 0 && (
          <View style={[styles.progressRow, { marginTop: 6 }]}>
            <View style={[styles.progressBg, { backgroundColor: colors.progressTrack }]}>
              <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: isComplete ? colors.accentGreen : colors.amber }]} />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              {plan.completedLessons}/{plan.lessonCount}
            </Text>
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
    header: {
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: c.lightCream,
      borderBottomWidth: 1,
      borderBottomColor: c.borderBeige,
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionSubtitleBlock: { marginTop: 4, marginBottom: 16 },
    sectionSubtitleText: { fontSize: 13, color: c.textMuted, lineHeight: 20, fontFamily: "Inter_400Regular" },
    sectionSubtitleQuote: {
      fontSize: 13, color: c.textMid, lineHeight: 20, fontFamily: "Inter_400Regular",
      fontStyle: "italic", marginTop: 10,
    },
    segmentRow: {
      flexDirection: "row", backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.borderBeige, padding: 4, marginBottom: 16,
    },
    segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
    segmentBtnActive: { backgroundColor: c.primaryGreen },
    segmentText: { fontSize: 13, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    segmentTextActive: { color: "#fff" },
    plansList: { paddingHorizontal: 20, paddingTop: 16 },
    planCard: {
      backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 12,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    planCardLocked: { opacity: 0.55 },
    planIconWrap: {
      width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)",
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    planCardBody: { flex: 1 },
    planTitle: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 3 },
    planDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    comingSoonPill: {
      backgroundColor: "rgba(201,180,138,0.2)", borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0,
    },
    comingSoonText: { fontSize: 10, fontWeight: "700", color: c.amber, fontFamily: "Inter_700Bold" },
    overallProgress: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    overallLeft: {},
    overallLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overallPct: { fontSize: 16, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    overallApproved: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 2 },
    overallCircle: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: "rgba(29,158,117,0.12)",
      borderWidth: 2, borderColor: c.accentGreen,
      alignItems: "center", justifyContent: "center",
    },
    overallCircleText: { fontSize: 16, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    overallCircleSub: { fontSize: 9, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overallBarBg: { height: 6, backgroundColor: c.progressTrack, borderRadius: 3, position: "relative", overflow: "hidden" },
    overallBarSubmitted: { position: "absolute", left: 0, top: 0, height: 6, backgroundColor: c.amber, borderRadius: 3, opacity: 0.55 },
    overallBarFill: { position: "absolute", left: 0, top: 0, height: 6, backgroundColor: c.progressFill, borderRadius: 3 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: 20, paddingTop: 16 },
    milestoneRow: { alignItems: "flex-start", paddingLeft: 26 },
    milestoneDot: {
      width: 20, height: 20, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
    },
    milestoneLine: {
      width: 2, height: 16,
      backgroundColor: c.borderBeige,
      marginLeft: 35,
    },
    card: {
      borderRadius: 16, borderWidth: 1,
      padding: 14, flexDirection: "row", gap: 12, alignItems: "center",
      marginBottom: 2,
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
    moduleTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 2 },
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
  const { modules, isLoading, plans, plansLoading, plansV2, plansV2Loading } = useData();
  const { colors } = useTheme();
  const [section, setSection] = useState<"curriculum" | "plans">("curriculum");

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);
  const completedLessons = modules.reduce((a, m) => a + m.completedLessons, 0);
  const submittedLessons = modules.reduce((a, m) => a + (m.submittedLessons ?? m.completedLessons), 0);
  const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const submittedPct = totalLessons > 0 ? Math.round((submittedLessons / totalLessons) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>{t("learn.title")}</Text>
        {section === "curriculum" ? (
          <View style={styles.sectionSubtitleBlock}>
            <Text style={styles.sectionSubtitleText}>{t("learn.coreCurriculumSubtitle")}</Text>
            <Text style={styles.sectionSubtitleQuote}>{t("learn.coreCurriculumSubtitleQuote")}</Text>
          </View>
        ) : (
          <View style={styles.sectionSubtitleBlock}>
            <Text style={styles.sectionSubtitleText}>{t("learn.plansSubtitle")}</Text>
            <Text style={styles.sectionSubtitleQuote}>{t("learn.plansSubtitleQuote")}</Text>
          </View>
        )}

        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segmentBtn, section === "curriculum" && styles.segmentBtnActive]}
            onPress={() => setSection("curriculum")}
          >
            <Text style={[styles.segmentText, section === "curriculum" && styles.segmentTextActive]}>{t("learn.coreCurriculum")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, section === "plans" && styles.segmentBtnActive]}
            onPress={() => setSection("plans")}
          >
            <Text style={[styles.segmentText, section === "plans" && styles.segmentTextActive]}>{t("learn.plans")}</Text>
          </TouchableOpacity>
        </View>

        {section === "curriculum" && (
          <>
            <View style={styles.overallProgress}>
              <View style={styles.overallLeft}>
                <Text style={styles.overallLabel}>{t("learn.overallProgress")}</Text>
                <Text style={styles.overallPct}>
                  {t("learn.lessonsSubmitted", { submitted: submittedLessons, total: totalLessons })}
                </Text>
                <Text style={styles.overallApproved}>
                  {t("learn.lessonsApproved", { approved: completedLessons, total: totalLessons })}
                </Text>
              </View>
              <View style={styles.overallCircle}>
                <Text style={styles.overallCircleText}>{submittedLessons}</Text>
                <Text style={styles.overallCircleSub}>{t("learn.submitted")}</Text>
              </View>
            </View>
            {/* Two-layer bar: amber = submitted, green overlay = approved.
                Growth credit still only counts approved. */}
            <View style={styles.overallBarBg}>
              <View style={[styles.overallBarSubmitted, { width: `${submittedPct}%` as any }]} />
              <View style={[styles.overallBarFill, { width: `${overallPct}%` as any }]} />
            </View>
          </>
        )}
      </View>

      {section === "curriculum" ? (
        isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.accentGreen} />
          </View>
        ) : (
          <FlatList
            key="curriculum-list"
            data={modules}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <View>
                {index === 0 && <View style={styles.milestoneLine} />}
                <View style={styles.milestoneRow}>
                  <View style={[styles.milestoneDot, {
                    backgroundColor: item.completedLessons === item.lessonCount
                      ? colors.accentGreen
                      : item.completedLessons > 0 ? colors.amber : colors.borderBeige
                  }]}>
                    {item.completedLessons === item.lessonCount && (
                      <Ionicons name="checkmark" size={10} color={colors.cream} />
                    )}
                  </View>
                </View>
                <ModuleCard
                  module={item}
                  onPress={() => router.push(`/module/${item.id}`)}
                />
                <View style={styles.milestoneLine} />
              </View>
            )}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        (plansLoading && plansV2Loading) ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.accentGreen} />
          </View>
        ) : (plans.length === 0 && plansV2.length === 0) ? (
          <View style={styles.loadingContainer}>
            <Ionicons name="radio-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.moduleDesc, { textAlign: "center", marginTop: 12, paddingHorizontal: 40 }]}>
              {t("learn.noPlans")}
            </Text>
          </View>
        ) : (
          <ScrollView
            key="plans-list"
            contentContainerStyle={[styles.plansList, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
          >
            {plans.map(item => (
              <PlanCard
                key={item.id}
                plan={item}
                onPress={() => {
                  if (item.isSingleModule && item.singleModuleId) {
                    router.push(`/module/${item.singleModuleId}`);
                  } else {
                    router.push(`/module/${item.id}`);
                  }
                }}
              />
            ))}
            {plansV2.map(item => (
              <PlanCardV2
                key={item.id}
                plan={item}
                onPress={() => router.push(`/plan/${item.id}` as any)}
              />
            ))}
          </ScrollView>
        )
      )}
      </View>
    </View>
  );
}
