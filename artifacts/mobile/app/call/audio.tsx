import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";

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

export default function AudioCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    channelName: string; otherUserId: string; otherUserName?: string; callType?: CallType;
    isInitiator?: string; callId?: string; conversationId?: string; callLogId?: string;
  }>();
  const isInitiator = params.isInitiator === "true";
  const callType = (params.callType as CallType) || "audio";

  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [callState, setCallState] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getToken(params.channelName, myUid);
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
      onUserJoined: () => {
        connectedAtRef.current = Date.now();
        setConnected(true);
        setCallState("connected");
      },
      onUserOffline: () => {
        setConnected(false);
        handleEndCall();
      },
    },
  });

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

  const otherName = params.otherUserName || "Peer";

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 30 }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <Text style={styles.brand}>P2P Global</Text>

      <View style={styles.center}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={56} color="rgba(255,255,255,0.6)" />
        </View>
        <Text style={styles.name}>{otherName}</Text>
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
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleEndCall}>
          <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          <Text style={styles.controlLabel}>End</Text>
        </TouchableOpacity>
      </View>
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
});