import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Alert, Platform, Animated, AppState, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase, useAuth } from "@/contexts/AuthContext";
import {
  getFamilyDetail, getWorshipSession, joinWorshipSession, leaveWorshipSession, updateWorshipState, updateWorshipPresence,
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
import { colors, radii, spacing, type, DESKTOP_BREAKPOINT } from "@/lib/togetherTheme";
import TogetherHeader from "@/components/family/TogetherHeader";
import CompanionCard from "@/components/family/CompanionCard";
import SharedMedia from "@/components/family/SharedMedia";
import GuideControls from "@/components/family/GuideControls";
import GatheringFooter from "@/components/family/GatheringFooter";
import AudioBalance from "@/components/family/AudioBalance";
import ChatPanel from "@/components/family/ChatPanel";
import MediaShelf from "@/components/family/MediaShelf";
import ScripturePanel from "@/components/family/ScripturePanel";
import PrayerSpacePanel from "@/components/family/PrayerSpacePanel";
import NotesPanel from "@/components/family/NotesPanel";
import LessonPicker from "@/components/family/LessonPicker";
import { useVoiceSpace } from "@/hooks/useVoiceSpace";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Labels are the only thing standardized here — the WorshipMode key
// values ("sharing", "silent_prayer", "teaching", ...) are the internal
// identifiers used by the API/DB and are unchanged; only what's shown to
// the user is renamed to the canonical product vocabulary.
const MODES: { key: WorshipMode; label: string; icon: string }[] = [
  { key: "worship", label: "Media", icon: "📺" },
  { key: "scripture", label: "Bible", icon: "📖" },
  { key: "prayer", label: "Prayer", icon: "🙏" },
  { key: "sharing", label: "Share", icon: "🎤" },
  { key: "silent_prayer", label: "Mute", icon: "🔕" },
  { key: "teaching", label: "Study Workspace", icon: "📚" },
];
const REACTIONS = ["🙏", "❤️", "🔥", "👏", "✝️"];
const MODE_BY_KEY = new Map(MODES.map((m) => [m.key, m]));

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
  const { width } = useWindowDimensions();
  // Below the breakpoint: mobile composition (large content area, simple
  // stacked bottom controls). At/above it: desktop composition
  // (content-focused center + a companion gathering area side by side,
  // Together Chat docks to the right instead of sliding from the bottom).
  const isDesktop = width >= DESKTOP_BREAKPOINT;

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
  const [lessonPickerOpen, setLessonPickerOpen] = useState(false);
  const [attachedLesson, setAttachedLesson] = useState<{ id: string; title: string } | null>(null);
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
      // Session first — its own familyId is the source of truth for which
      // family's roster/prayer list to load next. A user can be in worship
      // sessions belonging to different families, so this can never assume
      // "my one family"; it must ask for the SPECIFIC family this session
      // belongs to.
      const s = await getWorshipSession(params.sessionId);
      setSession(s);
      setParticipants(s.participants ?? []);

      const family = await getFamilyDetail(s.familyId);
      setMembers(family.members);
      setShepherdId(family.family?.shepherdId ?? null);
      const p = await getFamilyPrayerRequests(s.familyId);
      setPrayers(p);

      // Chat history — a late joiner or reconnecting client catches up here;
      // new messages after that arrive live over the signal broadcast below.
      getWorshipMessages(params.sessionId).then(setMessages).catch(() => {});
      getWorshipQueue(params.sessionId).then(setQueue).catch(() => {});
      getWorshipNotes(params.sessionId).then(setNotes).catch(() => {});
    } catch (e: any) {
      showAlert("Couldn't load the Gathering", e.message ?? "Please try again.");
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
          showAlert("Gathering ended", "This session has ended.");
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
          showAlert("Gathering ended", "This session has ended.");
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
    } catch (e: any) { showAlert("Couldn't add to the Queue", e.message ?? "Please try again."); }
  }
  async function handleRemoveFromQueue(itemId: string) {
    if (!session) return;
    try { await removeFromWorshipQueue(session.id, itemId); setQueue((prev) => prev.filter((q) => q.id !== itemId)); }
    catch (e: any) { showAlert("Couldn't remove that item", e.message ?? "Please try again."); }
  }
  async function handleReorderQueue(orderedItemIds: string[]) {
    if (!session) return;
    try { setQueue(await reorderWorshipQueue(session.id, orderedItemIds)); }
    catch (e: any) { showAlert("Couldn't reorder the Queue", e.message ?? "Please try again."); }
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

  // Attaches an existing curriculum lesson to this Gathering — never writes
  // p2p_lesson_progress or implies completion, purely a "this Gathering is
  // about this lesson" link the Session Summary and next-Gathering
  // continuity screens read back later (see migrations/129).
  async function selectLesson(lessonId: string, lessonTitle: string) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { lessonId });
      setSession(updated);
      setAttachedLesson({ id: lessonId, title: lessonTitle });
      setLessonPickerOpen(false);
    } catch (e: any) { showAlert("Couldn't attach that lesson", e.message ?? "Please try again."); }
  }

  // Resolves a display title for a lesson attached by someone else (or
  // still set from before this client last reloaded) — a single cheap
  // lookup, only when the id we're showing is stale, never repeated per-tick.
  useEffect(() => {
    if (!session?.lessonId) { setAttachedLesson(null); return; }
    if (attachedLesson?.id === session.lessonId) return;
    let cancelled = false;
    supabase.from("p2p_lessons").select("id,title").eq("id", session.lessonId).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setAttachedLesson({ id: data.id as string, title: data.title as string });
    });
    return () => { cancelled = true; };
  }, [session?.lessonId, attachedLesson?.id]);

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

  // Prayer Focus rides the session row (Guide-only, same authorization +
  // broadcast pattern as Scripture and mode changes) — no separate
  // realtime channel needed.
  async function setPrayerFocus(requestId: string | null) {
    if (!session || !isHost) return;
    try {
      const updated = await updateWorshipState(session.id, { focusPrayerRequestId: requestId });
      setSession(updated);
      broadcastState(updated);
    } catch (e: any) { showAlert("Couldn't focus this request", e.message ?? "Please try again."); }
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
    Alert.alert("End Gathering?", "This will end the session for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "End", style: "destructive", onPress: async () => {
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
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  const memberById = new Map(members.map((m) => [m.userId, m]));
  const activeParticipants = participants.filter((p) => p.presence_status !== "away");
  const currentModeMeta = MODE_BY_KEY.get(session.currentMode) ?? MODES[0];

  const sharedMediaProps = {
    session, mediaVolume: effectiveMediaVolume(togetherAudio.prefs), resyncNonce, onDriftStatus: setIsBehind, onEnded: handleMediaEnded,
    isBehind, onReturnToLive: handleReturnToLive, canControl, urlInput: mediaUrlInput, onChangeUrlInput: setMediaUrlInput,
    onSetMedia: setMedia, onTogglePlay: togglePlay,
  };

  const modeContent = (
    <>
      {session.currentMode === "worship" && (
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <Text style={styles.panelLabel}>MEDIA</Text>
            <TouchableOpacity onPress={() => setMediaShelfOpen(true)} accessibilityRole="button" accessibilityLabel={`Open Queue${queue.length > 0 ? `, ${queue.length} items` : ""}`}>
              <Text style={styles.shelfLink}>Queue{queue.length > 0 ? ` (${queue.length})` : ""}</Text>
            </TouchableOpacity>
          </View>
          <SharedMedia {...sharedMediaProps} />
        </View>
      )}

      {session.currentMode === "scripture" && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>BIBLE</Text>
          <ScripturePanel currentScripture={session.currentScripture} isGuide={isHost} onSelect={selectScripture} />
        </View>
      )}

      {(session.currentMode === "prayer" || session.currentMode === "silent_prayer") && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>{session.currentMode === "silent_prayer" ? "MUTE" : "PRAYER"}</Text>
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
          />
        </View>
      )}

      {session.currentMode === "teaching" && (
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <Text style={styles.panelLabel}>STUDY WORKSPACE</Text>
            <TouchableOpacity onPress={() => setNotesOpen(true)} accessibilityRole="button" accessibilityLabel={`Open Notes${notes.length > 0 ? `, ${notes.length} notes` : ""}`}>
              <Text style={styles.shelfLink}>Notes{notes.length > 0 ? ` (${notes.length})` : ""}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.silentHint}>The Guide can present Scripture, media, and notes. Everyone can ask questions in chat.</Text>
          <View style={styles.lessonRow}>
            <Text style={styles.lessonRowLabel}>Lesson: {attachedLesson?.title ?? "None selected"}</Text>
            {isHost && (
              <TouchableOpacity onPress={() => setLessonPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Choose Lesson">
                <Text style={styles.shelfLink}>Choose Lesson</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScripturePanel currentScripture={session.currentScripture} isGuide={isHost} onSelect={selectScripture} />
          {(session.mediaId || canControl) && <SharedMedia {...sharedMediaProps} />}
        </View>
      )}

      {session.currentMode === "sharing" && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>SHARE</Text>
          <Text style={styles.silentHint}>Take turns sharing with the family.</Text>
        </View>
      )}
    </>
  );

  const companionsArea = (
    <View>
      <Text style={styles.companionsLabel}>PARTICIPANTS</Text>
      <View style={styles.companionsGrid}>
        {activeParticipants.map((p) => {
          const m = memberById.get(p.user_id);
          const voice = voiceSpace.companionStates.find((c) => c.userId === p.user_id);
          const name = m?.name ?? "Someone";
          const handUp = raisedHandUserIds.has(p.user_id);
          const canModerate = isHost && p.user_id !== session.hostId && p.user_id !== profile?.id;
          return (
            <CompanionCard
              key={p.user_id}
              name={name}
              isGuide={p.user_id === session.hostId}
              speaking={!!voice?.speaking}
              muted={!!(voice?.connected && voice.muted)}
              praying={p.presence_status === "praying"}
              handUp={handUp}
              canModerate={canModerate}
              onLongPress={() => canModerate && handleRemoveParticipant(p.user_id, name)}
              onHandUpPress={isHost ? () => Alert.alert(`${name} — Raise Hand`, "", [
                { text: "Dismiss", onPress: () => dismissHand(p.user_id) },
                { text: "Allow", onPress: () => allowHand(p.user_id) },
              ]) : undefined}
            />
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={{ paddingTop: insets.top + 10 }}>
        <TogetherHeader
          onBack={leave}
          title="Study Workspace"
          modeIcon={currentModeMeta.icon}
          modeLabel={currentModeMeta.label}
          participantCount={activeParticipants.length}
          showEnd={isHost || isShepherd}
          onEnd={handleEnd}
        />
      </View>

      {isDesktop ? (
        <View style={styles.desktopRow}>
          <ScrollView style={styles.desktopContentPane} contentContainerStyle={styles.scroll}>{modeContent}</ScrollView>
          <ScrollView style={styles.desktopCompanionsPane} contentContainerStyle={styles.desktopCompanionsPaneContent}>{companionsArea}</ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {modeContent}
          {companionsArea}
        </ScrollView>
      )}

      <View style={styles.reactionsOverlay} pointerEvents="none">
        {reactions.map((r) => <FloatingReaction key={r.id} emoji={r.emoji} />)}
      </View>

      {isHost && <GuideControls modes={MODES} currentMode={session.currentMode} onChange={changeMode} />}

      <GatheringFooter
        reactionEmojis={REACTIONS}
        onSendReaction={sendReaction}
        handRaised={handRaised}
        onToggleRaiseHand={toggleRaiseHand}
        onOpenChat={() => setChatOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
        onOpenAudioBalance={() => setAudioBalanceOpen(true)}
        isHost={isHost}
        onOpenTransfer={() => setTransferOpen(true)}
        bottomInset={insets.bottom}
      />

      <Modal visible={transferOpen} transparent animationType="fade" onRequestClose={() => setTransferOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetBox}>
            <Text style={styles.sheetTitle}>Transfer Guide</Text>
            {activeParticipants.filter((p) => p.user_id !== session.hostId).map((p) => {
              const m = memberById.get(p.user_id);
              return (
                <TouchableOpacity key={p.user_id} style={styles.transferRow} onPress={() => handleTransfer(p.user_id)} accessibilityRole="button" accessibilityLabel={`Make ${m?.name ?? "Someone"} the Guide`}>
                  <Text style={styles.transferName}>{m?.name ?? "Someone"}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setTransferOpen(false)} accessibilityRole="button" accessibilityLabel="Cancel transferring Guide">
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AudioBalance
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
        dockRight={isDesktop}
      />

      <MediaShelf
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

      <LessonPicker
        visible={lessonPickerOpen}
        onClose={() => setLessonPickerOpen(false)}
        onSelect={selectLesson}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 20, gap: spacing.lg },

  panel: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.xs },
  panelLabel: { color: colors.light, ...type.label },
  panelLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shelfLink: { color: colors.connection, ...type.caption, fontFamily: "Inter_600SemiBold" },
  silentHint: { color: colors.textSecondary, ...type.body, marginTop: spacing.xs },
  lessonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  lessonRowLabel: { color: colors.textSecondary, ...type.caption, flex: 1, marginRight: spacing.sm },

  companionsLabel: { color: colors.textTertiary, ...type.label, marginBottom: spacing.sm },
  companionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  // Desktop composition — content-focused center + a companion gathering
  // area beside it, each independently scrollable. An original split, not
  // a copy of any call/chat app's sidebar-plus-stage layout.
  desktopRow: { flex: 1, flexDirection: "row" },
  desktopContentPane: { flex: 2 },
  desktopCompanionsPane: { flex: 1, maxWidth: 320, borderLeftWidth: 1, borderLeftColor: colors.borderFaint },
  desktopCompanionsPaneContent: { padding: spacing.lg },

  reactionsOverlay: { position: "absolute", bottom: 140, alignSelf: "center", alignItems: "center" },
  floatingReaction: { position: "absolute", fontSize: 26 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: colors.sheet, borderTopLeftRadius: radii.xl + 4, borderTopRightRadius: radii.xl + 4, padding: spacing.xl, gap: spacing.xs },
  sheetTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: spacing.sm },
  transferRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderFaint, minHeight: 44, justifyContent: "center" },
  transferName: { color: colors.textPrimary, ...type.body },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs, minHeight: 44, justifyContent: "center" },
  cancelBtnText: { color: colors.textSecondary, ...type.bodyEmph },
});
