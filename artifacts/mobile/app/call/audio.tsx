import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { useStudySession, StudyLessonMeta, StudySessionSummary as StudySummary, OtherParticipant } from "@/hooks/useStudySession";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";
import { resolveCallParticipants, CallParticipant } from "@/lib/callParticipants";
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

const CALL_TYPE_LABEL: Partial<Record<CallType, string>> = {
  pastoral: "Pastoral check-in",
  crisis: "Crisis call",
};

// Caller side only — mirrors incoming.tsx's RING_TIMEOUT_MS (30s) on the
// recipient's screen. Without this, "Calling…" only ever ends via Agora
// connecting or a status UPDATE written by the recipient's own device (see
// the realtime watch effect below) — if the recipient's app never opens
// incoming.tsx (backgrounded, killed, or just never received the signal),
// the caller would otherwise wait indefinitely.
const NO_ANSWER_TIMEOUT_MS = 40000;

export default function AudioCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    channelName: string; otherUserId: string; otherUserName?: string; callType?: CallType;
    isInitiator?: string; callId?: string; conversationId?: string; callLogId?: string;
    autoStudyLessonId?: string; autoStudyModuleId?: string; autoStudyLessonTitle?: string;
  }>();
  const isInitiator = params.isInitiator === "true";
  const callType = (params.callType as CallType) || "audio";

  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  // Study Together C1 — remoteUids replaces the old singular `connected`
  // boolean so the call layer itself can hold more than one other party.
  // `connected` is still derived here (below) so every existing effect
  // that only ever needed "is someone else here" keeps working unchanged.
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const connected = remoteUids.length > 0;
  const [groupParticipants, setGroupParticipants] = useState<CallParticipant[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [callState, setCallState] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");
  const endedRef = useRef(false);

  const [mode, setMode] = useState<"call" | "study">("call");
  const [chooseLessonOpen, setChooseLessonOpen] = useState(false);
  const [studySummary, setStudySummary] = useState<StudySummary | null>(null);
  const otherName = params.otherUserName || "Peer";
  // Study Together C3 — otherParticipants replaces the old single otherUserId
  // param. remoteUids.length <= 1 keeps using the exact 1:1 route params
  // (byte-identical to before C3); group calls use the resolved roster from
  // C1's resolveCallParticipants, already fetched below into groupParticipants.
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

  // Study Together C3 — mid-call join detection (spec §9): as soon as a
  // call becomes a group call, proactively check whether the others already
  // have a study session running, so a joiner sees "X and Y are studying
  // Lesson N" instead of only finding out if they happen to tap the button.
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

  function handleChooseLesson(lesson: StudyLessonMeta) {
    setChooseLessonOpen(false);
    study.startStudy(lesson);
  }

  function handleStartAutoStudy() {
    if (!params.autoStudyLessonId || !params.autoStudyModuleId) return;
    study.startStudy({ id: params.autoStudyLessonId, moduleId: params.autoStudyModuleId, title: params.autoStudyLessonTitle ?? "" });
  }
  const connectedAtRef = useRef<number | null>(null);

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
            callType,
            connected: wasConnected,
            durationSeconds,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages" as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.conversationId, callType]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: false,
    eventHandler: {
      onUserJoined: (_connection, uid) => {
        connectedAtRef.current = Date.now();
        setCallState("connected");
        setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
      },
      // Study Together C1: the call now only ends when the LAST remote
      // participant leaves, not simply "a" participant — for an existing
      // 1:1 call that's the exact same moment as before (one remote uid
      // going to zero), so this preserves current behavior unchanged
      // while letting a group call continue for whoever's left.
      onUserOffline: (_connection, uid) => {
        setRemoteUids((prev) => {
          const next = prev.filter((u) => u !== uid);
          if (next.length === 0) handleEndCall();
          return next;
        });
        // Study Together C4.7/C4.3 — report ANY departed study participant,
        // not just the leader (a rank-and-file departure still needs to be
        // cleared from the active roster; the server only recomputes a
        // leader when the departure actually affects leadership). This
        // handler is registered once at mount (see useAgoraEngine.native.ts),
        // so it reads live values via refs, not the closed-over `study`/
        // `groupParticipants` from the render that registered it.
        const liveStudy = studyRef.current;
        if (liveStudy.isActive && liveStudy.isGroup) {
          const departed = groupParticipantsRef.current.find((p) => p.uid === uid);
          if (departed) {
            void liveStudy.reportParticipantDeparture(departed.userId);
          }
        }
      },
    },
  });

  // Resolve real names for group calls only (>1 remote party) — the
  // existing 1:1 path keeps using otherUserId/otherUserName from route
  // params directly and never calls this.
  useEffect(() => {
    if (remoteUids.length <= 1) { setGroupParticipants([]); return; }
    let cancelled = false;
    resolveCallParticipants(params.channelName, remoteUids).then((list) => { if (!cancelled) setGroupParticipants(list); });
    return () => { cancelled = true; };
  }, [remoteUids, params.channelName]);

  // Ticking duration timer, only once the other party has actually joined.
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [connected]);

  // Caller side only — watch the incoming_calls row this call came from for
  // a decline/missed transition so "calling..." doesn't hang forever.
  useEffect(() => {
    if (!isInitiator || !params.callId || connected) return;
    const channel = supabase
      .channel(`p2p_call_watch_${params.callId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_incoming_calls", filter: `id=eq.${params.callId}` },
        (payload) => {
          const status = (payload.new as Record<string, unknown>).status as string;
          if (status === "declined" || status === "missed" || status === "cancelled") {
            handleEndCall();
          }
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
  function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    engineRef.current?.setEnableSpeakerphone(next);
  }

  const studyStripLabel = studyOtherParticipants.length <= 1
    ? otherName
    : studyOtherParticipants.length === 2
      ? `${studyOtherParticipants[0].name} & ${studyOtherParticipants[1].name}`
      : `${studyOtherParticipants[0].name} & ${studyOtherParticipants.length - 1} others`;

  const participantStrip = (
    <View style={styles.studyParticipantStrip}>
      <View style={styles.studyMiniAvatar}><Ionicons name="person" size={16} color="rgba(255,255,255,0.6)" /></View>
      <Text style={styles.studyMiniName} numberOfLines={1}>{studyStripLabel}</Text>
      <TouchableOpacity style={styles.studyMiniBtn} onPress={toggleMute}>
        <Ionicons name={muted ? "mic-off" : "mic"} size={16} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.studyMiniBtn} onPress={toggleSpeaker}>
        <Ionicons name={speakerOn ? "volume-high" : "volume-medium-outline"} size={16} color="#fff" />
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
    <View style={[styles.screen, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 30 }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <Text style={styles.brand}>P2P Global</Text>

      <View style={styles.center}>
        {remoteUids.length <= 1 ? (
          <>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={56} color="rgba(255,255,255,0.6)" />
            </View>
            <Text style={styles.name}>{otherName}</Text>
          </>
        ) : (
          // Study Together C1 group-calling foundation — minimal reusable
          // layout for >1 remote party. No group Study Together UI here;
          // this is only the call-layer participant list.
          <View style={styles.groupParticipantList}>
            {groupParticipants.map((p) => (
              <View key={p.uid} style={styles.groupParticipantRow}>
                <View style={styles.groupParticipantAvatar}><Ionicons name="person" size={18} color="rgba(255,255,255,0.6)" /></View>
                <Text style={styles.groupParticipantName} numberOfLines={1}>{p.name}</Text>
              </View>
            ))}
            <Text style={styles.name}>{groupParticipants.length + 1} on this call</Text>
          </View>
        )}
        {callType !== "audio" && <Text style={styles.subLabel}>{CALL_TYPE_LABEL[callType]}</Text>}

        {callState === "connecting" || callState === "ringing" ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.statusText}>{callState === "connecting" ? "Connecting…" : "Calling…"}</Text>
          </View>
        ) : callState === "connected" ? (
          <View style={styles.statusRow}>
            <View style={styles.liveDot} />
            <Text style={styles.timerText}>{formatClock(elapsed)}</Text>
          </View>
        ) : (
          <Text style={styles.statusText}>Call ended</Text>
        )}

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

        {callState === "connected" && !study.pendingGroupStudy?.active && (!hasAutoStudy || autoStudyDismissed) && (
          <TouchableOpacity style={styles.studyBtn} onPress={handleOpenStudy}>
            <Text style={styles.studyBtnEmoji}>📖</Text>
            <Text style={styles.studyBtnText}>Study Together</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Ionicons name={muted ? "mic-off" : "mic"} size={22} color="#fff" />
          <Text style={styles.controlLabel}>{muted ? "Unmute" : "Mute"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleSpeaker}>
          <Ionicons name={speakerOn ? "volume-high" : "volume-medium-outline"} size={22} color="#fff" />
          <Text style={styles.controlLabel}>Speaker</Text>
        </TouchableOpacity>
        {canAddPeople && (
          <TouchableOpacity style={styles.controlBtn} onPress={() => setAddPeopleOpen(true)}>
            <Ionicons name="person-add" size={20} color="#fff" />
            <Text style={styles.controlLabel}>Add</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleEndCall}>
          <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          <Text style={styles.controlLabel}>End</Text>
        </TouchableOpacity>
      </View>

      {params.callLogId && (
        <AddPeopleSheet visible={addPeopleOpen} onClose={() => setAddPeopleOpen(false)} callId={params.callLogId} />
      )}

      <ChooseLessonSheet
        visible={chooseLessonOpen}
        onClose={() => setChooseLessonOpen(false)}
        onChooseLesson={handleChooseLesson}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  avatarCircle: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center", marginBottom: 18,
  },
  name: { fontSize: 24, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  groupParticipantList: { alignItems: "center", gap: 8, marginBottom: 10 },
  groupParticipantRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupParticipantAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  groupParticipantName: { color: "#fff", fontSize: 15, fontFamily: "Inter_500Medium" },
  subLabel: { fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: "Inter_400Regular", marginTop: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  statusText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_400Regular" },
  timerText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },
  controlsRow: { flexDirection: "row", gap: 28 },
  controlBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center", gap: 2,
  },
  endBtn: { backgroundColor: "#DC2626" },
  controlLabel: { position: "absolute", bottom: -20, color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Inter_500Medium" },
  studyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 26,
    backgroundColor: "rgba(29,158,117,0.15)", borderWidth: 1, borderColor: "#1D9E75",
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
  },
  studyBtnEmoji: { fontSize: 16 },
  studyBtnText: { color: "#1D9E75", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  studyParticipantStrip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#141F19",
  },
  studyMiniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  studyMiniName: { flex: 1, color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },
  studyMiniBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  autoStudyCard: {
    marginTop: 26, backgroundColor: "#141F19", borderWidth: 1, borderColor: "#1D9E75",
    borderRadius: 14, padding: 14, gap: 10, width: "88%",
  },
  autoStudyText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  autoStudyRow: { flexDirection: "row", gap: 8 },
  autoStudyDismiss: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  autoStudyDismissText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  autoStudyStartBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: "#1D9E75" },
  autoStudyStartText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
});