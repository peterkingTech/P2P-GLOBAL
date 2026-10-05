import React, { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Platform, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// "Call back" from the phone's own call history — Android's system call log
// (CALL_BACK, modules/call-system CallBackActivity) or iPhone Phone → Recents
// (CallKit start-call intent). Starts a new P2P call of the same type to the
// same person through the shared start sequence every call site uses, so
// /calls/start's relationship and block checks apply exactly as usual.
export default function CallBackScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ peerId?: string; peerName?: string; callType?: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !profile?.id) return;
    started.current = true;
    const peerId = params.peerId ?? "";
    const callType = params.callType === "video" ? "video" : "audio";
    const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/messages" as any));
    if (!peerId || peerId === profile.id) { leave(); return; }
    (async () => {
      let peerName = params.peerName || "";
      if (!peerName) {
        const { data } = await supabase.from("p2p_profiles").select("full_name").eq("id", peerId).maybeSingle();
        peerName = (data?.full_name as string | undefined) ?? "Peer";
      }
      const result = await startPeerCall({
        supabase, currentUserId: profile.id, otherUserId: peerId, callType,
        onAlert: showAlert, source: "system_call_log_callback",
      });
      if (!result) { leave(); return; }
      router.replace({
        pathname: callType === "video" ? "/call/video" : "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: peerId, otherUserName: peerName, callType,
          callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
        }),
      } as any);
    })();
  }, [profile?.id, params.peerId, params.peerName, params.callType, router]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator color="#fff" />
      <Text style={styles.text}>Calling {params.peerName || "back"}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0B1A13", gap: 14 },
  text: { color: "#E8E2D0", fontSize: 15, fontFamily: "Inter_500Medium" },
});
