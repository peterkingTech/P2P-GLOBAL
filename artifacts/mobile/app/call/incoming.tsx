import React, { useEffect, useRef, useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, Animated, Easing, Platform, Alert, ActivityIndicator } from "react-native";
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

  const pulse = useRef(new Animated.Value(1)).current;
  const settledRef = useRef(false);
  const [joining, setJoining] = useState(false);
  const ringtone = useRingtone();
  // The incoming-call invitation payload (push notification / p2p_incoming_calls
  // row) has never carried a caller photo — only callerId/callerName — so this
  // is a small additive read-only lookup, not a change to push/invitation
  // architecture. Absence of a photo silently keeps the existing emoji fallback.
  const [callerPhotoUrl, setCallerPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!params.callerId) return;
    let cancelled = false;
    supabase.from("p2p_profiles").select("photo_url").eq("id", params.callerId).maybeSingle().then(({ data }) => {
      if (!cancelled) setCallerPhotoUrl((data as any)?.photo_url ?? null);
    });
    return () => { cancelled = true; };
  }, [params.callerId]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Real ringing (audio + vibration), not just the pulse animation above.
  // Starts the moment this screen mounts (a call invitation has been
  // received) and stops on every exit path: answer, decline, timeout,
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={styles.center}>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulse }] }]} />
        <View style={styles.avatarCircle}>
          {callerPhotoUrl ? (
            <Image source={{ uri: callerPhotoUrl }} style={styles.avatarPhoto} />
          ) : (
            <Text style={styles.avatarEmoji}>🌳</Text>
          )}
        </View>

        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callingText}>
          {isCrisis ? "needs you now" : isInvitation ? "invited you to join a call" : "is calling you..."}
        </Text>

        <View style={styles.typeChip}>
          <Ionicons name={callType === "video" ? "videocam" : "call"} size={14} color={p2pColors.accent} />
          <Text style={styles.typeChipText}>{CALL_TYPE_LABEL[callType]}</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        {!isCrisis && (
          <TouchableOpacity style={[styles.circleBtn, styles.declineBtn]} onPress={handleDecline} activeOpacity={0.85}>
            <Ionicons name="close" size={30} color="#fff" />
            <Text style={styles.circleBtnLabel}>Decline</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.circleBtn, styles.answerBtn]} onPress={handleAnswer} activeOpacity={0.85} disabled={joining}>
          {joining ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={30} color="#fff" />}
          <Text style={styles.circleBtnLabel}>Answer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(p2p: P2PCallColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p2p.bg, justifyContent: "space-between", alignItems: "center" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
    avatarRing: {
      position: "absolute", width: 160, height: 160, borderRadius: 80,
      borderWidth: 2, borderColor: p2p.accentBorder,
    },
    avatarCircle: {
      width: 130, height: 130, borderRadius: 65, backgroundColor: p2p.pillBg,
      alignItems: "center", justifyContent: "center", marginBottom: 24,
      borderWidth: 1.5, borderColor: p2p.accent,
    },
    avatarEmoji: { fontSize: 56 },
    avatarPhoto: { width: "100%", height: "100%", borderRadius: 65 },
    callerName: { fontSize: 26, fontWeight: "700", color: p2p.textPrimary, fontFamily: "Inter_700Bold" },
    callingText: { fontSize: 15, color: p2p.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
    typeChip: {
      flexDirection: "row", alignItems: "center", gap: 6, marginTop: 20,
      backgroundColor: p2p.pillBg, borderWidth: 1, borderColor: p2p.accentBorder,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    },
    typeChipText: { color: p2p.accent, fontSize: 13, fontFamily: "Inter_500Medium" },
    buttonRow: { flexDirection: "row", gap: 40, paddingBottom: 20 },
    circleBtn: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", gap: 4 },
    // Decline is the same "hang up" red-icon safety convention as the
    // in-call End Call button (see P2PControlButton's `danger` branch) —
    // always P2P_END_CALL_RED, never themed.
    declineBtn: { backgroundColor: P2P_END_CALL_RED },
    answerBtn: { backgroundColor: p2p.accent },
    circleBtnLabel: { position: "absolute", bottom: -22, color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "Inter_500Medium" },
  });
}