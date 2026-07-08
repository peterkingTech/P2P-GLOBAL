import React, { useEffect, useState, useCallback } from "react";
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
import {
  useData,
  Assignment,
  SubmissionStatus,
  QuestionSubmission,
  SubmissionType,
} from "@/contexts/DataContext";
import AudioRecorder from "@/components/AudioRecorder";
import VideoRecorder from "@/components/VideoRecorder";
import colors from "@/constants/colors";

interface LessonContent {
  title: string;
  sections: { id: string; title: string; content: string }[];
  scriptures: { id: string; reference: string; verse: string }[];
  questions: { id: string; question: string }[];
}

// ── Submission type tab selector ──────────────────────────────────────────────
function TypeTabs({
  value,
  onChange,
  disabled,
}: {
  value: SubmissionType;
  onChange: (t: SubmissionType) => void;
  disabled?: boolean;
}) {
  const tabs: { type: SubmissionType; icon: string; label: string }[] = [
    { type: "text", icon: "create-outline", label: "Text" },
    { type: "audio", icon: "mic-outline", label: "Audio" },
    { type: "video", icon: "videocam-outline", label: "Video" },
  ];
  return (
    <View style={tabStyles.row}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.type}
          style={[tabStyles.tab, value === t.type && tabStyles.tabActive]}
          onPress={() => !disabled && onChange(t.type)}
          disabled={disabled}
          activeOpacity={0.75}
        >
          <Ionicons
            name={t.icon as any}
            size={14}
            color={value === t.type ? colors.cream : colors.textMid}
          />
          <Text style={[tabStyles.label, value === t.type && tabStyles.labelActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  row: {
    flexDirection: "row", gap: 6, marginBottom: 12,
  },
  tab: {
    flex: 1, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center",
    paddingVertical: 7, borderRadius: 10,
    backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige,
  },
  tabActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  label: { fontSize: 12, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  labelActive: { color: colors.cream },
});

// ── Question response card ────────────────────────────────────────────────────
function QuestionResponseCard({
  question,
  questionIndex,
  lessonId,
  existingSub,
}: {
  question: { id: string; question: string };
  questionIndex: number;
  lessonId: string;
  existingSub: QuestionSubmission | undefined;
}) {
  const { submitContent } = useData();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<SubmissionType>("text");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<QuestionSubmission | null>(existingSub ?? null);
  const [error, setError] = useState<string | null>(null);

  async function handleTextSubmit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await submitContent({
      lessonId,
      questionId: question.id,
      type: "text",
      text: text.trim(),
    });
    setSubmitting(false);
    if (err) { setError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted({ id: Date.now().toString(), questionId: question.id, submissionType: "text", textContent: text.trim(), mediaUrl: null, durationSeconds: null, createdAt: new Date().toISOString() });
    setExpanded(false);
  }

  async function handleMediaSubmit(localUri: string, durationSeconds: number) {
    const err = await submitContent({
      lessonId,
      questionId: question.id,
      type: mode as "audio" | "video",
      mediaUri: localUri,
      durationSeconds,
    });
    if (err) { setError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted({ id: Date.now().toString(), questionId: question.id, submissionType: mode, textContent: null, mediaUrl: "uploaded", durationSeconds, createdAt: new Date().toISOString() });
    setExpanded(false);
  }

  const typeIcon = (t: SubmissionType) => t === "audio" ? "mic" : t === "video" ? "videocam" : "chatbubble";

  return (
    <View style={qStyles.wrapper}>
      <View style={qStyles.questionRow}>
        <View style={qStyles.questionNum}>
          <Text style={qStyles.questionNumText}>{questionIndex + 1}</Text>
        </View>
        <Text style={qStyles.questionText}>{question.question}</Text>
      </View>

      {submitted ? (
        <TouchableOpacity style={qStyles.submittedBadge} onPress={() => { setSubmitted(null); setExpanded(true); }} activeOpacity={0.7}>
          <Ionicons name={typeIcon(submitted.submissionType) as any} size={12} color={colors.accentGreen} />
          <Text style={qStyles.submittedText}>Responded · tap to update</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={qStyles.shareToggle}
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.75}
        >
          <Ionicons name={expanded ? "chevron-up" : "chatbubble-outline"} size={13} color={colors.textMid} />
          <Text style={qStyles.shareToggleText}>{expanded ? "Hide" : "Share your response"}</Text>
        </TouchableOpacity>
      )}

      {expanded && !submitted && (
        <View style={qStyles.inputArea}>
          <TypeTabs value={mode} onChange={setMode} disabled={submitting} />
          {mode === "text" ? (
            <>
              <TextInput
                style={qStyles.textInput}
                multiline
                placeholder="Write your reflection here…"
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
              />
              {error && <Text style={qStyles.error}>{error}</Text>}
              <TouchableOpacity
                style={[qStyles.submitBtn, (!text.trim() || submitting) && qStyles.submitBtnDisabled]}
                onPress={handleTextSubmit}
                disabled={!text.trim() || submitting}
                activeOpacity={0.85}
              >
                {submitting ? <ActivityIndicator color={colors.cream} size="small" /> : (
                  <>
                    <Ionicons name="send" size={14} color={colors.cream} />
                    <Text style={qStyles.submitBtnText}>Share Response</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : mode === "audio" ? (
            <>
              {error && <Text style={qStyles.error}>{error}</Text>}
              <AudioRecorder onSubmit={handleMediaSubmit} disabled={submitting} />
            </>
          ) : (
            <>
              {error && <Text style={qStyles.error}>{error}</Text>}
              <VideoRecorder onSubmit={handleMediaSubmit} disabled={submitting} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const qStyles = StyleSheet.create({
  wrapper: { marginBottom: 14 },
  questionRow: { flexDirection: "row", gap: 12, marginBottom: 6, alignItems: "flex-start" },
  questionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  questionNumText: { fontSize: 11, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  questionText: { flex: 1, fontSize: 14, color: colors.textDark, lineHeight: 22, fontFamily: "Inter_400Regular" },
  submittedBadge: {
    flexDirection: "row", gap: 5, alignItems: "center",
    marginLeft: 36, marginTop: 2, marginBottom: 2,
    backgroundColor: "rgba(29,158,117,0.08)",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: "flex-start",
  },
  submittedText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  shareToggle: {
    flexDirection: "row", gap: 5, alignItems: "center",
    marginLeft: 36, marginTop: 2,
    alignSelf: "flex-start",
  },
  shareToggleText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  inputArea: { marginLeft: 36, marginTop: 8 },
  textInput: {
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 10, minHeight: 80, textAlignVertical: "top",
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 10, backgroundColor: colors.lightCream,
  },
  error: { fontSize: 12, color: "#C0392B", marginBottom: 8, fontFamily: "Inter_400Regular" },
  submitBtn: {
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryGreen, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.cream, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    lessons, markLessonComplete,
    getAssignmentForLesson, getSubmissionStatus, getQuestionSubmissionsForLesson,
    submitContent,
  } = useData();

  const [content, setContent] = useState<LessonContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus | null>(null);
  const [questionSubs, setQuestionSubs] = useState<Map<string, QuestionSubmission>>(new Map());

  // Assignment submission state
  const [assignmentMode, setAssignmentMode] = useState<SubmissionType>("text");
  const [submissionText, setSubmissionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const lessonMeta = lessons.find((l) => l.id === id);
  const completed = lessonMeta?.isCompleted ?? false;
  const evalStatus = submissionStatus?.evaluationStatus ?? null;
  const canResubmit = evalStatus === null || evalStatus === "needs_revision";

  // Load lesson content
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
            sections: ((sections ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, title: (s.title as string) ?? "", content: (s.content as string) ?? "" })),
            scriptures: ((scriptures ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, reference: s.reference as string, verse: s.verse as string })),
            questions: ((questions ?? []) as Record<string, unknown>[]).map((q) => ({ id: q.id as string, question: q.question as string })),
          });
        }
      } catch {
        if (!cancelled) setContent({ title: lessonMeta?.title ?? "Lesson", sections: [], scriptures: [], questions: [] });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  // Load assignment + question submissions
  useEffect(() => {
    let cancelled = false;
    async function loadSubmissions() {
      if (!id) return;
      const [a, qSubs] = await Promise.all([
        getAssignmentForLesson(id),
        getQuestionSubmissionsForLesson(id),
      ]);
      if (cancelled) return;
      setAssignment(a);
      const map = new Map<string, QuestionSubmission>();
      for (const s of qSubs) map.set(s.questionId, s);
      setQuestionSubs(map);
      if (a) {
        const status = await getSubmissionStatus(id);
        if (cancelled) return;
        if (status) {
          setSubmissionText(status.content);
          setAssignmentMode(status.submissionType);
          setSubmissionStatus(status);
        }
      }
    }
    loadSubmissions();
    return () => { cancelled = true; };
  }, [id, getAssignmentForLesson, getSubmissionStatus, getQuestionSubmissionsForLesson]);

  async function handleSubmitAssignment() {
    if (!assignment || !id || submitting) return;
    if (assignmentMode === "text" && !submissionText.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const err = await submitContent({
      lessonId: id,
      assignmentId: assignment.id,
      type: assignmentMode,
      text: assignmentMode === "text" ? submissionText.trim() : null,
    });
    if (err) { setSubmitError(err); setSubmitting(false); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const status = await getSubmissionStatus(id);
    setSubmissionStatus(status);
    setSubmitting(false);
  }

  async function handleMediaAssignmentSubmit(localUri: string, durationSeconds: number) {
    if (!assignment || !id) return;
    const err = await submitContent({
      lessonId: id,
      assignmentId: assignment.id,
      type: assignmentMode as "audio" | "video",
      mediaUri: localUri,
      durationSeconds,
    });
    if (err) { setSubmitError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const status = await getSubmissionStatus(id);
    setSubmissionStatus(status);
  }

  async function handleComplete() {
    if (!id || completing) return;
    setCompleting(true);
    try { await markLessonComplete(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    finally { setCompleting(false); }
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
        <View style={styles.loadingContainer}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
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
                <QuestionResponseCard
                  key={q.id}
                  question={q}
                  questionIndex={idx}
                  lessonId={id ?? ""}
                  existingSub={questionSubs.get(q.id)}
                />
              ))}
            </View>
          )}

          {assignment && (() => {
            return (
              <View style={styles.assignmentCard}>
                <View style={styles.questionsHeader}>
                  <Ionicons name="create" size={16} color={colors.accentGreen} />
                  <Text style={styles.questionsTitle}>{assignment.title}</Text>
                </View>
                <Text style={styles.assignmentInstructions}>{assignment.instructions}</Text>

                {canResubmit && (
                  <TypeTabs value={assignmentMode} onChange={setAssignmentMode} disabled={submitting} />
                )}

                {evalStatus === "needs_revision" && submissionStatus?.feedback && (
                  <View style={styles.revisionBanner}>
                    <Ionicons name="alert-circle" size={16} color={colors.amber} />
                    <Text style={styles.revisionBannerText}>{submissionStatus.feedback}</Text>
                  </View>
                )}

                {canResubmit && assignmentMode === "text" && (
                  <TextInput
                    style={styles.assignmentInput}
                    multiline
                    placeholder="Write your response here..."
                    placeholderTextColor={colors.textMuted}
                    value={submissionText}
                    onChangeText={setSubmissionText}
                  />
                )}

                {submitError && <Text style={styles.submitError}>{submitError}</Text>}

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
                  <>
                    {canResubmit && assignmentMode === "audio" && (
                      <AudioRecorder onSubmit={handleMediaAssignmentSubmit} disabled={submitting} />
                    )}
                    {canResubmit && assignmentMode === "video" && (
                      <VideoRecorder onSubmit={handleMediaAssignmentSubmit} disabled={submitting} />
                    )}
                    {assignmentMode === "text" && (
                      <TouchableOpacity
                        style={[styles.completeBtn, (submitting || !submissionText.trim()) && styles.completeBtnDisabled]}
                        onPress={handleSubmitAssignment}
                        activeOpacity={0.85}
                        disabled={submitting || !submissionText.trim()}
                      >
                        {submitting ? <ActivityIndicator color={colors.cream} /> : (
                          <>
                            <Ionicons name="send" size={18} color={colors.cream} />
                            <Text style={styles.completeBtnText}>
                              {evalStatus === "needs_revision" ? "Resubmit Assignment" : "Submit Assignment"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
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
                {completing ? <ActivityIndicator color={colors.cream} /> : (
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
    backgroundColor: colors.accentGreen, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  completedTagText: { color: colors.cream, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  lessonTitle: { fontSize: 24, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 20 },
  verseCard: {
    backgroundColor: colors.cardBeige, borderRadius: 16, borderWidth: 1, borderColor: colors.warmBeige,
    padding: 16, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: colors.amber,
  },
  verseText: { fontSize: 16, fontStyle: "italic", color: colors.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 8 },
  verseRef: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  sectionHeading: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 8, marginTop: 4 },
  bodyPara: { fontSize: 15, color: colors.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 16 },
  questionsCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 28, marginTop: 8,
  },
  questionsHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  questionsTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  completeBtn: {
    backgroundColor: colors.primaryGreen, borderRadius: 14, height: 54,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeBtnText: { color: colors.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  completedBanner: {
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 14, borderWidth: 1,
    borderColor: "rgba(29,158,117,0.3)", height: 54,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  completedBannerText: { color: colors.accentGreen, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  assignmentCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 20,
  },
  assignmentInstructions: { fontSize: 14, color: colors.textMid, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 14 },
  assignmentInput: {
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 12, minHeight: 100, textAlignVertical: "top",
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 12, backgroundColor: colors.lightCream,
  },
  submitError: { fontSize: 12, color: "#C0392B", marginBottom: 10, fontFamily: "Inter_400Regular" },
  revisionBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "rgba(217,164,65,0.12)", borderRadius: 12, borderWidth: 1,
    borderColor: "rgba(217,164,65,0.35)", padding: 12, marginBottom: 12,
  },
  revisionBannerText: { flex: 1, fontSize: 13, color: colors.textDark, lineHeight: 20, fontFamily: "Inter_400Regular" },
});
