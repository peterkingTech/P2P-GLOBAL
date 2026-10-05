import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, ActivityIndicator } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { acceptCallInvitation, declineCallInvitation } from "@/lib/callInvitations";
import { useRingtone } from "@/hooks/useRingtone";
import { getP2PCallColors, P2P_END_CALL_RED } from "@/components/call/p2pCallTheme";
import type { P2PCallColors } from "@/components/call/p2pCallTheme";
import { useTheme } from "@/contexts/ThemeContext";
import { dismissCallNotifications } from "@/lib/callNotifications";
import { answerSystemCall, endSystemCall } from "@/lib/callSystem";
import { Avatar } from "@/components/Avatar";
import appColors from "@/constants/colors";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const RING_TIMEOUT_MS = 30000;
// Device clocks can disagree with the server's created_at by a few seconds:
// never ring for less than this, and only treat a still-"ringing" row as
// stale once it's past the server's own no-answer sweep (45s).
const MIN_RING_MS = 10000;
const STALE_CALL_MS = 45000;

const CALL_TYPE_LABEL: Record<CallType, string> = {
  audio: "Audio Call",
  video: "Video Call",
  pastoral: "Pastoral Check-in",
  crisis: "Crisis Alert",
};

export default function IncomingCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode } = useTheme();
  const p2pColors = getP2PCallColors(colors, resolvedMode);
  const styles = makeStyles(p2pColors);
  const params = useLocalSearchParams<{
    callId: string; channelName: string; callType: CallType; callerId: string; callerName?: string;
    conversationId?: string; callLogId?: string; invitationId?: string;
    // Set when Accept/Decline was pressed on the system notification.
    action?: "accept" | "decline";
    // The caller's profile photo when the opener already knows it (push
    // payload, realtime host) — shown at once instead of after a lookup.
    callerPhotoUrl?: string;
  }>();
  const notificationAction = params.action === "accept" || params.action === "decline" ? params.action : null;
  const callType = (params.callType as CallType) ?? "audio";
  const callerName = params.callerName || "Someone";
  // Crisis calls cannot be declined — accepting is the only option (see
  // Prompt 5 Watchtower integration). Every other call type can be.
  const isCrisis = callType === "crisis";
  // Study Together C2 — this ringing screen is reused verbatim for both an
  // ordinary 1:1 call AND an Add People invitation into an existing group
  // call; invitationId (only set for the latter) is what tells Answer to
  // run the real capacity/authorization check before joining, instead of
  // just settling the row and navigating straight in.
  const isInvitation = !!params.invitationId;

  const settledRef = useRef(false);
  const [joining, setJoining] = useState(false);
  const ringtone = useRingtone();
  // The caller's profile photo is the whole screen. A URL passed in by the
  // opener shows immediately (expo-image serves it from its disk cache when
  // it has been seen before); the profile lookup then confirms/refreshes it.
  // No photo → the standard P2P Avatar. Never blocks Answer/Decline.
  const [callerPhotoUrl, setCallerPhotoUrl] = useState<string | null>(params.callerPhotoUrl || null);
  useEffect(() => {
    if (!params.callerId) return;
    let cancelled = false;
    supabase.from("p2p_profiles").select("photo_url").eq("id", params.callerId).maybeSingle().then(({ data }) => {
      const url = (data as any)?.photo_url as string | null | undefined;
      if (!cancelled && url) setCallerPhotoUrl(url);
    });
    return () => { cancelled = true; };
  }, [params.callerId]);

  // Real ringing (audio + vibration). Stops on every exit path: answer, decline, timeout,
  // remote cancellation, or an unexpected unmount (useRingtone's own
  // cleanup effect covers that last case even if none of the explicit
  // stop() calls below ever run).
  // Ringing itself starts in the live-check effect below, only once the
  // call is confirmed to still be ringing (and never for an Accept/Decline
  // pressed on the notification).
  useEffect(() => {
    return () => { void ringtone.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forensic calling audit — settle() previously had no timeout of its own:
  // a hung network request (not even necessarily a thrown error — mobile
  // networks can stall a fetch indefinitely without ever rejecting) would
  // leave the caller of settle() awaiting forever. Racing against a bounded
  // timeout guarantees this specific step can never be the reason a call
  // rings/waits indefinitely, per the "no infinite transitional state"
  // requirement.
  const SETTLE_TIMEOUT_MS = 10000;
  // CALL DEBUG forensic fix — proven live via a cold-start decline: the app
  // was launched directly into this screen by a notification tap, so there
  // is no prior screen on the stack and router.canGoBack() is false. Every
  // exit path here used to be a bare `if (router.canGoBack()) router.back()`
  // with no else, so declining/missing/remote-cancelling from a cold start
  // left the user stuck on the ringing screen forever even though the call
  // was already correctly settled in the database. Mirrors the same
  // fallback audio.tsx's navigateBack() already uses.
  function dismissScreen() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages" as any);
  }
  // Only settles a row that is still "ringing": a late write (this device's
  // timeout, a slow decline) must never overwrite the real outcome — e.g. a
  // caller's cancellation or the server's no-answer sweep. Returns false
  // when the call had already stopped ringing.
  async function settle(status: "accepted" | "declined" | "missed"): Promise<boolean> {
    if (settledRef.current) return false;
    settledRef.current = true;
    void dismissCallNotifications(params.callId);
    if (!params.callId) return true;
    const update = supabase
      .from("p2p_incoming_calls")
      .update({ status, responded_at: new Date().toISOString() })
      .eq("id", params.callId)
      .eq("status", "ringing")
      .select("id");
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("settle timed out")), SETTLE_TIMEOUT_MS));
    const { data, error } = await Promise.race([update, timeout]);
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }

  // Live check — this screen can be opened from a push long after the call
  // stopped ringing (caller hung up, timed out, answered elsewhere). Confirm
  // the row is still ringing before ringing at all, and time the ring from
  // when the call started, not from when this screen happened to open.
  // A failed read rings normally rather than blocking a real call.
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void dismissCallNotifications(params.callId);
    (async () => {
      let ageMs = 0;
      if (params.callId) {
        const { data } = await supabase
          .from("p2p_incoming_calls").select("status, created_at").eq("id", params.callId).maybeSingle();
        if (cancelled) return;
        ageMs = data?.created_at ? Math.max(0, Date.now() - new Date(data.created_at as string).getTime()) : 0;
        if (data && (data.status !== "ringing" || ageMs > STALE_CALL_MS)) {
          console.log("CALL DEBUG incoming: call no longer ringing", { callId: params.callId, status: data.status, ageMs });
          settledRef.current = true;
          endSystemCall(params.callId, data.status === "accepted" ? "answered_elsewhere" : "missed");
          showAlert("Call ended", `${callerName}'s call has already ended.`);
          dismissScreen();
          return;
        }
      }
      if (notificationAction === "accept") { void handleAnswer(); return; }
      // Crisis calls can't be declined here either — they just ring.
      if (notificationAction === "decline" && !isCrisis) { void handleDecline(); return; }
      console.log("CALL DEBUG incoming: call live, starting ringtone", { callId: params.callId, channelName: params.channelName, callType, ageMs });
      void ringtone.start();
      ringTimerRef.current = setTimeout(() => {
        console.log("CALL DEBUG incoming: ring timeout, marking missed", { callId: params.callId });
        void ringtone.stop();
        endSystemCall(params.callId, "missed");
        settle("missed").catch(() => { /* the server's no-answer sweep settles it instead */ });
        dismissScreen();
      }, Math.max(MIN_RING_MS, RING_TIMEOUT_MS - ageMs));
    })();
    return () => {
      cancelled = true;
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The caller can hang up before this device answers (e.g. they tap End
  // while still on their own "Calling…" screen) — /calls/end updates this
  // row to 'cancelled' server-side, but without watching for that update
  // here, this screen would keep ringing for the full 30s regardless. Also
  // covers a remote 'declined'/'missed' write from any other path that
  // might settle this same row first.
  useEffect(() => {
    if (!params.callId) return;
    const channel = supabase
      .channel(`p2p_incoming_call_watch_${params.callId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_incoming_calls", filter: `id=eq.${params.callId}` },
        (payload) => {
          const status = (payload.new as Record<string, unknown>).status as string;
          if (settledRef.current) return;
          // "accepted" here means another of this user's devices answered.
          if (status !== "ringing") {
            console.log("CALL DEBUG incoming: remote settled the call first", { callId: params.callId, status });
            settledRef.current = true;
            if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
            void ringtone.stop();
            void dismissCallNotifications(params.callId);
            endSystemCall(params.callId, status === "accepted" ? "answered_elsewhere" : status === "declined" ? "declined_elsewhere" : "missed");
            dismissScreen();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callId]);

  async function handleDecline() {
    console.log("CALL DEBUG incoming: declined", { callId: params.callId });
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    await ringtone.stop();
    endSystemCall(params.callId, "declined");
    try {
      await settle("declined");
    } catch (e: any) {
      // Unlike Accept, a failed decline write must not trap the user on
      // this screen — declining is a purely local "get me out of here"
      // action from the recipient's perspective; the caller's own
      // NO_ANSWER_TIMEOUT_MS (audio.tsx) is the fallback if this write
      // never lands.
      console.warn("CALL DEBUG incoming: decline write failed, exiting anyway", { callId: params.callId, error: e?.message });
    }
    if (isInvitation && params.invitationId) {
      declineCallInvitation(params.invitationId).catch(() => { /* the row is already settled locally either way */ });
    }
    dismissScreen();
  }

  async function handleAnswer() {
    if (joining) return;
    console.log("CALL DEBUG incoming: answer pressed", { callId: params.callId, isInvitation });
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    await ringtone.stop();
    void dismissCallNotifications(params.callId);
    // Invitation-derived ringing calls must run the real accept flow first
    // — capacity/expiry/authorization are all re-checked atomically
    // server-side (migration 083) — rather than settling and navigating
    // straight in, which would let a stale or full-call invitation through.
    if (isInvitation && params.invitationId) {
      setJoining(true);
      // Set before the request: its own "accepted" write must not look like
      // another device answering to the realtime watcher above.
      settledRef.current = true; // this invitation flow owns settlement, not the plain p2p_incoming_calls update
      try {
        const result = await acceptCallInvitation(params.invitationId);
        const pathname = result.callType === "video" ? "/call/video" : "/call/audio";
        router.replace({
          pathname,
          params: {
            channelName: result.channelName,
            otherUserId: params.callerId,
            otherUserName: callerName,
            otherUserAvatarUrl: callerPhotoUrl ?? "",
            callType: result.callType,
            isInitiator: "false",
            callId: params.callId,
            conversationId: result.conversationId ?? "",
            callLogId: result.callLogId,
          },
        } as any);
      } catch (e: any) {
        settledRef.current = false; // a failed accept can be retried
        setJoining(false);
        showAlert("Couldn't join", e?.message ?? "Please try again.");
      }
      return;
    }

    // Forensic calling audit ROOT CAUSE — this plain (non-invitation) 1:1
    // accept path previously had NO error handling around settle(): if that
    // write threw or hung (a real risk on a mobile network — a backgrounded
    // app, a network handoff, a stalled fetch that never even rejects), the
    // exception propagated out of handleAnswer with nothing to catch it.
    // The ringtone had already been stopped a few lines above, but
    // router.replace() into the actual call screen never ran — this
    // recipient's device would sit on this exact ringing screen forever,
    // silently, with no error shown and no way to retry, while the caller's
    // side waited on an Agora onUserJoined that could now never fire
    // (this device never even requests a token). Matches the reported
    // symptom exactly on both ends. The invitation branch above already had
    // this try/catch; this mirrors it.
    setJoining(true);
    // Tell the OS call (Telecom/CallKit, if reported) it was answered HERE
    // before writing "accepted": that write's own realtime echo must not be
    // mistaken for another device answering.
    answerSystemCall(params.callId);
    let stillRinging: boolean;
    try {
      stillRinging = await settle("accepted");
    } catch (e: any) {
      console.warn("CALL DEBUG incoming: accept FAILED, offering retry", { callId: params.callId, error: e?.message });
      settledRef.current = false; // allow a genuine retry, not a silent no-op
      setJoining(false);
      showAlert("Couldn't connect", "There was a problem answering this call. Please try again.");
      return;
    }
    // The caller hung up / it timed out / another device answered between
    // the ring and this tap — joining now would only wait on an empty channel.
    if (!stillRinging) {
      console.log("CALL DEBUG incoming: accept too late, call no longer ringing", { callId: params.callId });
      endSystemCall(params.callId, "missed");
      showAlert("Call ended", `${callerName}'s call has already ended.`);
      dismissScreen();
      return;
    }
    const pathname = callType === "video" ? "/call/video" : "/call/audio";
    router.replace({
      pathname,
      params: {
        channelName: params.channelName,
        otherUserId: params.callerId,
        otherUserName: callerName,
        otherUserAvatarUrl: callerPhotoUrl ?? "",
        callType,
        isInitiator: "false",
        callId: params.callId,
        conversationId: params.conversationId,
        callLogId: params.callLogId,
      },
    } as any);
  }

  // "P2P Global Audio" / "P2P Global Video" — the special call types keep
  // their own wording.
  const subtitle = isCrisis
    ? "Crisis alert · needs you now"
    : isInvitation
      ? "Invited you to a P2P Global call"
      : callType === "pastoral"
        ? `P2P Global · ${CALL_TYPE_LABEL.pastoral}`
        : `P2P Global ${callType === "video" ? "Video" : "Audio"}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* The caller's photo IS the screen: cover-cropped around the centre,
          never stretched; the disk cache makes a repeat caller instant. */}
      {callerPhotoUrl ? (
        <ExpoImage
          source={{ uri: callerPhotoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="center"
          cachePolicy="memory-disk"
          transition={180}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]}>
          <Avatar name={callerName} size={168} />
        </View>
      )}
      {/* Darken only the top (name) and bottom (controls) so the face in
          the middle stays clear. */}
      <LinearGradient
        colors={["rgba(0,0,0,0.62)", "rgba(0,0,0,0.12)", "rgba(0,0,0,0)", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.78)"]}
        locations={[0, 0.26, 0.5, 0.68, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={[styles.header, { paddingTop: insets.top + 48 }]}>
        <Text style={styles.callerName} numberOfLines={2}>{callerName}</Text>
        <View style={styles.subtitleRow}>
          <Ionicons name={callType === "video" ? "videocam" : "call"} size={15} color="rgba(255,255,255,0.9)" />
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={[styles.buttonRow, { paddingBottom: insets.bottom + 44 }]}>
        {!isCrisis && (
          <View style={styles.buttonColumn}>
            <TouchableOpacity
              style={[styles.circleBtn, styles.declineBtn]} onPress={handleDecline} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel="Decline call"
            >
              <Ionicons name="call" size={30} color="#fff" style={styles.hangupIcon} />
            </TouchableOpacity>
            <Text style={styles.circleBtnLabel}>Decline</Text>
          </View>
        )}
        <View style={styles.buttonColumn}>
          <TouchableOpacity
            style={[styles.circleBtn, styles.answerBtn]} onPress={handleAnswer} activeOpacity={0.85} disabled={joining}
            accessibilityRole="button" accessibilityLabel="Accept call"
          >
            {joining ? <ActivityIndicator color="#fff" /> : <Ionicons name={callType === "video" ? "videocam" : "call"} size={30} color="#fff" />}
          </TouchableOpacity>
          <Text style={styles.circleBtnLabel}>Accept</Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(p2p: P2PCallColors) {
  const shadow = { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#000", justifyContent: "space-between" },
    fallback: { backgroundColor: p2p.bg, alignItems: "center", justifyContent: "center" },
    header: { alignItems: "center", paddingHorizontal: 28 },
    callerName: {
      fontSize: 34, color: "#fff", fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.3, ...shadow,
    },
    subtitleRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 },
    subtitle: { fontSize: 16, color: "rgba(255,255,255,0.92)", fontFamily: "Inter_500Medium", ...shadow },
    buttonRow: { flexDirection: "row", justifyContent: "space-evenly", paddingHorizontal: 24 },
    buttonColumn: { alignItems: "center", gap: 10 },
    circleBtn: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
    // Decline is the same "hang up" red-icon safety convention as the
    // in-call End Call button (see P2PControlButton's `danger` branch) —
    // always P2P_END_CALL_RED, never themed. Accept is P2P's own green.
    declineBtn: { backgroundColor: P2P_END_CALL_RED },
    answerBtn: { backgroundColor: appColors.accentGreen },
    hangupIcon: { transform: [{ rotate: "135deg" }] },
    circleBtnLabel: { color: "#fff", fontSize: 14, fontFamily: "Inter_500Medium", ...shadow },
  });
}