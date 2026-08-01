import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

interface CircleMember { id: string; userId: string; role: string; status: string; name: string; avatarUrl: string | null }
interface CircleSession { id: string; lessonId: string; scheduledAt: string | null; completedAt: string | null; sessionStatus: string; notes: string | null }
interface CircleDetail {
  id: string; name: string; description: string | null; leaderId: string; currentLessonId: string | null;
  status: string; members: CircleMember[]; sessions: CircleSession[];
}
interface JoinRequest { id: string; userId: string; userName: string; message: string | null; requestedAt: string }
interface PendingEvaluation { submissionId: string; submitterId: string; submitterName: string; lessonId: string; content: string; evaluationsSoFar: number }

export default function CircleDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: circleId } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [pendingEvals, setPendingEvals] = useState<PendingEvaluation[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionLessonId, setSessionLessonId] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});

  const isLeader = circle?.leaderId === profile?.id;

  const load = useCallback(async () => {
    if (!circleId) return;
    setLoading(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/circles/${circleId}`);
      const data = (await res.json()) as CircleDetail;
      setCircle(data);

      if (data.leaderId === profile?.id) {
        const jrRes = await fetch(`${apiUrl}/circles/${circleId}/join-requests`);
        setJoinRequests(await jrRes.json());
      }
      if (profile?.id) {
        const pendingRes = await fetch(`${apiUrl}/circles/${circleId}/evaluations/pending?userId=${profile.id}`);
        setPendingEvals(await pendingRes.json());
      }
    } catch {
      setCircle(null);
    } finally {
      setLoading(false);
    }
  }, [circleId, profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function respondToRequest(requestId: string, action: "approve" | "decline") {
    if (!profile?.id) return;
    await fetch(`${getApiUrl()}/circles/${circleId}/join-requests/${requestId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, respondedBy: profile.id }),
    });
    load();
  }

  async function createSession() {
    if (!sessionLessonId.trim()) return;
    setSavingSession(true);
    try {
      await fetch(`${getApiUrl()}/circles/${circleId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: sessionLessonId.trim(), createdBy: profile?.id }),
      });
      setSessionModalOpen(false);
      setSessionLessonId("");
      load();
    } catch {
      Alert.alert("Couldn't create session", "Please try again.");
    } finally {
      setSavingSession(false);
    }
  }

  async function submitEvaluation(evalItem: PendingEvaluation, decision: "approved" | "needs_revision") {
    if (!profile?.id) return;
    try {
      await fetch(`${getApiUrl()}/circles/${circleId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: evalItem.submissionId,
          evaluatorId: profile.id,
          submitterId: evalItem.submitterId,
          lessonId: evalItem.lessonId,
          decision,
          feedback: feedbackDrafts[evalItem.submissionId] ?? null,
        }),
      });
      setPendingEvals((prev) => prev.filter((e) => e.submissionId !== evalItem.submissionId));
    } catch {
      Alert.alert("Couldn't submit evaluation", "Please try again.");
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.errorText}>Circle not found.</Text>
      </View>
    );
  }

  const nextSession = circle.sessions.find((s) => s.sessionStatus === "scheduled");
  const pastSessions = circle.sessions.filter((s) => s.sessionStatus !== "scheduled");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle} numberOfLines={1}>{circle.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]} showsVerticalScrollIndicator={false}>
        {circle.description ? <Text style={styles.description}>{circle.description}</Text> : null}

        {pendingEvals.length > 0 && (
          <TouchableOpacity style={styles.reviewBanner} onPress={() => setReviewOpen(true)}>
            <Ionicons name="clipboard-outline" size={18} color={colors.upperRoomAmber} />
            <Text style={styles.reviewBannerText}>Review Submissions ({pendingEvals.length})</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.upperRoomAmber} />
          </TouchableOpacity>
        )}

        {isLeader && joinRequests.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Join Requests</Text>
            {joinRequests.map((r) => (
              <View key={r.id} style={styles.requestRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{r.userName}</Text>
                  {r.message ? <Text style={styles.requestMessage}>{r.message}</Text> : null}
                </View>
                <TouchableOpacity style={styles.approveBtn} onPress={() => respondToRequest(r.id, "approve")}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.declineBtn} onPress={() => respondToRequest(r.id, "decline")}>
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionHeading}>Members ({circle.members.length})</Text>
        {circle.members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>{m.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>
            {m.role === "leader" && (
              <View style={styles.leaderPill}><Text style={styles.leaderPillText}>Leader</Text></View>
            )}
          </View>
        ))}

        <Text style={styles.sectionHeading}>Sessions</Text>
        {nextSession ? (
          <View style={styles.sessionCard}>
            <Ionicons name="calendar-outline" size={16} color={colors.accentGreen} />
            <Text style={styles.sessionText}>
              {nextSession.scheduledAt ? `Scheduled ${new Date(nextSession.scheduledAt).toLocaleDateString()}` : "Scheduled — date TBD"}
            </Text>
          </View>
        ) : (
          <Text style={styles.emptyMuted}>No upcoming session scheduled.</Text>
        )}
        {isLeader && (
          <TouchableOpacity style={styles.newSessionBtn} onPress={() => setSessionModalOpen(true)}>
            <Ionicons name="add" size={16} color={colors.accentGreen} />
            <Text style={styles.newSessionBtnText}>Schedule Session</Text>
          </TouchableOpacity>
        )}
        {pastSessions.length > 0 && (
          <View style={{ marginTop: 12 }}>
            {pastSessions.map((s) => (
              <View key={s.id} style={styles.pastSessionRow}>
                <Ionicons name={s.sessionStatus === "completed" ? "checkmark-circle" : "close-circle"} size={14} color={s.sessionStatus === "completed" ? colors.accentGreen : colors.textMuted} />
                <Text style={styles.pastSessionText}>
                  {s.completedAt ? new Date(s.completedAt).toLocaleDateString() : "Missed"} — {s.sessionStatus}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Review Submissions modal */}
      <Modal visible={reviewOpen} animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.headerBar}>
            <TouchableOpacity onPress={() => setReviewOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={colors.textDark} />
            </TouchableOpacity>
            <Text style={styles.headerBarTitle}>Review Submissions</Text>
            <View style={{ width: 22 }} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            {pendingEvals.length === 0 ? (
              <Text style={styles.emptyMuted}>Nothing waiting on you right now.</Text>
            ) : (
              pendingEvals.map((e) => (
                <View key={e.submissionId} style={styles.evalCard}>
                  <Text style={styles.evalSubmitter}>{e.submitterName}</Text>
                  <Text style={styles.evalContent} numberOfLines={6}>{e.content}</Text>
                  <Text style={styles.evalConsensus}>{e.evaluationsSoFar} of 2 evaluations so far</Text>
                  <TextInput
                    style={styles.feedbackInput}
                    placeholder="Optional feedback"
                    placeholderTextColor={colors.textMuted}
                    value={feedbackDrafts[e.submissionId] ?? ""}
                    onChangeText={(v) => setFeedbackDrafts((prev) => ({ ...prev, [e.submissionId]: v }))}
                    multiline
                  />
                  <View style={styles.evalActionsRow}>
                    <TouchableOpacity style={styles.approveEvalBtn} onPress={() => submitEvaluation(e, "approved")}>
                      <Text style={styles.approveEvalBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.reviseEvalBtn} onPress={() => submitEvaluation(e, "needs_revision")}>
                      <Text style={styles.reviseEvalBtnText}>Needs Revision</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Create session modal */}
      <Modal visible={sessionModalOpen} animationType="fade" transparent onRequestClose={() => setSessionModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Schedule Session</Text>
            <Text style={styles.fieldLabel}>Lesson ID</Text>
            <TextInput style={styles.input} value={sessionLessonId} onChangeText={setSessionLessonId} placeholder="Lesson ID for this session" placeholderTextColor={colors.textMuted} />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSessionModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={createSession} disabled={savingSession}>
                {savingSession ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>Schedule</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    scroll: { padding: 20 },
    errorText: { fontSize: 15, color: c.textMuted, fontFamily: "Inter_400Regular" },
    description: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 16 },
    reviewBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(224,164,65,0.12)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)", borderRadius: 12, padding: 14, marginBottom: 16 },
    reviewBannerText: { flex: 1, fontSize: 13, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    requestRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8 },
    requestName: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    requestMessage: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    approveBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    declineBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    memberAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
    memberAvatarText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    memberName: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    leaderPill: { backgroundColor: "rgba(224,164,65,0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    leaderPillText: { fontSize: 10, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    sessionCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14 },
    sessionText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    emptyMuted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    newSessionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
    newSessionBtnText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    pastSessionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    pastSessionText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    evalCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 14 },
    evalSubmitter: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    evalContent: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 19 },
    evalConsensus: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    feedbackInput: { backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 10, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10, minHeight: 50 },
    evalActionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    approveEvalBtn: { flex: 1, backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
    approveEvalBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    reviseEvalBtn: { flex: 1, borderWidth: 1, borderColor: "#C0392B", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
    reviseEvalBtnText: { color: "#C0392B", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
    modalBox: { width: "85%", backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 4 },
    modalTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 6, fontFamily: "Inter_600SemiBold" },
    input: { backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 18 },
    modalCancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    modalCancelText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    modalSaveBtn: { flex: 1, backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    modalSaveText: { fontSize: 14, color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
