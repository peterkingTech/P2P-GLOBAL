import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import { authedFetch } from "@/lib/adminFetch";
import { resolveCallParticipants, CallParticipant } from "@/lib/callParticipants";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import { StudyTogetherOverlay } from "@/components/study/StudyTogetherOverlay";
import { StudySessionSummary } from "@/components/study/StudySessionSummary";
import { AddPeopleSheet } from "@/components/call/AddPeopleSheet";

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

// CALL DEBUG forensic fix — two gaps the prior audit missed:
//   1. Nothing timed out "joining_channel" itself. If Agora's joinChannel()
//      call never reaches onJoinChannelSuccess (silent SDK-level stall —
//      no onError, no state change), the UI sat there forever. This bounds
//      that specific step for BOTH caller and recipient.
//   2. NO_ANSWER_TIMEOUT_MS above only ever applied to the caller
//      (isInitiator-gated). A recipient who taps Accept and then has their
//      OWN joinChannel/onUserJoined sequence stall had — and until this
//      fix, still has — literally zero timeout of any kind. This bounds
//      "waiting_for_peer" for whichever party doesn't already have a
//      timer covering it.
const JOIN_CHANNEL_TIMEOUT_MS = 15000;
const PEER_WAIT_TIMEOUT_MS = 45000;

// react-native-agora's ConnectionStateType.ConnectionStateFailed (=5). Not
// imported as a value from "react-native-agora" here on purpose — that
// package statically pulls in native-only RN internals
// (codegenNativeComponent) that break Metro's web bundle the instant any
// file importing it is reachable from a route (see useAgoraEngine.native.ts
// / .web.ts's platform split, which exists specifically to keep the real
// package out of the web bundle). The numeric value itself is stable/
// documented Agora SDK API, confirmed against node_modules/react-native-agora's
// own type definitions.
const AGORA_CONNECTION_STATE_FAILED = 5;

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
  // CALL DEBUG fix — the appId the token was actually minted for, always
  // used to initialize the engine instead of the client's own local env
  // constant (see useAgoraEngine.native.ts).
  const [tokenAppId, setTokenAppId] = useState<string | undefined>(undefined);
  // CALL DEBUG fix — this was previously `useRef(profile?.id ? uidFromUserId(profile.id) : 1).current`,
  // which freezes on the FIRST render only. If profile hadn't loaded yet at
  // that exact moment (a real race on a cold start / fast navigation into a
  // call), this device's uid silently locked to the generic fallback `1`
  // forever, even once profile arrived — two devices hitting this at once
  // both become uid 1, an actual Agora join collision. useMemo instead
  // recomputes whenever profile?.id changes, and every effect that uses
  // myUid below is gated on profile.id existing at all (see requestToken
  // effect), so a token is never requested with a placeholder identity.
  const myUid = useMemo(() => (profile?.id ? uidFromUserId(profile.id) : null), [profile?.id]);

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
  // CALL DEBUG fix — explicit state machine (was "connecting" | "ringing" |
  // "connected" | "ended", where "ringing" ambiguously meant "Calling…" for
  // BOTH the caller and, after answering, the recipient too). Now:
  //   requesting_token -> joining_channel -> waiting_for_peer -> connected -> ended
  //                                                            \-> failed
  // "waiting_for_peer" is the only state where the UI's label differs by
  // role (isInitiator shows "Calling…", the recipient shows "Connecting…")
  // — see the render below. Nothing here is set to "connected" except the
  // real onUserJoined callback from Agora itself (never a UI shortcut).
  // "failed" is distinct from "ended": it means Agora itself reported the
  // connection could never be established (onConnectionStateChanged ->
  // ConnectionStateFailed) or a join-step timeout elapsed — as opposed to
  // "ended", which means the call genuinely connected or was deliberately
  // stopped (hangup/decline/cancel). Both still funnel through the same
  // handleEndCall for cleanup/reporting/navigation (see below).
  const [callState, setCallState] = useState<
    "requesting_token" | "joining_channel" | "waiting_for_peer" | "connected" | "failed" | "ended"
  >("requesting_token");
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
  // CALL DEBUG forensic fix — set immediately before transitioning to
  // "failed" at every failure site, read once by the dedicated "failed"
  // handling effect below. A ref (not state) since it only needs to be
  // read once, synchronously, when that effect runs.
  const failureMessageRef = useRef<string>("Unable to connect. Please try again.");

  // CALL DEBUG fix — gated on myUid (derived from profile?.id) actually
  // existing. Previously this ran unconditionally on mount with whatever
  // uid was available at that instant (possibly the frozen "1" fallback)
  // and, on failure, silently moved straight to "ended" with zero surfaced
  // reason (matches the reported bug's exact "swallowed token error"
  // symptom). Now: never requests a token with a placeholder identity, and
  // logs the real failure before giving up.
  useEffect(() => {
    if (!myUid || !profile?.id) {
      console.log("CALL DEBUG audio: waiting for authenticated profile before requesting token", { hasProfile: !!profile?.id });
      return;
    }
    let cancelled = false;
    console.log("CALL DEBUG audio: requesting token", {
      channelName: params.channelName, uid: myUid, isInitiator, callId: params.callId, callLogId: params.callLogId,
    });
    (async () => {
      try {
        const { token: t, appId } = await getToken(params.channelName, myUid, profile.id);
        console.log("CALL DEBUG audio: token acquired", { channelName: params.channelName, uid: myUid });
        if (!cancelled) {
          setToken(t);
          setTokenAppId(appId);
          setCallState((s) => (s === "requesting_token" ? "joining_channel" : s));
        }
      } catch (e) {
        console.warn("CALL DEBUG audio: token request FAILED", { channelName: params.channelName, uid: myUid, error: e instanceof Error ? e.message : String(e) });
        // CALL DEBUG forensic fix — previously went straight to "ended" with
        // no alert and no /calls/end report, leaving a dead-end "Call ended"
        // screen with no way forward except the OS back gesture. "failed"
        // routes through the same handleEndCall as every other failure path
        // (see the dedicated effect below) — reports connected=false,
        // navigates back, and tells the user what happened.
        if (!cancelled) { failureMessageRef.current = "Couldn't connect this call. Please try again."; setCallState("failed"); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelName, myUid, profile?.id]);

  // CALL DEBUG forensic fix — handleEndCall now takes an optional reason so
  // a genuine connection failure can still report accurately to /calls/end
  // (connected is always derived from connectedAtRef, never guessed) while
  // also surfacing a real, honest message to the user instead of silently
  // vanishing into "Call ended". Every failure source in this file
  // (token-fetch failure, join-channel timeout, peer-wait timeout, Agora's
  // own ConnectionStateFailed) sets failureMessageRef and calls this with
  // reason="failed" rather than inventing its own cleanup path.
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
            callType,
            connected: wasConnected,
            durationSeconds,
            // Forensic calling audit — the only persisted record of the real
            // Agora onUserJoined moment (see migration 110). Never a UI
            // shortcut: this ref is only ever set from that exact callback.
            connectedAt: connectedAtRef.current ? new Date(connectedAtRef.current).toISOString() : null,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    function navigateBack() {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/messages" as any);
    }
    // A connection failure (never connected) is surfaced to the user with a
    // real reason before navigating away — a deliberate hangup needs no
    // such dialog. Alert.alert doesn't block, so navigation runs from its
    // onDismiss, matching the existing NO_ANSWER_TIMEOUT_MS pattern below.
    if (reason === "failed" && !wasConnected) {
      showAlert("Call failed", failureMessageRef.current, navigateBack);
    } else {
      navigateBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.callId, params.conversationId, callType]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: false,
    appId: tokenAppId,
    eventHandler: {
      // CALL DEBUG fix — this device successfully joined the Agora channel.
      // This is NOT "connected" (see section 5 of the audit): it only means
      // *this* device is in the channel, with no guarantee the other party
      // is. Previously nothing distinguished this from "waiting," and there
      // was no visibility at all into whether joinChannel ever actually
      // succeeded or silently failed (no onError/onConnectionStateChanged
      // were registered) — exactly the kind of failure that would present
      // as a permanent "Calling…" on both ends with zero diagnostic trail.
      onJoinChannelSuccess: (connection) => {
        console.log("CALL DEBUG audio: onJoinChannelSuccess", { channelName: connection.channelId, uid: connection.localUid });
        setCallState((s) => (s === "connected" ? s : "waiting_for_peer"));
      },
      // CALL DEBUG forensic fix — this was pure logging. Agora's own
      // ConnectionStateFailed is the SDK's authoritative "this can never
      // connect" signal (fired for, among other things, an App ID/token/
      // channel mismatch — see ConnectionChangedReasonType's
      // InvalidAppId/InvalidToken/InvalidChannelName/BannedByServer/
      // JoinFailed values) — previously nothing here ever left "Connecting…"
      // when the SDK itself already knew the join had permanently failed.
      onConnectionStateChanged: (connection, state, reason) => {
        console.log("CALL DEBUG audio: onConnectionStateChanged", { channelName: connection.channelId, state, reason });
        if (state === AGORA_CONNECTION_STATE_FAILED) {
          failureMessageRef.current = "The call connection failed. Please try again.";
          setCallState((s) => (s === "ended" ? s : "failed"));
        }
      },
      onError: (err, msg) => {
        console.warn("CALL DEBUG audio: onError", { err, msg });
      },
      onTokenPrivilegeWillExpire: () => {
        console.warn("CALL DEBUG audio: token privilege about to expire", { channelName: params.channelName });
      },
      // Another participant has actually joined and is available — THIS is
      // the real, only correct signal for "connected." Never set by
      // answering/pressing a button; only by Agora itself confirming the
      // remote party is present.
      onUserJoined: (connection, uid) => {
        console.log("CALL DEBUG audio: onUserJoined", { channelName: connection.channelId, remoteUid: uid });
        connectedAtRef.current = Date.now();
        setCallState("connected");
        setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
      },
      // Study Together C1: the call now only ends when the LAST remote
      // participant leaves, not simply "a" participant — for an existing
      // 1:1 call that's the exact same moment as before (one remote uid
      // going to zero), so this preserves current behavior unchanged
      // while letting a group call continue for whoever's left.
      onUserOffline: (connection, uid) => {
        console.log("CALL DEBUG audio: onUserOffline", { channelName: connection.channelId, remoteUid: uid });
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

  // CALL DEBUG forensic fix — bounds the "joining_channel" step itself
  // (waiting on Agora's onJoinChannelSuccess) for BOTH caller and
  // recipient. Previously nothing did: a silent SDK-level stall (no
  // onError, no onConnectionStateChanged — a genuine possibility, not just
  // a hypothetical) left the UI on "Connecting…"/"Calling…" forever.
  useEffect(() => {
    if (callState !== "joining_channel") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = "Couldn't connect this call. Please check your connection and try again.";
      setCallState((s) => (s === "joining_channel" ? "failed" : s));
    }, JOIN_CHANNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState]);

  // CALL DEBUG forensic fix — the recipient side of the exact gap the
  // forensic audit confirmed: NO_ANSWER_TIMEOUT_MS above only ever applied
  // to the caller. A recipient who tapped Accept and then had their own
  // join/onUserJoined sequence stall had zero timeout of any kind. This
  // does not touch the caller's existing 40s behavior at all.
  useEffect(() => {
    if (isInitiator || callState !== "waiting_for_peer") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = "Unable to reach the other person. Please try again.";
      setCallState((s) => (s === "waiting_for_peer" ? "failed" : s));
    }, PEER_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isInitiator, callState]);

  // CALL DEBUG forensic fix — the single place "failed" actually resolves:
  // reports connected=false to /calls/end, shows the real reason, and
  // navigates away — the same cleanup every other end-of-call path uses,
  // so there is no separate/duplicate ending logic to keep in sync.
  useEffect(() => {
    if (callState === "failed") handleEndCall("failed");
  }, [callState, handleEndCall]);

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
      <TouchableOpacity style={[styles.studyMiniBtn, styles.endBtn]} onPress={() => handleEndCall()}>
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

        {callState !== "connected" && callState !== "ended" ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#fff" size="small" />
            {/* "Calling…" is only ever accurate for the person who placed
                the call while genuinely still waiting on the other side —
                the recipient, even at this same waiting_for_peer state
                right after answering, sees "Connecting…" instead (section 3:
                "Calling…" must never be the recipient's catch-all label). */}
            <Text style={styles.statusText}>
              {callState === "waiting_for_peer" && isInitiator ? "Calling…" : "Connecting…"}
            </Text>
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
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={() => handleEndCall()}>
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