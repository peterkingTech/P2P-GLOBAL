import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { sharePlan } from "@/lib/sharing";

const COVER_HEIGHT = 200;

// ── Types (unified schema — a plan is a p2p_curriculums row with type='plan',
// modules/lessons are the same p2p_modules/p2p_lessons tables core curriculum
// uses) ─────────────────────────────────────────────────────────────────────
type PlanLessonDetail = { id: string; moduleId: string | null; title: string; subtitle: string | null; sortOrder: number; status: string };
type PlanModuleDetail = { id: string; title: string; description: string | null; coverImageUrl: string | null; colorTheme: string | null; sortOrder: number; status: string; lessons: PlanLessonDetail[] };
type PlanCategoryRef = { id: string; title: string; colorTheme: string };
type PlanDetail = {
  id: string; title: string; description: string | null; subtitle: string | null;
  coverImageUrl: string | null; colorTheme: string; difficultyLevel: string; estimatedWeeks: number | null;
  teachingCreditName: string | null; teachingCreditRole: string | null; teachingCreditChurch: string | null;
  teachingCreditLocation: string | null; teachingCreditYoutube: string | null; teachingCreditInstagram: string | null;
  topicNumber: number | null; category: PlanCategoryRef | null;
  modules: PlanModuleDetail[];
};
type LockedPlanInfo = { locked: true; title: string; unlockMessage: string; previousPlanId: string | null; previousPlanTitle: string | null };

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { getPlanProgress, checkCategoryCompletion } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [lockedInfo, setLockedInfo] = useState<LockedPlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgErr, setImgErr] = useState(false);

  const loadPlan = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLockedInfo(null);
    try {
      const apiUrl = getApiUrl();
      const params = profile?.id ? `?userId=${profile.id}` : "";
      const res = await fetch(`${apiUrl}/plans/${id}${params}`);
      if (res.status === 403) {
        const body = (await res.json()) as LockedPlanInfo;
        setLockedInfo(body);
        setPlan(null);
        return;
      }
      if (!res.ok) { setPlan(null); return; }
      const data = (await res.json()) as PlanDetail;
      setPlan(data);
      if (data.category) void checkCategoryCompletion(data.category.id);

      // On-demand translation, English already showing — this silently
      // upgrades title/description/subtitle and module titles in place once
      // resolved. Teaching credit fields are never translated (name/role/
      // church/location are proper nouns / fixed English labels).
      const language = profile?.contentLanguage;
      if (language && language !== "en") {
        fetch(`${apiUrl}/translations/curriculum/${data.id}?language=${language}`)
          .then((r) => r.json())
          .then((t) => {
            if (!t?.translation_available) return;
            setPlan((prev) => prev ? {
              ...prev,
              title: t.title ?? prev.title,
              description: t.description ?? prev.description,
              subtitle: t.subtitle ?? prev.subtitle,
            } : prev);
          })
          .catch(() => { /* keep English */ });

        Promise.all(
          data.modules.map((m) =>
            fetch(`${apiUrl}/translations/module/${m.id}?language=${language}`)
              .then((r) => r.json())
              .then((t) => ({ moduleId: m.id, t }))
              .catch(() => null)
          )
        ).then((results) => {
          const titleByModuleId = new Map<string, string>();
          for (const r of results) {
            if (r?.t?.translation_available && r.t.title) titleByModuleId.set(r.moduleId, r.t.title);
          }
          if (titleByModuleId.size === 0) return;
          setPlan((prev) => prev ? {
            ...prev,
            modules: prev.modules.map((m) => ({ ...m, title: titleByModuleId.get(m.id) ?? m.title })),
          } : prev);
        });
      }
    } finally {
      setLoading(false);
    }
  }, [id, profile?.id, profile?.contentLanguage, checkCategoryCompletion]);

  // Refetch on every focus — returning from a lesson after submitting should
  // reflect the new progress percentage immediately, and re-checks lock
  // status in case completing that lesson just unlocked this very plan.
  useFocusEffect(useCallback(() => { loadPlan(); }, [loadPlan]));

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (lockedInfo) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={colors.textDark} />
          </TouchableOpacity>
          <Text style={styles.headerBarTitle} numberOfLines={1}>{lockedInfo.title}</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.lockedScreen}>
          <View style={styles.lockedIconWrap}>
            <Ionicons name="lock-closed" size={36} color={colors.textMuted} />
          </View>
          <Text style={styles.lockedHeading}>This plan is locked</Text>
          <Text style={styles.lockedMessage}>
            {lockedInfo.previousPlanTitle
              ? `Complete "${lockedInfo.previousPlanTitle}" to unlock "${lockedInfo.title}"`
              : lockedInfo.unlockMessage}
          </Text>
          {lockedInfo.previousPlanId && (
            <TouchableOpacity
              style={styles.lockedBtn}
              onPress={() => router.replace(`/plan/${lockedInfo.previousPlanId}` as any)}
            >
              <Text style={styles.lockedBtnText}>Go to Previous Plan</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.errorText}>Plan not found.</Text>
      </View>
    );
  }

  const progress = getPlanProgress(plan.id);
  const totalLessons = plan.modules.reduce((a, m) => a + m.lessons.length, 0);
  const hasStarted = totalLessons > 0 && progress > 0;
  const hasTeachingCredit = !!plan.teachingCreditName;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle} numberOfLines={1}>{plan.title}</Text>
        <TouchableOpacity
          onPress={() => sharePlan({ id: plan.id, title: plan.title, categoryTitle: plan.category?.title ?? null }, profile?.username)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="share-outline" size={20} color={colors.textDark} />
        </TouchableOpacity>
      </View>

      {plan.category && (
        <View style={styles.breadcrumbRow}>
          <TouchableOpacity onPress={() => router.push(`/plans/category/${plan.category!.id}` as any)}>
            <Text style={styles.breadcrumbLink}>{plan.category.title}</Text>
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
          <Text style={styles.breadcrumbCurrent} numberOfLines={1}>{plan.title}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {plan.coverImageUrl && !imgErr ? (
          <Image
            source={{ uri: plan.coverImageUrl }}
            style={styles.cover}
            resizeMode="cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: `${plan.colorTheme}1A` }]}>
            <Ionicons name="book-outline" size={44} color={plan.colorTheme} />
          </View>
        )}

        <View style={styles.scroll}>
          <Text style={styles.planTitle}>{plan.title}</Text>
          {plan.subtitle ? <Text style={styles.planTagline}>{plan.subtitle}</Text> : null}

          <View style={styles.metaRow}>
            <View style={[styles.difficultyBadge, { borderColor: plan.colorTheme }]}>
              <Text style={[styles.difficultyBadgeText, { color: plan.colorTheme }]}>{plan.difficultyLevel}</Text>
            </View>
            {plan.estimatedWeeks ? (
              <Text style={styles.metaText}>{plan.estimatedWeeks} week{plan.estimatedWeeks === 1 ? "" : "s"}</Text>
            ) : null}
          </View>

          {hasStarted && (
            <View style={styles.progressBlock}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress}%` as any, backgroundColor: plan.colorTheme }]} />
              </View>
              <Text style={styles.progressLabel}>{progress}% complete</Text>
            </View>
          )}

          {plan.description ? (
            <View style={styles.overviewBlock}>
              <Text style={styles.sectionHeading}>Overview</Text>
              <Text style={styles.overviewText}>{plan.description}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.sharePlanBtn}
            onPress={() => sharePlan({ id: plan.id, title: plan.title, categoryTitle: plan.category?.title ?? null }, profile?.username)}
          >
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={styles.sharePlanBtnText}>Share this Plan</Text>
          </TouchableOpacity>

          <View style={styles.lessonsBlock}>
            <Text style={styles.sectionHeading}>Modules</Text>
            {plan.modules.map((m, idx) => (
              <View key={m.id} style={styles.moduleCard}>
                <View style={styles.moduleNameRow}>
                  <View style={[styles.moduleBadge, { backgroundColor: plan.colorTheme }]}>
                    <Text style={styles.moduleBadgeText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.moduleName} numberOfLines={2}>{m.title}</Text>
                  <Text style={styles.moduleLessonCount}>
                    {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
                  </Text>
                </View>
                {m.lessons.map((lesson) => (
                  <TouchableOpacity
                    key={lesson.id}
                    style={styles.lessonRow}
                    onPress={() => router.push(`/lesson/${lesson.id}` as any)}
                    activeOpacity={0.82}
                  >
                    <Ionicons name="play-circle-outline" size={18} color={colors.textMuted} />
                    <Text style={styles.lessonTitle} numberOfLines={1}>{lesson.title}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>

          {hasTeachingCredit && (
            <View style={styles.teacherBlock}>
              <Text style={styles.teacherBlockHeading}>
                <Ionicons name="person-circle-outline" size={14} color={colors.accentGreen} /> TEACHING CREDIT
              </Text>
              <Text style={styles.teacherName}>Teaching credit: {plan.teachingCreditName}</Text>
              {(plan.teachingCreditRole || plan.teachingCreditChurch) ? (
                <Text style={styles.teacherDetail}>
                  {[plan.teachingCreditRole, plan.teachingCreditChurch].filter(Boolean).join(", ")}
                </Text>
              ) : null}
              {plan.teachingCreditLocation ? <Text style={styles.teacherDetail}>{plan.teachingCreditLocation}</Text> : null}
              {(plan.teachingCreditYoutube || plan.teachingCreditInstagram) && (
                <View style={styles.teacherSocials}>
                  {plan.teachingCreditYoutube ? (
                    <TouchableOpacity
                      style={styles.socialBtn}
                      onPress={() => Linking.openURL(plan.teachingCreditYoutube!.startsWith("http") ? plan.teachingCreditYoutube! : `https://youtube.com/${plan.teachingCreditYoutube}`)}
                    >
                      <Ionicons name="logo-youtube" size={14} color="#FF0000" />
                      <Text style={styles.socialHandle}>{plan.teachingCreditYoutube}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {plan.teachingCreditInstagram ? (
                    <TouchableOpacity
                      style={styles.socialBtn}
                      onPress={() => Linking.openURL(plan.teachingCreditInstagram!.startsWith("http") ? plan.teachingCreditInstagram! : `https://instagram.com/${plan.teachingCreditInstagram!.replace("@", "")}`)}
                    >
                      <Ionicons name="logo-instagram" size={14} color="#C13584" />
                      <Text style={styles.socialHandle}>{plan.teachingCreditInstagram}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.lightCream, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },

    breadcrumbRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
    breadcrumbLink: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    breadcrumbCurrent: { flex: 1, fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    lockedScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
    lockedIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.cardBeige, alignItems: "center", justifyContent: "center" },
    lockedHeading: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    lockedMessage: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    lockedBtn: { backgroundColor: c.accentGreen, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
    lockedBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 20, paddingTop: 20 },
    errorText: { fontSize: 15, color: c.textMuted, fontFamily: "Inter_400Regular" },

    cover: { width: "100%", height: COVER_HEIGHT },
    coverPlaceholder: { alignItems: "center", justifyContent: "center" },

    planTitle: { fontSize: 24, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 30 },
    planTagline: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 20 },

    metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
    difficultyBadge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
    difficultyBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
    metaText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    progressBlock: { marginTop: 16 },
    progressBarBg: { height: 6, backgroundColor: c.progressTrack, borderRadius: 3, overflow: "hidden" },
    progressBarFill: { height: 6, borderRadius: 3 },
    progressLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6 },

    sharePlanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1D9E75", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, marginTop: 20, marginBottom: 4 },
    sharePlanBtnText: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: "#fff" },
    overviewBlock: { marginTop: 20 },
    sectionHeading: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.6 },
    overviewText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 22 },

    lessonsBlock: { marginTop: 24 },
    moduleCard: { marginBottom: 18 },
    moduleNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    moduleBadge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    moduleBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    moduleName: { flex: 1, fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    moduleLessonCount: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },

    lessonRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 12, marginBottom: 8 },
    lessonTitle: { flex: 1, fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },

    teacherBlock: { marginTop: 20, marginBottom: 4, backgroundColor: "rgba(29,158,117,0.06)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.2)", padding: 16 },
    teacherBlockHeading: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" },
    teacherName: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    teacherDetail: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    teacherSocials: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
    socialBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: c.borderBeige },
    socialHandle: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
  });
}
