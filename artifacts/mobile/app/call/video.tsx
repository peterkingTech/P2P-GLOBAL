import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView, Platform, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView, QualityType, BackgroundSourceType, BackgroundBlurDegree, SegModelType } from "@/lib/agoraNative";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { useStudySession, StudyLessonMeta, StudySessionSummary as StudySummary, OtherParticipant } from "@/hooks/useStudySession";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";
import { resolveCallParticipants, CallParticipant } from "@/lib/callParticipants";
import { ParticipantGrid } from "@/components/call/ParticipantGrid";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import { StudyTogetherOverlay } from "@/components/study/StudyTogetherOverlay";
import { StudySessionSummary } from "@/components/study/StudySessionSummary";
import { AddPeopleSheet } from "@/components/call/AddPeopleSheet";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Caller side only — mirrors incoming.tsx's RING_TIMEOUT_MS (30s) on the
// recipient's screen. Without this, "Calling…" only ever ends via Agora
// connecting or a status UPDATE written by the recipient's own device (see
// the realtime watch effect below) — if the recipient's app never opens
// incoming.tsx (backgrounded, killed, or just never received the signal),
// the caller would otherwise wait indefinitely.
const NO_ANSWER_TIMEOUT_MS = 40000;

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    channelName: string; otherUserId: string; otherUserName?: string; callType?: CallType;
    isInitiator?: string; callId?: string; conversationId?: string; callLogId?: string;
    sessionId?: string; lessonId?: string;
    autoStudyLessonId?: string; autoStudyModuleId?: string; autoStudyLessonTitle?: string;
  }>();
  const isInitiator = params.isInitiator === "true";
  const markedInProgressRef = useRef(false);

  const [lessonSidebarVisible, setLessonSidebarVisible] = useState(false);
  const [sessionLessonTitle, setSessionLessonTitle] = useState("");
  const [sessionQuestions, setSessionQuestions] = useState<{ id: string; question: string }[]>([]);

  useEffect(() => {
    if (!params.lessonId) return;
    (async () => {
      const { data: lesson } = await supabase.from("p2p_lessons").select("title").eq("id", params.lessonId).maybeSingle();
      setSessionLessonTitle(lesson?.title ?? "This Session's Lesson");
      const { data: qs } = await supabase
        .from("p2p_reflection_questions").select("id,question").eq("lesson_id", params.lessonId).order("display_order");
      setSessionQuestions((qs ?? []) as { id: string; question: string }[]);
    })();
  }, [params.lessonId]);

  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  // Study Together C1 — remoteUid (singular) becomes remoteUids (array) so
  // the call layer can hold more than one other party. `remoteUid` is kept
  // as a derived single value for everything on the existing 1:1 render
  // path (fullscreen remote view, poor-connection fallback, etc.), so
  // that code is untouched when there's exactly one remote party.
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const remoteUid = remoteUids.length === 1 ? remoteUids[0] : null;
  const connected = remoteUids.length > 0;
  const [groupParticipants, setGroupParticipants] = useState<CallParticipant[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [blurOn, setBlurOn] = useState(false);
  const [poorConnection, setPoorConnection] = useState(false);
  const [videoAutoDisabled, setVideoAutoDisabled] = useState(false);
  const [callState, setCallState] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const poorQualityStreakRef = useRef(0);

  const [mode, setMode] = useState<"call" | "study">("call");
  const [chooseLessonOpen, setChooseLessonOpen] = useState(false);
  const [studySummary, setStudySummary] = useState<StudySummary | null>(null);
  const otherName = params.otherUserName || "Peer";
  // Study Together C3 — otherParticipants replaces the old single otherUserId
  // param, same generalization as audio.tsx. remoteUids.length <= 1 keeps
  // using the exact 1:1 route params (byte-identical to before C3).
  const studyOtherParticipants: OtherParticipant[] = remoteUids.length > 1
    ? groupParticipants.map((p) => ({ userId: p.userId, name: p.name }))
    : [{ userId: params.otherUserId, name: otherName }];
  const study = useStudySession(params.channelName, params.callLogId ?? "", studyOtherParticipants);
  const studyRef = useRef(study);
  studyRef.current = study;
  const groupParticipantsRef = useRef(groupParticipants);
  groupParticipantsRef.current = groupParticipants;
  const [autoStudyDismissed, setAutoStudyDismissed] = useState(false);
  const hasAutoStudy = !!(params.autoStudyLessonId && params.autoStudyModuleId);
  // Study Together C2 — Add People. Available once connected and while
  // there's room for at least one more (6 total, including self).
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const canAddPeople = callState === "connected" && remoteUids.length < 5;

  // Study Together C3 — mid-call join detection (spec §9), mirrors audio.tsx.
  useEffect(() => {
    if (remoteUids.length > 1 && !study.isActive) {
      void study.checkActiveStudy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteUids.length > 1, study.isActive]);

  function handleOpenStudy() {
    setChooseLessonOpen(true);
  }

  async function handleJoinGroupStudy() {
    const joined = await study.joinStudy();
    if (!joined) showAlert("Couldn't join study", "This study session may have just ended.");
  }

  useEffect(() => {
    if (study.isActive) setMode("study");
  }, [study.isActive]);

  function handleChooseLesson(lessonMeta: StudyLessonMeta) {
    setChooseLessonOpen(false);
    study.startStudy(lessonMeta);
  }

  function handleStartAutoStudy() {
    if (!params.autoStudyLessonId || !params.autoStudyModuleId) return;
    study.startStudy({ id: params.autoStudyLessonId, moduleId: params.autoStudyModuleId, title: params.autoStudyLessonTitle ?? "" });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getToken(params.channelName, myUid, profile?.id);
        if (!cancelled) { setToken(t); setCallState((s) => (s === "connecting" ? "ringing" : s)); }
      } catch {
        if (!cancelled) setCallState("ended");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelName]);

  const handleEndCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("ended");

    const durationSeconds = connectedAtRef.current ? Math.round((Date.now() - connectedAtRef.current) / 1000) : 0;
    const wasConnected = !!connectedAtRef.current;

    if (params.callLogId) {
      try {
        await fetch(`${getApiUrl()}/calls/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callLogId: params.callLogId,
            conversationId: params.conversationId || null,
            callType: "video",
            connected: wasConnected,
            durationSeconds,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages" as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.conversationId]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: true,
    eventHandler: {
      onUserJoined: (_connection, uid) => {
        connectedAtRef.current = Date.now();
        setCallState("connected");
        setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        if (params.sessionId && !markedInProgressRef.current) {
          markedInProgressRef.current = true;
          void fetch(`${getApiUrl()}/calls/sessions/${params.sessionId}/mark-in-progress`, { method: "POST" });
        }
      },
      // Study Together C1: ends only when the LAST remote participant
      // leaves — for an existing 1:1 call that's the same single moment
      // as before, preserving current behavior unchanged.
      onUserOffline: (_connection, uid) => {
        setRemoteUids((prev) => {
          const next = prev.filter((u) => u !== uid);
          if (next.length === 0) handleEndCall();
          return next;
        });
        // Study Together C4.7/C4.3 — report ANY departed study participant,
        // not just the leader, via refs since this handler is registered
        // once at mount (see useAgoraEngine.native.ts) and would otherwise
        // read stale state.
        const liveStudy = studyRef.current;
        if (liveStudy.isActive && liveStudy.isGroup) {
          const departed = groupParticipantsRef.current.find((p) => p.uid === uid);
          if (departed) {
            void liveStudy.reportParticipantDeparture(departed.userId);
          }
        }
      },
      onNetworkQuality: (_connection, uid, txQuality, rxQuality) => {
        if (uid !== 0) return; // only the local user's own uplink/downlink
        const worst = Math.max(txQuality, rxQuality);
        if (worst >= QualityType.QualityBad) {
          poorQualityStreakRef.current += 1;
        } else {
          poorQualityStreakRef.current = 0;
          if (poorConnection) setPoorConnection(false);
        }
        // A few consecutive bad samples (not just one blip) before reacting.
        if (poorQualityStreakRef.current >= 3 && !videoAutoDisabled) {
          setPoorConnection(true);
          setVideoAutoDisabled(true);
          setCameraOn(false);
          engineRef.current?.enableLocalVideo(false);
        }
      },
    },
  });

  useEffect(() => {
    if (!connectedAtRef.current) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [connected]);

  // Resolve real names for group calls only (>1 remote party) — the
  // existing 1:1 path keeps using otherUserId/otherUserName from route
  // params directly and never calls this.
  useEffect(() => {
    if (remoteUids.length <= 1) { setGroupParticipants([]); return; }
    let cancelled = false;
    resolveCallParticipants(params.channelName, remoteUids).then((list) => { if (!cancelled) setGroupParticipants(list); });
    return () => { cancelled = true; };
  }, [remoteUids, params.channelName]);

  useEffect(() => {
    if (!isInitiator || !params.callId || connected) return;
    const channel = supabase
      .channel(`p2p_call_watch_${params.callId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_incoming_calls", filter: `id=eq.${params.callId}` },
        (payload) => {
          const status = (payload.new as Record<string, unknown>).status as string;
          if (status === "declined" || status === "missed" || status === "cancelled") handleEndCall();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isInitiator, params.callId, connected, handleEndCall]);

  // Caller side only — if nobody answers within NO_ANSWER_TIMEOUT_MS, stop
  // waiting instead of leaving "Calling…" on screen forever.
  useEffect(() => {
    if (!isInitiator || connected) return;
    const timer = setTimeout(() => {
      showAlert("No answer", `${otherName} didn't pick up.`);
      handleEndCall();
    }, NO_ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInitiator, connected, handleEndCall, otherName]);

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
  function flipCamera() {
    engineRef.current?.switchCamera();
  }
  // Requires the Agora Segmentation Extension to be linked natively — the
  // JS/TS call below is always safe to make, but silently no-ops (non-zero
  // return code, no crash) if that extension isn't present in the build.
  function toggleBlur() {
    const next = !blurOn;
    setBlurOn(next);
    engineRef.current?.enableVirtualBackground(
      next,
      { background_source_type: BackgroundSourceType.BackgroundBlur, blur_degree: BackgroundBlurDegree.BlurDegreeHigh },
      { modelType: SegModelType.SegModelAi },
    );
  }

  const studyStripLabel = studyOtherParticipants.length <= 1
    ? otherName
    : studyOtherParticipants.length === 2
      ? `${studyOtherParticipants[0].name} & ${studyOtherParticipants[1].name}`
      : `${studyOtherParticipants[0].name} & ${studyOtherParticipants.length - 1} others`;

  const participantStrip = (
    <View style={styles.studyParticipantStrip}>
      <View style={styles.studyMiniTile}>
        {remoteUid !== null ? <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: remoteUid }} /> : <Ionicons name="person" size={16} color="rgba(255,255,255,0.5)" />}
      </View>
      {cameraOn && (
        <View style={styles.studyMiniTile}>
          <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} zOrderMediaOverlay />
        </View>
      )}
      <Text style={styles.studyMiniName} numberOfLines={1}>{studyStripLabel}</Text>
      <TouchableOpacity style={styles.studyMiniBtn} onPress={toggleMute}>
        <Ionicons name={muted ? "mic-off" : "mic"} size={16} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.studyMiniBtn} onPress={toggleCamera}>
        <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={16} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.studyMiniBtn, styles.endBtn]} onPress={handleEndCall}>
        <Ionicons name="call" size={16} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
      </TouchableOpacity>
    </View>
  );

  if (mode === "study") {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <StudyTogetherOverlay
          session={study}
          myId={profile?.id ?? ""}
          myName={profile?.displayName || "Me"}
          otherParticipants={studyOtherParticipants}
          participantStrip={participantStrip}
          onReturnToCall={() => setMode("call")}
          onSessionEnded={(summary) => setStudySummary(summary)}
        />
        <StudySessionSummary
          visible={!!studySummary}
          summary={studySummary}
          otherUserName={otherName}
          onContinueCall={() => { setStudySummary(null); setMode("call"); }}
          onEndCall={() => { setStudySummary(null); handleEndCall(); }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {remoteUids.length > 1 ? (
        // Study Together C1 group-calling foundation — minimal reusable
        // grid, no group Study Together content here. The 1:1 fullscreen
        // + PIP layout below is completely untouched for exactly one
        // remote party.
        <ParticipantGrid
          tiles={[
            { uid: 0, name: "You", isSelf: true, videoOn: cameraOn },
            ...remoteUids.map((uid) => ({
              uid, isSelf: false, videoOn: true,
              name: groupParticipants.find((p) => p.uid === uid)?.name ?? "Someone",
            })),
          ]}
        />
      ) : remoteUid !== null && !poorConnection ? (
        <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: remoteUid }} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.remoteFallback]}>
          <Ionicons name="person" size={64} color="rgba(255,255,255,0.3)" />
          {(callState === "connecting" || callState === "ringing") && (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.statusText}>{callState === "connecting" ? "Connecting…" : "Calling…"}</Text>
            </View>
          )}
        </View>
      )}

      {remoteUids.length <= 1 && cameraOn && (
        <TouchableOpacity style={[styles.pip, { top: insets.top + 16 }]} onPress={toggleBlur} activeOpacity={0.85}>
          <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} zOrderMediaOverlay />
          {blurOn && (
            <View style={styles.pipBlurBadge}>
              <Ionicons name="sparkles" size={10} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      )}

      {poorConnection && (
        <View style={[styles.banner, { top: insets.top + 10 }]}>
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={styles.bannerText}>Poor connection — switched to audio only</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{otherName}</Text>
          {callState === "connected" && <Text style={styles.timer}>{formatClock(elapsed)}</Text>}
        </View>

        {callState === "connected" && study.pendingGroupStudy?.active && (
          <View style={styles.autoStudyCard}>
            <Text style={styles.autoStudyText}>
              {studyStripLabel} {studyOtherParticipants.length > 2 ? "are" : "is"} studying {study.pendingGroupStudy.title || "a lesson"}.
            </Text>
            <View style={styles.autoStudyRow}>
              <TouchableOpacity style={styles.autoStudyDismiss} onPress={study.dismissPendingGroupStudy}>
                <Text style={styles.autoStudyDismissText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.autoStudyStartBtn} onPress={handleJoinGroupStudy}>
                <Text style={styles.autoStudyStartText}>Join Study</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {callState === "connected" && !study.pendingGroupStudy?.active && hasAutoStudy && !autoStudyDismissed && (
          <View style={styles.autoStudyCard}>
            <Text style={styles.autoStudyText}>Continue {params.autoStudyLessonTitle || "their current lesson"}?</Text>
            <View style={styles.autoStudyRow}>
              <TouchableOpacity style={styles.autoStudyDismiss} onPress={() => setAutoStudyDismissed(true)}>
                <Text style={styles.autoStudyDismissText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.autoStudyStartBtn} onPress={handleStartAutoStudy}>
                <Text style={styles.autoStudyStartText}>Start Study</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={toggleCamera}>
            <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={flipCamera} disabled={!cameraOn}>
            <Ionicons name="camera-reverse" size={20} color={cameraOn ? "#fff" : "rgba(255,255,255,0.35)"} />
          </TouchableOpacity>
          {callState === "connected" && (
            <TouchableOpacity style={styles.controlBtn} onPress={handleOpenStudy}>
              <Ionicons name="school" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          {sessionQuestions.length > 0 && (
            <TouchableOpacity style={styles.controlBtn} onPress={() => setLessonSidebarVisible(true)}>
              <Ionicons name="list" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          {canAddPeople && (
            <TouchableOpacity style={styles.controlBtn} onPress={() => setAddPeopleOpen(true)}>
              <Ionicons name="person-add" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleEndCall}>
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
        </View>
      </View>

      {params.callLogId && (
        <AddPeopleSheet visible={addPeopleOpen} onClose={() => setAddPeopleOpen(false)} callId={params.callLogId} />
      )}

      <ChooseLessonSheet
        visible={chooseLessonOpen}
        onClose={() => setChooseLessonOpen(false)}
        onChooseLesson={handleChooseLesson}
      />

      <Modal visible={lessonSidebarVisible} transparent animationType="slide" onRequestClose={() => setLessonSidebarVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{sessionLessonTitle}</Text>
              <TouchableOpacity onPress={() => setLessonSidebarVisible(false)}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              {sessionQuestions.map((q, i) => (
                <View key={q.id} style={styles.sidebarQuestionRow}>
                  <Text style={styles.sidebarQuestionNumber}>{i + 1}</Text>
                  <Text style={styles.sidebarQuestionText}>{q.question}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E" },
  remoteFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#111A15", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_400Regular" },
  pip: {
    position: "absolute", right: 16, width: 110, height: 150, borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", backgroundColor: "#000",
  },
  pipBlurBadge: {
    position: "absolute", bottom: 6, right: 6, backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10, padding: 4,
  },
  banner: {
    position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(180,83,9,0.9)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  bannerText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.35)", gap: 14,
  },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  timer: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_500Medium" },
  controlsRow: { flexDirection: "row", justifyContent: "space-between" },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  endBtn: { backgroundColor: "#DC2626" },
  studyParticipantStrip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#141F19",
  },
  studyMiniTile: {
    width: 36, height: 36, borderRadius: 8, overflow: "hidden",
    backgroundColor: "#1A241E", alignItems: "center", justifyContent: "center",
  },
  studyMiniName: { flex: 1, color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },
  studyMiniBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  autoStudyCard: {
    backgroundColor: "rgba(20,31,25,0.92)", borderWidth: 1, borderColor: "#1D9E75",
    borderRadius: 14, padding: 12, gap: 10, marginBottom: 14,
  },
  autoStudyText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  autoStudyRow: { flexDirection: "row", gap: 8 },
  autoStudyDismiss: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  autoStudyDismissText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  autoStudyStartBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: "#1D9E75" },
  autoStudyStartText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  modalSearchRow: { flexDirection: "row", gap: 8 },
  modalInput: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular",
  },
  modalSearchBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  modalError: { color: "#F87171", fontSize: 13, fontFamily: "Inter_400Regular" },
  modalResult: { gap: 6, paddingVertical: 8 },
  modalResultText: { color: "#fff", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, fontStyle: "italic" },
  modalResultRef: { color: "#1D9E75", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sidebarQuestionRow: { flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  sidebarQuestionNumber: { color: "#1D9E75", fontSize: 13, fontFamily: "Inter_700Bold", width: 18 },
  sidebarQuestionText: { flex: 1, color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});