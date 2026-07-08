import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { supabase } from "@/contexts/AuthContext";
import { useData, Assignment, SubmissionStatus } from "@/contexts/DataContext";
import colors from "@/constants/colors";

interface LessonContent {
  title: string;
  sections: { id: string; title: string; content: string }[];
  scriptures: { id: string; reference: string; verse: string }[];
  questions: { id: string; question: string }[];
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lessons, markLessonComplete, getAssignmentForLesson, getSubmissionStatus, submitAssignment } = useData();
  const [content, setContent] = useState<LessonContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submissionText, setSubmissionText] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const lessonMeta = lessons.find((l) => l.id === id);
  const completed = lessonMeta?.isCompleted ?? false;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setIsLoading(true);
      try {
        const [{ data: lesson }, { data: sections }, { data: scriptures }, { data: questions }] =
          await Promise.all([
            supabase.from("p2p_lessons").select("id,title").eq("id", id).maybeSingle(),
            supabase.from("p2p_lesson_sections").select("id,title,content,section_order").eq("lesson_id", id).order("section_order", { ascending: true }),
            supabase.from("p2p_scriptures").select("id,reference,verse,display_order").eq("lesson_id", id).order("display_order", { ascending: true }),
            supabase.from("p2p_reflection_questions").select("id,question,display_order").eq("lesson_id", id).order("display_order", { ascending: true }),
          ]);

        if (!cancelled) {
          setContent({
            title: (lesson?.title as string) ?? lessonMeta?.title ?? "Lesson",
            sections: ((sections ?? []) as Record<string, unknown>[]).map((s) => ({
              id: s.id as string,
              title: (s.title as string) ?? "",
              content: (s.content as string) ?? "",
            })),
            scriptures: ((scriptures ?? []) as Record<string, unknown>[]).map((s) => ({
              id: s.id as string,
              reference: s.reference as string,
              verse: s.verse as string,
            })),
            questions: ((questions ?? []) as Record<string, unknown>[]).map((q) => ({
              id: q.id as string,
              question: q.question as string,
            })),
          });
        }
      } catch {
        if (!cancelled) {
          setContent({ title: lessonMeta?.title ?? "Lesson", sections: [], scriptures: [], questions: [] });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssignment() {
      if (!id) return;
      const a = await getAssignmentForLesson(id);
      if (cancelled) return;
      setAssignment(a);
      if (a) {
        const status = await getSubmissionStatus(id);
        if (cancelled) return;
        if (status) {
          setSubmissionText(status.content);
          setSubmissionStatus(status);
        }
      }
    }
    loadAssignment();
    return () => {
      cancelled = true;
    };
  }, [id, getAssignmentForLesson, getSubmissionStatus]);

  async function handleSubmitAssignment() {
    if (!assignment || !id || submitting || !submissionText.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const err = await submitAssignment(assignment.id, id, submissionText.trim());
    if (err) {
      setSubmitError(err);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const status = await getSubmissionStatus(id);
      setSubmissionStatus(status);
    }
    setSubmitting(false);
  }

  async function handleComplete() {
    if (!id || completing) return;
    setCompleting(true);
    try {
      await markLessonComplete(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>Lesson</Text>
        {completed && (
          <View style={styles.completedTag}>
            <Ionicons name="checkmark" size={12} color={colors.cream} />
            <Text style={styles.completedTagText}>Done</Text>
          </View>
        )}
      </View>

      {isLoading || !content ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lessonTitle}>{content.title}</Text>

          {content.scriptures.map((s) => (
            <View key={s.id} style={styles.verseCard}>
              <Text style={styles.verseText}>"{s.verse}"</Text>
              <Text style={styles.verseRef}>— {s.reference}</Text>
            </View>
          ))}

          {content.sections.map((section) => (
            <View key={section.id}>
              {section.title ? <Text style={styles.sectionHeading}>{section.title}</Text> : null}
              {section.content.split("\n\n").map((para, idx) => (
                <Text key={idx} style={styles.bodyPara}>{para}</Text>
              ))}
            </View>
          ))}

          {content.questions.length > 0 && (
            <View style={styles.questionsCard}>
              <View style={styles.questionsHeader}>
                <Ionicons name="people" size={16} color={colors.accentGreen} />
                <Text style={styles.questionsTitle}>Discussion Questions</Text>
              </View>
              {content.questions.map((q, idx) => (
                <View key={q.id} style={styles.questionRow}>
                  <View style={styles.questionNum}>
                    <Text style={styles.questionNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.questionText}>{q.question}</Text>
                </View>
              ))}
            </View>
          )}

          {assignment && (() => {
            const evalStatus = submissionStatus?.evaluationStatus ?? null;
            const canEdit = evalStatus === null || evalStatus === "needs_revision";
            return (
              <View style={styles.assignmentCard}>
                <View style={styles.questionsHeader}>
                  <Ionicons name="create" size={16} color={colors.accentGreen} />
                  <Text style={styles.questionsTitle}>{assignment.title}</Text>
                </View>
                <Text style={styles.assignmentInstructions}>{assignment.instructions}</Text>
                <TextInput
                  style={[styles.assignmentInput, !canEdit && styles.assignmentInputDisabled]}
                  multiline
                  placeholder="Write your response here..."
                  placeholderTextColor={colors.textMuted}
                  value={submissionText}
                  onChangeText={setSubmissionText}
                  editable={canEdit}
                />
                {submitError && <Text style={styles.submitError}>{submitError}</Text>}

                {evalStatus === "needs_revision" && submissionStatus?.feedback && (
                  <View style={styles.revisionBanner}>
                    <Ionicons name="alert-circle" size={16} color={colors.amber} />
                    <Text style={styles.revisionBannerText}>{submissionStatus.feedback}</Text>
                  </View>
                )}

                {evalStatus === "pending" ? (
                  <View style={styles.completedBanner}>
                    <Ionicons name="hourglass" size={18} color={colors.accentGreen} />
                    <Text style={styles.completedBannerText}>Submitted — awaiting peer review</Text>
                  </View>
                ) : evalStatus === "approved" ? (
                  <View style={styles.completedBanner}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />
                    <Text style={styles.completedBannerText}>
                      {submissionStatus?.selfApproved
                        ? "Approved — first through this lesson, unevaluated"
                        : "Approved by your peer evaluator"}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.completeBtn,
                      (submitting || !submissionText.trim()) && styles.completeBtnDisabled,
                    ]}
                    onPress={handleSubmitAssignment}
                    activeOpacity={0.85}
                    disabled={submitting || !submissionText.trim()}
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.cream} />
                    ) : (
                      <>
                        <Ionicons name="send" size={18} color={colors.cream} />
                        <Text style={styles.completeBtnText}>
                          {evalStatus === "needs_revision" ? "Resubmit Assignment" : "Submit Assignment"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}

          {!assignment && (
            !completed ? (
              <TouchableOpacity
                style={[styles.completeBtn, completing && styles.completeBtnDisabled]}
                onPress={handleComplete}
                activeOpacity={0.85}
                disabled={completing}
              >
                {completing ? (
                  <ActivityIndicator color={colors.cream} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={colors.cream} />
                    <Text style={styles.completeBtnText}>Mark as Complete</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.completedBanner}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                <Text style={styles.completedBannerText}>Lesson completed!</Text>
              </View>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerLabel: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  completedTag: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: colors.accentGreen,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  completedTagText: { color: colors.cream, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  lessonTitle: {
    fontSize: 24, fontWeight: "700", color: colors.textDark,
    fontFamily: "Inter_700Bold", marginBottom: 20,
  },
  verseCard: {
    backgroundColor: colors.cardBeige,
    borderRadius: 16, borderWidth: 1, borderColor: colors.warmBeige,
    padding: 16, marginBottom: 24,
    borderLeftWidth: 4, borderLeftColor: colors.amber,
  },
  verseText: {
    fontSize: 16, fontStyle: "italic", color: colors.textDark,
    lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 8,
  },
  verseRef: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  sectionHeading: {
    fontSize: 16, fontWeight: "700", color: colors.textDark,
    fontFamily: "Inter_700Bold", marginBottom: 8, marginTop: 4,
  },
  bodyPara: {
    fontSize: 15, color: colors.textDark, lineHeight: 26,
    fontFamily: "Inter_400Regular", marginBottom: 16,
  },
  questionsCard: {
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 28, marginTop: 8,
  },
  questionsHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  questionsTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  questionRow: { flexDirection: "row", gap: 12, marginBottom: 14, alignItems: "flex-start" },
  questionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  questionNumText: { fontSize: 11, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  questionText: { flex: 1, fontSize: 14, color: colors.textDark, lineHeight: 22, fontFamily: "Inter_400Regular" },
  completeBtn: {
    backgroundColor: colors.primaryGreen, borderRadius: 14,
    height: 54, flexDirection: "row", gap: 8,
    alignItems: "center", justifyContent: "center",
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeBtnText: { color: colors.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  completedBanner: {
    backgroundColor: "rgba(29,158,117,0.1)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
    height: 54, flexDirection: "row", gap: 8,
    alignItems: "center", justifyContent: "center",
  },
  completedBannerText: { color: colors.accentGreen, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  assignmentCard: {
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 20,
  },
  assignmentInstructions: {
    fontSize: 14, color: colors.textMid, lineHeight: 22,
    fontFamily: "Inter_400Regular", marginBottom: 14,
  },
  assignmentInput: {
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 12, minHeight: 100, textAlignVertical: "top",
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 12, backgroundColor: colors.lightCream,
  },
  assignmentInputDisabled: { opacity: 0.6 },
  submitError: {
    fontSize: 12, color: "#C0392B", marginBottom: 10, fontFamily: "Inter_400Regular",
  },
  revisionBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "rgba(217,164,65,0.12)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(217,164,65,0.35)",
    padding: 12, marginBottom: 12,
  },
  revisionBannerText: {
    flex: 1, fontSize: 13, color: colors.textDark, lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
});
