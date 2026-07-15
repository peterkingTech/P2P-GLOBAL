import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useData, PlanReflectionSubmission } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// ── Types ──────────────────────────────────────────────────────────────────────

type LessonDetail = {
  id: string; plan_id: string; module_id: string | null; lesson_code: string | null;
  title: string; order_index: number;
  memory_verse_reference: string | null; memory_verse_text: string | null;
  definition_title: string | null; what_is_it: string | null;
  why_heading: string | null; why_text: string | null;
  to_whom: string | null; notes: string | null;
};
type Question = { id: string; question_text: string; order_index: number };
type EvalStatus = "none" | "submitted" | "pending_eval" | "approved" | "needs_revision";

export default function PlanLessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, user } = useAuth();
  const { submitPlanReflection, getPlanReflectionSubmissionsForLesson } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [reflections, setReflections] = useState<Question[]>([]);
  const [assignmentQs, setAssignmentQs] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [evalStatus, setEvalStatus] = useState<EvalStatus>("none");
  const [evalFeedback, setEvalFeedback] = useState<string | null>(null);
  const [reflectionSubs, setReflectionSubs] = useState<Map<string, PlanReflectionSubmission>>(new Map());
  const [reflectionDrafts, setReflectionDrafts] = useState<Record<string, string>>({});
  const [reflectionEditing, setReflectionEditing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingReflection, setSubmittingReflection] = useState<string | null>(null);

  const loadLesson = useCallback(async () => {
    if (!lessonId) return;
    setLoading(true);

    const [{ data: l }, { data: rqs }, { data: aqs }] = await Promise.all([
      supabase.from("p2p_plan_lessons").select("*").eq("id", lessonId).single(),
      supabase.from("p2p_plan_reflection_questions").select("id,question_text,order_index").eq("lesson_id", lessonId).order("order_index"),
      supabase.from("p2p_plan_assignment_questions").select("id,question_text,order_index").eq("lesson_id", lessonId).order("order_index"),
    ]);

    setLesson(l as LessonDetail | null);
    setReflections((rqs ?? []) as Question[]);
    setAssignmentQs((aqs ?? []) as Question[]);

    if (profile?.id) {
      const [reflectionRows, { data: progress }] = await Promise.all([
        getPlanReflectionSubmissionsForLesson(lessonId),
        supabase.from("p2p_plan_lesson_progress").select("completed").eq("user_id", profile.id).eq("lesson_id", lessonId).maybeSingle(),
      ]);
      setReflectionSubs(new Map(reflectionRows.map((r) => [r.questionId, r])));

      if (progress?.completed) {
        setEvalStatus("approved");
      } else {
        const { data: evalRow } = await supabase
          .from("p2p_plan_lesson_evaluations")
          .select("status,feedback")
          .eq("submitter_id", profile.id)
          .eq("lesson_id", lessonId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (evalRow) {
          setEvalStatus(evalRow.status === "approved" ? "approved" : evalRow.status === "needs_revision" ? "needs_revision" : "pending_eval");
          setEvalFeedback((evalRow.feedback as string) ?? null);
        } else {
          const { data: sub } = await supabase
            .from("p2p_plan_assignment_submissions")
            .select("id")
            .eq("user_id", profile.id)
            .eq("lesson_id", lessonId)
            .limit(1)
            .maybeSingle();
          setEvalStatus(sub ? "submitted" : "none");
          setEvalFeedback(null);
        }
      }
    }
    setLoading(false);
  }, [lessonId, profile?.id, getPlanReflectionSubmissionsForLesson]);

  useEffect(() => { loadLesson(); }, [loadLesson]);

  // Live-update if an evaluator resolves this lesson's evaluation while the
  // learner still has it open — same realtime pattern used for core curriculum
  // (see lesson/[id].tsx) and for chat, since there's no notification inbox UI
  // anywhere in the app yet to otherwise surface the resolution.
  useEffect(() => {
    if (!lessonId || !user) return;
    const channel = supabase
      .channel(`p2p_plan_lesson_evaluations_${lessonId}_${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_plan_lesson_evaluations", filter: `lesson_id=eq.${lessonId}` },
        (payload) => {
          const row = payload.new as { submitter_id?: string };
          if (row.submitter_id === user.id) loadLesson();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lessonId, user, loadLesson]);

  async function handleSubmitReflection(questionId: string) {
    const text = (reflectionDrafts[questionId] ?? "").trim();
    if (!text || !lessonId) return;
    setSubmittingReflection(questionId);
    const err = await submitPlanReflection({ lessonId, questionId, text });
    setSubmittingReflection(null);
    if (err) { Alert.alert("Couldn't save", err); return; }
    setReflectionSubs((prev) => {
      const next = new Map(prev);
      next.set(questionId, { id: `local-${Date.now()}`, questionId, content: text, createdAt: new Date().toISOString() });
      return next;
    });
    setReflectionEditing((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
  }

  const submitAssignment = async () => {
    if (!profile || !lesson) return;
    const allAnswers = assignmentQs.map((q, i) => `Q${i + 1}: ${q.question_text}\nA: ${answers[q.id] ?? ""}`).join("\n\n");
    if (assignmentQs.length > 0) {
      const missing = assignmentQs.some(q => !(answers[q.id] ?? "").trim());
      if (missing) { Alert.alert("Please answer all assignment questions before submitting."); return; }
    }
    setSubmitting(true);
    const { error } = await supabase.from("p2p_plan_assignment_submissions").insert({
      lesson_id: lesson.id,
      user_id: profile.id,
      content: allAnswers || "Lesson reviewed.",
    });
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setEvalStatus("pending_eval");
      setTimeout(() => loadLesson(), 500);
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }
  if (!lesson) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.muted}>Lesson not found.</Text>
      </View>
    );
  }

  const isComplete = evalStatus === "approved";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {lesson.lesson_code ? <Text style={styles.lessonCode}>{lesson.lesson_code}</Text> : null}
          <Text style={styles.headerTitle} numberOfLines={2}>{lesson.title}</Text>
        </View>
        {isComplete && (
          <View style={styles.completeBadge}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.completeBadgeText}>Done</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Memory verse */}
        {lesson.memory_verse_reference && (
          <View style={styles.verseCard}>
            <Text style={styles.verseRef}>{lesson.memory_verse_reference}</Text>
            {lesson.memory_verse_text ? <Text style={styles.verseText}>"{lesson.memory_verse_text}"</Text> : null}
          </View>
        )}

        {/* Definition section */}
        {(lesson.definition_title || lesson.what_is_it) && (
          <View style={styles.contentSection}>
            {lesson.definition_title ? <Text style={styles.contentSectionTitle}>{lesson.definition_title}</Text> : null}
            {lesson.what_is_it ? <Text style={styles.contentBody}>{lesson.what_is_it}</Text> : null}
          </View>
        )}

        {/* Why section */}
        {(lesson.why_heading || lesson.why_text) && (
          <View style={styles.contentSection}>
            {lesson.why_heading ? <Text style={styles.contentSectionTitle}>{lesson.why_heading}</Text> : null}
            {lesson.why_text ? <Text style={styles.contentBody}>{lesson.why_text}</Text> : null}
          </View>
        )}

        {/* To Whom section */}
        {lesson.to_whom && (
          <View style={styles.contentSection}>
            <Text style={styles.contentSectionTitle}>TO WHOM DOES THIS APPLY?</Text>
            <Text style={styles.contentBody}>{lesson.to_whom}</Text>
          </View>
        )}

        {/* Notes */}
        {lesson.notes && (
          <View style={[styles.contentSection, styles.notesSection]}>
            <Text style={[styles.contentSectionTitle, { color: colors.amber }]}>NOTE</Text>
            <Text style={styles.contentBody}>{lesson.notes}</Text>
          </View>
        )}

        {/* Reflection questions — private, personal-processing content. Never
            peer-evaluated: saved immediately, visible only to the submitter. */}
        {reflections.length > 0 && (
          <View style={styles.questionsBlock}>
            <Text style={styles.questionsHeading}>Reflection Questions</Text>
            <Text style={styles.assignmentNote}>
              <Ionicons name="lock-closed" size={11} color={colors.textMuted} /> Private — only you can see your answers here.
            </Text>
            {reflections.map((q, i) => {
              const saved = reflectionSubs.get(q.id);
              const isEditing = reflectionEditing.has(q.id) || !saved;
              return (
                <View key={q.id} style={styles.assignmentQ}>
                  <Text style={styles.questionNumber}>{i + 1}. {q.question_text}</Text>
                  {isEditing ? (
                    <>
                      <TextInput
                        style={styles.answerInput}
                        placeholder="Your reflection…"
                        placeholderTextColor={colors.textMuted}
                        value={reflectionDrafts[q.id] ?? saved?.content ?? ""}
                        onChangeText={(v) => setReflectionDrafts((prev) => ({ ...prev, [q.id]: v }))}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                      <TouchableOpacity
                        style={[styles.submitBtn, { marginTop: 8, paddingVertical: 10 }]}
                        onPress={() => handleSubmitReflection(q.id)}
                        disabled={submittingReflection === q.id}
                      >
                        {submittingReflection === q.id ? <ActivityIndicator color="#fff" size="small" /> : (
                          <>
                            <Ionicons name="send" size={14} color="#fff" />
                            <Text style={styles.submitBtnText}>Save</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.reflectionSavedBadge}
                      onPress={() => setReflectionEditing((prev) => new Set(prev).add(q.id))}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="checkmark" size={12} color={colors.accentGreen} />
                      <Text style={styles.reflectionSavedText}>Saved · tap to update</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Assignment section */}
        {assignmentQs.length > 0 && evalStatus === "none" && (
          <View style={styles.assignmentBlock}>
            <Text style={styles.questionsHeading}>Assignment</Text>
            <Text style={styles.assignmentNote}>Answer all questions below and submit to complete this lesson. A peer will review your work.</Text>
            {assignmentQs.map((q, i) => (
              <View key={q.id} style={styles.assignmentQ}>
                <Text style={styles.questionNumber}>{i + 1}. {q.question_text}</Text>
                <TextInput
                  style={styles.answerInput}
                  placeholder="Your answer…"
                  placeholderTextColor={colors.textMuted}
                  value={answers[q.id] ?? ""}
                  onChangeText={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            ))}
            <TouchableOpacity style={styles.submitBtn} onPress={submitAssignment} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit Assignment</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* No assignment — just a "mark reviewed" button */}
        {assignmentQs.length === 0 && evalStatus === "none" && (
          <TouchableOpacity style={styles.submitBtn} onPress={submitAssignment} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Mark Lesson as Reviewed</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Status messages */}
        {evalStatus === "pending_eval" && (
          <View style={styles.statusCard}>
            <Ionicons name="hourglass-outline" size={20} color={colors.amber} />
            <Text style={styles.statusText}>Your submission is pending peer review. You'll be notified when it's evaluated.</Text>
          </View>
        )}
        {evalStatus === "needs_revision" && (
          <View style={[styles.statusCard, { borderColor: "#E53E3E" }]}>
            <Ionicons name="refresh-circle-outline" size={20} color="#E53E3E" />
            <Text style={[styles.statusText, { color: "#E53E3E" }]}>Your evaluator requested revisions.</Text>
            {evalFeedback ? (
              <View style={styles.feedbackBox}>
                <Ionicons name="chatbox-ellipses-outline" size={14} color="#E53E3E" />
                <Text style={styles.feedbackBoxText}>{evalFeedback}</Text>
              </View>
            ) : null}
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: "#E53E3E", marginTop: 12 }]} onPress={() => setEvalStatus("none")}>
              <Text style={styles.submitBtnText}>Re-submit</Text>
            </TouchableOpacity>
          </View>
        )}
        {evalStatus === "approved" && (
          <View style={[styles.statusCard, { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.06)" }]}>
            <Ionicons name="checkmark-circle" size={24} color={colors.accentGreen} />
            <Text style={[styles.statusText, { color: colors.accentGreen, fontFamily: "Inter_700Bold" }]}>Lesson Complete!</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.lightCream, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    lessonCode: { fontSize: 10, fontWeight: "700", color: c.amber, fontFamily: "Inter_700Bold", marginBottom: 2 },
    headerTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 20, flex: 1 },
    completeBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    completeBadgeText: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },

    scroll: { paddingHorizontal: 20, paddingTop: 20 },

    verseCard: { backgroundColor: c.primaryGreen, borderRadius: 14, padding: 18, marginBottom: 20 },
    verseRef: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.8)", fontFamily: "Inter_700Bold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
    verseText: { fontSize: 15, color: "#fff", fontFamily: "Inter_400Regular", lineHeight: 24, fontStyle: "italic" },

    contentSection: { marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    contentSectionTitle: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.6 },
    contentBody: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 23 },
    notesSection: { backgroundColor: "rgba(201,180,138,0.1)", borderRadius: 10, padding: 14, borderBottomWidth: 0, borderWidth: 1, borderColor: "rgba(201,180,138,0.3)" },

    questionsBlock: { marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    questionsHeading: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.6 },
    questionRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    questionNumber: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", minWidth: 22 },
    questionText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },

    assignmentBlock: { marginBottom: 20 },
    assignmentNote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 16, fontStyle: "italic" },
    assignmentQ: { marginBottom: 14 },
    answerInput: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", minHeight: 80, marginTop: 6 },

    submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
    submitBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

    statusCard: { flexDirection: "column", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: c.amber, padding: 16, marginTop: 12 },
    statusText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
    feedbackBox: {
      flexDirection: "row", gap: 8, alignItems: "flex-start", alignSelf: "stretch",
      backgroundColor: "rgba(229,62,62,0.06)", borderRadius: 10, borderWidth: 1,
      borderColor: "rgba(229,62,62,0.25)", padding: 10, marginTop: 4,
    },
    feedbackBoxText: { flex: 1, fontSize: 12, color: c.textDark, lineHeight: 18, fontFamily: "Inter_400Regular" },
    reflectionSavedBadge: {
      flexDirection: "row", gap: 5, alignItems: "center", marginTop: 6,
      backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start",
    },
    reflectionSavedText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
  });
}
