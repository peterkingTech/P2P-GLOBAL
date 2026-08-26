import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, Assignment, AssignmentQuestion, QuestionSubmission } from "@/contexts/DataContext";
import { QuestionResponseCard } from "@/app/lesson/[id]";
import type { useStudySession, StudyProgress, OtherParticipant } from "@/hooks/useStudySession";
import type { GroupStudyProgress } from "@/lib/groupStudy";

interface QuestionRow { id: string; question: string; kind: "reflection" | "assignment" }

// Reuses the exact existing submission pipeline (submitContent(), via
// QuestionResponseCard imported straight from lesson/[id].tsx) — discussing a
// question together is a pure UI focus signal, never a data write; only "My
// Answer" ever touches p2p_submissions, per-participant, unchanged.
export function StudyQuestionsTab({ session, otherParticipants }: { session: ReturnType<typeof useStudySession>; otherParticipants: OtherParticipant[] }) {
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
  const [groupProgress, setGroupProgress] = useState<GroupStudyProgress>({});
  const [discussionText, setDiscussionText] = useState("");

  const lessonId = session.lesson?.id;
  const isGroup = session.isGroup;

  const load = useCallback(async () => {
    if (!lessonId) return;
    setLoading(true);
    const [lessonData, a, aQuestions, qSubs, aqSubs, prog, gProg] = await Promise.all([
      session.getSharedLessonData(lessonId),
      getAssignmentForLesson(lessonId),
      getAssignmentQuestionsForLesson(lessonId),
      getQuestionSubmissionsForLesson(lessonId),
      getAssignmentQuestionSubmissionsForLesson(lessonId),
      isGroup ? Promise.resolve(null) : session.getStudyProgress(lessonId),
      isGroup ? session.getGroupProgress(lessonId) : Promise.resolve({} as GroupStudyProgress),
    ]);
    setReflectionQuestions(lessonData.questions);
    setAssignment(a);
    setAssignmentQuestions(aQuestions);
    setReflectionSubs(new Map(qSubs.map((s) => [s.questionId, s])));
    setAssignmentSubs(new Map(aqSubs.map((s) => [s.questionId, s])));
    setProgress(prog);
    setGroupProgress(gProg);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, isGroup]);

  useEffect(() => { load(); }, [load]);

  if (loading || !lessonId) {
    return <View style={styles.centerFill}><ActivityIndicator color="#1D9E75" /></View>;
  }

  const rows: QuestionRow[] = [
    ...reflectionQuestions.map((q) => ({ ...q, kind: "reflection" as const })),
    ...assignmentQuestions.map((q) => ({ ...q, kind: "assignment" as const })),
  ];

  function statusLabel(p?: { status: string; completed: boolean }): string {
    if (!p) return "not started";
    return p.completed ? "Completed" : p.status.replace("_", " ");
  }

  function handleSendDiscussion() {
    if (!discussionText.trim()) return;
    session.sendDiscussionMessage(discussionText);
    setDiscussionText("");
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 4 }}>
      {!isGroup && progress && (
        <View style={styles.progressRow}>
          <View style={styles.progressChip}>
            <Text style={styles.progressChipLabel}>You</Text>
            <Text style={styles.progressChipValue}>{statusLabel(progress.mine)}</Text>
          </View>
          <View style={styles.progressChip}>
            <Text style={styles.progressChipLabel}>{otherParticipants[0]?.name ?? "Partner"}</Text>
            <Text style={styles.progressChipValue}>{statusLabel(progress.theirs)}</Text>
          </View>
        </View>
      )}
      {isGroup && (
        <View style={styles.progressRowWrap}>
          {otherParticipants.map((p) => (
            <View key={p.userId} style={styles.progressChipSmall}>
              <Text style={styles.progressChipLabel} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.progressChipValue}>{statusLabel(groupProgress[p.userId])}</Text>
            </View>
          ))}
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

          {session.discussingQuestionId === row.id && (
            <View style={styles.discussionPanel}>
              {session.discussionMessages.length === 0 ? (
                <Text style={styles.discussionEmpty}>Start the conversation — share a thought on this question.</Text>
              ) : (
                session.discussionMessages.slice(-20).map((m, mi) => (
                  <Text key={mi} style={styles.discussionMsg}><Text style={styles.discussionMsgName}>{m.name}: </Text>{m.text}</Text>
                ))
              )}
              <View style={styles.discussionInputRow}>
                <TextInput
                  style={styles.discussionInput}
                  value={discussionText}
                  onChangeText={setDiscussionText}
                  placeholder="Say something…"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  onSubmitEditing={handleSendDiscussion}
                />
                <TouchableOpacity style={styles.discussionSendBtn} onPress={handleSendDiscussion}>
                  <Ionicons name="send" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={styles.myAnswerLabel}>My Answer</Text>
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
  progressRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  progressChip: { flex: 1, backgroundColor: "#1A241E", borderRadius: 12, padding: 12 },
  progressChipSmall: { minWidth: 100, backgroundColor: "#1A241E", borderRadius: 12, padding: 10 },
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
  discussionPanel: { backgroundColor: "#141F19", borderRadius: 12, padding: 12, gap: 6, marginBottom: 10 },
  discussionEmpty: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  discussionMsg: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_400Regular" },
  discussionMsgName: { color: "#1D9E75", fontWeight: "700", fontFamily: "Inter_700Bold" },
  discussionInputRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  discussionInput: { flex: 1, backgroundColor: "#1A241E", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: "#fff", fontSize: 12, fontFamily: "Inter_400Regular" },
  discussionSendBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  myAnswerLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
});