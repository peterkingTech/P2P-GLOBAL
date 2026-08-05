import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
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
import { useData, PendingEvaluation, MySubmission, SubmitterEvaluationContext } from "@/contexts/DataContext";
import { supabase, useAuth } from "@/contexts/AuthContext";
import MediaPlayer from "@/components/MediaPlayer";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";

interface CirclePendingEvaluation {
  submissionId: string;
  submitterId: string;
  submitterName: string;
  lessonId: string;
  content: string;
  evaluationsSoFar: number;
  circleId: string;
  circleName: string;
}

function CircleEvaluationCard({ evaluation, onResolved }: { evaluation: CirclePendingEvaluation; onResolved: (submissionId: string) => void }) {
  const { profile } = useAuth();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "needs_revision" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve(decision: "approved" | "needs_revision") {
    if (submitting || !profile?.id) return;
    setSubmitting(decision);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/circles/${evaluation.circleId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: evaluation.submissionId,
          evaluatorId: profile.id,
          submitterId: evaluation.submitterId,
          lessonId: evaluation.lessonId,
          decision,
          feedback: feedback.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Could not submit evaluation");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onResolved(evaluation.submissionId);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.circleBadgeRow}>
        <Ionicons name="people-circle-outline" size={14} color={colors.accentGreen} />
        <Text style={styles.circleBadgeText}>{evaluation.circleName}</Text>
        <View style={styles.consensusPill}>
          <Text style={styles.consensusPillText}>{evaluation.evaluationsSoFar} of 2 evaluations so far</Text>
        </View>
      </View>
      <View style={styles.cardHeader}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={16} color={colors.accentGreen} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.submitterName}>{evaluation.submitterName}</Text>
        </View>
      </View>
      <View style={styles.contentBox}>
        <Text style={styles.contentText}>{evaluation.content || <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>No text content</Text>}</Text>
      </View>
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
        <TouchableOpacity style={[styles.actionBtn, styles.reviseBtn]} onPress={() => handleResolve("needs_revision")} disabled={submitting !== null} activeOpacity={0.85}>
          {submitting === "needs_revision" ? <ActivityIndicator color={colors.textDark} size="small" /> : (
            <><Ionicons name="refresh" size={16} color={colors.textDark} /><Text style={styles.reviseBtnText}>Ask for Revision</Text></>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleResolve("approved")} disabled={submitting !== null} activeOpacity={0.85}>
          {submitting === "approved" ? <ActivityIndicator color={colors.cream} size="small" /> : (
            <><Ionicons name="checkmark" size={16} color={colors.cream} /><Text style={styles.approveBtnText}>Approve</Text></>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Compact context card for the reviewer — just enough to evaluate the
// submission fairly (who they are, how far along they are, momentum).
// Deliberately excludes registration/spiritual-background intake, other
// reflections/submissions, help-request history, and any other private
// profile field — same restraint as moderator access (getAllProfiles()).
function SubmitterContextCard({ context }: { context: SubmitterEvaluationContext }) {
  return (
    <View style={styles.submitterContextCard}>
      {context.photoUrl ? (
        <Image source={{ uri: context.photoUrl }} style={styles.contextAvatar} />
      ) : (
        <View style={[styles.contextAvatar, styles.contextAvatarFallback]}>
          <Ionicons name="person" size={18} color={colors.accentGreen} />
        </View>
      )}
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

function statusInfo(sub: MySubmission): { icon: string; color: string; bg: string; label: string } {
  if (sub.selfApproved) {
    return { icon: "checkmark-circle", color: colors.accentGreen, bg: "rgba(29,158,117,0.08)", label: "Approved (first through this lesson)" };
  }
  switch (sub.evaluationStatus) {
    case "approved":
      return { icon: "checkmark-circle", color: colors.accentGreen, bg: "rgba(29,158,117,0.08)", label: "Approved" };
    case "needs_revision":
      return { icon: "alert-circle", color: "#C0392B", bg: "rgba(192,57,43,0.08)", label: "Needs revision" };
    default:
      return { icon: "time-outline", color: colors.amber, bg: "rgba(217,164,65,0.1)", label: "Waiting for peer review" };
  }
}

function MySubmissionCard({ submission }: { submission: MySubmission }) {
  const router = useRouter();
  const info = statusInfo(submission);
  const isMedia = submission.submissionType === "audio" || submission.submissionType === "video";

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push(`/lesson/${submission.lessonId}` as any)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatarCircle}>
          <Ionicons
            name={submission.submissionType === "audio" ? "mic" : submission.submissionType === "video" ? "videocam" : "create"}
            size={16}
            color={colors.accentGreen}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.submitterName}>{submission.lessonTitle}</Text>
          <Text style={styles.lessonTitle}>{new Date(submission.createdAt).toLocaleDateString()}</Text>
        </View>
      </View>

      {isMedia ? (
        submission.mediaUrl ? (
          <View style={styles.mediaBox}>
            <MediaPlayer
              storagePath={submission.mediaUrl}
              submissionType={submission.submissionType as "audio" | "video"}
              durationSeconds={submission.durationSeconds}
            />
          </View>
        ) : null
      ) : (
        <View style={styles.contentBox}>
          <Text style={styles.contentText} numberOfLines={3}>
            {submission.content || <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>No text content</Text>}
          </Text>
        </View>
      )}

      <View style={[styles.statusBadge, { backgroundColor: info.bg }]}>
        <Ionicons name={info.icon as any} size={13} color={info.color} />
        <Text style={[styles.statusBadgeText, { color: info.color }]}>{info.label}</Text>
      </View>

      {submission.evaluationStatus === "needs_revision" && submission.feedback ? (
        <View style={styles.revisionBanner}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color="#C0392B" />
          <Text style={styles.revisionBannerText}>{submission.feedback}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function isSubmissionApproved(sub: MySubmission): boolean {
  return sub.selfApproved || sub.evaluationStatus === "approved";
}

export default function EvaluationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { pendingEvaluations, getMySubmissions } = useData();
  const [tab, setTab] = useState<"toReview" | "submitted" | "approved">("toReview");
  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [circleEvals, setCircleEvals] = useState<CirclePendingEvaluation[]>([]);

  const loadCircleEvals = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const apiUrl = getApiUrl();
      const allRes = await fetch(`${apiUrl}/circles?status=active,forming`);
      const all = (await allRes.json()) as { id: string; name: string }[];
      const details = await Promise.all(
        (Array.isArray(all) ? all : []).map((c) => fetch(`${apiUrl}/circles/${c.id}`).then((r) => r.json()).catch(() => null))
      );
      const myCircles = details.filter(
        (d) => d && Array.isArray(d.members) && d.members.some((m: { userId: string }) => m.userId === profile.id)
      );
      const pendingLists = await Promise.all(
        myCircles.map((c: any) =>
          fetch(`${apiUrl}/circles/${c.id}/evaluations/pending?userId=${profile.id}`)
            .then((r) => r.json())
            .then((items: any[]) => (Array.isArray(items) ? items.map((i) => ({ ...i, circleId: c.id, circleName: c.name })) : []))
            .catch(() => [])
        )
      );
      setCircleEvals(pendingLists.flat());
    } catch {
      setCircleEvals([]);
    }
  }, [profile?.id]);

  useEffect(() => { loadCircleEvals(); }, [loadCircleEvals]);

  function handleCircleEvalResolved(submissionId: string) {
    setCircleEvals((prev) => prev.filter((e) => e.submissionId !== submissionId));
  }

  const loadMySubmissions = useCallback(async () => {
    setLoadingMine(true);
    setMySubmissions(await getMySubmissions());
    setLoadingMine(false);
  }, [getMySubmissions]);

  useEffect(() => {
    if (tab !== "toReview") loadMySubmissions();
  }, [tab, loadMySubmissions]);

  const submittedSubmissions = mySubmissions.filter((s) => !isSubmissionApproved(s));
  const approvedSubmissions = mySubmissions.filter(isSubmissionApproved);

  // Live-update "Submitted"/"Recently Approved" the moment an evaluator
  // resolves one, so the learner sees Approved/Needs revision without
  // pulling to refresh. Plans now share this same table post-unification.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`p2p_lesson_evaluations_mine_${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_lesson_evaluations", filter: `submitter_id=eq.${user.id}` },
        () => { if (tab !== "toReview") loadMySubmissions(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, tab, loadMySubmissions]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Peer Review</Text>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "toReview" && styles.tabBtnActive]}
          onPress={() => setTab("toReview")}
        >
          <Text style={[styles.tabBtnText, tab === "toReview" && styles.tabBtnTextActive]} numberOfLines={2}>
            To Review{(pendingEvaluations.length + circleEvals.length) > 0 ? ` (${pendingEvaluations.length + circleEvals.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "submitted" && styles.tabBtnActive]}
          onPress={() => setTab("submitted")}
        >
          <Text style={[styles.tabBtnText, tab === "submitted" && styles.tabBtnTextActive]} numberOfLines={2}>
            Submitted — Awaiting Approval{submittedSubmissions.length > 0 ? ` (${submittedSubmissions.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "approved" && styles.tabBtnActive]}
          onPress={() => setTab("approved")}
        >
          <Text style={[styles.tabBtnText, tab === "approved" && styles.tabBtnTextActive]} numberOfLines={2}>
            Recently Approved
          </Text>
        </TouchableOpacity>
      </View>

      {tab === "toReview" ? (
        pendingEvaluations.length === 0 && circleEvals.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle" size={48} color={colors.borderBeige} />
            <Text style={styles.emptyTitle}>You're all caught up</Text>
            <Text style={styles.emptySub}>No peer evaluations are waiting for your review right now.</Text>
          </View>
        ) : (
          <FlatList
            data={[
              ...pendingEvaluations.map((e) => ({ kind: "solo" as const, item: e })),
              ...circleEvals.map((e) => ({ kind: "circle" as const, item: e })),
            ]}
            keyExtractor={(row) => (row.kind === "solo" ? row.item.id : row.item.submissionId)}
            renderItem={({ item: row }) =>
              row.kind === "solo" ? (
                <EvaluationCard evaluation={row.item} />
              ) : (
                <CircleEvaluationCard evaluation={row.item} onResolved={handleCircleEvalResolved} />
              )
            }
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : loadingMine ? (
        <View style={styles.emptyState}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : tab === "submitted" ? (
        submittedSubmissions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={colors.borderBeige} />
            <Text style={styles.emptyTitle}>Nothing awaiting approval</Text>
            <Text style={styles.emptySub}>Assignment responses you submit will show up here until a peer evaluator resolves them.</Text>
          </View>
        ) : (
          <FlatList
            data={submittedSubmissions}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MySubmissionCard submission={item} />}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : approvedSubmissions.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle" size={48} color={colors.borderBeige} />
          <Text style={styles.emptyTitle}>No approved submissions yet</Text>
          <Text style={styles.emptySub}>Submissions a peer evaluator approves will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={approvedSubmissions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MySubmissionCard submission={item} />}
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
  tabRow: {
    flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  tabBtn: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, paddingHorizontal: 4, borderRadius: 10, minHeight: 44,
    backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige,
  },
  tabBtnActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  tabBtnText: { fontSize: 11, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  tabBtnTextActive: { color: colors.cream },
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
  actionBtn: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  reviseBtn: { backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige },
  reviseBtnText: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  approveBtn: { backgroundColor: colors.primaryGreen },
  approveBtnText: { fontSize: 13, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
  statusBadge: {
    flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusBadgeText: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  revisionBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    marginTop: 10,
    backgroundColor: "rgba(192,57,43,0.06)", borderRadius: 10, borderWidth: 1,
    borderColor: "rgba(192,57,43,0.25)", padding: 10,
  },
  revisionBannerText: { flex: 1, fontSize: 12, color: colors.textDark, lineHeight: 18, fontFamily: "Inter_400Regular" },
  circleBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  circleBadgeText: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  consensusPill: { marginLeft: "auto", backgroundColor: colors.cardBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  consensusPillText: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
