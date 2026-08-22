import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, Assignment, AssignmentQuestion, QuestionSubmission } from "@/contexts/DataContext";
import { QuestionResponseCard } from "@/app/lesson/[id]";
import type { useStudySession, StudyProgress } from "@/hooks/useStudySession";

interface QuestionRow { id: string; question: string; kind: "reflection" | "assignment" }

// Reuses the exact existing submission pipeline (submitContent(), via
// QuestionResponseCard imported straight from lesson/[id].tsx) — discussing a
// question together is a pure UI focus signal, never a data write; only "My
// Answer" ever touches p2p_submissions, per-participant, unchanged.
export function StudyQuestionsTab({ session, otherUserName }: { session: ReturnType<typeof useStudySession>; otherUserName: string }) {
  const {
    getAssignmentForLesson, getQuestionSubmissionsForLesson,
    getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson,
  } = useData();

  const [loading, setLoading] = useState(true);
  const [reflectionQuestions, setReflectionQuestions] = useState<{ id: string; question: string }[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [assignmentQuestions, setAssignmentQuestions] = useState<AssignmentQuestion[]>([]);
  const [reflectionSubs, setReflectionSubs] = useState<Map<string, QuestionSubmission>>(new Map());
  const [assignmentSubs, setAssignmentSubs] = useState<Map<string, QuestionSubmission>>(new Map());
  const [progress, setProgress] = useState<StudyProgress | null>(null);

  const lessonId = session.lesson?.id;

  const load = useCallback(async () => {
    if (!lessonId) return;
    setLoading(true);
    const [lessonData, a, aQuestions, qSubs, aqSubs, prog] = await Promise.all([
      session.getSharedLessonData(lessonId),
      getAssignmentForLesson(lessonId),
      getAssignmentQuestionsForLesson(lessonId),
      getQuestionSubmissionsForLesson(lessonId),
      getAssignmentQuestionSubmissionsForLesson(lessonId),
      session.getStudyProgress(lessonId),
    ]);
    setReflectionQuestions(lessonData.questions);
    setAssignment(a);
    setAssignmentQuestions(aQuestions);
    setReflectionSubs(new Map(qSubs.map((s) => [s.questionId, s])));
    setAssignmentSubs(new Map(aqSubs.map((s) => [s.questionId, s])));
    setProgress(prog);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !lessonId) {
    return <View style={styles.centerFill}><ActivityIndicator color="#1D9E75" /></View>;
  }

  const rows: QuestionRow[] = [
    ...reflectionQuestions.map((q) => ({ ...q, kind: "reflection" as const })),
    ...assignmentQuestions.map((q) => ({ ...q, kind: "assignment" as const })),
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 4 }}>
      {progress && (
        <View style={styles.progressRow}>
          <View style={styles.progressChip}>
            <Text style={styles.progressChipLabel}>You</Text>
            <Text style={styles.progressChipValue}>{progress.mine.completed ? "Completed" : progress.mine.status.replace("_", " ")}</Text>
          </View>
          <View style={styles.progressChip}>
            <Text style={styles.progressChipLabel}>{otherUserName}</Text>
            <Text style={styles.progressChipValue}>{progress.theirs.completed ? "Completed" : progress.theirs.status.replace("_", " ")}</Text>
          </View>
        </View>
      )}

      {rows.length === 0 && (
        <Text style={styles.emptyText}>This lesson has no discussion questions.</Text>
      )}

      {rows.map((row, i) => (
        <View key={row.id} style={styles.questionBlock}>
          <TouchableOpacity
            style={[styles.discussBtn, session.discussingQuestionId === row.id && styles.discussBtnActive]}
            onPress={() => session.discussQuestion(row.id)}
          >
            <Ionicons name="chatbubbles-outline" size={14} color={session.discussingQuestionId === row.id ? "#fff" : "#1D9E75"} />
            <Text style={[styles.discussBtnText, session.discussingQuestionId === row.id && styles.discussBtnTextActive]}>
              {session.discussingQuestionId === row.id ? `Discussing Question ${i + 1}` : "Discuss Together"}
            </Text>
          </TouchableOpacity>
          <QuestionResponseCard
            question={row}
            questionIndex={i}
            lessonId={lessonId}
            existingSub={(row.kind === "reflection" ? reflectionSubs : assignmentSubs).get(row.id)}
            kind={row.kind}
            assignmentId={row.kind === "assignment" ? assignment?.id : undefined}
            onSubmitted={load}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 30 },
  progressRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  progressChip: { flex: 1, backgroundColor: "#1A241E", borderRadius: 12, padding: 12 },
  progressChipLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  progressChipValue: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 2, textTransform: "capitalize" },
  questionBlock: { marginBottom: 18 },
  discussBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderWidth: 1, borderColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
  },
  discussBtnActive: { backgroundColor: "#1D9E75" },
  discussBtnText: { color: "#1D9E75", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  discussBtnTextActive: { color: "#fff" },
});