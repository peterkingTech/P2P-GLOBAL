import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, Modal, Alert, Platform, Animated } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import SyncedMediaPlayer from "@/components/family/SyncedMediaPlayer";
import {
  getMyFamily, getWorshipSession, joinWorshipSession, leaveWorshipSession, updateWorshipState,
  transferWorshipHost, endWorshipSession, getFamilyPrayerRequests, createFamilyPrayerRequest, updateFamilyPrayerRequestStatus,
  computeWorshipPositionMs, type WorshipSession, type WorshipMode, type FamilyMember, type FamilyPrayerRequest, type SharedMediaProvider,
} from "@/lib/familyApi";
import { youtubeProvider } from "@/lib/mediaProviders/youtube";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const MODES: { key: WorshipMode; label: string; icon: string }[] = [
  { key: "worship", label: "Worship", icon: "🎵" },
  { key: "scripture", label: "Scripture", icon: "📖" },
  { key: "prayer", label: "Prayer", icon: "🙏" },
  { key: "sharing", label: "Sharing", icon: "🎤" },
  { key: "silent_prayer", label: "Silent", icon: "🕊️" },
  { key: "thanksgiving", label: "Thanks", icon: "❤️" },
];
const REACTIONS = ["🙏", "❤️", "🙌", "🕊️", "📖"];

function FloatingReaction({ emoji }: { emoji: string }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -60, duration: 1400, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity]);
  return <Animated.Text style={[styles.floatingReaction, { transform: [{ translateY }], opacity }]}>{emoji}</Animated.Text>;
}

export default function FamilyWorshipScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ sessionId: string }>();

  const [session, setSession] = useState<WorshipSession | null>(null);
  const [participants, setParticipants] = useState<{ user_id: string; presence_status: string }[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [shepherdId, setShepherdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, forceTick] = useState(0);
  const [reactions, setReactions] = useState<{ id: number; emoji: string }[]>([]);
  const [prayers, setPrayers] = useState<FamilyPrayerRequest[]>([]);
  const [newPrayer, setNewPrayer] = useState("");
  const [scriptureRef, setScriptureRef] = useState("");
  const [scriptureText, setScriptureText] = useState<string | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const leftRef = useRef(false);

  const isHost = session?.hostId === profile?.id;
  const isShepherd = shepherdId === profile?.id;

  const load = useCallback(async () => {
    if (!params.sessionId) return;
    try {
      const [s, family] = await Promise.all([getWorshipSession(params.sessionId), getMyFamily()]);
      setSession(s);
      setParticipants(s.participants ?? []);
      setMembers(family.members);
      setShepherdId(family.family?.shepherdId ?? null);
      if (s.currentScripture?.reference) setScriptureRef(s.currentScripture.reference);
      if (family.family) {
        const p = await getFamilyPrayerRequests(family.family.id);
        setPrayers(p);
      }
    } catch (e: any) {
      showAlert("Couldn't load Family Worship", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [params.sessionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (params.sessionId) joinWorshipSession(params.sessionId).catch(() => {}); }, [params.sessionId]);

  // Ticking re-render so the displayed playback position keeps advancing
  // between session-row updates, without writing anything to the DB.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const leave = useCallback(async () => {
    if (leftRef.current || !params.sessionId) return;
    leftRef.current = true;
    await leaveWorshipSession(params.sessionId).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace("/family" as any);
  }, [params.sessionId, router]);

  // Session row is the source of truth for state/mode/media/scripture/
  // playback anchor — every client just reconciles to it, no polling.
  useEffect(() => {
    if (!params.sessionId) return;
    const channel = supabase
      .channel(`p2p_family_worship_sessions_${params.sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "p2p_family_worship_sessions", filter: `id=eq.${params.sessionId}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.status === "ended") {
          showAlert("Family Worship ended", "This worship session has ended.");
          leave();
          return;
        }
        setSession((prev) => prev ? {
          ...prev, status: row.status as string, currentMode: row.current_mode as WorshipMode,
          mediaProvider: row.media_provider as SharedMediaProvider | null,
          mediaType: row.media_type as "video" | "audio" | null, mediaId: row.media_id as string | null, mediaUrl: row.media_url as string | null,
          playbackBasePositionMs: Number(row.playback_base_position_ms ?? 0), playbackBaseServerTime: row.playback_base_server_time as string,
          playbackRate: Number(row.playback_rate ?? 1), isPlaying: !!row.is_playing,
          currentScripture: (row.current_scripture as { reference: string } | null) ?? null, hostId: row.host_id as string,
        } : prev);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [params.sessionId, leave]);

  // Private signaling channel — reactions only (ephemeral, never persisted).
  const signalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!params.sessionId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel(`family_worship_signal_${params.sessionId}`, { config: { broadcast: { self: false }, private: true } });
      channel.on("broadcast", { event: "reaction" }, ({ payload }: { payload: { emoji: string } }) => {
        const id = Date.now() + Math.random();
        setReactions((prev) => [...prev, { id, emoji: payload.emoji }]);
        setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 1500);
      })
      // Primary state-sync path — see the broadcastState() comment above
      // its definition for why this exists alongside postgres_changes.
      .on("broadcast", { event: "state" }, ({ payload }: { payload: WorshipSession }) => {
        if (payload.status === "ended") {
          showAlert("Family Worship ended", "This worship session has ended.");
          leave();
          return;
        }
        setSession(payload);
      })
      .subscribe();
      signalRef.current = channel;
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [params.sessionId, leave]);

  // Primary state-sync send path — postgres_changes on this table has been
  // observed to not deliver in production despite correct publication
  // membership and RLS (isolated, verified: an identical client pattern
  // against a known-working table with a similarly-shaped policy delivers
  // fine; this table specifically does not, even minutes after being added
  // to the publication). Root cause not conclusively identified — most
  // likely a Supabase-managed Realtime service-side gap for a table this
  // new, outside what's fixable via SQL from here. Broadcasting the new
  // state directly (the same channel already proven reliable for
  // reactions) is the actual, working delivery path; the postgres_changes
  // subscription above is left in place as a harmless secondary listener
  // in case that gap resolves itself later.
  function broadcastState(next: WorshipSession) {
    signalRef.current?.send({ type: "broadcast", event: "state", payload: next });
  }

  function sendReaction(emoji: string) {
    signalRef.current?.send({ type: "broadcast", event: "reaction", payload: { emoji } });
    const id = Date.now();
    setReactions((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 1500);
  }

  async function changeMode(mode: WorshipMode) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { currentMode: mode });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't change mode", e.message ?? "Please try again."); }
  }

  async function togglePlay() {
    if (!session || !isHost) return;
    try {
      const positionMs = Math.max(0, computeWorshipPositionMs(session));
      const updated = await updateWorshipState(session.id, { isPlaying: !session.isPlaying, positionMs });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't update playback", e.message ?? "Please try again."); }
  }

  async function setMedia() {
    if (!session || !isHost || !mediaUrlInput.trim()) return;
    const input = mediaUrlInput.trim();
    try {
      if (youtubeProvider.matches(input)) {
        const videoId = youtubeProvider.extractId(input);
        if (!videoId) {
          showAlert("Couldn't recognize that link", "That doesn't look like a valid YouTube video link.");
          return;
        }
        const updated = await updateWorshipState(session.id, {
          mediaProvider: "youtube", mediaId: videoId, mediaType: null, mediaUrl: null, isPlaying: true, positionMs: 0,
        });
        setSession(updated);
        broadcastState(updated);
        setMediaUrlInput("");
        return;
      }
      // Fallback: a direct audio/video file link (the pre-YouTube behavior, unchanged).
      const isAudio = /\.(mp3|m4a|wav|aac)(\?|$)/i.test(input);
      const updated = await updateWorshipState(session.id, {
        mediaProvider: null, mediaId: null, mediaUrl: input, mediaType: isAudio ? "audio" : "video", isPlaying: true, positionMs: 0,
      });
      setSession(updated);
      broadcastState(updated);
      setMediaUrlInput("");
    } catch (e: any) { showAlert("Couldn't set media", e.message ?? "Please try again."); }
  }

  async function loadScripture() {
    if (!session || !isHost || !scriptureRef.trim()) return;
    try {
      const res = await fetch(`${getApiUrl()}/bible/verse?ref=${encodeURIComponent(scriptureRef.trim())}`);
      const body = await res.json();
      if (!res.ok) { showAlert("Couldn't find that passage", body.error ?? "Check the reference and try again."); return; }
      setScriptureText(body.text);
      const updated = await updateWorshipState(session.id, { currentMode: "scripture", currentScripture: { reference: scriptureRef.trim() } });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't load Scripture", e.message ?? "Please try again."); }
  }

  useEffect(() => {
    if (session?.currentMode === "scripture" && session.currentScripture?.reference && !scriptureText) {
      fetch(`${getApiUrl()}/bible/verse?ref=${encodeURIComponent(session.currentScripture.reference)}`)
        .then((r) => r.json()).then((b) => setScriptureText(b.text ?? null)).catch(() => {});
    }
  }, [session?.currentMode, session?.currentScripture?.reference, scriptureText]);

  async function addPrayer() {
    if (!session || !newPrayer.trim()) return;
    try {
      await createFamilyPrayerRequest(session.familyId, newPrayer.trim(), "family");
      setNewPrayer("");
      setPrayers(await getFamilyPrayerRequests(session.familyId));
    } catch (e: any) { showAlert("Couldn't share this prayer", e.message ?? "Please try again."); }
  }
  async function markPrayed(id: string) {
    if (!session) return;
    try { await updateFamilyPrayerRequestStatus(session.familyId, id, "prayed"); setPrayers(await getFamilyPrayerRequests(session.familyId)); }
    catch (e: any) { showAlert("Couldn't update this prayer", e.message ?? "Please try again."); }
  }

  async function handleTransfer(newHostId: string) {
    if (!session) return;
    try {
      await transferWorshipHost(session.id, newHostId);
      const updated = { ...session, hostId: newHostId };
      setSession(updated);
      broadcastState(updated);
      setTransferOpen(false);
    }
    catch (e: any) { showAlert("Couldn't transfer hosting", e.message ?? "Please try again."); }
  }

  async function handleEnd() {
    if (!session) return;
    Alert.alert("End Family Worship?", "This will end the session for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "End Worship", style: "destructive", onPress: async () => {
        await endWorshipSession(session.id);
        broadcastState({ ...session, status: "ended" });
        leave();
      } },
    ]);
  }

  if (loading || !session) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const memberById = new Map(members.map((m) => [m.userId, m]));
  const activeParticipants = participants.filter((p) => p.presence_status !== "away");

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={leave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.topBarTitle}>🕊️ Family Worship</Text>
          <Text style={styles.topBarSub}>{activeParticipants.length} together</Text>
        </View>
        {(isHost || isShepherd) && (
          <TouchableOpacity onPress={handleEnd} style={styles.endBtn}><Text style={styles.endBtnText}>End</Text></TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {session.currentMode === "worship" && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>SHARED MEDIA</Text>
            <SyncedMediaPlayer session={session} />
            {isHost && (
              <View style={styles.hostRow}>
                <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
                  <Ionicons name={session.isPlaying ? "pause" : "play"} size={20} color="#fff" />
                </TouchableOpacity>
                <TextInput
                  style={styles.mediaInput}
                  placeholder="Paste a YouTube link…"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={mediaUrlInput}
                  onChangeText={setMediaUrlInput}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.smallBtn} onPress={setMedia}><Text style={styles.smallBtnText}>Set</Text></TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {session.currentMode === "scripture" && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>SCRIPTURE</Text>
            {isHost && (
              <View style={styles.hostRow}>
                <TextInput
                  style={[styles.mediaInput, { flex: 1 }]}
                  placeholder="e.g. Psalm 23:1"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={scriptureRef}
                  onChangeText={setScriptureRef}
                />
                <TouchableOpacity style={styles.smallBtn} onPress={loadScripture}><Text style={styles.smallBtnText}>Go</Text></TouchableOpacity>
              </View>
            )}
            <Text style={styles.scriptureRef}>{session.currentScripture?.reference ?? "No passage selected"}</Text>
            {scriptureText && <Text style={styles.scriptureText}>{scriptureText}</Text>}
          </View>
        )}

        {(session.currentMode === "prayer" || session.currentMode === "silent_prayer") && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>{session.currentMode === "silent_prayer" ? "SILENT PRAYER" : "FAMILY PRAYER"}</Text>
            {session.currentMode === "silent_prayer" && <Text style={styles.silentHint}>Together, quietly. Microphones are muted.</Text>}
            {prayers.filter((p) => p.status !== "answered").map((p) => (
              <View key={p.id} style={styles.prayerRow}>
                <Text style={styles.prayerText}>🙏 {p.content}</Text>
                {p.status === "open" && (
                  <TouchableOpacity onPress={() => markPrayed(p.id)}><Text style={styles.prayerAction}>Prayed</Text></TouchableOpacity>
                )}
              </View>
            ))}
            <View style={styles.hostRow}>
              <TextInput
                style={[styles.mediaInput, { flex: 1 }]}
                placeholder="Share a prayer request…"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={newPrayer}
                onChangeText={setNewPrayer}
              />
              <TouchableOpacity style={styles.smallBtn} onPress={addPrayer}><Text style={styles.smallBtnText}>Share</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {(session.currentMode === "sharing" || session.currentMode === "thanksgiving") && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>{session.currentMode === "thanksgiving" ? "THANKSGIVING" : "SHARING"}</Text>
            <Text style={styles.silentHint}>
              {session.currentMode === "thanksgiving" ? "Take turns sharing something you're thankful for." : "Take turns sharing with the family."}
            </Text>
          </View>
        )}

        <View>
          <Text style={styles.companionsLabel}>COMPANIONS</Text>
          <View style={styles.participantsRow}>
            {activeParticipants.map((p) => {
              const m = memberById.get(p.user_id);
              return (
                <View key={p.user_id} style={styles.participantChip}>
                  <Text style={styles.participantInitial}>{(m?.name ?? "?").charAt(0).toUpperCase()}</Text>
                  <Text style={styles.participantName} numberOfLines={1}>{m?.name ?? "Someone"}{p.user_id === session.hostId ? " · Guide" : ""}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.reactionsOverlay} pointerEvents="none">
        {reactions.map((r) => <FloatingReaction key={r.id} emoji={r.emoji} />)}
      </View>

      {isHost && (
        <View style={styles.modeRow}>
          {MODES.map((m) => (
            <TouchableOpacity key={m.key} style={[styles.modeBtn, session.currentMode === m.key && styles.modeBtnActive]} onPress={() => changeMode(m.key)}>
              <Text style={styles.modeIcon}>{m.icon}</Text>
              <Text style={styles.modeLabel}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={[styles.bottomRow, { paddingBottom: insets.bottom + 12 }]}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
            <Text style={styles.reactionEmoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        {isHost && (
          <TouchableOpacity style={styles.transferBtn} onPress={() => setTransferOpen(true)}>
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={transferOpen} transparent animationType="fade" onRequestClose={() => setTransferOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <Text style={styles.sheetTitle}>Transfer Guide</Text>
            {activeParticipants.filter((p) => p.user_id !== session.hostId).map((p) => {
              const m = memberById.get(p.user_id);
              return (
                <TouchableOpacity key={p.user_id} style={styles.transferRow} onPress={() => handleTransfer(p.user_id)}>
                  <Text style={styles.transferName}>{m?.name ?? "Someone"}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setTransferOpen(false)}>
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
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  topBarTitle: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  topBarSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  endBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  endBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  scroll: { paddingHorizontal: 16, paddingBottom: 20, gap: 16 },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  mediaInput: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular",
  },
  smallBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  smallBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

  panel: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 16, gap: 6 },
  panelLabel: { color: "#B8860B", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  scriptureRef: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 6 },
  scriptureText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginTop: 6, fontStyle: "italic" },
  silentHint: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },

  prayerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  prayerText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, marginRight: 8 },
  prayerAction: { color: "#1D9E75", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  companionsLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 8 },
  participantsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  participantChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 150 },
  participantInitial: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  participantName: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Inter_400Regular" },

  reactionsOverlay: { position: "absolute", bottom: 140, alignSelf: "center", alignItems: "center" },
  floatingReaction: { position: "absolute", fontSize: 26 },

  modeRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 10, paddingTop: 6 },
  modeBtn: { alignItems: "center", gap: 2, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  modeBtnActive: { backgroundColor: "rgba(184,134,11,0.25)" },
  modeIcon: { fontSize: 16 },
  modeLabel: { color: "rgba(255,255,255,0.7)", fontSize: 9, fontFamily: "Inter_500Medium" },

  bottomRow: { flexDirection: "row", justifyContent: "center", gap: 14, paddingTop: 10 },
  reactionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  reactionEmoji: { fontSize: 18 },
  transferBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 8 },
  transferRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  transferName: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  cancelBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});