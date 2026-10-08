import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView, Platform, Alert, AppState, useWindowDimensions, PermissionsAndroid } from "react-native";
import { Camera } from "expo-camera";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView, QualityType, BackgroundSourceType, BackgroundBlurDegree, SegModelType, RemoteVideoState } from "@/lib/agoraNative";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { useStudySession, StudyLessonMeta, StudySessionSummary as StudySummary, OtherParticipant } from "@/hooks/useStudySession";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import { resolveCallParticipants, CallParticipant } from "@/lib/callParticipants";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import { startCallBackgroundSupport, stopCallBackgroundSupport } from "@/lib/callBackgroundSupport";
import { endSystemCall, systemEndReason } from "@/lib/callSystem";
import { useSystemCall } from "@/lib/useSystemCall";
import { usePeerPhoto } from "@/lib/usePeerPhoto";
import { Avatar } from "@/components/Avatar";
import { Image as ExpoImage } from "expo-image";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import { StudyTogetherOverlay } from "@/components/study/StudyTogetherOverlay";
import { StudySessionSummary } from "@/components/study/StudySessionSummary";
import { AddPeopleSheet } from "@/components/call/AddPeopleSheet";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import { P2PRectStage } from "@/components/call/P2PRectStage";
import { P2PControlButton } from "@/components/call/P2PControlButton";
import { CallMoreSheet, type CallMoreAction } from "@/components/call/CallMoreSheet";
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
//
// Root-cause fix (real BlueStacks/Nox test) — 40000 was measured to be too
// short: it counts from screen mount, not from the recipient's ring/accept,
// so it has to cover incoming.tsx's own RING_TIMEOUT_MS (30000) PLUS however
// long the recipient then takes to accept, get permissions, spin up their
// engine, fetch a token, and join — which real-device testing showed can
// exceed 60s total even on a healthy connection. A caller timing out before
// a legitimately-answering recipient can finish joining was the confirmed
// root cause of calls that connect on Agora's side but never show a remote
// participant. 70000 keeps this bounded (still a real "give up" timeout,
// never infinite) while giving the recipient's realistic worst-case join
// path room to complete.
const NO_ANSWER_TIMEOUT_MS = 70000;

// Minimum gap between two Audio/Video mode switches (see modeSwitchAllowed).
const MODE_SWITCH_COOLDOWN_MS = 700;

// See audio.tsx's identical declaration.
type UnansweredOutcome = "no_answer" | "declined" | "busy";
const UNANSWERED_LABEL: Record<UnansweredOutcome, string> = {
  no_answer: "No answer", declined: "Call declined", busy: "Busy",
};

// CALL DEBUG forensic fix — see audio.tsx's identical comment: bounds the
// "joining_channel" step itself (both roles) and the recipient's side of
// "waiting_for_peer" (previously unbounded — the 40s timer above only ever
// applied to the caller).
const JOIN_CHANNEL_TIMEOUT_MS = 15000;
const PEER_WAIT_TIMEOUT_MS = 45000;

// Video-call lifecycle audit — a remote participant's onUserOffline is
// commonly just a transient network drop, not a real hangup (Agora itself
// distinguishes "left the channel" from "connection dropped" no further
// than this one event). Give a genuine reconnect this long to happen before
// treating it as a real departure — see onUserOffline/onUserJoined below.
const RECONNECT_GRACE_MS = 15000;

// See audio.tsx's identical constant for why this isn't imported as a value
// from "react-native-agora" (that package breaks Metro's web bundle the
// instant it's imported by any file reachable from a route).
const AGORA_CONNECTION_STATE_FAILED = 5;
// See audio.tsx: UserOfflineReasonType.UserOfflineQuit (=0), a deliberate leave.
const AGORA_USER_OFFLINE_QUIT = 0;

// CALL NAV TRACE (automatic-second-call investigation) — see mountIdRef
// below; module-scope so it keeps counting across remounts within the
// same JS process instead of resetting.
let videoMountCounter = 0;

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  // The main controls must fit one row on narrow phones (e.g. 320–360pt):
  // shrink from 58 but never below a 44pt tap target. Video mode shows 7
  // controls, audio mode 5 (camera/flip don't apply) — see the controls row.
  const { width: screenWidth } = useWindowDimensions();
  const controlSizeFor = (count: number) =>
    Math.max(44, Math.min(58, Math.floor((screenWidth - 40 - (count - 1) * 8) / count)));
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, resolvedMode } = useTheme();
  const p2pColors = getP2PCallColors(colors, resolvedMode);
  const styles = makeStyles(p2pColors);
  const params = useLocalSearchParams<{
    channelName: string; otherUserId: string; otherUserName?: string; otherUserAvatarUrl?: string; callType?: CallType;
    isInitiator?: string; callId?: string; conversationId?: string; callLogId?: string;
    sessionId?: string; lessonId?: string;
    autoStudyLessonId?: string; autoStudyModuleId?: string; autoStudyLessonTitle?: string;
  }>();
  const isInitiator = params.isInitiator === "true";
  // Seamless Audio ↔ Video — a 1:1 AUDIO call runs on this screen in audio
  // mode (app/call/audio.tsx routes it here): same engine, camera off until
  // the user taps Video. The call stays an audio call in its history.
  const startsAsAudio = params.callType === "audio";
  const callTypeForRecord: "audio" | "video" = startsAsAudio ? "audio" : "video";
  const markedInProgressRef = useRef(false);
  // CALL NAV TRACE (automatic-second-call investigation) — a fresh id per
  // component mount (module-scope counter, so it's unambiguous whether two
  // log lines came from the same mounted instance or a genuine remount).
  // Runs unconditionally on every render's first pass — not inside a
  // useEffect — specifically so it can't be confused with an effect
  // re-running inside an already-mounted instance.
  const mountIdRef = useRef<number | null>(null);
  if (mountIdRef.current === null) {
    mountIdRef.current = ++videoMountCounter;
    console.log("CALL NAV TRACE: video.tsx mounted", {
      mountId: mountIdRef.current, callId: params.callId, channelName: params.channelName,
      isInitiator, otherUserId: params.otherUserId, timestamp: new Date().toISOString(),
    });
  }

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
  // Set in onJoinChannelSuccess; gates the local tile's first mount (see selfTile).
  const [localJoined, setLocalJoined] = useState(false);
  // Forensic calling audit — this codebase never tracked a real per-remote
  // camera-on/off signal before (confirmed: otherTiles.videoOn was hardcoded
  // true/!poorConnection everywhere). Driven now by Agora's own
  // onRemoteVideoStateChanged; defaults to false (avatar fallback) per uid
  // until that uid's first Decoding event actually arrives, rather than
  // assuming video is showing before there's any evidence it is.
  const [remoteVideoOn, setRemoteVideoOn] = useState<Record<number, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(!startsAsAudio);
  // Stage 6 — mirrors cameraUnavailable below: a denied mic permission
  // previously produced zero user-visible signal at all. Cleared by the
  // user's own retry gesture (unmuting), same convention as the existing
  // camera-toggle-as-retry pattern.
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [blurOn, setBlurOn] = useState(false);
  const [filterOn, setFilterOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  // WhatsApp-style call redesign — user-controlled Video<->Audio presentation
  // switch. Deliberately separate from cameraOn: cameraOn already means
  // "is my camera capturing," which this reuses to actually stop the local
  // video track (same engine.enableLocalVideo() call as the manual camera
  // toggle below), but mediaMode is the distinct, explicit "I chose an
  // audio-only presentation" concept that also drives which controls show.
  // It never touches the Agora channel/engine/token — see switchTo*Mode.
  const [mediaMode, setMediaMode] = useState<"video" | "audio">(startsAsAudio ? "audio" : "video");
  const controlSize = controlSizeFor(mediaMode === "video" ? 7 : 5);
  // WhatsApp-style call redesign — which participant is the large tile.
  // Pure UI state: P2PRectStage's tap handler below only flips this, never
  // touches Agora. false (the default) preserves this screen's original,
  // pre-existing initial layout (other participant large, self small pip).
  const [mainIsSelf, setMainIsSelf] = useState(false);
  const [poorConnection, setPoorConnection] = useState(false);
  // Video-call lifecycle audit — camera-unavailable is now tracked
  // separately from cameraOn: cameraOn also flips false when the USER
  // deliberately toggles their camera off (toggleCamera below), which must
  // not show a "camera unavailable" banner. This is only set true by a real
  // permission denial (onCameraUnavailable) and cleared by a successful
  // manual retry.
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  // Video-call lifecycle audit — a remote participant's transient network
  // drop (Agora's onUserOffline) must not immediately end the call. uid is
  // kept in remoteUids/remoteVideoOn during the grace period below (see
  // RECONNECT_GRACE_MS) — this set only drives the "reconnecting" UI signal.
  const [disconnectedUids, setDisconnectedUids] = useState<Set<number>>(new Set());
  const reconnectTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // P2P Call Redesign — presentation layer only, see useActiveSpeaker.ts.
  const activeSpeaker = useActiveSpeaker();
  // CALL DEBUG fix — same explicit state machine as audio.tsx, including
  // the "failed" addition (see that file's comment for the full rationale).
  const [callState, setCallState] = useState<
    "requesting_token" | "joining_channel" | "waiting_for_peer" | "connected" | "failed" | "ended" | "no_answer"
  >("requesting_token");
  // Which unanswered outcome the "no_answer" result screen is showing.
  const [unansweredOutcome, setUnansweredOutcome] = useState<UnansweredOutcome>("no_answer");
  // Stage 22 — guards "Call again" against a double-tap starting two calls.
  const [callingAgain, setCallingAgain] = useState(false);
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  // CALL TIMEOUT DEBUG — anchor for elapsedMs on every timeout log below;
  // this screen's mount time, not any Agora-specific event, since the goal
  // is to see exactly how long each phase actually took end-to-end.
  const callMountAtRef = useRef(Date.now());
  // CALL TIMEOUT DEBUG — the NO_ANSWER_TIMEOUT_MS effect below intentionally
  // does not list callState in its deps (that must not change — it would
  // alter when the timer itself gets (re)armed), so its callback would
  // otherwise log a stale value; this ref gives it the real one without
  // touching that effect's dependency array.
  const callStateRef = useRef(callState);
  callStateRef.current = callState;
  const poorQualityStreakRef = useRef(0);
  const failureMessageRef = useRef<string>("Unable to connect. Please try again.");
  // CALL DEBUG fix — the Android mic/camera permission prompt(s) inside
  // useAgoraEngine can take an arbitrary, human-paced amount of time to
  // resolve. JOIN_CHANNEL_TIMEOUT_MS below must only start counting once
  // that's done and the engine has actually attempted to join — otherwise
  // time spent looking at the OS permission dialog silently eats into the
  // join timeout and a call can time out before it was ever given a real
  // chance to connect.
  const [readyToJoin, setReadyToJoin] = useState(false);

  const [mode, setMode] = useState<"call" | "study">("call");
  const [chooseLessonOpen, setChooseLessonOpen] = useState(false);
  const [studySummary, setStudySummary] = useState<StudySummary | null>(null);
  const otherName = params.otherUserName || "Peer";
  // The other person's profile photo (shown whenever their video is off) —
  // the caller's side is never handed one in its route params.
  const peerPhotoUrl = usePeerPhoto(params.otherUserId, params.otherUserAvatarUrl);
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

  // Stage 22 — extracted out of handleEndCall's own closure (it was a local
  // function there before) so the "No answer" result screen's Cancel button
  // can reuse the exact same fallback logic without duplicating it.
  function navigateBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages" as any);
  }

  // CALL DEBUG forensic fix — see audio.tsx's identical comment: "failed"
  // routes through this same function (reason="failed") so every failure
  // source shares one cleanup/report/navigate path. Stage 22 adds a fourth,
  // distinct "no_answer" reason — see audio.tsx's identical comment for the
  // full rationale (setToken(null) reuses useAgoraEngine's own existing
  // dependency-driven cleanup instead of navigating away).
  // "remote_end": see audio.tsx — the other side hung up on purpose.
  const handleEndCall = useCallback(async (reason: "user" | "remote_end" | "failed" | UnansweredOutcome = "user") => {
    console.log("CALL END TRACE", {
      mountId: mountIdRef.current, source: reason, callId: params.callId, channelName: params.channelName,
      alreadyEnded: endedRef.current, timestamp: new Date().toISOString(),
    });
    if (endedRef.current) return;
    endedRef.current = true;
    // Stage 26B — see audio.tsx's identical comment.
    stopCallBackgroundSupport();
    endSystemCall(params.callId, systemEndReason(reason, { isInitiator }));
    // Declined and busy share the "No answer" result screen and teardown.
    const unanswered = reason === "no_answer" || reason === "declined" || reason === "busy";
    if (unanswered) setUnansweredOutcome(reason);
    setCallState(unanswered ? "no_answer" : "ended");

    // Video-call lifecycle audit — a real end (explicit or genuine failure)
    // must not leave a pending reconnect-grace timer to fire afterward and
    // touch state on an already-ended call.
    reconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
    reconnectTimersRef.current.clear();

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
            // The type the call STARTED as — switching mid-call is still one call.
            callType: callTypeForRecord,
            connected: wasConnected,
            durationSeconds,
            connectedAt: connectedAtRef.current ? new Date(connectedAtRef.current).toISOString() : null,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    // Stage 22 — no navigation here at all: the /calls/end report above
    // already ran, so the engine only needs to actually leave.
    if (unanswered) {
      setToken(null);
      return;
    }

    if (reason === "failed" && !wasConnected) {
      showAlert("Call failed", failureMessageRef.current, navigateBack);
    } else {
      navigateBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.callId, params.conversationId]);

  // OS call integration — see audio.tsx's identical call.
  useSystemCall({
    callId: params.callId, isInitiator, callType: callTypeForRecord,
    peerId: params.otherUserId, peerName: otherName, channelName: params.channelName,
    conversationId: params.conversationId, callLogId: params.callLogId,
    connected, onSystemEnd: () => { void handleEndCall("user"); },
  });

  // Stage 22 — reuses the exact same shared helper every other call-
  // initiation site uses (lib/callStart.ts), not a second call mechanism.
  async function handleCallAgain() {
    if (callingAgain || !profile?.id || !params.otherUserId) return;
    console.log("CALL NAV TRACE: Call Again button pressed", { mountId: mountIdRef.current, callId: params.callId, channelName: params.channelName, timestamp: new Date().toISOString() });
    setCallingAgain(true);
    const result = await startPeerCall({
      supabase, currentUserId: profile.id, otherUserId: params.otherUserId,
      callType: callTypeForRecord, onAlert: showAlert, source: "video_call_again_button",
    });
    if (!result) { setCallingAgain(false); return; }
    router.replace({
      pathname: startsAsAudio ? "/call/audio" : "/call/video",
      params: buildCallRouteParams({
        channelName: result.channelName, otherUserId: params.otherUserId, otherUserName: otherName,
        callType: callTypeForRecord, callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
      }),
    } as any);
  }

  // Stage 22 — reuses the existing conversation screen's own voice-message
  // recorder rather than a second recorder; the engine was already torn
  // down by handleEndCall's "no_answer" branch before this ever renders.
  function handleRecordVoice() {
    if (params.conversationId) router.replace(`/messages/${params.conversationId}` as any);
    else navigateBack();
  }

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: true,
    appId: tokenAppId,
    // WhatsApp-style ringing lifecycle — the callee's screen only ever
    // mounts after they've already tapped Accept (see incoming.tsx), so the
    // callee always publishes immediately. The caller (isInitiator) starts
    // with local preview only, nothing published — see onUserJoined below
    // for where publishing actually starts once the callee has joined.
    initialPublishVideo: startsAsAudio ? false : !isInitiator,
    // An audio call starts with the camera completely off (no permission
    // prompt, no preview, nothing published) until the user taps Video.
    startWithCameraOff: startsAsAudio,
    onCameraUnavailable: useCallback(() => {
      // Video-call lifecycle audit — a camera problem is not the same thing
      // as ending (or downgrading) the video call: audio keeps flowing, the
      // user stays on this screen, and cameraUnavailable drives a distinct
      // banner (cameraOn alone would be indistinguishable from the user
      // having simply toggled their own camera off via toggleCamera below).
      console.warn("CALL DEBUG video: camera permission unavailable, reflecting into cameraOn state");
      setCameraOn(false);
      setCameraUnavailable(true);
    }, []),
    onPermissionsResolved: useCallback(() => setReadyToJoin(true), []),
    onMicUnavailable: useCallback(() => setMicUnavailable(true), []),
    eventHandler: {
      // CALL DEBUG fix — see audio.tsx's identical handlers/comments: this
      // device joining the channel is NOT "connected," and previously had
      // zero visibility (no onError/onConnectionStateChanged at all).
      onJoinChannelSuccess: (connection) => {
        console.log("CALL DEBUG video: onJoinChannelSuccess", { channelName: connection.channelId, uid: connection.localUid });
        setLocalJoined(true);
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
      // Video-call lifecycle audit — previously only logged, then the call
      // ran on borrowed time until Agora dropped it outright. On this
      // warning (fired ~30s before real expiry), fetch a fresh token from
      // the existing token-minting endpoint (same getToken this screen
      // already used to join) and hand it to the SAME live engine via
      // renewToken — never leaveChannel/rejoin, never touch the `token`
      // state this hook was keyed on (that would retrigger the engine
      // effect above and cause exactly the reinit this fix removes).
      onTokenPrivilegeWillExpire: () => {
        console.warn("CALL DEBUG video: token privilege about to expire", { channelName: params.channelName });
        if (!myUid || !profile?.id) return;
        getToken(params.channelName, myUid, profile.id)
          .then(({ token: freshToken }) => {
            const result = engineRef.current?.renewToken(freshToken);
            console.log("CALL DEBUG video: renewToken", { channelName: params.channelName, result });
          })
          .catch((e) => {
            console.warn("CALL DEBUG video: token renewal FAILED", { channelName: params.channelName, error: e instanceof Error ? e.message : String(e) });
          });
      },
      onUserJoined: (connection, uid) => {
        console.log("CALL DEBUG video: onUserJoined", { channelName: connection.channelId, remoteUid: uid });
        // Video-call lifecycle audit — only stamp the FIRST real connect.
        // A reconnect after a transient onUserOffline (see below) fires
        // onUserJoined again for the same uid; overwriting connectedAtRef
        // here would silently reset the call's duration bookkeeping every
        // time the network blips.
        if (!connectedAtRef.current) {
          connectedAtRef.current = Date.now();
          // WhatsApp-style ringing lifecycle — the callee's video.tsx only
          // ever mounts (and joins) after they've tapped Accept, so this
          // device seeing the callee's uid join IS the acceptance signal.
          // Only the caller needs this (the callee already published from
          // its own initialPublishVideo:true) — a no-op if cameraOn is
          // already false (e.g. the caller toggled their camera off while
          // still ringing).
          if (isInitiator && cameraOn) engineRef.publishVideoNow();
          // Stage 26B — start background support only on the real first
          // connect. isVideo reflects mediaMode at that exact moment (this
          // screen defaults to "video"); it is not re-evaluated if the
          // user later toggles Video<->Audio mid-call — a known, minor
          // simplification documented in the Stage 26B report, not a
          // functional break (the base microphone service type stays
          // valid regardless of mode).
          startCallBackgroundSupport(mediaMode === "video");
        }
        setCallState("connected");
        setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        // WhatsApp-style lifecycle — the remote RtcSurfaceView mounts as
        // soon as the participant's UID is known (remoteUids above), not
        // once onRemoteVideoStateChanged happens to report Decoding. This
        // just sets the INITIAL video-on assumption the instant they join
        // (true — optimistic, matching "mount on presence"); the real state
        // reported by onRemoteVideoStateChanged below still overrides it
        // (e.g. to false if their camera is actually off), it just no
        // longer gates the FIRST mount.
        setRemoteVideoOn((prev) => (uid in prev ? prev : { ...prev, [uid]: true }));
        // A genuine reconnect: cancel that uid's pending grace-period
        // removal and clear its "reconnecting" UI state.
        const pendingTimer = reconnectTimersRef.current.get(uid);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          reconnectTimersRef.current.delete(uid);
        }
        setDisconnectedUids((prev) => {
          if (!prev.has(uid)) return prev;
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
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
      // WhatsApp-style lifecycle — previously only RemoteVideoStateDecoding
      // counted as "show the surface," which meant the renderer was gated
      // on reaching Decoding rather than on the participant's presence (see
      // onUserJoined above, which now sets this true immediately on join).
      // Now only an explicit Stopped falls back to the avatar — Starting/
      // Decoding/Frozen all keep the surface mounted; this avoids
      // mount/unmount cycling the native view on every transient state
      // change while still showing the avatar for a genuinely stopped/off
      // camera.
      onRemoteVideoStateChanged: (connection, uid, state) => {
        console.log("CALL DEBUG video: onRemoteVideoStateChanged", { channelName: connection.channelId, remoteUid: uid, state });
        setRemoteVideoOn((prev) => ({ ...prev, [uid]: state !== RemoteVideoState.RemoteVideoStateStopped }));
      },
      // Video-call lifecycle audit — Agora's `reason` separates the two
      // cases: UserOfflineQuit is a deliberate hang-up, so the call ends now
      // with no "reconnecting" banner. UserOfflineDropped (a connection
      // timeout) keeps the uid in remoteUids/remoteVideoOn (so `connected`
      // and the tile stay put), marks it "reconnecting", and only removes it
      // if RECONNECT_GRACE_MS elapses with no rejoin (onUserJoined above
      // cancels this if they come back).
      onUserOffline: (connection, uid, reason) => {
        console.log("CALL DEBUG video: onUserOffline", { channelName: connection.channelId, remoteUid: uid, reason });
        activeSpeaker.clearIfActive(uid);
        const removeRemote = () => {
          reconnectTimersRef.current.delete(uid);
          setDisconnectedUids((prev) => {
            if (!prev.has(uid)) return prev;
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
          setRemoteUids((prev) => {
            const next = prev.filter((u) => u !== uid);
            if (next.length === 0) handleEndCall(reason === AGORA_USER_OFFLINE_QUIT ? "remote_end" : "user");
            return next;
          });
          setRemoteVideoOn((prev) => {
            if (!(uid in prev)) return prev;
            const next = { ...prev };
            delete next[uid];
            return next;
          });
          // Study Together C4.7/C4.3 — report ANY departed study
          // participant, not just the leader, via refs since this handler
          // is registered once at mount (see useAgoraEngine.native.ts) and
          // would otherwise read stale state.
          const liveStudy = studyRef.current;
          if (liveStudy.isActive && liveStudy.isGroup) {
            const departed = groupParticipantsRef.current.find((p) => p.uid === uid);
            if (departed) {
              void liveStudy.reportParticipantDeparture(departed.userId);
            }
          }
        };
        if (reason === AGORA_USER_OFFLINE_QUIT) {
          const pending = reconnectTimersRef.current.get(uid);
          if (pending) clearTimeout(pending);
          removeRemote();
          return;
        }
        setDisconnectedUids((prev) => {
          if (prev.has(uid)) return prev;
          const next = new Set(prev);
          next.add(uid);
          return next;
        });
        if (reconnectTimersRef.current.has(uid)) return; // no duplicate timers
        reconnectTimersRef.current.set(uid, setTimeout(removeRemote, RECONNECT_GRACE_MS));
      },
      // Video-call lifecycle audit — this previously force-disabled the
      // local camera (setCameraOn(false) + engine.enableLocalVideo(false))
      // after 3 consecutive bad samples, which is exactly the "silently
      // downgrades to audio-only" behavior a video call must never do.
      // Agora's own encoder already adapts bitrate/resolution to network
      // conditions on its own; this handler now only ever drives the
      // "Connection unstable" warning banner, never touches video enablement.
      onNetworkQuality: (_connection, uid, txQuality, rxQuality) => {
        if (uid !== 0) return; // only the local user's own uplink/downlink
        const worst = Math.max(txQuality, rxQuality);
        if (worst >= QualityType.QualityBad) {
          poorQualityStreakRef.current += 1;
          // A few consecutive bad samples (not just one blip) before warning.
          if (poorQualityStreakRef.current >= 3 && !poorConnection) setPoorConnection(true);
        } else {
          poorQualityStreakRef.current = 0;
          if (poorConnection) setPoorConnection(false);
        }
      },
    },
  });

  useEffect(() => {
    if (!connectedAtRef.current) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [connected]);

  // Video-call lifecycle audit — safety net for reconnect-grace timers on
  // unmount (handleEndCall already clears them on every normal exit path;
  // this only guards against an unmount that bypasses it).
  useEffect(() => {
    return () => {
      reconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
      reconnectTimersRef.current.clear();
      // CALL NAV TRACE (automatic-second-call investigation).
      console.log("CALL NAV TRACE: video.tsx unmounted", { mountId: mountIdRef.current, timestamp: new Date().toISOString() });
    };
  }, []);

  // Stage 7 — background/foreground continuity: iOS stops camera capture
  // while the app is backgrounded (a platform requirement, not a bug) and
  // does not always resume it automatically once foregrounded again. This
  // only re-issues the SAME enableLocalVideo call toggleCamera already uses
  // — no leaveChannel/joinChannel, no engine recreation, no channel/token/
  // UID change — and only when the user's own cameraOn state says the
  // camera should currently be on (a user who deliberately turned it off
  // while backgrounded is not overridden back on by this). Audio is not
  // included here: the Agora SDK/OS already keep the mic session alive in
  // the background for an active VoIP-style call; this app does not declare
  // a UIBackgroundModes audio/voip entry in app.json, so a real background
  // audio drop is a native-config limitation, not something a JS-level
  // re-enable call can fix (documented, not worked around here).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && cameraOn) {
        engineRef.current?.enableLocalVideo(true);
      }
    });
    return () => subscription.remove();
  }, [cameraOn]);

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
          console.log("CALL REALTIME TRACE: video.tsx call_watch update", {
            mountId: mountIdRef.current, callId: params.callId, channelName: params.channelName,
            status, timestamp: new Date().toISOString(),
          });
          // See audio.tsx's identical mapping.
          if (status === "declined") handleEndCall("declined");
          else if (status === "busy") handleEndCall("busy");
          else if (status === "missed") handleEndCall("no_answer");
          else if (status === "cancelled") handleEndCall();
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
      console.log("CALL TIMEOUT DEBUG video: firing", {
        callId: params.callId, channelName: params.channelName, callState: callStateRef.current,
        elapsedMs: Date.now() - callMountAtRef.current, timeoutSource: "NO_ANSWER_TIMEOUT_MS",
      });
      // Stage 22 — replaces the previous plain Alert with the dedicated
      // "No answer" result screen; see handleEndCall's "no_answer" branch.
      handleEndCall("no_answer");
    }, NO_ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInitiator, connected, handleEndCall]);

  // CALL DEBUG forensic fix — see audio.tsx's identical effects/comments.
  // Gated on readyToJoin (see its declaration above) so this can't start
  // counting down while still waiting on the Android permission dialog(s).
  useEffect(() => {
    if (callState !== "joining_channel" || !readyToJoin) return;
    const timeoutArmedAt = Date.now();
    const timer = setTimeout(() => {
      console.log("CALL TIMEOUT DEBUG video: firing", {
        callId: params.callId, channelName: params.channelName, callState: "joining_channel",
        elapsedMs: Date.now() - callMountAtRef.current, timeoutSource: "JOIN_CHANNEL_TIMEOUT_MS",
        armedForMs: Date.now() - timeoutArmedAt,
      });
      failureMessageRef.current = "Couldn't connect this call. Please check your connection and try again.";
      setCallState((s) => (s === "joining_channel" ? "failed" : s));
    }, JOIN_CHANNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState, readyToJoin]);

  useEffect(() => {
    if (isInitiator || callState !== "waiting_for_peer") return;
    const timer = setTimeout(() => {
      console.log("CALL TIMEOUT DEBUG video: firing", {
        callId: params.callId, channelName: params.channelName, callState: "waiting_for_peer",
        elapsedMs: Date.now() - callMountAtRef.current, timeoutSource: "PEER_WAIT_TIMEOUT_MS",
      });
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
    // Stage 6 — unmuting IS the retry gesture for a prior mic-permission
    // denial; a still-genuine denial has no other JS-visible signal to
    // re-assert it, same limitation as the camera-retry fix below.
    if (!next) setMicUnavailable(false);
  }
  function toggleCamera() {
    const next = !cameraOn;
    setCameraOn(next);
    engineRef.current?.enableLocalVideo(next);
    // WhatsApp-style ringing lifecycle — per Agora's own docs,
    // enableLocalVideo(true) alone does not resume PUBLISHING once stopped;
    // updateChannelMediaOptions is required too. Needed specifically for:
    // caller turns camera off while ringing (so publishVideoNow in
    // onUserJoined above was skipped), then turns it back on — without
    // this, the remote side would never start receiving video. Harmless/
    // idempotent if publishing was already on.
    if (next && connected) engineRef.publishVideoNow();
    // Stage 5 — turning the camera back on IS the user's retry gesture
    // after a prior onCameraUnavailable; clear the banner so a successful
    // retry doesn't keep showing a stale "unavailable" warning. A genuine
    // still-denied camera fires onCameraUnavailable again on its own.
    if (next) setCameraUnavailable(false);
  }
  function flipCamera() {
    engineRef.current?.switchCamera();
  }
  // Same primitive audio.tsx's speaker toggle uses. useAgoraEngine turns
  // speakerphone on at join, so speakerOn starts true to match.
  function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    engineRef.current?.setEnableSpeakerphone(next);
  }
  // Subtle skin smoothing via Agora's built-in beauty pipeline (full SDK,
  // already linked on iOS and Android). Applied to the local camera capture
  // before encoding, so the renderers are untouched. Smoothing plus a little
  // sharpness to keep real skin texture; lightening and redness stay at 0 so
  // skin tone is never altered. A negative return (-4 = device can't run it)
  // is reported honestly instead of leaving a toggle that does nothing.
  function toggleFilter() {
    const next = !filterOn;
    const engine = engineRef.current;
    if (!engine) return;
    const result = engine.setBeautyEffectOptions(next, {
      smoothnessLevel: 0.4, sharpnessLevel: 0.3, lighteningLevel: 0, rednessLevel: 0,
    });
    if (typeof result === "number" && result < 0) {
      setFilterOn(false);
      if (next) {
        showAlert(
          "Filter not available",
          result === -4
            ? "This device can't run the smoothing filter during a call."
            : "The smoothing filter couldn't be turned on. Please try again.",
        );
      }
      return;
    }
    setFilterOn(next);
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
  // WhatsApp-style call redesign — Feature B (Video<->Audio, user-controlled
  // only). Deliberately the SAME primitive as the manual camera toggle above
  // (engine.enableLocalVideo) — this is an intentional, explicit media-mode
  // choice, never the automatic network/camera fallback that was removed
  // from onNetworkQuality/onCameraUnavailable. No leaveChannel/joinChannel,
  // no engine recreation, no getToken, no touching remoteUids/remoteVideoOn/
  // connectedAtRef — the call, channel, and uid are completely unaffected;
  // only the local video track and this screen's own chrome change. The
  // remote tile is untouched by either of these and keeps reflecting its
  // own real state (remoteVideoOn) regardless of my mediaMode.
  // Rapid Audio/Video taps: ignore a switch that arrives before the previous
  // one could settle, so the camera is never toggled on/off in a burst.
  const lastModeSwitchAtRef = useRef(0);
  function modeSwitchAllowed(): boolean {
    const now = Date.now();
    if (now - lastModeSwitchAtRef.current < MODE_SWITCH_COOLDOWN_MS) return false;
    lastModeSwitchAtRef.current = now;
    return true;
  }
  function switchToAudioMode() {
    if (mediaMode === "audio" || !modeSwitchAllowed()) return;
    setMediaMode("audio");
    setCameraOn(false);
    engineRef.current?.enableLocalVideo(false);
    // Android: the background-call service no longer needs camera access.
    if (connected) startCallBackgroundSupport(false);
  }
  // A call that started as audio never asked for the camera or started its
  // preview (startWithCameraOff) — both happen on the first switch to video.
  const cameraReadyRef = useRef(!startsAsAudio);
  const switchingToVideoRef = useRef(false);
  async function ensureCameraReady(): Promise<boolean> {
    if (cameraReadyRef.current) return true;
    if (Platform.OS === "android") {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
    } else if (Platform.OS === "ios") {
      const { granted } = await Camera.requestCameraPermissionsAsync();
      if (!granted) return false;
    }
    engineRef.current?.startPreview();
    cameraReadyRef.current = true;
    return true;
  }
  async function switchToVideoMode() {
    if (mediaMode === "video" || switchingToVideoRef.current) return;
    // No camera access (permission denied / camera in use): stay in audio —
    // the call itself is never interrupted by this.
    const unavailableMessage = "Allow camera access for P2P Global in Settings to switch to video. Your call continues as audio.";
    if (cameraUnavailable) {
      showAlert("Camera unavailable", unavailableMessage);
      return;
    }
    if (!modeSwitchAllowed()) return;
    switchingToVideoRef.current = true;
    try {
      if (!(await ensureCameraReady())) {
        showAlert("Camera unavailable", unavailableMessage);
        return;
      }
    } finally {
      switchingToVideoRef.current = false;
    }
    setMediaMode("video");
    setCameraOn(true);
    engineRef.current?.enableLocalVideo(true);
    // WhatsApp-style ringing lifecycle — same resume-publishing requirement
    // as toggleCamera above.
    if (connected) engineRef.publishVideoNow();
    // Android: the background-call service now covers the camera too.
    if (connected) startCallBackgroundSupport(true);
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
      {/* LOCAL VIDEO FIX — same localJoined gate as selfTile above, same
          race-prevention rationale (this is a second, separate local
          RtcSurfaceView instance). */}
      {cameraOn && localJoined && (
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
  // comment. Remote tiles' videoOn now comes from a real per-uid signal
  // (remoteVideoOn, driven by onRemoteVideoStateChanged above) instead of
  // being hardcoded true. Video-call lifecycle audit — no longer gated on
  // this device's own poorConnection signal: remote video should keep
  // showing whenever it's actually still being decoded, regardless of our
  // own uplink/downlink quality; remoteVideoOn already reflects Agora's own
  // real per-uid decode state (Stopped/Frozen/Failed already fall back to
  // the avatar on their own, see onRemoteVideoStateChanged above).
  const otherTiles: P2POrbitTile[] = remoteUids.map((uid) => ({
    uid, isSelf: false,
    name: remoteUids.length === 1 ? otherName : (groupParticipants.find((p) => p.uid === uid)?.name ?? "Someone"),
    videoOn: !!remoteVideoOn[uid], muted: false,
    photoUrl: remoteUids.length === 1 ? peerPhotoUrl : (groupParticipants.find((p) => p.uid === uid)?.photoUrl ?? null),
  }));
  // LOCAL VIDEO FIX (iOS local-preview investigation) — videoOn gated on
  // localJoined, not just cameraOn. Root cause (confirmed from the installed
  // react-native-agora iOS native source, AgoraRtcSurfaceView.mm): its
  // updateProps sets _isInitialized=YES unconditionally, even when the
  // Agora engine (irisApiEngine) doesn't exist yet and the native bind call
  // is skipped — and since canvas={{uid:0}} never changes for this tile's
  // lifetime, that bind is never retried. selfTile was previously
  // constructed unconditionally from the very first render, so its
  // RtcSurfaceView mounted (and made its one-and-only bind attempt) before
  // the engine existed — createAgoraRtcEngine() only runs after an async
  // token fetch. The remote tile never hits this: it only mounts once
  // remoteUids is non-empty, which can only happen after the engine is
  // already running. Gating on localJoined (set in onJoinChannelSuccess,
  // after the engine/registerEventHandler/startPreview/enableVideo/
  // joinChannel sequence has already run) delays the local RtcSurfaceView's
  // first mount until the engine genuinely exists, matching remote's
  // natural timing. Does not touch P2PRectStage.tsx/Tile, remote rendering,
  // or any Agora/token/channel call.
  const selfTile: P2POrbitTile = { uid: 0, isSelf: true, name: profile?.displayName || "You", videoOn: cameraOn && localJoined, muted, photoUrl: profile?.avatarUrl ?? null };
  const allTiles = [selfTile, ...otherTiles];
  // Audio mode with no video from either side in a 1:1 call → the
  // person-centred audio presentation instead of an empty video stage.
  const anyRemoteVideo = remoteUids.some((uid) => !!remoteVideoOn[uid]);
  const audioPresentation = mediaMode === "audio" && !anyRemoteVideo && remoteUids.length <= 1;
  const peerSpeaking = remoteUids.some((uid) => activeSpeaker.speakingUids.has(uid));
  const portraitSize = Math.round(Math.min(screenWidth * 0.52, 220));

  // Stage 22 — dedicated "No answer" result, replacing the previous plain
  // Alert. Only reached via handleEndCall("no_answer"), which has already
  // torn the Agora engine down (setToken(null)) and reported /calls/end —
  // presentation only below, no media/engine calls of any kind.
  if (callState === "no_answer") {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "space-between", paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={styles.noAnswerAvatarWrap}>
            {peerPhotoUrl ? (
              <Image source={{ uri: peerPhotoUrl }} style={styles.noAnswerAvatarPhoto} />
            ) : (
              <Ionicons name="person" size={48} color={p2pColors.textMuted} />
            )}
          </View>
          <Text style={styles.noAnswerName}>{otherName}</Text>
          <Text style={styles.noAnswerStatus}>{UNANSWERED_LABEL[unansweredOutcome]}</Text>
        </View>
        <View style={styles.noAnswerActions}>
          <TouchableOpacity style={styles.noAnswerSecondaryBtn} onPress={navigateBack} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.noAnswerSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          {!!params.conversationId && (
            <TouchableOpacity style={styles.noAnswerSecondaryBtn} onPress={handleRecordVoice} accessibilityRole="button" accessibilityLabel="Record voice message">
              <Ionicons name="mic-outline" size={16} color={p2pColors.textPrimary} />
              <Text style={styles.noAnswerSecondaryText}>Record voice message</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.noAnswerPrimaryBtn, { backgroundColor: p2pColors.accent }]}
            onPress={handleCallAgain}
            disabled={callingAgain}
            accessibilityRole="button"
            accessibilityLabel="Call again"
          >
            {callingAgain ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="videocam" size={16} color="#fff" />
                <Text style={styles.noAnswerPrimaryText}>Call again</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
      {/* PiP TAP FIX (iOS local-preview investigation) — this row spans the
          full screen width (left:0, right:0) with zIndex:2, including an
          invisible spacer View at its right edge (purely there to balance
          the back button for centering the brand text). That spacer's
          bounds overlapped the PiP tile's upper portion and, being stacked
          above it, intercepted taps meant for the PiP's swap gesture —
          confirmed via device test (tapping the PiP's lower half, outside
          this row's vertical band, worked; its upper half didn't).
          box-none makes this container itself pass touches through to
          whatever is behind it; its interactive children (the back button
          below) are unaffected and keep receiving taps normally. */}
      <View pointerEvents="box-none" style={[styles.header, { top: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => handleEndCall()} accessibilityRole="button" accessibilityLabel="End call and go back">
          <Ionicons name="chevron-back" size={22} color={p2pColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ alignItems: "center", flex: 1, paddingHorizontal: 12 }} pointerEvents="none">
          {!audioPresentation && <Text style={styles.headerName} numberOfLines={1} accessibilityRole="header">{otherName}</Text>}
        </View>
        <View style={{ width: 22 }} />
      </View>
      {/* PiP TAP FIX — same pattern/rationale as the header above: full-width,
          zIndex:2 wrapper whose content (the pill) is centered, leaving
          empty-but-still-present space on either side that could intercept
          taps meant for whatever's behind it. */}
      <View pointerEvents="box-none" style={[styles.callTypePillWrap, { top: insets.top + 56 }]}>
        <View style={styles.callTypePill}>
          <Ionicons name={mediaMode === "video" ? "videocam" : "pulse"} size={12} color={p2pColors.accent} />
          <Text style={styles.callTypePillText}>{mediaMode === "video" ? "P2P Global Video" : "P2P Global Audio"}</Text>
        </View>
      </View>

      <View style={styles.orbitArea}>
        {audioPresentation ? (
          <>
            {/* Audio mode with no video on either side: the person-centred
                audio presentation (same as the audio call screen). The
                video stage returns the moment either side turns video on. */}
            {peerPhotoUrl && (
              <ExpoImage
                source={{ uri: peerPhotoUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={40}
                cachePolicy="memory-disk"
                accessibilityIgnoresInvertColors
              />
            )}
            {peerPhotoUrl && <View style={[StyleSheet.absoluteFill, styles.backdropShade]} pointerEvents="none" />}
            <View style={styles.peerBlock}>
              <View
                style={[
                  styles.peerRing,
                  { width: portraitSize + 16, height: portraitSize + 16, borderRadius: (portraitSize + 16) / 2 },
                  peerSpeaking && { borderColor: p2pColors.accent },
                ]}
              >
                {peerPhotoUrl ? (
                  <ExpoImage
                    source={{ uri: peerPhotoUrl }}
                    style={{ width: portraitSize, height: portraitSize, borderRadius: portraitSize / 2 }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={150}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Avatar name={otherName} size={portraitSize} />
                )}
              </View>
              <Text style={styles.peerName} numberOfLines={1} accessibilityRole="header">{otherName}</Text>
            </View>
          </>
        ) : (
          <P2PRectStage
            tiles={allTiles}
            speakingUids={activeSpeaker.speakingUids}
            colors={p2pColors}
            mainIsSelf={mainIsSelf}
            onSwapMain={() => setMainIsSelf((v) => !v)}
          />
        )}
        {callState !== "connected" && callState !== "ended" && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={p2pColors.textPrimary} size="small" />
            <Text style={styles.statusText}>
              {callState === "waiting_for_peer" && isInitiator ? "Ringing…" : "Connecting…"}
            </Text>
          </View>
        )}
      </View>

      {/* Smoothing filter sits beside your own video because it is about how
          you look; background blur moved into the More sheet. */}
      {cameraOn && mediaMode === "video" && (
        <TouchableOpacity
          style={[styles.filterPill, filterOn && { borderColor: p2pColors.accent, backgroundColor: p2pColors.pillBg }]}
          onPress={toggleFilter}
          activeOpacity={0.85}
          accessibilityRole="switch"
          accessibilityState={{ checked: filterOn }}
          accessibilityLabel="Smoothing filter"
        >
          <Ionicons name="sparkles" size={13} color={filterOn ? p2pColors.accent : p2pColors.textPrimary} />
          <Text style={[styles.filterPillText, { color: filterOn ? p2pColors.accent : p2pColors.textPrimary }]}>Smooth</Text>
        </TouchableOpacity>
      )}

      {/* Video-call lifecycle audit — this used to read "Poor connection —
          switched to audio only" alongside code that actually did switch
          it. The call now stays on video through poor network; this is a
          warning only. Stacked with the other two below when more than one
          applies at once. */}
      {poorConnection && (
        <View style={[styles.banner, { top: insets.top + 10 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={styles.bannerText}>Connection unstable — trying to maintain video</Text>
        </View>
      )}

      {cameraUnavailable && (
        <View style={[styles.banner, { top: insets.top + (poorConnection ? 54 : 10) }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="videocam-off" size={14} color="#fff" />
          <Text style={styles.bannerText}>Camera unavailable — you're still connected by audio. Use the camera button below to retry.</Text>
        </View>
      )}

      {micUnavailable && (
        <View style={[styles.banner, { top: insets.top + (poorConnection ? 54 : 10) + (cameraUnavailable ? 44 : 0) }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="mic-off" size={14} color="#fff" />
          <Text style={styles.bannerText}>Microphone unavailable — check your permission settings and unmute to retry.</Text>
        </View>
      )}

      {disconnectedUids.size > 0 && (
        <View style={[styles.banner, { top: insets.top + (poorConnection ? 54 : 10) + (cameraUnavailable ? 44 : 0) + (micUnavailable ? 44 : 0) }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="cloud-offline" size={14} color="#fff" />
          <Text style={styles.bannerText}>{otherName} disconnected — reconnecting…</Text>
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

        {/* Main row: the controls used constantly during a call. Less
            frequent ones live in the More sheet below. End Call is always
            last and always red. */}
        {/* Speaker · Audio/Video switch · Mute · (Camera · Flip — video
            mode only) · More · End. The switch shows the ACTION available:
            "Audio" in video mode, "Video" in audio mode — never both. */}
        <View style={styles.controlsRow}>
          <P2PControlButton size={controlSize} onPress={toggleSpeaker} active={speakerOn} accessibilityLabel={speakerOn ? "Turn speaker off" : "Turn speaker on"} colors={p2pColors}>
            <Ionicons name={speakerOn ? "volume-high" : "volume-medium-outline"} size={20} color={speakerOn ? p2pColors.accent : p2pColors.textPrimary} />
          </P2PControlButton>
          <P2PControlButton
            size={controlSize}
            onPress={mediaMode === "video" ? switchToAudioMode : switchToVideoMode}
            accessibilityLabel={mediaMode === "video" ? "Switch to audio" : "Switch to video"}
            colors={p2pColors}
          >
            <Ionicons name={mediaMode === "video" ? "call-outline" : "videocam-outline"} size={20} color={p2pColors.textPrimary} />
          </P2PControlButton>
          <P2PControlButton size={controlSize} onPress={toggleMute} active={muted} accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"} colors={p2pColors}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={20} color={muted ? p2pColors.accent : p2pColors.textPrimary} />
          </P2PControlButton>
          {mediaMode === "video" && (
            <P2PControlButton
              size={controlSize}
              onPress={toggleCamera}
              active={!cameraOn}
              accessibilityLabel={cameraOn ? "Turn camera off" : "Turn camera on"}
              colors={p2pColors}
            >
              <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={20} color={!cameraOn ? p2pColors.accent : p2pColors.textPrimary} />
            </P2PControlButton>
          )}
          {mediaMode === "video" && (
            <P2PControlButton size={controlSize} onPress={flipCamera} disabled={!cameraOn} accessibilityLabel="Switch camera" colors={p2pColors}>
              <Ionicons name="camera-reverse" size={20} color={cameraOn ? p2pColors.textPrimary : p2pColors.textMuted} />
            </P2PControlButton>
          )}
          <P2PControlButton size={controlSize} onPress={() => setMoreOpen(true)} accessibilityLabel="More call options" colors={p2pColors}>
            <Ionicons name="ellipsis-horizontal" size={20} color={p2pColors.textPrimary} />
          </P2PControlButton>
          <P2PControlButton size={controlSize} onPress={() => handleEndCall()} danger accessibilityLabel="End call" colors={p2pColors}>
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </P2PControlButton>
        </View>
      </View>

      <CallMoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        colors={p2pColors}
        actions={[
          ...(mediaMode === "video" && cameraOn
            ? [{ key: "blur", icon: "aperture-outline", label: "Background blur", detail: blurOn ? "On" : "Off", active: blurOn, onPress: toggleBlur } as CallMoreAction]
            : []),
          ...(callState === "connected"
            ? [{ key: "study", icon: "school-outline", label: "Study Together", onPress: handleOpenStudy } as CallMoreAction]
            : []),
          ...(sessionQuestions.length > 0
            ? [{ key: "questions", icon: "list-outline", label: "Lesson questions", onPress: () => setLessonSidebarVisible(true) } as CallMoreAction]
            : []),
          ...(canAddPeople
            ? [{ key: "add-people", icon: "person-add-outline", label: "Add someone to this call", onPress: () => setAddPeopleOpen(true) } as CallMoreAction]
            : []),
        ]}
      />

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
    // Stage 22 — "No answer" result screen.
    noAnswerAvatarWrap: {
      width: 128, height: 128, borderRadius: 64, backgroundColor: p2p.pillBg,
      alignItems: "center", justifyContent: "center", overflow: "hidden",
      borderWidth: 1.5, borderColor: p2p.accentBorder, marginBottom: 20,
    },
    noAnswerAvatarPhoto: { width: "100%", height: "100%" },
    noAnswerName: { fontSize: 24, fontWeight: "700", color: p2p.textPrimary, fontFamily: "Inter_700Bold" },
    noAnswerStatus: { fontSize: 15, color: p2p.textMuted, fontFamily: "Inter_400Regular", marginTop: 6 },
    noAnswerActions: { width: "100%", paddingHorizontal: 24, gap: 12 },
    noAnswerSecondaryBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderWidth: 1, borderColor: p2p.surfaceBorder, borderRadius: 14, paddingVertical: 14,
    },
    noAnswerSecondaryText: { color: p2p.textPrimary, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    noAnswerPrimaryBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderRadius: 14, paddingVertical: 14,
    },
    noAnswerPrimaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    header: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, zIndex: 2 },
    // The other person's name over the live video — shadowed so it reads on
    // any picture.
    headerName: {
      color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold",
      textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
    },
    callTypePillWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 2 },
    callTypePill: {
      flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: p2p.pillBg,
      borderWidth: 1, borderColor: p2p.accentBorder, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    },
    callTypePillText: { color: p2p.accent, fontSize: 12, fontFamily: "Inter_600SemiBold" },
    orbitArea: { flex: 1, alignItems: "center", justifyContent: "center" },
    // Audio-mode presentation (see audioPresentation) — mirrors audio.tsx.
    backdropShade: { backgroundColor: "rgba(6,12,9,0.62)" },
    peerBlock: { alignItems: "center", gap: 18 },
    peerRing: { alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.14)" },
    peerName: {
      color: p2p.textPrimary, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center",
      letterSpacing: -0.3, paddingHorizontal: 24, maxWidth: "100%",
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    statusText: { color: p2p.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
    // Just below the PiP tile (P2PRectStage's pipTile: top 16 + height 122).
    filterPill: {
      position: "absolute", top: 148, right: 16, height: 32, paddingHorizontal: 12, borderRadius: 16,
      flexDirection: "row", alignItems: "center", gap: 5,
      backgroundColor: withAlpha(p2p.bg, 0.6), borderWidth: 1, borderColor: p2p.surfaceBorder, zIndex: 2,
    },
    filterPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
    // maxWidth keeps the six buttons grouped on tablets instead of spread edge to edge.
    controlsRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", maxWidth: 440, alignSelf: "center" },
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