import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform, Alert, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { acceptCallInvitation, declineCallInvitation } from "@/lib/callInvitations";
import { useRingtone } from "@/hooks/useRingtone";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const RING_TIMEOUT_MS = 30000;

const CALL_TYPE_LABEL: Record<CallType, string> = {
  audio: "Audio Call",
  video: "Video Call",
  pastoral: "Pastoral Check-in",
  crisis: "Crisis Alert",
};

export default function IncomingCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    callId: string; channelName: string; callType: CallType; callerId: string; callerName?: string;
    conversationId?: string; callLogId?: string; invitationId?: string;
  }>();
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
  useEffect(() => {
    console.log("CALL DEBUG incoming: screen mounted, starting ringtone", { callId: params.callId, channelName: params.channelName, callType });
    void ringtone.start();
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
  async function settle(status: "accepted" | "declined" | "missed") {
    if (settledRef.current) return;
    settledRef.current = true;
    if (params.callId) {
      const update = supabase
        .from("p2p_incoming_calls")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", params.callId);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("settle timed out")), SETTLE_TIMEOUT_MS));
      await Promise.race([update, timeout]);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      console.log("CALL DEBUG incoming: ring timeout, marking missed", { callId: params.callId });
      void ringtone.stop();
      settle("missed");
      if (router.canGoBack()) router.back();
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
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
          if (status === "cancelled" || status === "declined" || status === "missed") {
            console.log("CALL DEBUG incoming: remote settled the call first", { callId: params.callId, status });
            settledRef.current = true;
            void ringtone.stop();
            if (router.canGoBack()) router.back();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callId]);

  async function handleDecline() {
    console.log("CALL DEBUG incoming: declined", { callId: params.callId });
    await ringtone.stop();
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
    if (router.canGoBack()) router.back();
  }

  async function handleAnswer() {
    if (joining) return;
    console.log("CALL DEBUG incoming: answer pressed", { callId: params.callId, isInvitation });
    await ringtone.stop();
    // Invitation-derived ringing calls must run the real accept flow first
    // — capacity/expiry/authorization are all re-checked atomically
    // server-side (migration 083) — rather than settling and navigating
    // straight in, which would let a stale or full-call invitation through.
    if (isInvitation && params.invitationId) {
      setJoining(true);
      try {
        const result = await acceptCallInvitation(params.invitationId);
        settledRef.current = true; // this invitation flow owns settlement, not the plain p2p_incoming_calls update
        const pathname = result.callType === "video" ? "/call/video" : "/call/audio";
        router.replace({
          pathname,
          params: {
            channelName: result.channelName,
            otherUserId: params.callerId,
            otherUserName: callerName,
            callType: result.callType,
            isInitiator: "false",
            callId: params.callId,
            conversationId: result.conversationId ?? "",
            callLogId: result.callLogId,
          },
        } as any);
      } catch (e: any) {
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
    try {
      await settle("accepted");
    } catch (e: any) {
      console.warn("CALL DEBUG incoming: accept FAILED, offering retry", { callId: params.callId, error: e?.message });
      settledRef.current = false; // allow a genuine retry, not a silent no-op
      setJoining(false);
      showAlert("Couldn't connect", "There was a problem answering this call. Please try again.");
      return;
    }
    const pathname = callType === "video" ? "/call/video" : "/call/audio";
    router.replace({
      pathname,
      params: {
        channelName: params.channelName,
        otherUserId: params.callerId,
        otherUserName: callerName,
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
          <Text style={styles.avatarEmoji}>🌳</Text>
        </View>

        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callingText}>
          {isCrisis ? "needs you now" : isInvitation ? "invited you to join a call" : "is calling you..."}
        </Text>

        <View style={styles.typeChip}>
          <Ionicons name={callType === "video" ? "videocam" : "call"} size={14} color="#fff" />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E", justifyContent: "space-between", alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  avatarRing: {
    position: "absolute", width: 160, height: 160, borderRadius: 80,
    borderWidth: 2, borderColor: "rgba(29,158,117,0.5)",
  },
  avatarCircle: {
    width: 130, height: 130, borderRadius: 65, backgroundColor: "rgba(29,158,117,0.18)",
    alignItems: "center", justifyContent: "center", marginBottom: 24,
  },
  avatarEmoji: { fontSize: 56 },
  callerName: { fontSize: 26, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  callingText: { fontSize: 15, color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular", marginTop: 4 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 20,
    backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  typeChipText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  buttonRow: { flexDirection: "row", gap: 40, paddingBottom: 20 },
  circleBtn: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", gap: 4 },
  declineBtn: { backgroundColor: "#DC2626" },
  answerBtn: { backgroundColor: "#1D9E75" },
  circleBtnLabel: { position: "absolute", bottom: -22, color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "Inter_500Medium" },
});