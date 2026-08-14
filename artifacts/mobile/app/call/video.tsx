import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView, QualityType, BackgroundSourceType, BackgroundBlurDegree, SegModelType } from "@/lib/agoraNative";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { lookupVerseForAdmin, type VerseResult } from "@/lib/bibleClient";
import { getApiUrl } from "@/lib/apiUrl";

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ── Scripture lookup modal — search a reference without leaving the call ────
function ScriptureModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<VerseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLookup() {
    if (!ref.trim()) return;
    setLoading(true); setError(""); setResult(null);
    const data = await lookupVerseForAdmin(ref.trim());
    setLoading(false);
    if (!data) setError("Couldn't find that reference. Try e.g. \"John 3:16\".");
    else setResult(data);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Look Up a Verse</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
          </View>
          <View style={styles.modalSearchRow}>
            <TextInput
              style={styles.modalInput}
              value={ref}
              onChangeText={setRef}
              placeholder="e.g. John 3:16"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoCapitalize="words"
              onSubmitEditing={handleLookup}
            />
            <TouchableOpacity style={styles.modalSearchBtn} onPress={handleLookup} disabled={loading}>
              {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 160 }}>
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
            {result ? (
              <View style={styles.modalResult}>
                <Text style={styles.modalResultText}>"{result.text}"</Text>
                <Text style={styles.modalResultRef}>— {ref.trim()}</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    channelName: string; otherUserId: string; otherUserName?: string; callType?: CallType;
    isInitiator?: string; callId?: string; conversationId?: string; callLogId?: string;
    sessionId?: string; lessonId?: string;
  }>();
  const isInitiator = params.isInitiator === "true";
  const markedInProgressRef = useRef(false);

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
  const myUid = useRef(profile?.id ? uidFromUserId(profile.id) : 1).current;

  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [blurOn, setBlurOn] = useState(false);
  const [scriptureVisible, setScriptureVisible] = useState(false);
  const [poorConnection, setPoorConnection] = useState(false);
  const [videoAutoDisabled, setVideoAutoDisabled] = useState(false);
  const [callState, setCallState] = useState<"connecting" | "ringing" | "connected" | "ended">("connecting");
  const endedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const poorQualityStreakRef = useRef(0);

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
            callType: "video",
            connected: wasConnected,
            durationSeconds,
          }),
        });
      } catch { /* the call is ending either way; a lost summary message isn't worth blocking on */ }
    }

    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages" as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callLogId, params.conversationId]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName,
    token,
    uid: myUid,
    enableVideo: true,
    eventHandler: {
      onUserJoined: (_connection, uid) => {
        connectedAtRef.current = Date.now();
        setRemoteUid(uid);
        setCallState("connected");
        if (params.sessionId && !markedInProgressRef.current) {
          markedInProgressRef.current = true;
          void fetch(`${getApiUrl()}/calls/sessions/${params.sessionId}/mark-in-progress`, { method: "POST" });
        }
      },
      onUserOffline: () => {
        setRemoteUid(null);
        handleEndCall();
      },
      onNetworkQuality: (_connection, uid, txQuality, rxQuality) => {
        if (uid !== 0) return; // only the local user's own uplink/downlink
        const worst = Math.max(txQuality, rxQuality);
        if (worst >= QualityType.QualityBad) {
          poorQualityStreakRef.current += 1;
        } else {
          poorQualityStreakRef.current = 0;
          if (poorConnection) setPoorConnection(false);
        }
        // A few consecutive bad samples (not just one blip) before reacting.
        if (poorQualityStreakRef.current >= 3 && !videoAutoDisabled) {
          setPoorConnection(true);
          setVideoAutoDisabled(true);
          setCameraOn(false);
          engineRef.current?.enableLocalVideo(false);
        }
      },
    },
  });

  useEffect(() => {
    if (!connectedAtRef.current) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [remoteUid]);

  useEffect(() => {
    if (!isInitiator || !params.callId || remoteUid) return;
    const channel = supabase
      .channel(`p2p_call_watch_${params.callId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_incoming_calls", filter: `id=eq.${params.callId}` },
        (payload) => {
          const status = (payload.new as Record<string, unknown>).status as string;
          if (status === "declined" || status === "missed" || status === "cancelled") handleEndCall();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isInitiator, params.callId, remoteUid, handleEndCall]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }
  function toggleCamera() {
    const next = !cameraOn;
    setCameraOn(next);
    engineRef.current?.enableLocalVideo(next);
  }
  function flipCamera() {
    engineRef.current?.switchCamera();
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

  const otherName = params.otherUserName || "Peer";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {remoteUid !== null && !poorConnection ? (
        <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: remoteUid }} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.remoteFallback]}>
          <Ionicons name="person" size={64} color="rgba(255,255,255,0.3)" />
          {(callState === "connecting" || callState === "ringing") && (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.statusText}>{callState === "connecting" ? "Connecting…" : "Calling…"}</Text>
            </View>
          )}
        </View>
      )}

      {cameraOn && (
        <TouchableOpacity style={[styles.pip, { top: insets.top + 16 }]} onPress={toggleBlur} activeOpacity={0.85}>
          <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} zOrderMediaOverlay />
          {blurOn && (
            <View style={styles.pipBlurBadge}>
              <Ionicons name="sparkles" size={10} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      )}

      {poorConnection && (
        <View style={[styles.banner, { top: insets.top + 10 }]}>
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={styles.bannerText}>Poor connection — switched to audio only</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{otherName}</Text>
          {callState === "connected" && <Text style={styles.timer}>{formatClock(elapsed)}</Text>}
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={toggleCamera}>
            <Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={flipCamera} disabled={!cameraOn}>
            <Ionicons name="camera-reverse" size={20} color={cameraOn ? "#fff" : "rgba(255,255,255,0.35)"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={() => setScriptureVisible(true)}>
            <Ionicons name="book" size={20} color="#fff" />
          </TouchableOpacity>
          {sessionQuestions.length > 0 && (
            <TouchableOpacity style={styles.controlBtn} onPress={() => setLessonSidebarVisible(true)}>
              <Ionicons name="list" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleEndCall}>
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
        </View>
      </View>

      <ScriptureModal visible={scriptureVisible} onClose={() => setScriptureVisible(false)} />

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E" },
  remoteFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#111A15", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Inter_400Regular" },
  pip: {
    position: "absolute", right: 16, width: 110, height: 150, borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", backgroundColor: "#000",
  },
  pipBlurBadge: {
    position: "absolute", bottom: 6, right: 6, backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10, padding: 4,
  },
  banner: {
    position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(180,83,9,0.9)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  bannerText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.35)", gap: 14,
  },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  timer: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_500Medium" },
  controlsRow: { flexDirection: "row", justifyContent: "space-between" },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  endBtn: { backgroundColor: "#DC2626" },

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