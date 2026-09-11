import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform, Modal, TextInput, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { ParticipantGrid, type GridTile } from "@/components/call/ParticipantGrid";
import {
  getChurchCall, leaveChurchCall, endChurchCall, CHURCH_CALL_PURPOSE_LABELS,
  getChurchCallMessages, sendChurchCallMessage, setParticipantMicDisabled, setParticipantVideoDisabled, removeParticipant,
  setChurchCallScripture, setChurchCallLesson, setChurchCallMedia,
  type ChurchCallDetail, type ChurchCallMessage, type ChurchCallParticipant,
} from "@/lib/churchCallApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const REACTIONS = ["🙏", "❤️", "🙌", "🔥", "👏"];

// Stage 2 — moderation/raise-hand/reaction/chat signals ride the same
// private Supabase Realtime broadcast pattern already proven by
// app/call/group.tsx and family/worship/[sessionId].tsx (Agora RTC gives
// no participant authority over another's stream — this is cooperative
// signaling for instant UX, with the actually-enforced state persisted
// server-side; see migration 131's own comments). No new signaling
// mechanism, no new reaction/hand-raise system.
type SignalType = "reaction" | "hand_raised" | "hand_lowered" | "mic_disabled" | "video_disabled" | "removed" | "chat_message";
interface Signal { type: SignalType; from: string; data?: any }

// Church Calls' live screen — reuses the exact same Agora engine/token
// plumbing (useAgora/useAgoraEngine) and the generic ParticipantGrid
// already proven by Peer Circle's app/call/group.tsx. Stage 2 adds: chat,
// reactions, raise hand, host moderation (mute/video-disable/remove), and
// a purpose-based presentation (Teaching emphasizes the host/speaker;
// Meeting/Bible Study/Prayer/etc. share the same balanced grid) — all on
// top of the same call, never a second call system.
export default function ChurchCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ callId: string; channelName: string; title?: string }>();

  const [detail, setDetail] = useState<ChurchCallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const [tokenAppId, setTokenAppId] = useState<string | undefined>(undefined);
  const myUid = useMemo(() => (profile?.id ? uidFromUserId(profile.id) : null), [profile?.id]);

  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micDisabledByHost, setMicDisabledByHost] = useState(false);
  const [videoDisabledByHost, setVideoDisabledByHost] = useState(false);
  const [ending, setEnding] = useState(false);
  const [speakingUids, setSpeakingUids] = useState<Set<number>>(new Set());

  const [handRaised, setHandRaised] = useState(false);
  const [raisedHandUserIds, setRaisedHandUserIds] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<{ id: number; emoji: string }[]>([]);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChurchCallMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [scriptureBook, setScriptureBook] = useState("");
  const [scriptureChapter, setScriptureChapter] = useState("");
  const [scriptureStartVerse, setScriptureStartVerse] = useState("");
  const [scriptureEndVerse, setScriptureEndVerse] = useState("");
  const [scriptureTranslation, setScriptureTranslation] = useState("NIV");
  const [lessonIdInput, setLessonIdInput] = useState("");
  const [youtubeIdInput, setYoutubeIdInput] = useState("");
  const [savingTools, setSavingTools] = useState(false);

  const isHost = !!profile?.id && detail?.call.hostId === profile.id;
  const purpose = detail?.call.purpose;
  const isTeaching = purpose === "teaching";

  const load = useCallback(async () => {
    if (!params.callId) return;
    try {
      const d = await getChurchCall(params.callId);
      setDetail(d);
      const me = d.participants.find((p) => p.userId === profile?.id);
      if (me) {
        setMicDisabledByHost(me.micDisabledByHost);
        setVideoDisabledByHost(me.videoDisabledByHost);
      }
    } catch (e: any) {
      showAlert("Couldn't load this call", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.callId, profile?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!params.callId) return;
    getChurchCallMessages(params.callId).then(setMessages).catch(() => {});
  }, [params.callId]);

  useEffect(() => {
    if (!myUid || !profile?.id || !params.channelName) return;
    let cancelled = false;
    (async () => {
      try {
        const { token: t, appId } = await getToken(params.channelName, myUid, profile.id);
        if (!cancelled) { setToken(t); setTokenAppId(appId); }
      } catch (e: any) {
        showAlert("Couldn't join", e.message ?? "Please try again.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.channelName, myUid, profile?.id]);

  const signalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sendSignal = useCallback((type: SignalType, data?: any) => {
    signalRef.current?.send({ type: "broadcast", event: "signal", payload: { type, from: profile?.id, data } as Signal });
  }, [profile?.id]);

  const handleLeave = useCallback(async () => {
    if (params.callId) { try { await leaveChurchCall(params.callId); } catch { /* best-effort */ } }
    if (router.canGoBack()) router.back();
    else router.replace("/church/calls" as any);
  }, [params.callId, router]);

  useEffect(() => {
    if (!profile?.id || !params.callId) return;
    const myId = profile.id;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase.channel(`church_call_signal_${params.callId}`, { config: { broadcast: { self: false }, private: true } });
      channel.on("broadcast", { event: "signal" }, ({ payload }: { payload: Signal }) => {
        switch (payload.type) {
          case "reaction": {
            const id = Date.now() + Math.random();
            setReactions((prev) => [...prev, { id, emoji: payload.data.emoji }]);
            setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 1500);
            break;
          }
          case "hand_raised":
            if (payload.data?.userId) setRaisedHandUserIds((prev) => new Set(prev).add(payload.data.userId));
            break;
          case "hand_lowered":
            if (payload.data?.userId) setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(payload.data.userId); return n; });
            break;
          case "mic_disabled":
            if (payload.data?.userId === myId) {
              setMicDisabledByHost(!!payload.data.disabled);
              if (payload.data.disabled) { setMuted(true); engineRef.current?.muteLocalAudioStream(true); }
            }
            break;
          case "video_disabled":
            if (payload.data?.userId === myId) {
              setVideoDisabledByHost(!!payload.data.disabled);
              if (payload.data.disabled) { setCameraOn(false); engineRef.current?.enableLocalVideo(false); }
            }
            break;
          case "removed":
            if (payload.data?.userId === myId) {
              showAlert("Removed", "The host removed you from this call.");
              handleLeave();
            }
            break;
          case "chat_message":
            setMessages((prev) => (prev.some((m) => m.id === payload.data.id) ? prev : [...prev, payload.data]));
            break;
        }
      }).subscribe((status, error) => {
        // Transient and self-recovering (Supabase's client auto-retries the
        // same channel) — console.warn, not .error, so a brief reconnect
        // blip during an unstable connection doesn't repeatedly trigger the
        // dev-client's error overlay, which has an interactive backdrop
        // that can end up covering the call's own controls (found live:
        // it sat on top of End Call/chat during a multi-minute reconnect
        // loop). Same CHANNEL_ERROR pattern as the pre-existing
        // group.tsx signal channel; left that file untouched per the
        // no-shared-changes-without-proof rule — this fix is Church-Calls-
        // local only.
        if (status === "CHANNEL_ERROR") console.warn("Church Call realtime channel reconnecting", error);
      });
      signalRef.current = channel;
    })();

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      if (channel) { supabase.removeChannel(channel); signalRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, params.callId, handleLeave]);

  const engineRef = useAgoraEngine({
    channelName: params.channelName ?? "",
    token,
    uid: myUid,
    enableVideo: true,
    appId: tokenAppId,
    eventHandler: {
      // Refetch on join/leave — detail.participants (names, mic/video-
      // disabled flags) is only ever fetched via load(); without this it
      // would go stale the moment anyone joins after the initial mount,
      // showing "Someone" instead of their real name and missing them
      // from the Participants/moderation panel entirely.
      onUserJoined: (_c, uid) => { setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid])); load(); },
      onUserOffline: (_c, uid) => { setRemoteUids((prev) => prev.filter((u) => u !== uid)); load(); },
      onAudioVolumeIndication: (_c, speakers) => {
        const loud = new Set((speakers ?? []).filter((s: any) => (s.volume ?? 0) > 40).map((s: any) => s.uid ?? 0));
        setSpeakingUids(loud);
      },
    },
  });

  function toggleMute() {
    if (micDisabledByHost) { showAlert("Muted by host", "The host has muted your microphone for this call."); return; }
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }
  function toggleCamera() {
    if (videoDisabledByHost) { showAlert("Video disabled by host", "The host has turned off your video for this call."); return; }
    const next = !cameraOn;
    setCameraOn(next);
    engineRef.current?.enableLocalVideo(next);
  }
  function toggleRaiseHand() {
    if (!profile?.id) return;
    const next = !handRaised;
    setHandRaised(next);
    sendSignal(next ? "hand_raised" : "hand_lowered", { userId: profile.id });
  }
  function lowerHand(userId: string) {
    sendSignal("hand_lowered", { userId });
    setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(userId); return n; });
  }

  async function handleMuteParticipant(p: ChurchCallParticipant) {
    if (!params.callId) return;
    const next = !p.micDisabledByHost;
    try {
      await setParticipantMicDisabled(params.callId, p.userId, next);
      sendSignal("mic_disabled", { userId: p.userId, disabled: next });
      setDetail((prev) => prev ? { ...prev, participants: prev.participants.map((x) => x.userId === p.userId ? { ...x, micDisabledByHost: next } : x) } : prev);
    } catch (e: any) { showAlert("Couldn't update", e.message ?? "Please try again."); }
  }
  async function handleVideoDisableParticipant(p: ChurchCallParticipant) {
    if (!params.callId) return;
    const next = !p.videoDisabledByHost;
    try {
      await setParticipantVideoDisabled(params.callId, p.userId, next);
      sendSignal("video_disabled", { userId: p.userId, disabled: next });
      setDetail((prev) => prev ? { ...prev, participants: prev.participants.map((x) => x.userId === p.userId ? { ...x, videoDisabledByHost: next } : x) } : prev);
    } catch (e: any) { showAlert("Couldn't update", e.message ?? "Please try again."); }
  }
  function handleRemoveParticipant(p: ChurchCallParticipant) {
    Alert.alert(`Remove ${p.name}?`, "They'll be disconnected from this call.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        if (!params.callId) return;
        try {
          await removeParticipant(params.callId, p.userId);
          sendSignal("removed", { userId: p.userId });
          setDetail((prev) => prev ? { ...prev, participants: prev.participants.filter((x) => x.userId !== p.userId) } : prev);
        } catch (e: any) { showAlert("Couldn't remove", e.message ?? "Please try again."); }
      } },
    ]);
  }

  function sendReaction(emoji: string) {
    sendSignal("reaction", { emoji });
    const id = Date.now();
    setReactions((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 1500);
  }

  async function handleSendChat() {
    const content = chatInput.trim();
    if (!content || !params.callId) return;
    setChatInput("");
    try {
      const message = await sendChurchCallMessage(params.callId, content);
      setMessages((prev) => [...prev, message]);
      sendSignal("chat_message", { id: message.id, callId: message.callId, userId: message.userId, authorName: message.authorName, content: message.content, createdAt: message.createdAt });
    } catch (e: any) { showAlert("Couldn't send message", e.message ?? "Please try again."); }
  }

  async function handleAttachScripture() {
    const chapter = parseInt(scriptureChapter, 10);
    const startVerse = parseInt(scriptureStartVerse, 10);
    const endVerse = scriptureEndVerse ? parseInt(scriptureEndVerse, 10) : undefined;
    if (!scriptureBook.trim() || !chapter || !startVerse || !scriptureTranslation.trim()) {
      showAlert("Missing details", "Book, chapter, start verse, and translation are required.");
      return;
    }
    if (!params.callId) return;
    setSavingTools(true);
    try {
      const { scriptureReference } = await setChurchCallScripture(params.callId, {
        book: scriptureBook.trim(), chapter, startVerse, endVerse: endVerse ?? startVerse, translation: scriptureTranslation.trim(),
      });
      setDetail((prev) => prev ? { ...prev, call: { ...prev.call, scriptureReference } } : prev);
      showAlert("Scripture attached", `${scriptureReference.book} ${scriptureReference.chapter}:${scriptureReference.startVerse}`);
    } catch (e: any) { showAlert("Couldn't attach Scripture", e.message ?? "Please try again."); }
    finally { setSavingTools(false); }
  }
  async function handleAttachLesson() {
    if (!params.callId || !lessonIdInput.trim()) return;
    setSavingTools(true);
    try {
      const { lesson } = await setChurchCallLesson(params.callId, lessonIdInput.trim());
      setDetail((prev) => prev ? { ...prev, lesson, call: { ...prev.call, lessonId: lesson?.lessonId ?? null } } : prev);
      showAlert("Lesson attached", lesson?.lessonTitle ?? "");
    } catch (e: any) { showAlert("Couldn't attach lesson", e.message ?? "Please try again."); }
    finally { setSavingTools(false); }
  }
  async function handleAttachMedia() {
    if (!params.callId || !youtubeIdInput.trim()) return;
    setSavingTools(true);
    try {
      const { media } = await setChurchCallMedia(params.callId, { provider: "youtube", id: youtubeIdInput.trim() });
      setDetail((prev) => prev ? { ...prev, call: { ...prev.call, media } } : prev);
      showAlert("Media attached", "");
    } catch (e: any) { showAlert("Couldn't attach media", e.message ?? "Please try again."); }
    finally { setSavingTools(false); }
  }

  async function handleEnd() {
    if (!params.callId) return;
    setEnding(true);
    try {
      await endChurchCall(params.callId);
      if (router.canGoBack()) router.back();
      else router.replace("/church/calls" as any);
    } catch (e: any) {
      showAlert("Couldn't end the call", e.message ?? "Please try again.");
    } finally {
      setEnding(false);
    }
  }

  if (loading || !detail) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const nameByUserId = new Map(detail.participants.map((p) => [uidFromUserId(p.userId), p.name]));
  const allTiles: GridTile[] = [
    { uid: 0, name: "You", isSelf: true, videoOn: cameraOn && !videoDisabledByHost },
    ...remoteUids.map((uid) => ({ uid, name: nameByUserId.get(uid) ?? "Someone", isSelf: false, videoOn: true })),
  ];
  // Teaching mode — the host/speaker gets the large tile, everyone else a
  // small strip. Same ParticipantGrid component, just partitioned
  // differently — never a second video-rendering implementation.
  const iAmHost = !!profile?.id && detail.call.hostId === profile.id;
  const hostUid = detail.call.hostId ? uidFromUserId(detail.call.hostId) : null;
  const speakerTile = isTeaching ? allTiles.find((t) => (t.isSelf && iAmHost) || (!t.isSelf && t.uid === hostUid)) ?? allTiles[0] : null;
  const otherTiles = isTeaching && speakerTile ? allTiles.filter((t) => t !== speakerTile) : allTiles;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.topBarTitle} numberOfLines={1}>{detail.call.title}</Text>
          <Text style={styles.topBarSub}>
            {CHURCH_CALL_PURPOSE_LABELS[detail.call.purpose]} · {allTiles.length} participant{allTiles.length === 1 ? "" : "s"}
          </Text>
        </View>
        <TouchableOpacity style={styles.iconBtnSmall} onPress={() => { setParticipantsOpen(true); load(); }}>
          <Ionicons name="people" size={16} color="#fff" />
          {raisedHandUserIds.size > 0 && <View style={styles.badgeDot} />}
        </TouchableOpacity>
        {isHost && (
          <TouchableOpacity style={styles.iconBtnSmall} onPress={() => setToolsOpen(true)}>
            <Ionicons name="book" size={16} color="#fff" />
          </TouchableOpacity>
        )}
        <View style={styles.liveDot} />
      </View>

      {(detail.call.scriptureReference || detail.lesson || detail.call.media) && (
        <View style={styles.contextBanner}>
          {detail.call.scriptureReference && (
            <Text style={styles.contextText} numberOfLines={1}>
              📖 {detail.call.scriptureReference.book} {detail.call.scriptureReference.chapter}:{detail.call.scriptureReference.startVerse}
              {detail.call.scriptureReference.endVerse !== detail.call.scriptureReference.startVerse ? `-${detail.call.scriptureReference.endVerse}` : ""} ({detail.call.scriptureReference.translation})
            </Text>
          )}
          {detail.lesson && <Text style={styles.contextText} numberOfLines={1}>📚 {detail.lesson.lessonTitle}</Text>}
          {detail.call.media && <Text style={styles.contextText} numberOfLines={1}>▶️ Media attached</Text>}
        </View>
      )}

      {isTeaching && speakerTile ? (
        <View style={{ flex: 1 }}>
          <View style={styles.speakerWrap}>
            <ParticipantGrid tiles={[speakerTile]} />
          </View>
          {otherTiles.length > 0 && (
            <View style={styles.smallStrip}>
              <ParticipantGrid tiles={otherTiles} />
            </View>
          )}
        </View>
      ) : (
        <ParticipantGrid tiles={allTiles} />
      )}

      <View style={styles.reactionsOverlay} pointerEvents="none">
        {reactions.map((r) => (
          <Text key={r.id} style={styles.floatingReaction}>{r.emoji}</Text>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.reactionRow}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
            <Text style={{ fontSize: 18 }}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.reactionBtn, handRaised && styles.reactionBtnActive]} onPress={toggleRaiseHand}>
          <Text style={{ fontSize: 16 }}>✋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reactionBtn} onPress={() => setChatOpen(true)}>
          <Ionicons name="chatbubble-outline" size={16} color="#fff" />
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.controlsRow, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Ionicons name={muted || micDisabledByHost ? "mic-off" : "mic"} size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleCamera}>
          <Ionicons name={cameraOn && !videoDisabledByHost ? "videocam" : "videocam-off"} size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleLeave}>
          <Ionicons name="call" size={18} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </TouchableOpacity>
      </View>

      {isHost && (
        <View style={styles.hostBar}>
          <TouchableOpacity style={styles.hostBtn} onPress={handleEnd} disabled={ending}>
            {ending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.hostBtnText}>End Call for Everyone</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Participants + moderation */}
      <Modal visible={participantsOpen} transparent animationType="slide" onRequestClose={() => setParticipantsOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Participants</Text>
              <TouchableOpacity onPress={() => setParticipantsOpen(false)}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {detail.participants.map((p) => {
                const handUp = raisedHandUserIds.has(p.userId);
                const isTileHost = p.userId === detail.call.hostId;
                return (
                  <View key={p.userId} style={styles.participantRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.participantName}>
                        {p.name}{p.userId === profile?.id ? " (You)" : ""}{isTileHost ? "  ⭐ Host" : ""}
                      </Text>
                      <Text style={styles.participantMeta}>
                        {p.micDisabledByHost ? "Mic disabled  " : ""}{p.videoDisabledByHost ? "Video disabled  " : ""}{handUp ? "✋ Raised hand" : ""}
                      </Text>
                    </View>
                    {handUp && isHost && (
                      <TouchableOpacity style={styles.smallActionBtn} onPress={() => lowerHand(p.userId)}>
                        <Text style={styles.smallActionText}>Lower</Text>
                      </TouchableOpacity>
                    )}
                    {isHost && p.userId !== profile?.id && !isTileHost && (
                      <>
                        <TouchableOpacity style={styles.smallActionBtn} onPress={() => handleMuteParticipant(p)}>
                          <Text style={styles.smallActionText}>{p.micDisabledByHost ? "Unmute" : "Mute"}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallActionBtn} onPress={() => handleVideoDisableParticipant(p)}>
                          <Text style={styles.smallActionText}>{p.videoDisabledByHost ? "Video On" : "Video Off"}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallActionBtn, styles.removeBtn]} onPress={() => handleRemoveParticipant(p)}>
                          <Text style={styles.smallActionText}>Remove</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Chat */}
      <Modal visible={chatOpen} transparent animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Chat</Text>
              <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {messages.length === 0 ? (
                <Text style={styles.sheetEmpty}>No messages yet.</Text>
              ) : messages.map((m) => (
                <View key={m.id} style={styles.chatRow}>
                  <Text style={styles.chatAuthor}>{m.authorName}</Text>
                  <Text style={styles.chatContent}>{m.content}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Message..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={handleSendChat}
              />
              <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendChat}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ministry Tools — Stage 4: Scripture / Lesson / Media, all optional
          associations into the existing Bible/curriculum/media systems.
          Never duplicates Bible text, curriculum, or writes lesson
          progress. */}
      <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={() => setToolsOpen(false)}>
        <View style={styles.sheetOverlay}>
          <ScrollView contentContainerStyle={styles.sheetBox} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Ministry Tools</Text>
              <TouchableOpacity onPress={() => setToolsOpen(false)}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
            </View>

            <Text style={styles.toolsLabel}>Scripture</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[styles.toolsInput, { flex: 2 }]} placeholder="Book" placeholderTextColor="rgba(255,255,255,0.4)" value={scriptureBook} onChangeText={setScriptureBook} />
              <TextInput style={[styles.toolsInput, { flex: 1 }]} placeholder="Ch." placeholderTextColor="rgba(255,255,255,0.4)" value={scriptureChapter} onChangeText={setScriptureChapter} keyboardType="number-pad" />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[styles.toolsInput, { flex: 1 }]} placeholder="Start verse" placeholderTextColor="rgba(255,255,255,0.4)" value={scriptureStartVerse} onChangeText={setScriptureStartVerse} keyboardType="number-pad" />
              <TextInput style={[styles.toolsInput, { flex: 1 }]} placeholder="End verse" placeholderTextColor="rgba(255,255,255,0.4)" value={scriptureEndVerse} onChangeText={setScriptureEndVerse} keyboardType="number-pad" />
              <TextInput style={[styles.toolsInput, { flex: 1 }]} placeholder="NIV" placeholderTextColor="rgba(255,255,255,0.4)" value={scriptureTranslation} onChangeText={setScriptureTranslation} />
            </View>
            <TouchableOpacity style={styles.toolsBtn} onPress={handleAttachScripture} disabled={savingTools}>
              <Text style={styles.toolsBtnText}>Attach Scripture</Text>
            </TouchableOpacity>

            <Text style={styles.toolsLabel}>Lesson</Text>
            <Text style={styles.sheetEmpty}>Find the lesson's ID in Study Workspace, then paste it here.</Text>
            <TextInput style={styles.toolsInput} placeholder="Lesson ID" placeholderTextColor="rgba(255,255,255,0.4)" value={lessonIdInput} onChangeText={setLessonIdInput} />
            <TouchableOpacity style={styles.toolsBtn} onPress={handleAttachLesson} disabled={savingTools}>
              <Text style={styles.toolsBtnText}>Attach Lesson</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolsLinkBtn} onPress={() => router.push("/curriculum" as any)}>
              <Text style={styles.toolsLinkText}>Open Study Workspace →</Text>
            </TouchableOpacity>

            <Text style={styles.toolsLabel}>Media (YouTube)</Text>
            <TextInput style={styles.toolsInput} placeholder="YouTube video ID" placeholderTextColor="rgba(255,255,255,0.4)" value={youtubeIdInput} onChangeText={setYoutubeIdInput} />
            <TouchableOpacity style={styles.toolsBtn} onPress={handleAttachMedia} disabled={savingTools}>
              <Text style={styles.toolsBtnText}>Attach Media</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B120E" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  topBarTitle: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  topBarSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },
  iconBtnSmall: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  badgeDot: { position: "absolute", top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: "#B8860B" },

  speakerWrap: { flex: 3 },
  smallStrip: { flex: 1, maxHeight: 140 },

  reactionsOverlay: { position: "absolute", bottom: 180, alignSelf: "center", alignItems: "center" },
  floatingReaction: { fontSize: 26, marginBottom: 4 },

  reactionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 6 },
  reactionBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  reactionBtnActive: { backgroundColor: "#B8860B" },

  controlsRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 16, paddingTop: 8 },
  controlBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  endBtn: { backgroundColor: "#DC2626" },

  hostBar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 10, justifyContent: "center" },
  hostBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  hostBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, maxHeight: "80%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sheetEmpty: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular" },

  participantRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)", flexWrap: "wrap" },
  participantName: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  participantMeta: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  smallActionBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 6 },
  removeBtn: { borderColor: "#DC2626" },
  smallActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium" },

  chatRow: { paddingVertical: 6 },
  chatAuthor: { color: "#1D9E75", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  chatContent: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  chatInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  chatInput: { flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },
  chatSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },

  contextBanner: { paddingHorizontal: 16, paddingBottom: 8, gap: 2 },
  contextText: { color: "#B8860B", fontSize: 11, fontFamily: "Inter_500Medium" },

  toolsLabel: { color: "#1D9E75", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginTop: 10 },
  toolsInput: {
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular",
  },
  toolsBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 6 },
  toolsBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  toolsLinkBtn: { alignItems: "center", paddingVertical: 8 },
  toolsLinkText: { color: "#1D9E75", fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
