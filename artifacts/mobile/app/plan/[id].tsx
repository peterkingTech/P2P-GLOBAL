import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// ── Types ──────────────────────────────────────────────────────────────────────

type Teacher = {
  id: string; name: string; ministry_or_church: string | null; location: string | null;
  youtube_handle: string | null; instagram_handle: string | null; other_social_handle: string | null;
};
type Module = { id: string; module_number: number; module_title: string; order_index: number };
type Lesson = {
  id: string; plan_id: string; module_id: string | null; lesson_code: string | null;
  title: string; order_index: number; completed: boolean;
  evaluationStatus?: "pending" | "needs_revision";
};
type OutlineSession = { id: string; session_label: string; summary: string | null; order_index: number };
type DQ = { id: string; question_number: number | null; topic: string | null; question_text: string; order_index: number };
type Plan = {
  id: string; title: string; tagline: string | null; overview: string | null; has_submodules: boolean; status: string;
};

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [sessions, setSessions] = useState<OutlineSession[]>([]);
  const [dqs, setDqs] = useState<DQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [dqsOpen, setDqsOpen] = useState(false);

  const loadPlan = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [
      { data: planData },
      { data: teachersData },
      { data: modulesData },
      { data: lessonsData },
      { data: outlineData },
      { data: dqData },
    ] = await Promise.all([
      supabase.from("p2p_plans").select("id,title,tagline,overview,has_submodules,status").eq("id", id).single(),
      supabase.from("p2p_plan_source_teachers").select("*").eq("plan_id", id),
      supabase.from("p2p_plan_modules").select("id,module_number,module_title,order_index").eq("plan_id", id).order("order_index"),
      supabase.from("p2p_plan_lessons").select("id,plan_id,module_id,lesson_code,title,order_index").eq("plan_id", id).order("order_index"),
      supabase.from("p2p_plan_teaching_outlines").select("id").eq("plan_id", id).maybeSingle(),
      supabase.from("p2p_plan_discussion_questions").select("id,question_number,topic,question_text,order_index").eq("plan_id", id).order("order_index"),
    ]);

    // Overlay translated plan/module/lesson titles when a non-English content
    // language is selected — same two-pass pattern as loadCurriculum()/loadPlansV2().
    // End-user path: only serve approved translations (review gate).
    let overlaidPlan = planData as Plan | null;
    const modulesRaw = (modulesData ?? []) as Module[];
    const lessonsRaw = (lessonsData ?? []) as Omit<Lesson, "completed" | "evaluationStatus">[];
    const languageCode = profile?.contentLanguage;
    if (languageCode && languageCode !== "en") {
      const moduleIds = modulesRaw.map((m) => m.id);
      const lessonIds = lessonsRaw.map((l) => l.id);
      const allIds = [id, ...moduleIds, ...lessonIds].filter(Boolean) as string[];
      const { data: planTrans } = await supabase
        .from("p2p_content_translations")
        .select("content_type,content_id,title,subtitle,description")
        .in("content_type", ["plan", "plan_module", "plan_lesson"])
        .in("content_id", allIds)
        .eq("language_code", languageCode)
        .eq("status", "approved");

      const planOverride = (planTrans ?? []).find((r: any) => r.content_type === "plan" && r.content_id === id) as any;
      if (planOverride && overlaidPlan) {
        overlaidPlan = {
          ...overlaidPlan,
          title: planOverride.title ?? overlaidPlan.title,
          tagline: planOverride.subtitle ?? overlaidPlan.tagline,
          overview: planOverride.description ?? overlaidPlan.overview,
        };
      }

      const moduleTitleOverrides = new Map<string, string>();
      const lessonTitleOverrides = new Map<string, string>();
      for (const row of (planTrans ?? []) as Record<string, unknown>[]) {
        if (!row.title) continue;
        if (row.content_type === "plan_module") moduleTitleOverrides.set(row.content_id as string, row.title as string);
        if (row.content_type === "plan_lesson") lessonTitleOverrides.set(row.content_id as string, row.title as string);
      }
      for (const m of modulesRaw) m.module_title = moduleTitleOverrides.get(m.id) ?? m.module_title;
      for (const l of lessonsRaw) l.title = lessonTitleOverrides.get(l.id) ?? l.title;
    }

    setPlan(overlaidPlan);
    setTeachers((teachersData ?? []) as Teacher[]);
    setModules(modulesRaw);
    setDqs((dqData ?? []) as DQ[]);

    if (profile?.id && lessonsRaw.length > 0) {
      const lessonIds = lessonsRaw.map(l => l.id);
      const [{ data: progressData }, { data: evalData }] = await Promise.all([
        supabase.from("p2p_plan_lesson_progress").select("lesson_id,completed").eq("user_id", profile.id).in("lesson_id", lessonIds),
        supabase.from("p2p_plan_lesson_evaluations").select("lesson_id,status").eq("submitter_id", profile.id).in("status", ["pending", "needs_revision"]).in("lesson_id", lessonIds),
      ]);
      const completedSet = new Set((progressData ?? []).filter((p: any) => p.completed).map((p: any) => p.lesson_id));
      const evalMap = new Map<string, "pending" | "needs_revision">();
      for (const e of (evalData ?? []) as any[]) {
        const st = e.status as "pending" | "needs_revision";
        if (st === "needs_revision" || !evalMap.has(e.lesson_id)) evalMap.set(e.lesson_id, st);
      }
      setLessons(lessonsRaw.map(l => ({
        ...l,
        completed: completedSet.has(l.id),
        evaluationStatus: completedSet.has(l.id) ? undefined : evalMap.get(l.id),
      })));
    } else {
      setLessons(lessonsRaw.map(l => ({ ...l, completed: false })));
    }

    if (outlineData) {
      const { data: sessionsData } = await supabase
        .from("p2p_plan_teaching_sessions")
        .select("id,session_label,summary,order_index")
        .eq("outline_id", (outlineData as any).id)
        .order("order_index");
      setSessions((sessionsData ?? []) as OutlineSession[]);
    }
    setLoading(false);
  }, [id, profile?.id]);

  // Refetch on every focus, not just mount — returning from a lesson screen
  // after submitting must show the new pending/unlock state immediately.
  useFocusEffect(useCallback(() => { loadPlan(); }, [loadPlan]));

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accentGreen} />
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

  const totalLessons = lessons.length;
  const completedCount = lessons.filter(l => l.completed).length;
  const pct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const renderLessons = (lessonList: Lesson[], moduleLocked: boolean) => {
    let prevPassedForUnlock = true;
    let allPrevCompleted = true;
    return lessonList.map((lesson, i) => {
      // Same convention as core curriculum: only a lesson seeded with
      // order_index >= 999 is a Discussion & Review lesson requiring full
      // approval of everything before it. Position in the list is not a
      // review marker — a normal last lesson unlocks on prior submission.
      const isReviewLesson = (lesson.order_index ?? 0) >= 999;
      const passedForUnlock = lesson.completed || lesson.evaluationStatus === "pending";
      const isLocked = moduleLocked || (i === 0 ? false : isReviewLesson ? !allPrevCompleted : !prevPassedForUnlock);
      const isPendingEval = !lesson.completed && lesson.evaluationStatus === "pending";
      const isNeedsRevision = !lesson.completed && lesson.evaluationStatus === "needs_revision";
      const dotColor = lesson.completed
        ? colors.accentGreen
        : isLocked ? colors.borderBeige
        : isNeedsRevision ? "#C0392B"
        : colors.amber;
      prevPassedForUnlock = passedForUnlock;
      allPrevCompleted = allPrevCompleted && lesson.completed;
      return (
        <TouchableOpacity
          key={lesson.id}
          style={[styles.lessonRow, lesson.completed && styles.lessonRowDone, isLocked && styles.lessonRowLocked]}
          onPress={() => !isLocked && router.push(`/plan/lesson/${lesson.id}` as any)}
          activeOpacity={isLocked ? 1 : 0.82}
          disabled={isLocked}
        >
          <View style={[styles.lessonStatusDot, { backgroundColor: dotColor }]}>
            {lesson.completed
              ? <Ionicons name="checkmark" size={10} color="#fff" />
              : isLocked ? <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
              : isPendingEval ? <Ionicons name="time" size={10} color="#fff" />
              : isNeedsRevision ? <Ionicons name="alert" size={10} color="#fff" />
              : null}
          </View>
          <View style={{ flex: 1 }}>
            {lesson.lesson_code ? <Text style={styles.lessonCode}>{lesson.lesson_code}</Text> : null}
            <Text style={[styles.lessonTitle, isLocked && { color: colors.textMuted }]}>{lesson.title}</Text>
            {isPendingEval && (
              <Text style={{ fontSize: 11, color: colors.amber, fontFamily: "Inter_400Regular", marginTop: 2 }}>
                Waiting for peer review and evaluation
              </Text>
            )}
            {isNeedsRevision && (
              <Text style={{ fontSize: 11, color: "#C0392B", fontFamily: "Inter_400Regular", marginTop: 2 }}>
                Needs revision
              </Text>
            )}
          </View>
          {!isLocked && !lesson.completed && !isPendingEval && !isNeedsRevision && (
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          )}
          {isPendingEval && <Ionicons name="time-outline" size={18} color={colors.amber} />}
          {isNeedsRevision && <Ionicons name="alert-circle" size={18} color="#C0392B" />}
        </TouchableOpacity>
      );
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle} numberOfLines={1}>{plan.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Title + tagline */}
        <Text style={styles.planTitle}>{plan.title}</Text>
        {plan.tagline ? <Text style={styles.planTagline}>{plan.tagline}</Text> : null}

        {/* Progress bar */}
        {totalLessons > 0 && (
          <View style={styles.progressBlock}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${pct}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{completedCount}/{totalLessons} lessons · {pct}%</Text>
          </View>
        )}

        {/* Teacher credit block — prominent */}
        {teachers.length > 0 && (
          <View style={styles.teacherBlock}>
            <Text style={styles.teacherBlockHeading}>
              <Ionicons name="person-circle-outline" size={14} color={colors.accentGreen} /> SOURCE TEACHER{teachers.length > 1 ? "S" : ""}
            </Text>
            {teachers.map(t => (
              <View key={t.id} style={styles.teacherCard}>
                <Text style={styles.teacherName}>{t.name}</Text>
                {t.ministry_or_church ? <Text style={styles.teacherDetail}>{t.ministry_or_church}</Text> : null}
                {t.location ? <Text style={styles.teacherDetail}>{t.location}</Text> : null}
                <View style={styles.teacherSocials}>
                  {t.youtube_handle ? (
                    <TouchableOpacity style={styles.socialBtn} onPress={() => Linking.openURL(`https://youtube.com/${t.youtube_handle}`)}>
                      <Ionicons name="logo-youtube" size={14} color="#FF0000" />
                      <Text style={styles.socialHandle}>{t.youtube_handle}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {t.instagram_handle ? (
                    <TouchableOpacity style={styles.socialBtn} onPress={() => Linking.openURL(`https://instagram.com/${t.instagram_handle?.replace("@", "")}`)}>
                      <Ionicons name="logo-instagram" size={14} color="#C13584" />
                      <Text style={styles.socialHandle}>@{t.instagram_handle?.replace("@", "")}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {t.other_social_handle ? (
                    <Text style={[styles.socialHandle, { color: colors.textMuted }]}>{t.other_social_handle}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Overview */}
        {plan.overview ? (
          <View style={styles.overviewBlock}>
            <Text style={styles.sectionHeading}>Overview</Text>
            <Text style={styles.overviewText}>{plan.overview}</Text>
          </View>
        ) : null}

        {/* Lessons */}
        <View style={styles.lessonsBlock}>
          <Text style={styles.sectionHeading}>Lessons</Text>
          {plan.has_submodules && modules.length > 0 ? (
            (() => {
              // A module unlocks only once the ENTIRE previous module is
              // complete — same rule as core curriculum's loadCurriculum().
              // previousModuleComplete carries across the .map() so a
              // module's first lesson doesn't default-unlock in isolation.
              let previousModuleComplete = true;
              return modules.map(m => {
                const modLessons = lessons.filter(l => l.module_id === m.id);
                const moduleLocked = !previousModuleComplete;
                const moduleComplete = modLessons.length > 0 && modLessons.every(l => l.completed);
                previousModuleComplete = moduleComplete;
                return (
                  <View key={m.id} style={styles.moduleBlock}>
                    <View style={styles.moduleNameRow}>
                      <Text style={styles.moduleName}>Module {m.module_number}: {m.module_title}</Text>
                      {moduleLocked && <Ionicons name="lock-closed" size={14} color={colors.textMuted} />}
                    </View>
                    {renderLessons(modLessons, moduleLocked)}
                  </View>
                );
              });
            })()
          ) : (
            renderLessons(lessons.filter(l => !l.module_id || !plan.has_submodules), false)
          )}
        </View>

        {/* Teaching outline — collapsible */}
        {sessions.length > 0 && (
          <View style={styles.collapseBlock}>
            <TouchableOpacity style={styles.collapseHeader} onPress={() => setOutlineOpen(o => !o)}>
              <Text style={styles.sectionHeading}>Teaching Outline</Text>
              <Ionicons name={outlineOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
            </TouchableOpacity>
            {outlineOpen && (
              <View style={styles.collapseBody}>
                {sessions.map(se => (
                  <View key={se.id} style={styles.sessionRow}>
                    <Text style={styles.sessionLabel}>{se.session_label}</Text>
                    {se.summary ? <Text style={styles.sessionSummary}>{se.summary}</Text> : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Discussion questions — collapsible */}
        {dqs.length > 0 && (
          <View style={styles.collapseBlock}>
            <TouchableOpacity style={styles.collapseHeader} onPress={() => setDqsOpen(o => !o)}>
              <Text style={styles.sectionHeading}>Discussion Questions</Text>
              <Ionicons name={dqsOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
            </TouchableOpacity>
            {dqsOpen && (
              <View style={styles.collapseBody}>
                {dqs.map((dq, i) => (
                  <View key={dq.id} style={styles.dqRow}>
                    <Text style={styles.dqNum}>{dq.question_number ?? i + 1}{dq.topic ? ` — ${dq.topic}` : ""}</Text>
                    <Text style={styles.dqText}>{dq.question_text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.lightCream, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    scroll: { paddingHorizontal: 20, paddingTop: 20 },
    planTitle: { fontSize: 24, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 30 },
    planTagline: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 20 },
    errorText: { fontSize: 15, color: c.textMuted, fontFamily: "Inter_400Regular" },

    progressBlock: { marginTop: 16 },
    progressBarBg: { height: 6, backgroundColor: c.progressTrack, borderRadius: 3, overflow: "hidden" },
    progressBarFill: { height: 6, backgroundColor: c.accentGreen, borderRadius: 3 },
    progressLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6 },

    teacherBlock: { marginTop: 20, backgroundColor: "rgba(29,158,117,0.06)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.2)", padding: 16 },
    teacherBlockHeading: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 12, textTransform: "uppercase" },
    teacherCard: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(29,158,117,0.12)" },
    teacherName: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    teacherDetail: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    teacherSocials: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
    socialBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: c.borderBeige },
    socialHandle: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },

    overviewBlock: { marginTop: 20 },
    sectionHeading: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.6 },
    overviewText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 22 },

    lessonsBlock: { marginTop: 24 },
    moduleBlock: { marginBottom: 20 },
    moduleNameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
    moduleName: { fontSize: 13, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },

    lessonRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 8 },
    lessonRowDone: { borderColor: "rgba(29,158,117,0.25)", backgroundColor: "rgba(29,158,117,0.04)" },
    lessonRowLocked: { opacity: 0.5 },
    lessonStatusDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    lessonCode: { fontSize: 10, fontWeight: "700", color: c.amber, fontFamily: "Inter_700Bold", marginBottom: 1 },
    lessonTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },

    collapseBlock: { marginTop: 20, borderTopWidth: 1, borderTopColor: c.borderBeige, paddingTop: 16 },
    collapseHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    collapseBody: { marginTop: 12 },
    sessionRow: { marginBottom: 12 },
    sessionLabel: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sessionSummary: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 2 },
    dqRow: { marginBottom: 14 },
    dqNum: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", marginBottom: 3, textTransform: "uppercase" },
    dqText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
  });
}
