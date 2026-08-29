import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData } from "@/contexts/DataContext";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

// The REAL p2p_sessions row — distinct from DataContext's `sessions` array,
// which reads a mismatched set of columns (participant_count, is_live,
// host_name) that don't exist on this table. This table's actual shape is
// a genuine 1:1 mentor/participant peer session, which is what the peer
// confirmation system (migration 036) hooks into on completion.
interface RealSessionRow {
  id: string;
  title: string;
  mentor_id: string | null;
  participant_id: string | null;
  lesson_id: string | null;
  status: string;
  scheduled_time: string | null;
  started_at: string | null;
  reflection_note: string | null;
  rating: number | null;
}

const JOIN_WINDOW_MS = 5 * 60 * 1000;

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  time: string;
}


export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sessions } = useData();

  const session = sessions.find((s) => s.id === id) ?? {
    id: id ?? "s1",
    title: "Bible Study Session",
    description: "Live peer study",
    isLive: true,
    participantCount: 4,
    hostName: "Host",
    durationMinutes: 45,
    scheduledAt: new Date().toISOString(),
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const { user } = useAuth();
  const [realSession, setRealSession] = useState<RealSessionRow | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadRealSession = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from("p2p_sessions")
      .select("id,title,mentor_id,participant_id,lesson_id,status,scheduled_time,started_at,reflection_note,rating")
      .eq("id", id)
      .maybeSingle();
    setRealSession((data as RealSessionRow) ?? null);
  }, [id]);

  useEffect(() => { loadRealSession(); }, [loadRealSession]);

  const justJoinedCallRef = useRef(false);
  const [reflectionModalOpen, setReflectionModalOpen] = useState(false);
  const [reflectionNote, setReflectionNote] = useState("");
  const [reflectionRating, setReflectionRating] = useState(0);
  const [savingReflection, setSavingReflection] = useState(false);
  const [joiningVideo, setJoiningVideo] = useState(false);

  useFocusEffect(useCallback(() => {
    loadRealSession();
    if (justJoinedCallRef.current) {
      justJoinedCallRef.current = false;
      if (realSession && !realSession.reflection_note) setReflectionModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRealSession]));

  const canJoinVideo = !!realSession?.scheduled_time &&
    Date.now() >= new Date(realSession.scheduled_time).getTime() - JOIN_WINDOW_MS &&
    realSession.status !== "completed";

  async function joinVideoSession() {
    if (!realSession || !user || joiningVideo) return;
    setJoiningVideo(true);
    try {
      const otherUserId = realSession.mentor_id === user.id ? realSession.participant_id : realSession.mentor_id;
      if (!otherUserId) return;
      const channelRes = await fetch(`${getApiUrl()}/calls/peer-channel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUserId: user.id, otherUserId }),
      });
      const { channelName } = await channelRes.json();
      const startRes = await authedFetch("/calls/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, callType: "video", recipientId: otherUserId }),
      });
      const { callLogId, incomingCallId } = await startRes.json();
      justJoinedCallRef.current = true;
      router.push({
        pathname: "/call/video" as any,
        params: {
          channelName, otherUserId, otherUserName: session.title, callType: "video", isInitiator: "true",
          callId: incomingCallId, callLogId, sessionId: realSession.id, lessonId: realSession.lesson_id ?? undefined,
        },
      });
    } finally {
      setJoiningVideo(false);
    }
  }

  async function submitReflection() {
    if (!realSession || savingReflection) return;
    setSavingReflection(true);
    try {
      await fetch(`${getApiUrl()}/calls/sessions/${realSession.id}/reflection`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: reflectionNote, rating: reflectionRating || undefined }),
      });
      setReflectionModalOpen(false);
      setReflectionNote("");
      setReflectionRating(0);
      await loadRealSession();
    } finally {
      setSavingReflection(false);
    }
  }

  const isParticipant = !!user && !!realSession && (realSession.mentor_id === user.id || realSession.participant_id === user.id);
  const isCompleted = realSession?.status === "completed";

  async function handleMarkComplete() {
    if (!realSession || completing || !user) return;
    setCompleting(true);
    const { error } = await supabase
      .from("p2p_sessions")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", realSession.id);
    setCompleting(false);
    if (error) {
      Alert.alert("Couldn't mark complete", error.message);
      return;
    }
    const peerId = realSession.mentor_id === user.id ? realSession.participant_id : realSession.mentor_id;
    void supabase.from("p2p_user_activity_events").insert({
      user_id: user.id,
      event_type: "session_held",
      metadata: { session_id: realSession.id, peer_id: peerId },
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadRealSession();
  }

  function sendMessage() {
    if (!input.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMessages((prev) => [
      {
        id: Date.now().toString(),
        user: "You",
        text: input.trim(),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
      ...prev,
    ]);
    setInput("");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.cream} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionTitle} numberOfLines={1}>{session.title}</Text>
          <View style={styles.metaRow}>
            {session.isLive && <View style={styles.liveDot} />}
            <Text style={styles.metaText}>
              {session.isLive ? "Live · " : ""}{session.participantCount} participants
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.leaveBtn} onPress={() => router.back()}>
          <Text style={styles.leaveBtnText}>Leave</Text>
        </TouchableOpacity>
      </View>

      {/* Verse of the session */}
      <View style={styles.verseBar}>
        <Ionicons name="bookmark" size={13} color={colors.amber} />
        <Text style={styles.verseBarText}>John 15:5</Text>
      </View>

      {isParticipant && canJoinVideo && (
        <TouchableOpacity style={styles.joinVideoBtn} onPress={joinVideoSession} disabled={joiningVideo} activeOpacity={0.85}>
          {joiningVideo ? <ActivityIndicator color={colors.cream} size="small" /> : (
            <>
              <Ionicons name="videocam" size={16} color={colors.cream} />
              <Text style={styles.joinVideoBtnText}>Join Video Session</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Mark session complete — this is what actually fires the Fellowship
          confirmation request (and, if participants are from different
          countries, the Unity fruit) for both people in this session. */}
      {isParticipant && (
        isCompleted ? (
          <View style={styles.completeBanner}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.completeBannerText}>Session marked complete</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.completeBtn} onPress={handleMarkComplete} disabled={completing} activeOpacity={0.85}>
            {completing ? (
              <ActivityIndicator color={colors.cream} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={16} color={colors.cream} />
                <Text style={styles.completeBtnText}>Mark Session Complete</Text>
              </>
            )}
          </TouchableOpacity>
        )
      )}

      {/* Chat */}
      {messages.length === 0 && (
        <View style={styles.emptyChat}>
          <Ionicons name="chatbubbles-outline" size={36} color={colors.navBorder} />
          <Text style={styles.emptyChatText}>No messages yet — start the conversation.</Text>
        </View>
      )}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        renderItem={({ item }) => (
          <View style={[styles.msgRow, item.user === "You" && styles.msgRowOwn]}>
            {item.user !== "You" && (
              <View style={styles.msgAvatar}>
                <Text style={styles.msgAvatarText}>{item.user.charAt(0)}</Text>
              </View>
            )}
            <View style={[styles.bubble, item.user === "You" && styles.bubbleOwn]}>
              {item.user !== "You" && (
                <Text style={styles.msgUser}>{item.user}</Text>
              )}
              <Text style={[styles.msgText, item.user === "You" && styles.msgTextOwn]}>
                {item.text}
              </Text>
              <Text style={styles.msgTime}>{item.time}</Text>
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 14 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Input */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Share a thought..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { opacity: input.trim() ? 1 : 0.4 }]}
          onPress={sendMessage}
          disabled={!input.trim()}
        >
          <Ionicons name="send" size={18} color={colors.cream} />
        </TouchableOpacity>
      </View>

      <Modal visible={reflectionModalOpen} transparent animationType="fade" onRequestClose={() => setReflectionModalOpen(false)}>
        <View style={styles.reflectionOverlay}>
          <View style={styles.reflectionSheet}>
            <Text style={styles.reflectionTitle}>How did your session go?</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setReflectionRating(n)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                  <Ionicons name={n <= reflectionRating ? "star" : "star-outline"} size={28} color={colors.amber} />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.reflectionInput}
              value={reflectionNote}
              onChangeText={setReflectionNote}
              placeholder="Any reflections from this session? (optional)"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              <TouchableOpacity style={styles.reflectionSkipBtn} onPress={() => setReflectionModalOpen(false)}>
                <Text style={styles.reflectionSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reflectionSaveBtn} onPress={submitReflection} disabled={savingReflection}>
                {savingReflection ? <ActivityIndicator color={colors.cream} size="small" /> : <Text style={styles.reflectionSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.navBg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.navBorder,
  },
  backBtn: { padding: 4 },
  sessionTitle: { fontSize: 15, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF4444" },
  metaText: { fontSize: 12, color: colors.lightGreen, opacity: 0.8, fontFamily: "Inter_400Regular" },
  leaveBtn: {
    backgroundColor: "rgba(185,28,28,0.2)",
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  leaveBtnText: { color: "#FCA5A5", fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  completeBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accentGreen, marginHorizontal: 16, marginTop: 10,
    borderRadius: 10, paddingVertical: 10,
  },
  completeBtnText: { color: colors.cream, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  joinVideoBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "#DC2626", marginHorizontal: 16, marginTop: 10,
    borderRadius: 10, paddingVertical: 10,
  },
  joinVideoBtnText: { color: colors.cream, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  reflectionOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  reflectionSheet: { backgroundColor: colors.navBg, borderRadius: 18, padding: 22, width: "100%", gap: 14, borderWidth: 1, borderColor: colors.navBorder },
  reflectionTitle: { fontSize: 16, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold", textAlign: "center" },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 10 },
  reflectionInput: {
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: colors.navBorder,
    padding: 12, color: colors.cream, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 70,
  },
  reflectionSkipBtn: { flex: 1, borderWidth: 1, borderColor: colors.navBorder, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  reflectionSkipText: { color: colors.lightGreen, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  reflectionSaveBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  reflectionSaveText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  completeBanner: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(29,158,117,0.1)", marginHorizontal: 16, marginTop: 10,
    borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
  },
  completeBannerText: { color: colors.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  verseBar: {
    flexDirection: "row", gap: 6, alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: "rgba(186,117,23,0.1)",
    borderBottomWidth: 1, borderBottomColor: colors.navBorder,
  },
  verseBarText: { color: colors.amber, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  emptyChat: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 40 },
  emptyChatText: { fontSize: 13, color: colors.navBorder, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 40 },
  msgRow: { flexDirection: "row", gap: 8, marginBottom: 12, alignItems: "flex-end" },
  msgRowOwn: { flexDirection: "row-reverse" },
  msgAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(29,158,117,0.2)",
    borderWidth: 1, borderColor: colors.navBorder,
    alignItems: "center", justifyContent: "center",
  },
  msgAvatarText: { fontSize: 12, fontWeight: "700", color: colors.lightGreen, fontFamily: "Inter_700Bold" },
  bubble: {
    maxWidth: "75%",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14, borderBottomLeftRadius: 4,
    padding: 10, borderWidth: 1, borderColor: colors.navBorder,
  },
  bubbleOwn: {
    backgroundColor: colors.accentGreen,
    borderRadius: 14, borderBottomRightRadius: 4,
    borderColor: "transparent",
  },
  msgUser: { fontSize: 11, color: colors.lightGreen, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  msgText: { fontSize: 14, color: colors.cream, lineHeight: 20, fontFamily: "Inter_400Regular" },
  msgTextOwn: { color: colors.cream },
  msgTime: { fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, alignSelf: "flex-end", fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row", gap: 8, alignItems: "flex-end",
    padding: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.navBorder,
    backgroundColor: colors.navBg,
  },
  textInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12, borderWidth: 1, borderColor: colors.navBorder,
    paddingHorizontal: 14, paddingVertical: 10,
    color: colors.cream, fontSize: 14, maxHeight: 100,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center",
  },
});
