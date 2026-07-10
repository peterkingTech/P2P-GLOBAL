import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PendingEvaluation } from "@/contexts/DataContext";
import MediaPlayer from "@/components/MediaPlayer";
import colors from "@/constants/colors";

function EvaluationCard({ evaluation }: { evaluation: PendingEvaluation }) {
  const { resolveEvaluation } = useData();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "needs_revision" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve(status: "approved" | "needs_revision") {
    if (submitting) return;
    setSubmitting(status);
    setError(null);
    const err = await resolveEvaluation(evaluation.id, status, feedback.trim());
    if (err) { setError(err); setSubmitting(null); }
    else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
  }

  const isMedia = evaluation.submissionType === "audio" || evaluation.submissionType === "video";

  return (
    <View style={styles.card}>
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
          <Text style={styles.contentText}>
            {evaluation.content || <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>No text content</Text>}
          </Text>
        </View>
      )}

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
        <TouchableOpacity
          style={[styles.actionBtn, styles.reviseBtn]}
          onPress={() => handleResolve("needs_revision")}
          disabled={submitting !== null}
          activeOpacity={0.85}
        >
          {submitting === "needs_revision" ? (
            <ActivityIndicator color={colors.textDark} size="small" />
          ) : (
            <>
              <Ionicons name="refresh" size={16} color={colors.textDark} />
              <Text style={styles.reviseBtnText}>Ask for Revision</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={() => handleResolve("approved")}
          disabled={submitting !== null}
          activeOpacity={0.85}
        >
          {submitting === "approved" ? (
            <ActivityIndicator color={colors.cream} size="small" />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={colors.cream} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function EvaluationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingEvaluations } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Evaluations Waiting for You</Text>
      </View>

      {pendingEvaluations.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle" size={48} color={colors.borderBeige} />
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySub}>No peer evaluations are waiting for your review right now.</Text>
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
  actionBtn: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  reviseBtn: { backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige },
  reviseBtnText: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  approveBtn: { backgroundColor: colors.primaryGreen },
  approveBtnText: { fontSize: 13, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
});
