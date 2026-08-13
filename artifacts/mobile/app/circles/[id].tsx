import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { VerificationBadge } from "@/components/VerificationBadge";

interface CircleMember { id: string; userId: string; role: string; status: string; name: string; avatarUrl: string | null; username: string | null; isVerified: boolean }
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
  const [startingSession, setStartingSession] = useState(false);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPreview, setAddPreview] = useState<{ userId: string; fullName: string } | null>(null);
  const [addSearching, setAddSearching] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferUsername, setTransferUsername] = useState("");
  const [transferring, setTransferring] = useState(false);

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

  async function startSession() {
    if (!profile?.id || !circle) return;
    if (!circle.currentLessonId) {
      Alert.alert("No lesson set", "This circle doesn't have a current lesson assigned yet.");
      return;
    }
    setStartingSession(true);
    try {
      const res = await fetch(`${getApiUrl()}/circles/${circleId}/start-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedBy: profile.id }),
      });
      if (!res.ok) throw new Error("start-session failed");
      const { channelName } = (await res.json()) as { channelName: string; sessionId: string };
      router.push({ pathname: "/call/group" as any, params: { circleId: circleId as string, channelName } });
    } catch {
      Alert.alert("Couldn't start session", "Please try again.");
    } finally {
      setStartingSession(false);
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

  async function searchAddMember() {
    const clean = addUsername.trim().replace(/^@/, "");
    if (!clean) return;
    setAddSearching(true);
    setAddError(null);
    setAddPreview(null);
    try {
      const res = await fetch(`${getApiUrl()}/profiles/username/${encodeURIComponent(clean)}`);
      if (!res.ok) { setAddError(`No account found for @${clean}`); return; }
      const data = await res.json();
      setAddPreview({ userId: data.userId, fullName: data.fullName ?? `@${data.username}` });
    } catch {
      setAddError("Couldn't search right now. Please try again.");
    } finally {
      setAddSearching(false);
    }
  }

  async function confirmAddMember() {
    if (!profile?.id || !addUsername.trim()) return;
    setAddingMember(true);
    try {
      const res = await fetch(`${getApiUrl()}/circles/${circleId}/members/by-username`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: addUsername.trim().replace(/^@/, ""), addedBy: profile.id }),
      });
      if (!res.ok) { const body = await res.json(); Alert.alert("Couldn't add member", body.error ?? "Please try again."); return; }
      setAddMemberOpen(false);
      setAddUsername("");
      setAddPreview(null);
      load();
    } finally {
      setAddingMember(false);
    }
  }

  function memberActionSheet(member: CircleMember) {
    if (!isLeader || member.userId === profile?.id) return;
    Alert.alert(member.username ? `@${member.username}` : member.name, undefined, [
      {
        text: member.role === "co_leader" ? "Remove Co-Leader" : "Make Co-Leader",
        onPress: () => setMemberRole(member, member.role === "co_leader" ? "member" : "co_leader"),
      },
      { text: "Remove from Circle", style: "destructive", onPress: () => confirmRemoveMember(member) },
      ...(member.username ? [{ text: "View Profile", onPress: () => router.push(`/profile/${member.username}` as any) }] : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  async function setMemberRole(member: CircleMember, role: "co_leader" | "member") {
    if (!profile?.id) return;
    await fetch(`${getApiUrl()}/circles/${circleId}/members/${member.userId}/role`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, changedBy: profile.id }),
    });
    load();
  }

  function confirmRemoveMember(member: CircleMember) {
    Alert.alert(
      `Remove ${member.username ? `@${member.username}` : member.name}?`,
      "They will be notified.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive", onPress: async () => {
            if (!profile?.id) return;
            await fetch(`${getApiUrl()}/circles/${circleId}/members/${member.userId}`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ removedBy: profile.id }),
            });
            load();
          },
        },
      ]
    );
  }

  async function handleTransferLeadership() {
    if (!profile?.id || !transferUsername.trim()) return;
    setTransferring(true);
    try {
      const clean = transferUsername.trim().replace(/^@/, "");
      const target = circle?.members.find((m) => m.username?.toLowerCase() === clean.toLowerCase());
      if (!target) { Alert.alert("Not found", `@${clean} isn't an active member of this circle.`); return; }
      const res = await fetch(`${getApiUrl()}/circles/${circleId}/transfer-leadership`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLeaderId: target.userId, currentLeaderId: profile.id }),
      });
      if (!res.ok) { const body = await res.json(); Alert.alert("Couldn't transfer leadership", body.error ?? "Please try again."); return; }
      const body = await res.json();
      Alert.alert("Leadership transferred", `${body.newLeaderName} is now the circle leader. You are now a member.`);
      setTransferOpen(false);
      setTransferUsername("");
      load();
    } finally {
      setTransferring(false);
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

        {isLeader && (
          <TouchableOpacity style={styles.startSessionBtn} onPress={startSession} disabled={startingSession}>
            {startingSession ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="videocam" size={18} color="#fff" />
                <Text style={styles.startSessionBtnText}>Start Session</Text>
              </>
            )}
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

        <View style={styles.membersHeaderRow}>
          <Text style={styles.sectionHeading}>Members ({circle.members.length})</Text>
          {isLeader && (
            <TouchableOpacity onPress={() => setTransferOpen(true)}>
              <Text style={styles.transferLink}>Transfer Leadership</Text>
            </TouchableOpacity>
          )}
        </View>
        {circle.members.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={styles.memberRow}
            activeOpacity={isLeader && m.userId !== profile?.id ? 0.6 : 1}
            onLongPress={() => memberActionSheet(m)}
            onPress={() => m.username && router.push(`/profile/${m.username}` as any)}
          >
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>{m.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.memberUsername} numberOfLines={1}>{m.username ? `@${m.username}` : m.name}</Text>
                <VerificationBadge isVerified={m.isVerified} username={m.username} size="small" />
              </View>
              {m.username && <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>}
            </View>
            {m.role === "leader" && (
              <View style={styles.leaderPill}><Text style={styles.leaderPillText}>Leader</Text></View>
            )}
            {m.role === "co_leader" && (
              <View style={styles.coLeaderPill}><Text style={styles.leaderPillText}>Co-Leader</Text></View>
            )}
          </TouchableOpacity>
        ))}

        {isLeader && (
          <TouchableOpacity style={styles.addMemberBtn} onPress={() => { setAddMemberOpen(true); setAddUsername(""); setAddPreview(null); setAddError(null); }}>
            <Ionicons name="person-add-outline" size={16} color={colors.accentGreen} />
            <Text style={styles.addMemberBtnText}>Add a member by username</Text>
          </TouchableOpacity>
        )}

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

      {/* Add member by username modal */}
      <Modal visible={addMemberOpen} animationType="fade" transparent onRequestClose={() => setAddMemberOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Add a member by username</Text>
            <View style={styles.usernameSearchRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={addUsername}
                onChangeText={(v) => { setAddUsername(v); setAddPreview(null); setAddError(null); }}
                placeholder="@username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={searchAddMember}
              />
              <TouchableOpacity style={styles.usernameSearchBtn} onPress={searchAddMember} disabled={addSearching}>
                {addSearching ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
            {addError && <Text style={styles.addErrorText}>{addError}</Text>}
            {addPreview && <Text style={styles.addPreviewText}>@{addUsername.trim().replace(/^@/, "")} — {addPreview.fullName}</Text>}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAddMemberOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={confirmAddMember} disabled={!addPreview || addingMember}>
                {addingMember ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>Add to Circle</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Transfer leadership modal */}
      <Modal visible={transferOpen} animationType="fade" transparent onRequestClose={() => setTransferOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Transfer Leadership</Text>
            <Text style={styles.fieldLabel}>New leader's username (must already be a member)</Text>
            <TextInput
              style={styles.input}
              value={transferUsername}
              onChangeText={setTransferUsername}
              placeholder="@username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setTransferOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleTransferLeadership} disabled={!transferUsername.trim() || transferring}>
                {transferring ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>Transfer</Text>}
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
    startSessionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accentGreen, borderRadius: 14, paddingVertical: 14, marginBottom: 16 },
    startSessionBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    reviewBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(224,164,65,0.12)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)", borderRadius: 12, padding: 14, marginBottom: 16 },
    reviewBannerText: { flex: 1, fontSize: 13, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    requestRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8 },
    requestName: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    requestMessage: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    approveBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    declineBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    membersHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
    transferLink: { fontSize: 11, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    memberAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
    memberAvatarText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    memberUsername: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberName: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    leaderPill: { backgroundColor: "rgba(224,164,65,0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    coLeaderPill: { backgroundColor: "rgba(29,158,117,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    leaderPillText: { fontSize: 10, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    addMemberBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 11, marginTop: 12 },
    addMemberBtnText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    usernameSearchRow: { flexDirection: "row", gap: 8 },
    usernameSearchBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    addErrorText: { fontSize: 12, color: "#C0392B", marginTop: 8, fontFamily: "Inter_400Regular" },
    addPreviewText: { fontSize: 13, color: c.textDark, marginTop: 8, fontFamily: "Inter_500Medium" },
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
