import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";

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
    conversationId?: string; callLogId?: string;
  }>();
  const callType = (params.callType as CallType) ?? "audio";
  const callerName = params.callerName || "Someone";
  // Crisis calls cannot be declined — accepting is the only option (see
  // Prompt 5 Watchtower integration). Every other call type can be.
  const isCrisis = callType === "crisis";

  const pulse = useRef(new Animated.Value(1)).current;
  const settledRef = useRef(false);

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

  async function settle(status: "accepted" | "declined" | "missed") {
    if (settledRef.current) return;
    settledRef.current = true;
    if (params.callId) {
      await supabase
        .from("p2p_incoming_calls")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", params.callId);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      settle("missed");
      if (router.canGoBack()) router.back();
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecline() {
    await settle("declined");
    if (router.canGoBack()) router.back();
  }

  async function handleAnswer() {
    await settle("accepted");
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
        <Text style={styles.callingText}>{isCrisis ? "needs you now" : "is calling you..."}</Text>

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
        <TouchableOpacity style={[styles.circleBtn, styles.answerBtn]} onPress={handleAnswer} activeOpacity={0.85}>
          <Ionicons name="checkmark" size={30} color="#fff" />
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