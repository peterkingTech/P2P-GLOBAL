import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView } from "react-native-agora";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";
import { getFlagEmoji } from "@/lib/countryGeo";

interface CircleMember { id: string; userId: string; role: string; status: string; name: string; avatarUrl: string | null; country?: string | null }
interface CircleSession { id: string; lessonId: string; scheduledAt: string | null; completedAt: string | null; sessionStatus: string; notes: string | null }
interface CircleDetail {
  id: string; name: string; description: string | null; leaderId: string; currentLessonId: string | null;
  status: string; members: CircleMember[]; sessions: CircleSession[];
}
interface Question { id: string; question: string }

type SignalType = "mute_all" | "remove_user" | "next_question" | "mark_discussed" | "hand_raised" | "hand_acknowledged" | "pass_host" | "session_ending";
interface Signal { type: SignalType; from: string; data?: any }

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function GroupCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ circleId: string; channelName: string }>();

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [inCallHostId, setInCallHostId] = useState<string | null>(null);
  const isHost = inCallHostId === profile?.id;

  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHandUserIds, setRaisedHandUserIds] = useState<Set<string>>(new Set());
  const [speakingUids, setSpeakingUids] = useState<Set<number>>(new Set());

  const [questions, setQuestions] = useState<Question[]>([]);
  const [lessonTitle, setLessonTitle] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [discussedIds, setDiscussedIds] = useState<Set<string>>(new Set());
  const [lessonSheetOpen, setLessonSheetOpen] = useState(false);

  const [completionOpen, setCompletionOpen] = useState(false);
  const [sessionNotes, setSessionNotes] = useState("");
  const [ending, setEnding] = useState(false);
  const startedAtRef = useRef(Date.now());

  // uid <-> member lookups, built once the roster is known — Agora only
  // gives us back the numeric uid on join/leave, never the real user id.
  const uidToMember = useMemo(() => {
    const map = new Map<number, CircleMember>();
    circle?.members.forEach((m) => map.set(uidFromUserId(m.userId), m));
    return map;
  }, [circle]);

  const load = useCallback(async () => {
    if (!params.circleId) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/circles/${params.circleId}`);
      const data = (await res.json()) as CircleDetail;
      setCircle(data);
      setInCallHostId((prev) => prev ?? data.leaderId);

      if (data.currentLessonId) {
        const { data: lesson } = await supabase.from("p2p_lessons").select("title").eq("id", data.currentLessonId).maybeSingle();
        setLessonTitle(lesson?.title ?? "Current Lesson");
        const { data: qs } = await supabase
          .from("p2p_reflection_questions").select("id,question").eq("lesson_id", data.currentLessonId).order("display_order");
        setQuestions((qs ?? []) as Question[]);
      }
    } catch {
      setCircle(null);
    } finally {
      setLoading(false);
    }
  }, [params.circleId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getToken(params.channelName, myUid);
        if (!cancelled) setToken(t);
      } catch (e: any) {
        showAlert("Couldn't join", e.message ?? "Please try again.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelName]);

  // ── Signaling channel — host controls, raise-hand, and question sync all
  // ride on a Supabase realtime broadcast channel alongside the Agora media
  // connection. Agora RTC gives no participant authority over another
  // participant's stream (that needs their own separate RTM product), so
  // "mute all" / "remove" are cooperative signals the receiving client acts
  // on itself, not something the sender can force directly. ──
  const signalChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const sendSignal = useCallback((type: SignalType, data?: any) => {
    signalChannelRef.current?.send({ type: "broadcast", event: "signal", payload: { type, from: profile?.id, data } as Signal });
  }, [profile?.id]);

  const handleLeave = useCallback(async () => {
    if (params.circleId) {
      // Best-effort — not gated on success, the user is leaving either way.
      void 0;
    }
    if (router.canGoBack()) router.back();
    else router.replace(`/circles/${params.circleId}` as any);
  }, [params.circleId, router]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel(`circle_call_${params.channelName}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, ({ payload }: { payload: Signal }) => {
      switch (payload.type) {
        case "mute_all":
          setMuted(true);
          engineRef.current?.muteLocalAudioStream(true);
          break;
        case "remove_user":
          if (payload.data?.userId === profile.id) {
            showAlert("Removed", "The host removed you from this session.");
            handleLeave();
          }
          break;
        case "next_question":
          setQuestionIndex(payload.data?.index ?? 0);
          break;
        case "mark_discussed":
          if (payload.data?.questionId) setDiscussedIds((prev) => new Set(prev).add(payload.data.questionId));
          break;
        case "hand_raised":
          if (payload.data?.userId) setRaisedHandUserIds((prev) => new Set(prev).add(payload.data.userId));
          break;
        case "hand_acknowledged":
          if (payload.data?.userId) setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(payload.data.userId); return n; });
          break;
        case "pass_host":
          if (payload.data?.newHostId) setInCallHostId(payload.data.newHostId);
          break;
        case "session_ending":
          showAlert("Session ended", "The leader has ended this session.");
          handleLeave();
          break;
      }
    }).subscribe();
    signalChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); signalChannelRef.current = null; };
  }, [profile?.id, params.channelName, handleLeave]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: true,
    eventHandler: {
      onUserJoined: (_c, uid) => setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid])),
      onUserOffline: (_c, uid) => setRemoteUids((prev) => prev.filter((u) => u !== uid)),
      onAudioVolumeIndication: (_c, speakers) => {
        const loud = new Set((speakers ?? []).filter((s) => (s.volume ?? 0) > 40).map((s) => s.uid ?? 0));
        setSpeakingUids(loud);
      },
    },
  });

  useEffect(() => {
    engineRef.current?.enableAudioVolumeIndication(500, 3, true);
  }, [engineRef, token]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }
  function toggleCamera() {
    const next = !cameraOn;
    setCameraOn(next);
    engineRef.current?.enableLocalVideo(next);
  }
  function toggleRaiseHand() {
    const next = !handRaised;
    setHandRaised(next);
    if (next) sendSignal("hand_raised", { userId: profile?.id });
  }
  function acknowledgeHand(userId: string) {
    sendSignal("hand_acknowledged", { userId });
    setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(userId); return n; });
  }
  function muteAll() {
    sendSignal("mute_all");
    showAlert("Muted everyone", "All participants except you have been muted.");
  }
  function removeParticipant(member: CircleMember) {
    Alert.alert(`Remove ${member.name}?`, "They'll be disconnected from this session.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => sendSignal("remove_user", { userId: member.userId }) },
    ]);
  }
  function passHost(member: CircleMember) {
    Alert.alert(`Make ${member.name} the host?`, "They'll control questions and session settings for the rest of this call.", [
      { text: "Cancel", style: "cancel" },
      { text: "Pass Host", onPress: () => { sendSignal("pass_host", { newHostId: member.userId }); setInCallHostId(member.userId); } },
    ]);
  }
  function markDiscussed() {
    const q = questions[questionIndex];
    if (!q) return;
    setDiscussedIds((prev) => new Set(prev).add(q.id));
    sendSignal("mark_discussed", { questionId: q.id });
  }
  function nextQuestion() {
    const next = Math.min(questionIndex + 1, questions.length - 1);
    setQuestionIndex(next);
    sendSignal("next_question", { index: next });
  }

  async function handleCompleteSession() {
    setEnding(true);
    try {
      const scheduled = circle?.sessions.find((s) => s.lessonId === circle.currentLessonId && s.sessionStatus === "scheduled");
      if (scheduled) {
        const durationMin = Math.round((Date.now() - startedAtRef.current) / 60000);
        const summary = `Discussed ${discussedIds.size} of ${questions.length} questions · ${circle?.members.length ?? 0} present · ${durationMin}m\n\n${sessionNotes.trim()}`.trim();
        await fetch(`${getApiUrl()}/circles/${params.circleId}/sessions/${scheduled.id}/complete`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: summary }),
        });
      }
      sendSignal("session_ending");
      setCompletionOpen(false);
      if (router.canGoBack()) router.back();
      else router.replace(`/circles/${params.circleId}` as any);
    } catch {
      showAlert("Couldn't save session", "Please try again.");
    } finally {
      setEnding(false);
    }
  }

  if (loading || !circle) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const currentQuestion = questions[questionIndex] ?? null;
  const tiles = [
    { uid: 0, member: circle.members.find((m) => m.userId === profile?.id) ?? null, isSelf: true },
    ...remoteUids.map((uid) => ({ uid, member: uidToMember.get(uid) ?? null, isSelf: false })),
  ].slice(0, 8);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.topBarTitle} numberOfLines={1}>{circle.name}</Text>
          <Text style={styles.topBarSub}>{lessonTitle || "Group call"} · {tiles.length} participant{tiles.length === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.liveDot} />
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {tiles.map(({ uid, member, isSelf }) => {
          const speaking = speakingUids.has(uid);
          const isTileHost = member?.userId === inCallHostId;
          const handUp = member && raisedHandUserIds.has(member.userId);
          return (
            <TouchableOpacity
              key={uid}
              style={[styles.tile, speaking && styles.tileSpeaking]}
              onLongPress={() => { if (isHost && member && !isSelf) removeParticipant(member); }}
              activeOpacity={isHost && !isSelf ? 0.7 : 1}
            >
              {isSelf && cameraOn ? (
                <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} />
              ) : !isSelf ? (
                <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid }} />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.tileAvatarWrap]}>
                  <Ionicons name="person" size={36} color="rgba(255,255,255,0.4)" />
                </View>
              )}
              <View style={styles.tileFooter}>
                <Text style={styles.tileName} numberOfLines={1}>
                  {getFlagEmoji(member?.country)} {member?.name ?? "Someone"}{isSelf ? " (You)" : ""}
                </Text>
                <View style={styles.tileBadgeRow}>
                  {isTileHost && <Ionicons name="star" size={12} color="#B8860B" />}
                  {handUp && <Text style={styles.tileHandEmoji}>✋</Text>}
                </View>
              </View>
              {isHost && member && raisedHandUserIds.has(member.userId) && (
                <TouchableOpacity style={styles.ackHandBtn} onPress={() => acknowledgeHand(member.userId)}>
                  <Text style={{ fontSize: 12 }}>✋</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {currentQuestion && (
        <TouchableOpacity style={styles.questionBar} onPress={() => setLessonSheetOpen(true)} activeOpacity={0.85}>
          <Text style={styles.questionLabel}>CURRENT QUESTION</Text>
          <Text style={styles.questionText} numberOfLines={2}>"{currentQuestion.question}"</Text>
          {isHost && questionIndex < questions.length - 1 && (
            <TouchableOpacity style={styles.nextQBtn} onPress={nextQuestion}>
              <Text style={styles.nextQBtnText}>Next →</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      <View style={[styles.controlsRow, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Ionicons name={muted ? "mic-off" : "mic"} size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleCamera}>
          <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, handRaised && styles.controlBtnActive]} onPress={toggleRaiseHand}>
          <Text style={{ fontSize: 16 }}>✋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={() => setLessonSheetOpen(true)}>
          <Ionicons name="book" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.endBtn]}
          onPress={() => (isHost ? setCompletionOpen(true) : handleLeave())}
        >
          <Ionicons name="call" size={18} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </TouchableOpacity>
      </View>

      {isHost && (
        <View style={styles.hostBar}>
          <TouchableOpacity style={styles.hostBtn} onPress={muteAll}>
            <Text style={styles.hostBtnText}>Mute All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.hostBtn} onPress={() => setCompletionOpen(true)}>
            <Text style={styles.hostBtnText}>Complete Session</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Lesson sidebar */}
      <Modal visible={lessonSheetOpen} transparent animationType="slide" onRequestClose={() => setLessonSheetOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{lessonTitle}</Text>
              <TouchableOpacity onPress={() => setLessonSheetOpen(false)}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {questions.length === 0 ? (
                <Text style={styles.sheetEmpty}>No discussion questions for this lesson.</Text>
              ) : questions.map((q, i) => (
                <TouchableOpacity
                  key={q.id}
                  style={[styles.questionRow, i === questionIndex && styles.questionRowActive]}
                  onPress={() => isHost && (setQuestionIndex(i), sendSignal("next_question", { index: i }))}
                  disabled={!isHost}
                >
                  <Ionicons name={discussedIds.has(q.id) ? "checkmark-circle" : "ellipse-outline"} size={16} color={discussedIds.has(q.id) ? "#1D9E75" : "rgba(255,255,255,0.4)"} />
                  <Text style={styles.questionRowText}>{q.question}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {currentQuestion && (
              <TouchableOpacity style={styles.markDiscussedBtn} onPress={markDiscussed}>
                <Text style={styles.markDiscussedText}>Mark Discussed</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Session completion */}
      <Modal visible={completionOpen} transparent animationType="fade" onRequestClose={() => setCompletionOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <Text style={styles.sheetTitle}>Complete Session</Text>
            <Text style={styles.sheetEmpty}>
              {discussedIds.size} of {questions.length} questions discussed · {circle.members.length} present
            </Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Session notes (optional)"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={sessionNotes}
              onChangeText={setSessionNotes}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCompletionOpen(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCompleteSession} disabled={ending}>
                {ending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>End and Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  topBarTitle: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  topBarSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },

  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, gap: 8 },
  tile: {
    width: "48%", aspectRatio: 0.9, borderRadius: 14, backgroundColor: "#141F19", overflow: "hidden",
    borderWidth: 2, borderColor: "transparent",
  },
  tileSpeaking: { borderColor: "#1D9E75" },
  tileAvatarWrap: { alignItems: "center", justifyContent: "center", backgroundColor: "#1A241E" },
  tileFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 6,
  },
  tileName: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  tileBadgeRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  tileHandEmoji: { fontSize: 12 },
  ackHandBtn: { position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, padding: 4 },

  questionBar: { marginHorizontal: 12, marginBottom: 8, backgroundColor: "#141F19", borderRadius: 12, padding: 12, gap: 4 },
  questionLabel: { color: "#1D9E75", fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  questionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  nextQBtn: { alignSelf: "flex-end", marginTop: 4 },
  nextQBtnText: { color: "#1D9E75", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  controlsRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 16, paddingTop: 8 },
  controlBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  controlBtnActive: { backgroundColor: "#B8860B" },
  endBtn: { backgroundColor: "#DC2626" },

  hostBar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 10, justifyContent: "center" },
  hostBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  hostBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetEmpty: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular" },
  questionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  questionRowActive: { backgroundColor: "rgba(29,158,117,0.1)" },
  questionRowText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  markDiscussedBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 6 },
  markDiscussedText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  notesInput: {
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, color: "#fff",
    fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 70,
  },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn: { flex: 1, backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});