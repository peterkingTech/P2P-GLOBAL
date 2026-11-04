import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  TextInput,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PendingEvaluation, SubmitterEvaluationContext } from "@/contexts/DataContext";
import { supabase, useAuth } from "@/contexts/AuthContext";
import MediaPlayer from "@/components/MediaPlayer";
import { AttachmentList } from "@/components/handwriting/AttachmentTray";
import { isAttachedOnlyText } from "@/lib/learningAttachmentsApi";
import ReviewPrompts from "@/components/ReviewPrompts";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";

// Compact context card for the reviewer — just enough to evaluate the
// submission fairly (who they are, how far along they are, momentum).
// Deliberately excludes registration/spiritual-background intake, other
// reflections/submissions, help-request history, and any other private
// profile field — same restraint as moderator access (getAllProfiles()).
function SubmitterContextCard({ context }: { context: SubmitterEvaluationContext }) {
  return (
    <View style={styles.submitterContextCard}>
      <Avatar photoUrl={context.photoUrl} fallbackIcon="person" size={40} style={styles.contextAvatar} />
      <View style={{ flex: 1 }}>
        <Text style={styles.contextName}>{context.fullName}</Text>
        <View style={styles.contextMetaRow}>
          <Text style={styles.contextMeta}>{context.growthStageEmoji} {context.growthStageName}</Text>
          <Text style={styles.contextMetaDot}>·</Text>
          <Text style={styles.contextMeta}>🔥 {context.streakDays}d streak</Text>
        </View>
        {context.contextLabel ? <Text style={styles.contextLabel}>{context.contextLabel}</Text> : null}
      </View>
    </View>
  );
}

function EvaluationCard({ evaluation }: { evaluation: PendingEvaluation }) {
  const { resolveEvaluation, getSubmitterEvaluationContext } = useData();
  const { user } = useAuth();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "needs_revision" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitterContext, setSubmitterContext] = useState<SubmitterEvaluationContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSubmitterEvaluationContext(evaluation.id).then((ctx) => {
      if (!cancelled) setSubmitterContext(ctx);
    });
    return () => { cancelled = true; };
  }, [evaluation.id, getSubmitterEvaluationContext]);

  async function handleResolve(status: "approved" | "needs_revision") {
    if (submitting) return;
    setSubmitting(status);
    setError(null);
    const trimmedFeedback = feedback.trim();
    const err = await resolveEvaluation(evaluation.id, status, trimmedFeedback);
    // Reset on both outcomes — on success the card is about to unmount as this
    // evaluation drops out of pendingEvaluations, but leaving `submitting` set
    // left the button permanently disabled for any render that happens first.
    setSubmitting(null);
    if (err) setError(err);
    else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Encouraging feedback = approved with real written feedback attached
      // (same "genuine encouragement" heuristic as the Encouragement Fruit
      // trigger in migration 036: written feedback, not just approve/reject).
      if (status === "approved" && trimmedFeedback.length > 0 && user) {
        void supabase.from("p2p_user_activity_events").insert({
          user_id: user.id,
          event_type: "peer_encouraged",
          metadata: { target_user_id: evaluation.submitterId, context: "lesson_evaluation" },
        });
      }
    }
  }

  const isMedia = evaluation.submissionType === "audio" || evaluation.submissionType === "video";

  return (
    <View style={styles.card}>
      {submitterContext && <SubmitterContextCard context={submitterContext} />}
      <View style={styles.cardHeader}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={16} color={colors.accentGreen} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.submitterName}>{evaluation.submitterName}</Text>
          <Text style={styles.lessonTitle}>{evaluation.lessonTitle}</Text>
        </View>
        <View style={styles.typeBadge}>
          <Ionicons
            name={
              evaluation.submissionType === "audio"
                ? "mic"
                : evaluation.submissionType === "video"
                ? "videocam"
                : "create"
            }
            size={12}
            color={colors.textMid}
          />
          <Text style={styles.typeBadgeText}>
            {evaluation.submissionType.charAt(0).toUpperCase() + evaluation.submissionType.slice(1)}
          </Text>
        </View>
      </View>

      {evaluation.questionText && (
        <Text style={styles.questionLabel}>{evaluation.questionText}</Text>
      )}

      {isMedia && evaluation.mediaUrl ? (
        <View style={styles.mediaBox}>
          <MediaPlayer
            storagePath={evaluation.mediaUrl}
            submissionType={evaluation.submissionType as "audio" | "video"}
            durationSeconds={evaluation.durationSeconds}
          />
        </View>
      ) : (
        <View style={styles.contentBox}>
          {isAttachedOnlyText(evaluation.content) ? <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>Answered with a drawing or file — open it below.</Text> : (
          <Text style={styles.contentText}>
            {evaluation.content || <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>No text content</Text>}
          </Text>)}
        </View>
      )}
      {/* Drawings / photos / PDFs sent with this answer — only its assigned reviewer (and the writer) can open them. */}
      <AttachmentList kind="core_submission" submissionId={evaluation.submissionId} />

      <ReviewPrompts feedback={feedback} onChange={setFeedback} />
      <TextInput
        style={styles.feedbackInput}
        multiline
        placeholder="Optional feedback for this disciple..."
        placeholderTextColor={colors.textMuted}
        value={feedback}
        onChangeText={setFeedback}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.actionRow}>
        <AppButton label="Ask for Revision" onPress={() => handleResolve("needs_revision")} variant="secondary" icon="refresh" disabled={submitting !== null} loading={submitting === "needs_revision"} style={{ flex: 1 }} palette="fixedLight" />
        <AppButton label="Approve" onPress={() => handleResolve("approved")} icon="checkmark" disabled={submitting !== null} loading={submitting === "approved"} style={{ flex: 1 }} palette="fixedLight" />
      </View>
    </View>
  );
}

// Reviews assigned to you directly (the original path, used while the
// Peer Evaluation Engine is off). Engine invitations and evaluations, and your
// own submissions' results, are in My Evaluations — nothing shows in both.
export default function EvaluationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingEvaluations } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review submissions</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open My Evaluations" onPress={() => router.push("/evaluation" as any)}
        style={{ marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="albums-outline" size={16} color={colors.accentGreen} />
        <Text style={{ flex: 1, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Your own submissions, invitations and feedback are in My Evaluations</Text>
      </TouchableOpacity>

      {pendingEvaluations.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle" size={48} color={colors.borderBeige} />
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySub}>No submissions are waiting for your review right now.</Text>
        </View>
      ) : (
        <FlatList
          data={pendingEvaluations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EvaluationCard evaluation={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 16 },
  submitterContextCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.cardBeige, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 10, marginBottom: 12,
  },
  contextAvatar: { width: 40, height: 40, borderRadius: 20 },
  contextAvatarFallback: { backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
  contextName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  contextMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  contextMeta: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  contextMetaDot: { fontSize: 12, color: colors.textMuted },
  contextLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center",
  },
  submitterName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  lessonTitle: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  typeBadge: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: colors.cardBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  typeBadgeText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_500Medium" },
  questionLabel: {
    fontSize: 12, color: colors.textMuted, fontStyle: "italic",
    fontFamily: "Inter_400Regular", marginBottom: 8, lineHeight: 18,
  },
  mediaBox: { marginBottom: 12 },
  contentBox: {
    backgroundColor: colors.cardBeige, borderRadius: 12, borderWidth: 1, borderColor: colors.warmBeige,
    padding: 12, marginBottom: 12,
  },
  contentText: { fontSize: 14, color: colors.textDark, lineHeight: 22, fontFamily: "Inter_400Regular" },
  feedbackInput: {
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 12, minHeight: 70, textAlignVertical: "top",
    fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 12, backgroundColor: colors.lightCream,
  },
  errorText: { fontSize: 12, color: "#C0392B", marginBottom: 10, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", gap: 10 },
});
