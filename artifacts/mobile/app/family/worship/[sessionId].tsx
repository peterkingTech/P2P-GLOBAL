import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, Modal, Alert, Platform, Animated, AppState } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import SyncedMediaPlayer from "@/components/family/SyncedMediaPlayer";
import {
  getMyFamily, getWorshipSession, joinWorshipSession, leaveWorshipSession, updateWorshipState, updateWorshipPresence,
  transferWorshipHost, endWorshipSession, getFamilyPrayerRequests, createFamilyPrayerRequest, updateFamilyPrayerRequestStatus,
  getWorshipMessages, sendWorshipMessage, removeWorshipParticipant, canControlMedia,
  getWorshipQueue, addToWorshipQueue, removeFromWorshipQueue, reorderWorshipQueue, playNextInWorshipQueue,
  updateMediaPermission, setTrustedParticipant, getWorshipNotes, createWorshipNote, deleteWorshipNote,
  computeWorshipPositionMs, type WorshipSession, type WorshipMode, type FamilyMember, type FamilyPrayerRequest, type SharedMediaProvider, type WorshipMessage,
  type WorshipQueueItem, type MediaPermission, type WorshipNote, type MessageContext, type WorshipScripture,
} from "@/lib/familyApi";
import { youtubeProvider } from "@/lib/mediaProviders/youtube";
import { useTogetherAudio } from "@/hooks/useTogetherAudio";
import { effectiveMediaVolume } from "@/lib/togetherAudio/mixer";
import AudioBalancePanel from "@/components/family/AudioBalancePanel";
import ChatPanel from "@/components/family/ChatPanel";
import MediaShelfPanel from "@/components/family/MediaShelfPanel";
import ScripturePanel from "@/components/family/ScripturePanel";
import PrayerSpacePanel from "@/components/family/PrayerSpacePanel";
import NotesPanel from "@/components/family/NotesPanel";
import { useVoiceSpace } from "@/hooks/useVoiceSpace";

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
  { key: "teaching", label: "Teaching", icon: "📚" },
];
const REACTIONS = ["🙏", "❤️", "🔥", "👏", "✝️"];

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
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [audioBalanceOpen, setAudioBalanceOpen] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHandUserIds, setRaisedHandUserIds] = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<WorshipMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [pendingChatContext, setPendingChatContext] = useState<MessageContext | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<WorshipNote[]>([]);
  const [mediaShelfOpen, setMediaShelfOpen] = useState(false);
  const [queue, setQueue] = useState<WorshipQueueItem[]>([]);
  const [isBehind, setIsBehind] = useState(false);
  const [resyncNonce, setResyncNonce] = useState(0);
  const leftRef = useRef(false);
  const togetherAudio = useTogetherAudio();
  const voiceCompanions = React.useMemo(
    () => members.filter((m) => m.userId !== profile?.id).map((m) => ({ userId: m.userId, name: m.name })),
    [members, profile?.id]
  );
  const voiceSpace = useVoiceSpace(session?.channelName ?? "", profile?.id, voiceCompanions, togetherAudio.prefs);

  const isHost = session?.hostId === profile?.id;
  const isShepherd = shepherdId === profile?.id;
  // Media Permissions — the client-side mirror used only to decide which
  // controls to show; familyWorship.ts's canControlMedia() re-checks this
  // independently on every mutating call, so this can never be the only
  // gate (no arbitrary client-side permission escalation is possible even
  // if this value were wrong or tampered with).
  const canControl = session ? canControlMedia(session, profile?.id) : false;

  // Reconnect (spec steps 1-3 + 5): always refetches fresh from the server
  // rather than trusting whatever local state survived a background/
  // foreground cycle — session state (which carries Shared Media + the
  // clock needed to compute the current expected position, step 2-3) and
  // participant state (step 5) both come from this one call. Voice state
  // (step 4) is intentionally NOT force-restarted here — the Agora engine
  // has its own reconnect/onConnectionStateChanged handling (useVoiceSpace),
  // and forcing a rejoin on every foreground tap would be more disruptive
  // than helpful; a genuinely dropped voice connection surfaces on its own
  // via that existing "failed" phase + Retry.
  const load = useCallback(async () => {
    if (!params.sessionId) return;
    try {
      const [s, family] = await Promise.all([getWorshipSession(params.sessionId), getMyFamily()]);
      setSession(s);
      setParticipants(s.participants ?? []);
      setMembers(family.members);
      setShepherdId(family.family?.shepherdId ?? null);
      if (family.family) {
        const p = await getFamilyPrayerRequests(family.family.id);
        setPrayers(p);
      }
      // Chat history — a late joiner or reconnecting client catches up here;
      // new messages after that arrive live over the signal broadcast below.
      getWorshipMessages(params.sessionId).then(setMessages).catch(() => {});
      getWorshipQueue(params.sessionId).then(setQueue).catch(() => {});
      getWorshipNotes(params.sessionId).then(setNotes).catch(() => {});
    } catch (e: any) {
      showAlert("Couldn't load Family Worship", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [params.sessionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (params.sessionId) joinWorshipSession(params.sessionId).catch(() => {}); }, [params.sessionId]);

  // Reconnect trigger — foreground resume is the one moment this app can
  // reliably observe "we might have missed something" (the socket itself
  // recovers on its own; stale LOCAL state is the actual risk this guards
  // against, per this task's explicit "do not blindly restore stale local
  // state" instruction).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => sub.remove();
  }, [load]);

  // Ticking re-render so the displayed playback position keeps advancing
  // between session-row updates, without writing anything to the DB.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const leave = useCallback(async () => {
    if (leftRef.current || !params.sessionId) return;
    leftRef.current = true;
    voiceSpace.leave();
    await leaveWorshipSession(params.sessionId).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace("/family" as any);
  }, [params.sessionId, router, voiceSpace.leave]);

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
          currentScripture: (row.current_scripture as WorshipSession["currentScripture"]) ?? null, hostId: row.host_id as string,
        } : prev);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [params.sessionId, leave]);

  // Private signaling channel — Expressions (reactions), Hand Up, Together
  // Chat's live delivery, moderation, and session-state sync all ride the
  // same channel (migration 121's realtime.messages RLS already scopes it
  // to active participants of this exact session — a removed participant
  // is blocked here the instant their participant row is marked left).
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
      .on("broadcast", { event: "hand_raised" }, ({ payload }: { payload: { userId: string } }) => {
        setRaisedHandUserIds((prev) => new Set(prev).add(payload.userId));
      })
      .on("broadcast", { event: "hand_allowed" }, ({ payload }: { payload: { userId: string } }) => {
        setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(payload.userId); return n; });
        if (payload.userId === profile?.id) { setHandRaised(false); showAlert("You're up!", "The Guide invited you to share."); }
      })
      .on("broadcast", { event: "hand_dismissed" }, ({ payload }: { payload: { userId: string } }) => {
        setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(payload.userId); return n; });
        if (payload.userId === profile?.id) setHandRaised(false);
      })
      .on("broadcast", { event: "chat_message" }, ({ payload }: { payload: WorshipMessage }) => {
        setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
      })
      .on("broadcast", { event: "note" }, ({ payload }: { payload: WorshipNote }) => {
        setNotes((prev) => (prev.some((n) => n.id === payload.id) ? prev : [...prev, payload]));
      })
      // Prayer participation — persisted via presence_status (see the
      // PUT .../presence route comment), broadcast here purely for instant
      // delivery to already-connected clients; a reconnect picks it up
      // from the normal GET regardless.
      .on("broadcast", { event: "presence" }, ({ payload }: { payload: { userId: string; presenceStatus: string } }) => {
        setParticipants((prev) => prev.map((p) => (p.user_id === payload.userId ? { ...p, presence_status: payload.presenceStatus } : p)));
      })
      .on("broadcast", { event: "removed" }, ({ payload }: { payload: { userId: string } }) => {
        if (payload.userId === profile?.id) {
          showAlert("Removed", "The Guide removed you from this Gathering.");
          leave();
        }
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

  // Hand Up — ephemeral, like reactions: nothing is persisted, "complex
  // stage functionality" (an actual speaking-turn system) is explicitly
  // out of scope for this pass. Mirrors app/call/group.tsx's proven
  // hand_raised/hand_acknowledged pattern for the exact same reason it
  // works there: a Guide/host acknowledging is a cooperative signal, not
  // something the sender can force onto another client.
  function toggleRaiseHand() {
    if (!profile?.id) return;
    const next = !handRaised;
    setHandRaised(next);
    if (next) signalRef.current?.send({ type: "broadcast", event: "hand_raised", payload: { userId: profile.id } });
  }
  function allowHand(userId: string) {
    signalRef.current?.send({ type: "broadcast", event: "hand_allowed", payload: { userId } });
    setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(userId); return n; });
  }
  function dismissHand(userId: string) {
    signalRef.current?.send({ type: "broadcast", event: "hand_dismissed", payload: { userId } });
    setRaisedHandUserIds((prev) => { const n = new Set(prev); n.delete(userId); return n; });
  }

  // Together Chat — persisted (POST) so a late joiner/reconnect has real
  // history via GET, broadcast (proven-reliable path, same as reaction/
  // state) for instant delivery to whoever's already connected.
  async function sendChatMessage() {
    if (!session || !chatDraft.trim()) return;
    const content = chatDraft.trim();
    const context = pendingChatContext;
    setChatDraft("");
    setPendingChatContext(null);
    try {
      const message = await sendWorshipMessage(session.id, content, context);
      setMessages((prev) => [...prev, message]);
      signalRef.current?.send({ type: "broadcast", event: "chat_message", payload: message });
    } catch (e: any) {
      showAlert("Couldn't send message", e.message ?? "Please try again.");
    }
  }

  // Moderation — server-enforced (see POST .../remove's comment: RLS on
  // both messages and this signal channel independently requires an
  // active, left_at-null participant row, so this isn't just cosmetic).
  function handleRemoveParticipant(userId: string, name: string) {
    if (!session || !isHost) return;
    Alert.alert(`Remove ${name}?`, "They'll be disconnected from this Gathering.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try {
            await removeWorshipParticipant(session.id, userId);
            signalRef.current?.send({ type: "broadcast", event: "removed", payload: { userId } });
          } catch (e: any) {
            showAlert("Couldn't remove", e.message ?? "Please try again.");
          }
        },
      },
    ]);
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
    if (!session || !canControl) return;
    try {
      const positionMs = Math.max(0, computeWorshipPositionMs(session));
      const updated = await updateWorshipState(session.id, { isPlaying: !session.isPlaying, positionMs });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't update playback", e.message ?? "Please try again."); }
  }

  async function setMedia() {
    if (!session || !canControl || !mediaUrlInput.trim()) return;
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

  // Media Shelf — Guide/trusted/everyone (per canControl) can queue,
  // remove (or anyone can remove their own suggestion — enforced
  // server-side), and reorder; only canControl can Play Next.
  async function handleAddToQueue(mediaId: string, title: string | null, thumbnailUrl: string | null) {
    if (!session) return;
    try {
      const item = await addToWorshipQueue(session.id, { mediaProvider: "youtube", mediaId, title: title ?? undefined, thumbnailUrl: thumbnailUrl ?? undefined });
      setQueue((prev) => [...prev, item]);
    } catch (e: any) { showAlert("Couldn't add to the Media Shelf", e.message ?? "Please try again."); }
  }
  async function handleRemoveFromQueue(itemId: string) {
    if (!session) return;
    try { await removeFromWorshipQueue(session.id, itemId); setQueue((prev) => prev.filter((q) => q.id !== itemId)); }
    catch (e: any) { showAlert("Couldn't remove that item", e.message ?? "Please try again."); }
  }
  async function handleReorderQueue(orderedItemIds: string[]) {
    if (!session) return;
    try { setQueue(await reorderWorshipQueue(session.id, orderedItemIds)); }
    catch (e: any) { showAlert("Couldn't reorder the Media Shelf", e.message ?? "Please try again."); }
  }
  async function handlePlayNext() {
    if (!session) return;
    try {
      const updated = await playNextInWorshipQueue(session.id);
      setSession(updated);
      broadcastState(updated);
      setQueue(await getWorshipQueue(session.id));
    } catch (e: any) { showAlert("Couldn't play the next item", e.message ?? "Please try again."); }
  }
  async function handleChangeMediaPermission(permission: MediaPermission) {
    if (!session) return;
    try { const updated = await updateMediaPermission(session.id, { mediaPermission: permission }); setSession(updated); broadcastState(updated); }
    catch (e: any) { showAlert("Couldn't update Media Permissions", e.message ?? "Please try again."); }
  }
  async function handleChangeAutoAdvance(v: boolean) {
    if (!session) return;
    try { const updated = await updateMediaPermission(session.id, { autoAdvance: v }); setSession(updated); broadcastState(updated); }
    catch (e: any) { showAlert("Couldn't update", e.message ?? "Please try again."); }
  }
  async function handleToggleTrusted(userId: string) {
    if (!session) return;
    const nowTrusted = !session.trustedUserIds.includes(userId);
    try { const updated = await setTrustedParticipant(session.id, userId, nowTrusted); setSession(updated); broadcastState(updated); }
    catch (e: any) { showAlert("Couldn't update", e.message ?? "Please try again."); }
  }

  // Return to Live — an immediate resync rather than waiting for the next
  // periodic drift check; SyncedMediaPlayer/YouTubePlayer both react to
  // resyncNonce changing.
  function handleReturnToLive() {
    setResyncNonce((n) => n + 1);
    setIsBehind(false);
  }

  // Automatic next — deliberately Guide-only (not the full canControl
  // tier) so multiple trusted/everyone Companions whose players all detect
  // "ended" within moments of each other can't race to advance the queue
  // more than once.
  function handleMediaEnded() {
    if (!session || !session.autoAdvance || !isHost || queue.length === 0) return;
    handlePlayNext();
  }

  async function selectScripture(scripture: WorshipSession["currentScripture"]) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { currentMode: "scripture", currentScripture: scripture });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't share that passage", e.message ?? "Please try again."); }
  }

  async function addPrayer(content: string, visibility: "private" | "family", scriptureReference: WorshipScripture | null) {
    if (!session) return;
    try {
      await createFamilyPrayerRequest(session.familyId, content, visibility, scriptureReference);
      setPrayers(await getFamilyPrayerRequests(session.familyId));
    } catch (e: any) { showAlert("Couldn't share this prayer", e.message ?? "Please try again."); }
  }
  async function markPrayed(id: string) {
    if (!session) return;
    try { await updateFamilyPrayerRequestStatus(session.familyId, id, "prayed"); setPrayers(await getFamilyPrayerRequests(session.familyId)); }
    catch (e: any) { showAlert("Couldn't update this prayer", e.message ?? "Please try again."); }
  }
  async function markAnswered(id: string) {
    if (!session) return;
    try { await updateFamilyPrayerRequestStatus(session.familyId, id, "answered"); setPrayers(await getFamilyPrayerRequests(session.familyId)); }
    catch (e: any) { showAlert("Couldn't update this prayer", e.message ?? "Please try again."); }
  }

  // Prayer Focus and the Prayer Timer both ride the session row (Guide-only,
  // same authorization + broadcast pattern as Scripture and mode changes) —
  // no separate realtime channel needed.
  async function setPrayerFocus(requestId: string | null) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { focusPrayerRequestId: requestId });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't focus this request", e.message ?? "Please try again."); }
  }
  async function startPrayerTimer(durationSeconds: number) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { prayerTimerDurationSeconds: durationSeconds });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't start the timer", e.message ?? "Please try again."); }
  }
  async function stopPrayerTimer() {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { prayerTimerDurationSeconds: null });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't stop the timer", e.message ?? "Please try again."); }
  }

  // "I'm praying" — persists to the participant row (reconnect-safe) and
  // broadcasts for instant delivery, same dual-path as chat.
  const myPresenceStatus = participants.find((p) => p.user_id === profile?.id)?.presence_status;
  async function togglePraying() {
    if (!session || !profile?.id) return;
    const next = myPresenceStatus === "praying" ? "joined" : "praying";
    setParticipants((prev) => prev.map((p) => (p.user_id === profile.id ? { ...p, presence_status: next } : p)));
    signalRef.current?.send({ type: "broadcast", event: "presence", payload: { userId: profile.id, presenceStatus: next } });
    try { await updateWorshipPresence(session.id, next); } catch { /* ephemeral UI already updated; next reconnect resyncs from GET */ }
  }

  async function addNote(content: string, visibility: "shared" | "private", scriptureReference: WorshipScripture | null) {
    if (!session) return;
    try {
      const note = await createWorshipNote(session.id, content, visibility, scriptureReference);
      setNotes((prev) => [...prev, note]);
      if (visibility === "shared") signalRef.current?.send({ type: "broadcast", event: "note", payload: note });
    } catch (e: any) { showAlert("Couldn't save this note", e.message ?? "Please try again."); }
  }
  async function deleteNote(noteId: string) {
    if (!session) return;
    try { await deleteWorshipNote(session.id, noteId); setNotes((prev) => prev.filter((n) => n.id !== noteId)); }
    catch (e: any) { showAlert("Couldn't delete this note", e.message ?? "Please try again."); }
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
            <View style={styles.panelLabelRow}>
              <Text style={styles.panelLabel}>SHARED MEDIA</Text>
              <TouchableOpacity onPress={() => setMediaShelfOpen(true)}>
                <Text style={styles.shelfLink}>Media Shelf{queue.length > 0 ? ` (${queue.length})` : ""}</Text>
              </TouchableOpacity>
            </View>
            <View>
              <SyncedMediaPlayer
                session={session}
                mediaVolume={effectiveMediaVolume(togetherAudio.prefs)}
                resyncNonce={resyncNonce}
                onDriftStatus={setIsBehind}
                onEnded={handleMediaEnded}
              />
              {isBehind && (
                <TouchableOpacity style={styles.returnToLiveBadge} onPress={handleReturnToLive}>
                  <Ionicons name="refresh" size={12} color="#fff" />
                  <Text style={styles.returnToLiveText}>Return to Live</Text>
                </TouchableOpacity>
              )}
            </View>
            {canControl && (
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
            <ScripturePanel currentScripture={session.currentScripture} isGuide={isHost} onSelect={selectScripture} />
          </View>
        )}

        {(session.currentMode === "prayer" || session.currentMode === "silent_prayer") && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>{session.currentMode === "silent_prayer" ? "SILENT PRAYER" : "PRAYER SPACE"}</Text>
            {session.currentMode === "silent_prayer" && <Text style={styles.silentHint}>Together, quietly. Microphones are muted.</Text>}
            <PrayerSpacePanel
              session={session}
              prayers={prayers}
              isGuide={isHost}
              myUserId={profile?.id}
              praying={myPresenceStatus === "praying"}
              prayingCount={activeParticipants.filter((p) => p.presence_status === "praying").length}
              onTogglePraying={togglePraying}
              onAdd={addPrayer}
              onMarkPrayed={markPrayed}
              onMarkAnswered={markAnswered}
              onSetFocus={setPrayerFocus}
              onStartTimer={startPrayerTimer}
              onStopTimer={stopPrayerTimer}
            />
          </View>
        )}

        {session.currentMode === "teaching" && (
          <View style={styles.panel}>
            <View style={styles.panelLabelRow}>
              <Text style={styles.panelLabel}>TEACHING</Text>
              <TouchableOpacity onPress={() => setNotesOpen(true)}>
                <Text style={styles.shelfLink}>Notes{notes.length > 0 ? ` (${notes.length})` : ""}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.silentHint}>The Guide can present Scripture, media, and notes. Everyone can ask questions in chat.</Text>
            <ScripturePanel currentScripture={session.currentScripture} isGuide={isHost} onSelect={selectScripture} />
            {(session.mediaId || canControl) && (
              <View>
                <SyncedMediaPlayer
                  session={session}
                  mediaVolume={effectiveMediaVolume(togetherAudio.prefs)}
                  resyncNonce={resyncNonce}
                  onDriftStatus={setIsBehind}
                  onEnded={handleMediaEnded}
                />
                {canControl && (
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
              const voice = voiceSpace.companionStates.find((c) => c.userId === p.user_id);
              const name = m?.name ?? "Someone";
              const handUp = raisedHandUserIds.has(p.user_id);
              const canModerate = isHost && p.user_id !== session.hostId && p.user_id !== profile?.id;
              return (
                <TouchableOpacity
                  key={p.user_id}
                  style={[styles.participantChip, voice?.speaking && styles.participantChipSpeaking]}
                  onLongPress={() => canModerate && handleRemoveParticipant(p.user_id, name)}
                  activeOpacity={canModerate ? 0.7 : 1}
                >
                  <Text style={styles.participantInitial}>{name.charAt(0).toUpperCase()}</Text>
                  <Text style={styles.participantName} numberOfLines={1}>{name}{p.user_id === session.hostId ? " · Guide" : ""}</Text>
                  {p.presence_status === "praying" && <Text style={{ fontSize: 10 }}>🙏</Text>}
                  {voice?.connected && voice.muted && <Ionicons name="mic-off" size={10} color="rgba(255,255,255,0.6)" />}
                  {handUp && (
                    <TouchableOpacity
                      onPress={() => isHost && Alert.alert(`${name} — Hand Up`, "", [
                        { text: "Dismiss", onPress: () => dismissHand(p.user_id) },
                        { text: "Allow", onPress: () => allowHand(p.user_id) },
                      ])}
                      disabled={!isHost}
                    >
                      <Text style={styles.handUpBadge}>✋</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bottomRowScroll}
        contentContainerStyle={[styles.bottomRow, { paddingBottom: insets.bottom + 12 }]}
      >
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
            <Text style={styles.reactionEmoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.transferBtn, handRaised && styles.transferBtnActive]}
          onPress={toggleRaiseHand}
          accessibilityRole="button"
          accessibilityLabel={handRaised ? "Lower hand" : "Raise hand"}
        >
          <Text style={{ fontSize: 16 }}>✋</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.transferBtn}
          onPress={() => setChatOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Together Chat"
        >
          <Ionicons name="chatbubble-outline" size={16} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.transferBtn}
          onPress={() => setNotesOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Notes"
        >
          <Ionicons name="document-text-outline" size={16} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.transferBtn}
          onPress={() => setAudioBalanceOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Audio Balance"
        >
          <Ionicons name="options-outline" size={16} color="#fff" />
        </TouchableOpacity>
        {isHost && (
          <TouchableOpacity style={styles.transferBtn} onPress={() => setTransferOpen(true)}>
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>

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

      <AudioBalancePanel
        visible={audioBalanceOpen}
        onClose={() => setAudioBalanceOpen(false)}
        prefs={togetherAudio.prefs}
        onSetOutput={togetherAudio.setOutputVolume}
        onSetMedia={togetherAudio.setMediaVolume}
        onSetRoom={togetherAudio.setRoomVolume}
        onSetParticipant={togetherAudio.setParticipantVolume}
        onToggleMute={togetherAudio.toggleMuteParticipant}
        companions={voiceSpace.companionStates}
        voicePhase={voiceSpace.phase}
        voiceError={voiceSpace.errorMessage}
        onJoinVoice={voiceSpace.join}
        onRetryVoice={voiceSpace.retry}
        onLeaveVoice={voiceSpace.leave}
        micMuted={voiceSpace.micMuted}
        onToggleMic={voiceSpace.toggleMic}
        listening={voiceSpace.listening}
        onToggleListening={voiceSpace.toggleListening}
      />

      <ChatPanel
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        myUserId={profile?.id}
        draft={chatDraft}
        onChangeDraft={setChatDraft}
        onSend={sendChatMessage}
        currentScripture={session.currentScripture}
        currentMedia={session.mediaProvider && session.mediaId ? { mediaProvider: session.mediaProvider, mediaId: session.mediaId, positionMs: Math.max(0, computeWorshipPositionMs(session)) } : null}
        pendingContext={pendingChatContext}
        onSetPendingContext={setPendingChatContext}
      />

      <MediaShelfPanel
        visible={mediaShelfOpen}
        onClose={() => setMediaShelfOpen(false)}
        queue={queue}
        canControl={canControl}
        isGuide={isHost}
        onAdd={handleAddToQueue}
        onRemove={handleRemoveFromQueue}
        onReorder={handleReorderQueue}
        onPlayNext={handlePlayNext}
        mediaPermission={session.mediaPermission}
        onChangePermission={handleChangeMediaPermission}
        autoAdvance={session.autoAdvance}
        onChangeAutoAdvance={handleChangeAutoAdvance}
        myUserId={profile?.id}
        companions={voiceCompanions}
        trustedUserIds={session.trustedUserIds}
        onToggleTrusted={handleToggleTrusted}
      />

      <NotesPanel
        visible={notesOpen}
        onClose={() => setNotesOpen(false)}
        notes={notes}
        myUserId={profile?.id}
        currentScripture={session.currentScripture}
        onAdd={addNote}
        onDelete={deleteNote}
      />
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
  panelLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shelfLink: { color: "#5B8DEF", fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  returnToLiveBadge: {
    position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.8)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "#5B8DEF",
  },
  returnToLiveText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  scriptureRef: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 6 },
  scriptureText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginTop: 6, fontStyle: "italic" },
  silentHint: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },

  prayerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  prayerText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, marginRight: 8 },
  prayerAction: { color: "#1D9E75", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  companionsLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 8 },
  participantsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  participantChip: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: 150, borderWidth: 1.5, borderColor: "transparent",
  },
  // A subtle border pulse, not an animated ring/wave — original, low-key
  // "Speaking" affordance per this feature's own instruction not to copy
  // another product's speaking animation.
  participantChipSpeaking: { borderColor: "#1D9E75" },
  participantInitial: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  participantName: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Inter_400Regular" },

  reactionsOverlay: { position: "absolute", bottom: 140, alignSelf: "center", alignItems: "center" },
  floatingReaction: { position: "absolute", fontSize: 26 },

  modeRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 10, paddingTop: 6 },
  modeBtn: { alignItems: "center", gap: 2, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  modeBtnActive: { backgroundColor: "rgba(184,134,11,0.25)" },
  modeIcon: { fontSize: 16 },
  modeLabel: { color: "rgba(255,255,255,0.7)", fontSize: 9, fontFamily: "Inter_500Medium" },

  bottomRowScroll: { flexGrow: 0 },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 10, paddingHorizontal: 16, minWidth: "100%" },
  reactionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  reactionEmoji: { fontSize: 18 },
  transferBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  transferBtnActive: { backgroundColor: "#B8860B" },
  handUpBadge: { fontSize: 12, marginLeft: 2 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  sheetTitle: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 8 },
  transferRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  transferName: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  cancelBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});