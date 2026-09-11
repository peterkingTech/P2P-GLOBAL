import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import { authedFetch } from "@/lib/adminFetch";
import { resolveCallParticipants, CallParticipant } from "@/lib/callParticipants";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import { StudyTogetherOverlay } from "@/components/study/StudyTogetherOverlay";
import { StudySessionSummary } from "@/components/study/StudySessionSummary";
import { AddPeopleSheet } from "@/components/call/AddPeopleSheet";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import { P2PParticipantOrbit } from "@/components/call/P2PParticipantOrbit";
import { P2PControlButton } from "@/components/call/P2PControlButton";
import { getP2PCallColors, P2P_END_CALL_RED } from "@/components/call/p2pCallTheme";
import type { P2PCallColors } from "@/components/call/p2pCallTheme";
import type { P2POrbitTile } from "@/components/call/P2PParticipantNode";
import { useTheme } from "@/contexts/ThemeContext";
import { withAlpha } from "@/lib/colorUtils";

// Alert.alert on native is fire-and-forget — it returns immediately rather
// than waiting for the user to dismiss it. Callers that need cleanup/
// navigation to happen only AFTER the user has actually seen and dismissed
// the dialog (not racing it) must pass onDismiss rather than run that logic
// right after calling showAlert.
function showAlert(title: string, message: string, onDismiss?: () => void) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    onDismiss?.();
  } else {
    Alert.alert(title, message, onDismiss ? [{ text: "OK", onPress: onDismiss }] : undefined);
  }
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

// CALL DEBUG forensic fix — see audio.tsx's identical comment: bounds the
// "joining_channel" step itself (both roles) and the recipient's side of
// "waiting_for_peer" (previously unbounded — the 40s timer above only ever
// applied to the caller).
const JOIN_CHANNEL_TIMEOUT_MS = 15000;
const PEER_WAIT_TIMEOUT_MS = 45000;

// See audio.tsx's identical constant for why this isn't imported as a value
// from "react-native-agora" (that package breaks Metro's web bundle the
// instant it's imported by any file reachable from a route).
const AGORA_CONNECTION_STATE_FAILED = 5;

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, resolvedMode } = useTheme();
  const p2pColors = getP2PCallColors(colors, resolvedMode);
  const styles = makeStyles(p2pColors);
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
  const [tokenAppId, setTokenAppId] = useState<string | undefined>(undefined);
  // CALL DEBUG fix — see audio.tsx's identical comment: useRef-with-a-
  // fallback froze this uid at whatever profile.id was on the FIRST render,
  // permanently, even after profile loaded — a real Agora uid-collision
  // risk when two devices both hit that race and both end up on the
  // generic fallback. useMemo recomputes reactively; the token-request
  // effect below now gates on profile.id actually existing.
  const myUid = useMemo(() => (profile?.id ? uidFromUserId(profile.id) : null), [profile?.id]);

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
  // P2P Call Redesign — presentation layer only, see useActiveSpeaker.ts.
  const activeSpeaker = useActiveSpeaker();
  // CALL DEBUG fix — same explicit state machine as audio.tsx, including
  // the "failed" addition (see that file's comment for the full rationale).
  const [callState, setCallState] = useState<
    "requesting_token" | "joining_channel" | "waiting_for_peer" | "connected" | "failed" | "ended"
  >("requesting_token");
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const poorQualityStreakRef = useRef(0);
  const failureMessageRef = useRef<string>("Unable to connect. Please try again.");

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

  // CALL DEBUG fix — gated on myUid/profile.id, same as audio.tsx: never
  // requests a token with a placeholder identity, and the real failure
  // reason is logged rather than silently swallowed into "ended".
  useEffect(() => {
    if (!myUid || !profile?.id) {
      console.log("CALL DEBUG video: waiting for authenticated profile before requesting token", { hasProfile: !!profile?.id });
      return;
    }
    let cancelled = false;
    console.log("CALL DEBUG video: requesting token", {
      channelName: params.channelName, uid: myUid, isInitiator, callId: params.callId, callLogId: params.callLogId,
    });
    (async () => {
      try {
        const { token: t, appId } = await getToken(params.channelName, myUid, profile.id);
        console.log("CALL DEBUG video: token acquired", { channelName: params.channelName, uid: myUid });
        if (!cancelled) {
          setToken(t);
          setTokenAppId(appId);
          setCallState((s) => (s === "requesting_token" ? "joining_channel" : s));
        }
      } catch (e) {
        console.warn("CALL DEBUG video: token request FAILED", { channelName: params.channelName, uid: myUid, error: e instanceof Error ? e.message : String(e) });
        if (!cancelled) { failureMessageRef.current = "Couldn't connect this call. Please try again."; setCallState("failed"); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelName, myUid, profile?.id]);

  // CALL DEBUG forensic fix — see audio.tsx's identical comment: "failed"
  // routes through this same function (reason="failed") so every failure
  // source shares one cleanup/report/navigate path.
  const handleEndCall = useCallback(async (reason: "user" | "failed" = "user") => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("ended");

    const durationSeconds = connectedAtRef.current ? Math.round((Date.now() - connectedAtRef.current) / 1000) : 0;
    const wasConnected = !!connectedAtRef.current;

    if (params.callLogId) {
      try {
        await authedFetch("/calls/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callLogId: params.callLogId,
            incomingCallId: params.callId,
            conversationId: params.conversationId || null,
            callType: "video",
            connected: wasConnected,
            durationSeconds,
            connectedAt: connectedAtRef.current ? new Date(connectedAtRef.current).toISOString() : null,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    function navigateBack() {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/messages" as any);
    }
    if (reason === "failed" && !wasConnected) {
      showAlert("Call failed", failureMessageRef.current, navigateBack);
    } else {
      navigateBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.callId, params.conversationId]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: true,
    appId: tokenAppId,
    eventHandler: {
      // CALL DEBUG fix — see audio.tsx's identical handlers/comments: this
      // device joining the channel is NOT "connected," and previously had
      // zero visibility (no onError/onConnectionStateChanged at all).
      onJoinChannelSuccess: (connection) => {
        console.log("CALL DEBUG video: onJoinChannelSuccess", { channelName: connection.channelId, uid: connection.localUid });
        setCallState((s) => (s === "connected" ? s : "waiting_for_peer"));
      },
      // CALL DEBUG forensic fix — see audio.tsx's identical comment: this
      // was pure logging; ConnectionStateFailed is Agora's authoritative
      // "this can never connect" signal and previously never left
      // "Connecting…" when the SDK itself already knew the join failed.
      onConnectionStateChanged: (connection, state, reason) => {
        console.log("CALL DEBUG video: onConnectionStateChanged", { channelName: connection.channelId, state, reason });
        if (state === AGORA_CONNECTION_STATE_FAILED) {
          failureMessageRef.current = "The call connection failed. Please try again.";
          setCallState((s) => (s === "ended" ? s : "failed"));
        }
      },
      onError: (err, msg) => {
        console.warn("CALL DEBUG video: onError", { err, msg });
      },
      onTokenPrivilegeWillExpire: () => {
        console.warn("CALL DEBUG video: token privilege about to expire", { channelName: params.channelName });
      },
      onUserJoined: (connection, uid) => {
        console.log("CALL DEBUG video: onUserJoined", { channelName: connection.channelId, remoteUid: uid });
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
      // P2P Call Redesign — video calls did not previously subscribe to
      // this callback at all. It is an EXISTING Agora SDK event (already
      // used identically in audio.tsx); wiring it here only adds a
      // listener for real speaking data to drive the orbit's active-
      // speaker highlight — it does not change how Agora computes or
      // reports volume, and nothing about join/leave/token/permission
      // behavior is touched.
      onAudioVolumeIndication: (_connection, speakers) => {
        activeSpeaker.reportVolume(speakers ?? []);
      },
      onUserOffline: (connection, uid) => {
        console.log("CALL DEBUG video: onUserOffline", { channelName: connection.channelId, remoteUid: uid });
        activeSpeaker.clearIfActive(uid);
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
  // waiting instead of leaving "Calling…" on screen forever. handleEndCall
  // (state reset, /calls/end, navigation) runs from the dialog's onDismiss,
  // not right after showAlert() returns — Alert.alert doesn't block, so
  // running cleanup/navigation immediately after calling it would race the
  // dialog still being shown instead of actually being triggered by it.
  useEffect(() => {
    if (!isInitiator || connected) return;
    const timer = setTimeout(() => {
      showAlert("No answer", `${otherName} didn't pick up.`, handleEndCall);
    }, NO_ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInitiator, connected, handleEndCall, otherName]);

  // CALL DEBUG forensic fix — see audio.tsx's identical effects/comments.
  useEffect(() => {
    if (callState !== "joining_channel") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = "Couldn't connect this call. Please check your connection and try again.";
      setCallState((s) => (s === "joining_channel" ? "failed" : s));
    }, JOIN_CHANNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState]);

  useEffect(() => {
    if (isInitiator || callState !== "waiting_for_peer") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = "Unable to reach the other person. Please try again.";
      setCallState((s) => (s === "waiting_for_peer" ? "failed" : s));
    }, PEER_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInitiator, callState]);

  useEffect(() => {
    if (callState === "failed") handleEndCall("failed");
  }, [callState, handleEndCall]);

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
      <TouchableOpacity style={[styles.studyMiniBtn, styles.endBtn]} onPress={() => handleEndCall()}>
        <Ionicons name="call" size={16} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
      </TouchableOpacity>
    </View>
  );

  // P2P Call Redesign — presentation only. Self is now a real orbit
  // participant (previously only a small PIP tile, hidden entirely in
  // group calls) rather than a special case — see audio.tsx's identical
  // comment. Remote tiles' videoOn always true, matching the existing
  // group.tsx precedent exactly (this codebase has never tracked a
  // per-remote camera-on/off signal — confirmed forensically — so this
  // is not a new limitation introduced by the redesign); poorConnection
  // forces the graceful avatar fallback instead of a broken video frame.
  const otherTiles: P2POrbitTile[] = remoteUids.map((uid) => ({
    uid, isSelf: false,
    name: remoteUids.length === 1 ? otherName : (groupParticipants.find((p) => p.uid === uid)?.name ?? "Someone"),
    videoOn: !poorConnection, muted: false,
  }));
  const selfTile: P2POrbitTile = { uid: 0, isSelf: true, name: profile?.displayName || "You", videoOn: cameraOn, muted };
  const allTiles = [selfTile, ...otherTiles];
  const centerUid = activeSpeaker.activeUid ?? (remoteUids.length > 0 ? remoteUids[0] : 0);
  const centerTile = allTiles.find((t) => t.uid === centerUid) ?? selfTile;
  const orbitTiles = allTiles.filter((t) => t.uid !== centerTile.uid);

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

      {/* Minimal header (section 11) — no participant-count badge; Direct
          Calls has no Participants button today (confirmed absent from
          this file, audio.tsx, and group.tsx), so none is invented here. */}
      <View style={[styles.header, { top: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => handleEndCall()} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={p2pColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.brand}>P2P Global</Text>
          <Text style={styles.brandSub}>Discipleship Network</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      <View style={[styles.callTypePillWrap, { top: insets.top + 56 }]}>
        <View style={styles.callTypePill}>
          <Ionicons name="videocam" size={12} color={p2pColors.accent} />
          <Text style={styles.callTypePillText}>Video Call</Text>
        </View>
      </View>

      <View style={styles.orbitArea}>
        <P2PParticipantOrbit
          centerTile={centerTile}
          orbitTiles={orbitTiles}
          speakingUids={activeSpeaker.speakingUids}
          colors={p2pColors}
        />
        {callState !== "connected" && callState !== "ended" && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={p2pColors.textPrimary} size="small" />
            <Text style={styles.statusText}>
              {callState === "waiting_for_peer" && isInitiator ? "Calling…" : "Connecting…"}
            </Text>
          </View>
        )}
      </View>

      {centerTile.isSelf && cameraOn && (
        <TouchableOpacity style={[styles.blurToggle, { top: insets.top + 100 }]} onPress={toggleBlur} activeOpacity={0.85} accessibilityLabel="Toggle background blur">
          <Ionicons name="sparkles" size={14} color={blurOn ? p2pColors.accent : p2pColors.textPrimary} />
        </TouchableOpacity>
      )}

      {poorConnection && (
        <View style={[styles.banner, { top: insets.top + 10 }]}>
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={styles.bannerText}>Poor connection — switched to audio only</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {callState === "connected" && <Text style={styles.timer}>{formatClock(elapsed)}</Text>}

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
          <P2PControlButton onPress={toggleMute} active={muted} accessibilityLabel="Mute microphone" colors={p2pColors}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={20} color={muted ? p2pColors.accent : p2pColors.textPrimary} />
          </P2PControlButton>
          <P2PControlButton onPress={toggleCamera} active={!cameraOn} accessibilityLabel="Turn camera on or off" colors={p2pColors}>
            <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={20} color={!cameraOn ? p2pColors.accent : p2pColors.textPrimary} />
          </P2PControlButton>
          <P2PControlButton onPress={flipCamera} disabled={!cameraOn} accessibilityLabel="Switch camera" colors={p2pColors}>
            <Ionicons name="camera-reverse" size={20} color={cameraOn ? p2pColors.textPrimary : p2pColors.textMuted} />
          </P2PControlButton>
          {callState === "connected" && (
            <P2PControlButton onPress={handleOpenStudy} accessibilityLabel="Study Together" colors={p2pColors}>
              <Ionicons name="school" size={20} color={p2pColors.textPrimary} />
            </P2PControlButton>
          )}
          {sessionQuestions.length > 0 && (
            <P2PControlButton onPress={() => setLessonSidebarVisible(true)} accessibilityLabel="Lesson questions" colors={p2pColors}>
              <Ionicons name="list" size={20} color={p2pColors.textPrimary} />
            </P2PControlButton>
          )}
          {canAddPeople && (
            <P2PControlButton onPress={() => setAddPeopleOpen(true)} accessibilityLabel="Add someone to this call" colors={p2pColors}>
              <Ionicons name="person-add" size={20} color={p2pColors.textPrimary} />
            </P2PControlButton>
          )}
          <P2PControlButton onPress={() => handleEndCall()} danger accessibilityLabel="End call" colors={p2pColors}>
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </P2PControlButton>
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

function makeStyles(p2p: P2PCallColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p2p.bg },
    header: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, zIndex: 2 },
    brand: { color: p2p.textPrimary, fontSize: 14, fontFamily: "Inter_700Bold" },
    brandSub: { color: p2p.textMuted, fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
    callTypePillWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 2 },
    callTypePill: {
      flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: p2p.pillBg,
      borderWidth: 1, borderColor: p2p.accentBorder, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    },
    callTypePillText: { color: p2p.accent, fontSize: 12, fontFamily: "Inter_600SemiBold" },
    orbitArea: { flex: 1, alignItems: "center", justifyContent: "center" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    statusText: { color: p2p.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
    blurToggle: {
      position: "absolute", right: 16, width: 34, height: 34, borderRadius: 17,
      backgroundColor: withAlpha(p2p.bg, 0.6), alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: p2p.surfaceBorder, zIndex: 2,
    },
    banner: {
      position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8,
      backgroundColor: "rgba(180,83,9,0.9)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, zIndex: 2,
    },
    bannerText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
    bottomBar: {
      position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 20,
      backgroundColor: withAlpha(p2p.bg, 0.55), gap: 14, alignItems: "center",
    },
    timer: { color: p2p.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
    controlsRow: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
    endBtn: { backgroundColor: P2P_END_CALL_RED },
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
      backgroundColor: p2p.pillBg, borderWidth: 1, borderColor: p2p.accent,
      borderRadius: 14, padding: 12, gap: 10, marginBottom: 14, width: "100%",
    },
    autoStudyText: { color: p2p.textPrimary, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    autoStudyRow: { flexDirection: "row", gap: 8 },
    autoStudyDismiss: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: p2p.surfaceBorder },
    autoStudyDismissText: { color: p2p.textMuted, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    autoStudyStartBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: p2p.accent },
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
}