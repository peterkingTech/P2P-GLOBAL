import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Alert, Platform, Animated } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { getApiUrl } from "@/lib/apiUrl";
import { getFlagEmoji } from "@/lib/countryGeo";

interface RoomParticipant { userId: string; name: string; country: string | null; joinedAt: string }
interface RoomDetail {
  id: string; name: string; description: string | null; hostId: string; hostName: string;
  channelName: string; speakingMode: "open" | "structured"; currentSpeakerId: string | null;
  isLive: boolean; maxParticipants: number; currentParticipants: number; participants: RoomParticipant[];
}

const FLAG_REASONS = ["Inappropriate language", "False doctrine", "Harassment", "Spam", "Other"];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function SpeakingWave() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return <Animated.View style={[styles.waveRing, { transform: [{ scale }] }]} />;
}

export default function BreakRoomScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ roomId: string }>();

  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  const [muted, setMuted] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [speakingUids, setSpeakingUids] = useState<Set<number>>(new Set());
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [ending, setEnding] = useState(false);
  const leftRef = useRef(false);

  const { getToken } = useAgora();
  const isHost = room?.hostId === profile?.id;
  const canSpeak = room?.speakingMode === "open" || isHost || room?.currentSpeakerId === profile?.id;

  const uidToParticipant = useMemo(() => {
    const map = new Map<number, RoomParticipant>();
    room?.participants.forEach((p) => map.set(uidFromUserId(p.userId), p));
    return map;
  }, [room]);

  const load = useCallback(async () => {
    if (!params.roomId) return;
    try {
      const res = await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}`);
      if (!res.ok) throw new Error("not found");
      setRoom(await res.json());
    } catch {
      setRoom(null);
    } finally {
      setLoading(false);
    }
  }, [params.roomId]);

  const leaveRoom = useCallback(async () => {
    if (leftRef.current || !profile?.id || !params.roomId) return;
    leftRef.current = true;
    try {
      await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}/leave`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id }),
      });
    } catch { /* leaving either way */ }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/discover" as any);
  }, [profile?.id, params.roomId, router]);

  const doJoin = useCallback(async () => {
    if (!profile?.id || !params.roomId) return;
    try {
      const res = await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showAlert("Couldn't join room", body.error ?? "Please try again.");
        if (router.canGoBack()) router.back();
        return;
      }
      const { channelName } = await res.json();
      const t = await getToken(channelName, myUid, profile.id);
      setToken(t);
      setJoined(true);
    } catch {
      showAlert("Couldn't join room", "Please try again.");
    }
  }, [profile?.id, params.roomId, getToken, myUid, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (room && !joined) doJoin(); }, [room, joined, doJoin]);

  // Realtime room state — is_live, speaking_mode, current_speaker_id all
  // live here so every participant reacts the instant the host changes them.
  useEffect(() => {
    if (!params.roomId) return;
    const channel = supabase
      .channel(`p2p_break_rooms_${params.roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "p2p_break_rooms", filter: `id=eq.${params.roomId}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.is_live === false) {
          showAlert("Room ended", "This Break Room has ended.");
          leaveRoom();
          return;
        }
        setRoom((prev) => prev ? {
          ...prev, speakingMode: row.speaking_mode as "open" | "structured",
          currentSpeakerId: (row.current_speaker_id as string) ?? null,
        } : prev);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "p2p_break_room_participants", filter: `room_id=eq.${params.roomId}` }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [params.roomId, leaveRoom, load]);

  // Ephemeral signaling — raise hand and forced removal. Agora RTC gives no
  // participant authority over another client's stream, so "removed" is a
  // cooperative signal the target's own app acts on (see group.tsx).
  const signalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!profile?.id || !params.roomId) return;
    const myId = profile.id;
    let cancelled = false;

    // Security roadmap Phase 4 — private channel, matching Study Together's
    // fix (migration 086/089): RLS on realtime.messages now requires an
    // active p2p_break_room_participants row for this room, so the JWT
    // must be set before subscribing (awaited, not raced) and kept current
    // via the refresh listener below.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase.channel(`room_signal_${params.roomId}`, { config: { broadcast: { self: false }, private: true } });
      channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        if (payload.type === "hand_raised" && payload.userId) {
          setRaisedHands((prev) => new Set(prev).add(payload.userId));
        } else if (payload.type === "hand_lowered" && payload.userId) {
          setRaisedHands((prev) => { const n = new Set(prev); n.delete(payload.userId); return n; });
        } else if (payload.type === "removed" && payload.userId === myId) {
          showAlert("Removed", "The host removed you from this room.");
          leaveRoom();
        }
      }).subscribe((status, err) => {
        if (status === "CHANNEL_ERROR") console.error("Break Room realtime channel authorization failed", err);
      });
      signalRef.current = channel;
    })();

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      if (channel) { supabase.removeChannel(channel); signalRef.current = null; }
    };
  }, [profile?.id, params.roomId, leaveRoom]);

  const sendSignal = useCallback((type: string, data: Record<string, unknown> = {}) => {
    signalRef.current?.send({ type: "broadcast", event: "signal", payload: { type, ...data } });
  }, []);

  const engineRef = useAgoraEngine({
    channelName: joined ? room?.channelName ?? "" : "",
    token,
    uid: myUid,
    enableVideo: false,
    eventHandler: {
      onAudioVolumeIndication: (_c, speakers) => {
        setSpeakingUids(new Set((speakers ?? []).filter((s) => (s.volume ?? 0) > 40).map((s) => s.uid ?? 0)));
      },
    },
  });

  useEffect(() => { engineRef.current?.enableAudioVolumeIndication(500, 3, false); }, [engineRef, token]);

  // Structured rooms: only the current speaker (or host) can be unmuted —
  // Agora has no cross-client mute, so this is enforced locally per-client
  // against the room's DB state rather than something one client can force
  // on another.
  useEffect(() => {
    if (!engineRef.current || !room) return;
    const shouldMute = !canSpeak || muted;
    engineRef.current.muteLocalAudioStream(shouldMute);
  }, [engineRef, room, canSpeak, muted]);

  function toggleMute() { setMuted((m) => !m); }

  function toggleRaiseHand() {
    if (!profile?.id) return;
    const next = !handRaised;
    setHandRaised(next);
    sendSignal(next ? "hand_raised" : "hand_lowered", { userId: profile.id });
  }

  async function grantFloor(userId: string | null) {
    if (!isHost || !profile?.id || !params.roomId) return;
    try {
      await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}/set-speaker`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: profile.id, speakerId: userId }),
      });
      if (userId) sendSignal("hand_lowered", { userId });
    } catch { showAlert("Couldn't update speaker", "Please try again."); }
  }

  function removeParticipant(p: RoomParticipant) {
    Alert.alert(`Remove ${p.name}?`, "They'll be blocked from rejoining this room for 24 hours.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          if (!profile?.id || !params.roomId) return;
          await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}/remove`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostId: profile.id, userId: p.userId }),
          });
          sendSignal("removed", { userId: p.userId });
          load();
        },
      },
    ]);
  }

  async function submitFlag(reason: string) {
    if (!profile?.id || !params.roomId) return;
    setFlagging(true);
    try {
      await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}/flag`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flaggerId: profile.id, reason }),
      });
      setFlagOpen(false);
      showAlert("Reported", "Thanks — our moderation team has been notified.");
    } catch {
      showAlert("Couldn't submit report", "Please try again.");
    } finally {
      setFlagging(false);
    }
  }

  async function endRoomForAll() {
    if (!isHost || !profile?.id || !params.roomId) return;
    setEnding(true);
    try {
      await fetch(`${getApiUrl()}/calls/rooms/${params.roomId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: profile.id }),
      });
      leftRef.current = true;
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/discover" as any);
    } catch {
      showAlert("Couldn't end room", "Please try again.");
      setEnding(false);
    }
  }

  if (loading || !room) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.errorText}>This room isn't live anymore.</Text>}
      </View>
    );
  }

  const speakers = room.participants.filter((p) =>
    room.speakingMode === "structured" ? p.userId === room.currentSpeakerId : speakingUids.has(uidFromUserId(p.userId))
  );
  const listeners = room.participants.filter((p) => !speakers.some((s) => s.userId === p.userId));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={leaveRoom} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.topBarTitle} numberOfLines={1}>{room.name}</Text>
          <Text style={styles.topBarSub}>
            {room.speakingMode === "structured" ? "Structured" : "Open"} · {room.currentParticipants} here
          </Text>
        </View>
        <TouchableOpacity style={styles.flagBtn} onPress={() => setFlagOpen(true)}>
          <Ionicons name="flag-outline" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.sectionLabel}>SPEAKING NOW</Text>
        <View style={styles.speakerRow}>
          {speakers.length === 0 ? (
            <Text style={styles.emptyText}>{room.speakingMode === "structured" ? "No one has the floor yet." : "It's quiet in here."}</Text>
          ) : speakers.map((p) => (
            <View key={p.userId} style={styles.speakerTile}>
              <View style={styles.speakerAvatarWrap}>
                <SpeakingWave />
                <View style={styles.avatarCircleLarge}>
                  <Ionicons name="person" size={30} color="rgba(255,255,255,0.7)" />
                </View>
              </View>
              <Text style={styles.speakerName} numberOfLines={1}>
                {getFlagEmoji(p.country)} {p.name}{p.userId === room.hostId ? " · Host" : ""}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>LISTENERS ({listeners.length})</Text>
        <View style={styles.listenerGrid}>
          {listeners.map((p) => (
            <TouchableOpacity
              key={p.userId}
              style={styles.listenerTile}
              onLongPress={() => isHost && p.userId !== profile?.id && removeParticipant(p)}
              activeOpacity={isHost ? 0.7 : 1}
            >
              <View style={styles.avatarCircleSmall}>
                <Ionicons name="person" size={18} color="rgba(255,255,255,0.6)" />
              </View>
              <Text style={styles.listenerName} numberOfLines={1}>{getFlagEmoji(p.country)} {p.name}</Text>
              {raisedHands.has(p.userId) && <Text style={styles.handEmoji}>✋</Text>}
              {isHost && room.speakingMode === "structured" && raisedHands.has(p.userId) && (
                <TouchableOpacity style={styles.grantBtn} onPress={() => grantFloor(p.userId)}>
                  <Text style={styles.grantBtnText}>Give floor</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.controlsRow, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity
          style={[styles.controlBtn, !canSpeak && styles.controlBtnDisabled]}
          onPress={toggleMute}
          disabled={!canSpeak}
        >
          <Ionicons name={!canSpeak ? "mic-off" : muted ? "mic-off" : "mic"} size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, handRaised && styles.controlBtnActive]} onPress={toggleRaiseHand}>
          <Text style={{ fontSize: 16 }}>✋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={isHost ? endRoomForAll : leaveRoom} disabled={ending}>
          {ending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="exit-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
      {room.speakingMode === "structured" && !canSpeak && (
        <Text style={styles.structuredHint}>Raise your hand to ask for the floor</Text>
      )}

      <Modal visible={flagOpen} transparent animationType="fade" onRequestClose={() => setFlagOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <Text style={styles.sheetTitle}>Report this room</Text>
            {FLAG_REASONS.map((reason) => (
              <TouchableOpacity key={reason} style={styles.reasonRow} onPress={() => submitFlag(reason)} disabled={flagging}>
                <Text style={styles.reasonText}>{reason}</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setFlagOpen(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E" },
  errorText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_400Regular" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  topBarTitle: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  topBarSub: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  flagBtn: { padding: 4 },

  sectionLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 10 },
  speakerRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 14 },
  speakerTile: { alignItems: "center", width: 84 },
  speakerAvatarWrap: { alignItems: "center", justifyContent: "center", width: 72, height: 72 },
  waveRing: { position: "absolute", width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: "#1D9E75" },
  avatarCircleLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#1A241E", alignItems: "center", justifyContent: "center" },
  speakerName: { color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 8, textAlign: "center" },

  listenerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 14 },
  listenerTile: { alignItems: "center", width: 64 },
  avatarCircleSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1A241E", alignItems: "center", justifyContent: "center" },
  listenerName: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" },
  handEmoji: { fontSize: 12, marginTop: 2 },
  grantBtn: { marginTop: 4, backgroundColor: "#1D9E75", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  grantBtnText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },

  controlsRow: { flexDirection: "row", justifyContent: "center", gap: 24, paddingTop: 8 },
  controlBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  controlBtnDisabled: { opacity: 0.4 },
  controlBtnActive: { backgroundColor: "#B8860B" },
  endBtn: { backgroundColor: "#DC2626" },
  structuredHint: { textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular", paddingBottom: 8 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 8 },
  reasonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  reasonText: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  cancelBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});