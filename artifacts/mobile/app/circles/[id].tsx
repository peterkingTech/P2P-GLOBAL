import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { apiFetch } from "@/lib/apiClient";
import { VerificationBadge } from "@/components/VerificationBadge";
import { Avatar } from "@/components/Avatar";
import { QrShareSheet } from "@/components/qr/QrShareSheet";
import { circleQr } from "@/lib/qrLinks";
import { AppButton } from "@/components/ui";
import { showAlert, confirmAction } from "@/lib/alerts";

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
  // Active members can show the Circle's QR. Everyone else signed in sees the
  // same "Request to Join" as Find a Circle: the leader still approves.
  const isMember = !!profile?.id && !!circle?.members?.some((m) => m.userId === profile.id);
  const [qrOpen, setQrOpen] = useState(false);
  const [joinState, setJoinState] = useState<"idle" | "sending" | "sent">("idle");

  async function requestToJoin() {
    if (!profile?.id || !circleId) return;
    setJoinState("sending");
    try {
      // Same request as app/circles/discover.tsx. Signed: the server checks
      // the request is really from this person.
      const res = await apiFetch(`/circles/${circleId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setJoinState("sent");
    } catch {
      setJoinState("idle");
      showAlert("Couldn't send request", "Please try again.");
    }
  }

  const load = useCallback(async () => {
    if (!circleId) return;
    setLoading(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/circles/${circleId}`);
      // A removed or mistyped Circle (e.g. from an old QR code) is a 404 with
      // an error body: show "not found", never a half-rendered Circle.
      if (!res.ok) { setCircle(null); return; }
      const data = (await res.json()) as CircleDetail;
      setCircle(data);

      if (data.leaderId === profile?.id) {
        const jrRes = await apiFetch(`/circles/${circleId}/join-requests`);
        setJoinRequests(jrRes.ok ? await jrRes.json() : []);
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
    const res = await apiFetch(`/circles/${circleId}/join-requests/${requestId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, respondedBy: profile.id }),
    }).catch(() => null);
    if (!res?.ok) showAlert("Couldn't update the request", "Please try again.");
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
      showAlert("Couldn't create session", "Please try again.");
    } finally {
      setSavingSession(false);
    }
  }

  async function startSession() {
    if (!profile?.id || !circle) return;
    if (!circle.currentLessonId) {
      showAlert("No lesson set", "This circle doesn't have a current lesson assigned yet.");
      return;
    }
    setStartingSession(true);
    try {
      // Stage 25D-B — the server now derives caller identity exclusively
      // from verifyCaller(req) (a real session Bearer token), not this
      // startedBy field. apiFetch attaches that token the same way
      // every other authenticated call in this app already does; startedBy
      // is kept only because the request needs a JSON body at all, never
      // trusted by the server for authentication.
      const res = await apiFetch(`/circles/${circleId}/start-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedBy: profile.id }),
      });
      if (!res.ok) throw new Error("start-session failed");
      const { channelName } = (await res.json()) as { channelName: string; sessionId: string };
      router.push({ pathname: "/call/group" as any, params: { circleId: circleId as string, channelName } });
    } catch {
      showAlert("Couldn't start session", "Please try again.");
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
      showAlert("Couldn't submit evaluation", "Please try again.");
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
      if (!res.ok) { const body = await res.json(); showAlert("Couldn't add member", body.error ?? "Please try again."); return; }
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
    confirmAction(`Remove ${member.username ? `@${member.username}` : member.name}?`, "They will be notified.", async () => {
            if (!profile?.id) return;
            await fetch(`${getApiUrl()}/circles/${circleId}/members/${member.userId}`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ removedBy: profile.id }),
            });
            load();
          }, { confirmLabel: "Remove", destructive: true });
  }

  async function handleTransferLeadership() {
    if (!profile?.id || !transferUsername.trim()) return;
    setTransferring(true);
    try {
      const clean = transferUsername.trim().replace(/^@/, "");
      const target = circle?.members.find((m) => m.username?.toLowerCase() === clean.toLowerCase());
      if (!target) { showAlert("Not found", `@${clean} isn't an active member of this circle.`); return; }
      const res = await fetch(`${getApiUrl()}/circles/${circleId}/transfer-leadership`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLeaderId: target.userId, currentLeaderId: profile.id }),
      });
      if (!res.ok) { const body = await res.json(); showAlert("Couldn't transfer leadership", body.error ?? "Please try again."); return; }
      const body = await res.json();
      showAlert("Leadership transferred", `${body.newLeaderName} is now the circle leader. You are now a member.`);
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
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorText}>This Circle isn't available.</Text>
        <AppButton label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/circles" as any))} variant="outline" style={{ marginTop: 16 }} />
      </View>
    );
  }

  const nextSession = circle.sessions.find((s) => s.sessionStatus === "scheduled");
  const pastSessions = circle.sessions.filter((s) => s.sessionStatus !== "scheduled");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle} numberOfLines={1}>{circle.name}</Text>
        {isMember ? (
          <TouchableOpacity onPress={() => setQrOpen(true)} hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }} accessibilityRole="button" accessibilityLabel="Show Circle QR code">
            <Ionicons name="qr-code-outline" size={22} color={colors.textDark} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>
      <QrShareSheet spec={qrOpen ? circleQr({ id: circle.id, name: circle.name }) : null} visible={qrOpen} onClose={() => setQrOpen(false)} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]} showsVerticalScrollIndicator={false}>
        {circle.description ? <Text style={styles.description}>{circle.description}</Text> : null}

        {profile?.id && !isMember ? (
          <View style={styles.joinCard}>
            {joinState === "sent" ? (
              <Text style={styles.joinNote}>Request sent. The Circle leader will review it.</Text>
            ) : (
              <>
                <AppButton label="Request to Join" onPress={requestToJoin} disabled={joinState === "sending"} loading={joinState === "sending"} style={{ marginBottom: 16 }} />
                <Text style={styles.joinNote}>The Circle leader reviews every request.</Text>
              </>
            )}
          </View>
        ) : null}

        {pendingEvals.length > 0 && (
          <TouchableOpacity accessibilityRole="button" style={styles.reviewBanner} onPress={() => setReviewOpen(true)}>
            <Ionicons name="clipboard-outline" size={18} color={colors.upperRoomAmber} />
            <Text style={styles.reviewBannerText}>Review Submissions ({pendingEvals.length})</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.upperRoomAmber} />
          </TouchableOpacity>
        )}

        {isLeader && (
          <AppButton label="Start Session" onPress={startSession} icon="videocam" disabled={startingSession} loading={startingSession} style={{ marginBottom: 16 }} />
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm" hitSlop={10} style={styles.approveBtn} onPress={() => respondToRequest(r.id, "approve")}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} style={styles.declineBtn} onPress={() => respondToRequest(r.id, "decline")}>
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        <View style={styles.membersHeaderRow}>
          <Text style={styles.sectionHeading}>Members ({circle.members.length})</Text>
          {isLeader && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setTransferOpen(true)}>
              <Text style={styles.transferLink}>Transfer Leadership</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.membersCard}>
          {circle.members.map((m, i) => (
            <TouchableOpacity accessibilityRole="button"
              key={m.id}
              style={[styles.memberRow, i === circle.members.length - 1 && styles.memberRowLast]}
              activeOpacity={isLeader && m.userId !== profile?.id ? 0.6 : 1}
              onLongPress={() => memberActionSheet(m)}
              onPress={() => m.username && router.push(`/profile/${m.username}` as any)}
            >
              <Avatar photoUrl={m.avatarUrl} name={m.name} size={34} />
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
        </View>

        {isLeader && (
          <AppButton label="Add a member by username" onPress={() => { setAddMemberOpen(true); setAddUsername(""); setAddPreview(null); setAddError(null); }} variant="outline" icon="person-add-outline" style={{ marginTop: 12 }} />
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
          <AppButton label="Schedule Session" onPress={() => setSessionModalOpen(true)} variant="outline" icon="add" style={{ marginTop: 10 }} />
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
            <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" onPress={() => setReviewOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                    <AppButton label="Approve" onPress={() => submitEvaluation(e, "approved")} style={{ flex: 1 }} />
                    <AppButton label="Needs Revision" onPress={() => submitEvaluation(e, "needs_revision")} variant="outline" style={{ flex: 1 }} />
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
              <AppButton label="Cancel" onPress={() => setSessionModalOpen(false)} variant="outline" style={{ flex: 1 }} />
              <AppButton label="Schedule" onPress={createSession} disabled={savingSession} loading={savingSession} style={{ flex: 1 }} />
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
              <TouchableOpacity accessibilityRole="button" style={styles.usernameSearchBtn} onPress={searchAddMember} disabled={addSearching}>
                {addSearching ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
            {addError && <Text style={styles.addErrorText}>{addError}</Text>}
            {addPreview && <Text style={styles.addPreviewText}>@{addUsername.trim().replace(/^@/, "")} — {addPreview.fullName}</Text>}
            <View style={styles.modalBtnRow}>
              <AppButton label="Cancel" onPress={() => setAddMemberOpen(false)} variant="outline" style={{ flex: 1 }} />
              <AppButton label="Add to Circle" onPress={confirmAddMember} disabled={!addPreview || addingMember} loading={addingMember} style={{ flex: 1 }} />
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
              <AppButton label="Cancel" onPress={() => setTransferOpen(false)} variant="outline" style={{ flex: 1 }} />
              <AppButton label="Transfer" onPress={handleTransferLeadership} disabled={!transferUsername.trim() || transferring} loading={transferring} style={{ flex: 1 }} />
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
    joinCard: { marginBottom: 16 },
    joinNote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -8 },
    description: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 16 },
    reviewBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(224,164,65,0.12)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)", borderRadius: 12, padding: 14, marginBottom: 16 },
    reviewBannerText: { flex: 1, fontSize: 13, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    requestRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8 },
    requestName: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    requestMessage: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    approveBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    declineBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    membersHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 10 },
    transferLink: { fontSize: 11, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    // Rectangular card wrapping the whole roster, matching sessionCard/
    // evalCard's treatment elsewhere on this screen — rows inside stay a
    // plain list (divided by a hairline), not individually-boxed cards.
    membersCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, paddingHorizontal: 12 },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    memberRowLast: { borderBottomWidth: 0 },
    memberAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
    memberAvatarText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    memberUsername: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberName: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    leaderPill: { backgroundColor: "rgba(224,164,65,0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    coLeaderPill: { backgroundColor: "rgba(29,158,117,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    leaderPillText: { fontSize: 10, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
    usernameSearchRow: { flexDirection: "row", gap: 8 },
    usernameSearchBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    addErrorText: { fontSize: 12, color: "#C0392B", marginTop: 8, fontFamily: "Inter_400Regular" },
    addPreviewText: { fontSize: 13, color: c.textDark, marginTop: 8, fontFamily: "Inter_500Medium" },
    sessionCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14 },
    sessionText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    emptyMuted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    pastSessionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    pastSessionText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    evalCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 14 },
    evalSubmitter: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    evalContent: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 19 },
    evalConsensus: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    feedbackInput: { backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 10, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10, minHeight: 50 },
    evalActionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },

    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
    modalBox: { width: "85%", backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 4, maxWidth: 560 },
    modalTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 6, fontFamily: "Inter_600SemiBold" },
    input: { backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 18 },
    modalCancelText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    modalSaveText: { fontSize: 14, color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
