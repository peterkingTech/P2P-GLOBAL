import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Share,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import type { OfficialAccountType } from "@/contexts/AuthContext";
import { VerificationBadge } from "@/components/VerificationBadge";
import { OfficialBadge } from "@/components/OfficialBadge";
import AudioRecorder from "@/components/AudioRecorder";
import { VoiceMessageBubble } from "@/components/VoiceMessageBubble";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string | null;
  created_at: string;
  senderName?: string;
  message_type?: string;
  is_pinned?: boolean;
  pinned_label?: string | null;
  is_official_response?: boolean;
  crisis_context?: string | null;
  media_url?: string | null;
  media_duration_seconds?: number | null;
  call_log_id?: string | null;
}

// Call History / Call Information — the fields a call_summary message's
// card needs, joined from p2p_call_logs (already has everything: no new
// columns on p2p_messages). RLS on p2p_call_logs ("Users see own call
// logs") already restricts this to a real participant.
interface CallLogInfo {
  call_type: string;
  duration_seconds: number | null;
  status: string;
  participants: string[];
}

function formatCallDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.round(totalSeconds / 60)} min`;
}

// Mirrors call/history.tsx's existing "today = time, else short date"
// convention rather than inventing a new one.
function formatCallTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type CrisisThreadType = "watchtower" | "help_request" | "pastoral_checkin" | "support";

const CRISIS_BANNER_CONFIG: Record<CrisisThreadType, { icon: string; label: string; color: string; description: string }> = {
  watchtower: { icon: "🛡️", label: "CRISIS RESPONSE", color: "#C0392B", description: "Response to your Watchtower alert" },
  help_request: { icon: "🆘", label: "HELP REQUEST RESPONSE", color: "#B8860B", description: "Response to your help request" },
  pastoral_checkin: { icon: "🙏", label: "PASTORAL CHECK-IN", color: "#1D4E2B", description: "A support team member is following up" },
  support: { icon: "ℹ️", label: "SUPPORT MESSAGE", color: "#1D9E75", description: "Official message from P2P Global Support" },
};

function CrisisThreadBanner({ crisisType, submittedAt }: { crisisType: CrisisThreadType; submittedAt: string | null }) {
  const config = CRISIS_BANNER_CONFIG[crisisType];
  return (
    <View style={[bannerStyles.banner, { backgroundColor: `${config.color}20`, borderLeftColor: config.color }]}>
      <Text style={[bannerStyles.label, { color: config.color }]}>{config.icon} {config.label}</Text>
      <Text style={bannerStyles.description}>{config.description}</Text>
      {submittedAt && (
        <Text style={bannerStyles.submitted}>Submitted: {new Date(submittedAt).toLocaleDateString()}</Text>
      )}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  banner: { borderLeftWidth: 4, padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 8 },
  label: { fontWeight: "700", fontSize: 12, fontFamily: "Inter_700Bold" },
  description: { color: colors.textDark, fontSize: 13, marginTop: 2, fontFamily: "Inter_400Regular" },
  submitted: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontFamily: "Inter_400Regular" },
});

const MENTION_PATTERN = /@[a-zA-Z][a-zA-Z0-9._]{2,19}/g;

// Splits a message body on @username mentions and renders each as a
// tappable link to that user's public profile — doesn't verify the
// username actually exists (would mean an extra lookup per rendered
// message), so a mistyped/invalid mention just 404s harmlessly on tap,
// same as any other broken deep link.
function MentionText({ body, style, linkStyle }: { body: string; style: any; linkStyle: any }) {
  const router = useRouter();
  const parts = body.split(MENTION_PATTERN);
  const mentions = body.match(MENTION_PATTERN) ?? [];
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) nodes.push(<Text key={`t${i}`}>{part}</Text>);
    if (mentions[i]) {
      const username = mentions[i].slice(1);
      nodes.push(
        <Text key={`m${i}`} style={linkStyle} onPress={() => router.push(`/profile/${username}` as any)}>
          {mentions[i]}
        </Text>
      );
    }
  });
  return <Text style={style}>{nodes}</Text>;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { supabase, user } = useAuth();
  const { reportContent, pinMessage, unpinMessage, setActiveConversationId } = useData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [title, setTitle] = useState("Conversation");
  const [isDirect, setIsDirect] = useState(false);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherUserVerified, setOtherUserVerified] = useState(false);
  const [otherUserOfficialType, setOtherUserOfficialType] = useState<OfficialAccountType | null>(null);
  const [crisisType, setCrisisType] = useState<CrisisThreadType | null>(null);
  const [crisisSubmittedAt, setCrisisSubmittedAt] = useState<string | null>(null);
  const [helpRequestId, setHelpRequestId] = useState<string | null>(null);
  const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false);
  const [callingType, setCallingType] = useState<"audio" | "video" | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [text, setText] = useState("");
  const [mentionResults, setMentionResults] = useState<{ username: string; fullName: string | null }[]>([]);
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [startersVisible, setStartersVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const [callLogsById, setCallLogsById] = useState<Record<string, CallLogInfo>>({});

  const fetchCallLogs = useCallback(async (callLogIds: string[]) => {
    const missing = callLogIds.filter((cid) => !!cid);
    if (!missing.length) return;
    const { data, error } = await supabase
      .from("p2p_call_logs")
      .select("id, call_type, duration_seconds, status, participants")
      .in("id", missing);
    if (error || !data) return;
    setCallLogsById((prev) => {
      const next = { ...prev };
      for (const row of data as any[]) {
        next[row.id] = {
          call_type: row.call_type, duration_seconds: row.duration_seconds,
          status: row.status, participants: (row.participants as string[]) ?? [],
        };
      }
      return next;
    });
  }, [supabase]);

  const load = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const { data: conv } = await supabase
      .from("p2p_conversations")
      .select("id, type, name, crisis_type, crisis_submitted_at, help_request_id, feedback_requested, feedback_submitted")
      .eq("id", id)
      .maybeSingle();
    setCrisisType((conv?.crisis_type as CrisisThreadType | null) ?? null);
    setCrisisSubmittedAt((conv?.crisis_submitted_at as string | null) ?? null);
    setHelpRequestId((conv?.help_request_id as string | null) ?? null);
    setShowFeedbackPrompt(!!conv?.feedback_requested && !conv?.feedback_submitted);
    if (conv?.type === "direct") {
      setIsDirect(true);
      const { data: members } = await supabase
        .from("p2p_conversation_members")
        .select("user_id, p2p_profiles(full_name, is_verified, official_account_type)")
        .eq("conversation_id", id)
        .neq("user_id", user.id)
        .maybeSingle();
      setOtherUserId((members as any)?.user_id ?? null);
      setTitle((members as any)?.p2p_profiles?.full_name ?? "Direct message");
      setOtherUserVerified((members as any)?.p2p_profiles?.is_verified ?? false);
      setOtherUserOfficialType((members as any)?.p2p_profiles?.official_account_type ?? null);
    } else {
      setIsDirect(false);
      setTitle(conv?.name ?? "Group chat");
      setOtherUserOfficialType(null);
    }

    const [{ data: msgs, error: msgsErr }, { data: pinned, error: pinnedErr }] = await Promise.all([
      supabase
        .from("p2p_messages")
        // p2p_messages now has two FKs into p2p_profiles (sender_id and
        // pinned_by, migration 068) — the bare `p2p_profiles(...)` embed
        // syntax is ambiguous once there's more than one, and PostgREST
        // errors instead of guessing, which was silently emptying this
        // entire query (data came back null, and the result was never
        // checked for .error). Disambiguating by FK constraint name is the
        // same pattern already used elsewhere in this codebase, e.g.
        // DataContext's getModerationQueue.
        .select("id, conversation_id, sender_id, body, created_at, message_type, is_pinned, pinned_label, is_official_response, crisis_context, media_url, media_duration_seconds, call_log_id, p2p_profiles!p2p_messages_sender_id_fkey(full_name)")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("p2p_messages")
        .select("id, conversation_id, sender_id, body, created_at, pinned_label, p2p_profiles!p2p_messages_sender_id_fkey(full_name)")
        .eq("conversation_id", id)
        .eq("is_pinned", true)
        .order("pinned_at", { ascending: false }),
    ]);
    const mapMsg = (m: any): Message => ({
      id: m.id,
      conversation_id: m.conversation_id,
      sender_id: m.sender_id,
      body: m.body,
      message_type: m.message_type,
      created_at: m.created_at,
      senderName: m.p2p_profiles?.full_name,
      is_pinned: m.is_pinned,
      pinned_label: m.pinned_label,
      is_official_response: m.is_official_response,
      crisis_context: m.crisis_context,
      media_url: m.media_url,
      media_duration_seconds: m.media_duration_seconds,
      call_log_id: m.call_log_id,
    });
    if (msgsErr) console.error("Failed to load messages", msgsErr);
    if (pinnedErr) console.error("Failed to load pinned messages", pinnedErr);
    const mappedMsgs = (msgs ?? []).map(mapMsg);
    setMessages(mappedMsgs);
    setPinnedMessages((pinned ?? []).map(mapMsg));
    setLoading(false);
    void fetchCallLogs(mappedMsgs.filter((m) => m.message_type === "call_summary" && m.call_log_id).map((m) => m.call_log_id as string));

    await supabase
      .from("p2p_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", user.id);
  }, [id, supabase, user, fetchCallLogs]);

  useEffect(() => {
    load();
  }, [load]);

  // Suppresses the global MessageBanner for whichever conversation is
  // currently open (see setActiveConversationId in DataContext).
  useEffect(() => {
    if (!id) return;
    setActiveConversationId(id);
    return () => setActiveConversationId(null);
  }, [id, setActiveConversationId]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`p2p_messages_${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_messages", filter: `conversation_id=eq.${id}` },
        (payload) => {
          const m = payload.new as any;
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
          if (m.message_type === "call_summary" && m.call_log_id) void fetchCallLogs([m.call_log_id]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, supabase, fetchCallLogs]);

  async function initiateCall(callType: "audio" | "video") {
    if (!user || !otherUserId || !id || callingType) return;
    setCallingType(callType);
    try {
      const apiUrl = getApiUrl();
      const channelRes = await fetch(`${apiUrl}/calls/peer-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUserId: user.id, otherUserId }),
      });
      const channelData = await channelRes.json();
      if (!channelRes.ok) throw new Error(channelData.error || "Failed to start call");
      const channelName = channelData.channelName as string;

      // Call-log/incoming-call creation goes through the server — neither
      // table has an INSERT policy for the anon key (see calls.ts), by
      // design: who's allowed to start a call and log it server-side, not
      // client-spoofable.
      const startRes = await authedFetch("/calls/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, callType, recipientId: otherUserId, conversationId: id }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Failed to start call");

      router.push({
        pathname: callType === "video" ? "/call/video" : "/call/audio",
        params: {
          channelName,
          otherUserId,
          otherUserName: title,
          callType,
          isInitiator: "true",
          callId: startData.incomingCallId,
          conversationId: id,
          callLogId: startData.callLogId,
        },
      } as any);
    } catch (e: any) {
      Alert.alert("Couldn't start call", e.message ?? "Please try again.");
    } finally {
      setCallingType(null);
    }
  }

  function handleLongPressMessage(item: Message) {
    if (item.message_type === "call_summary" || !item.sender_id) return;
    const senderId = item.sender_id;
    const mine = senderId === user?.id;
    const canPin = isDirect || true; // either DM party, or a group/circle leader — enforced server-side by p2p_can_pin_message

    const options: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[] = [];

    if (item.is_pinned) {
      options.push({
        text: "Unpin Message",
        onPress: async () => {
          const err = await unpinMessage(item.id);
          if (err) Alert.alert("Couldn't unpin message", err);
          else load();
        },
      });
    } else if (canPin) {
      options.push({
        text: "📌 Pin Message",
        onPress: () => promptPinLabel(item.id),
      });
    }

    options.push({
      text: "↗️ Share",
      onPress: () => { Share.share({ message: item.body ?? "" }); },
    });

    if (!mine) {
      options.push({
        text: "Report message",
        onPress: async () => {
          const err = await reportContent("message", item.id, "Reported from conversation");
          Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
        },
      });
      options.push({
        text: "Report profile",
        style: "destructive",
        onPress: async () => {
          const err = await reportContent("profile", senderId, "Reported from conversation");
          Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
        },
      });
    }

    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(item.senderName || "Message options", undefined, options);
  }

  function promptPinLabel(messageId: string) {
    const labels = ["No label", "Important", "Follow up", "Scripture reference", "Action item"];
    Alert.alert(
      "Pin this message",
      "Add a label (optional)",
      [
        ...labels.map((label) => ({
          text: label,
          onPress: async () => {
            const err = await pinMessage(messageId, label === "No label" ? undefined : label);
            if (err) Alert.alert("Couldn't pin message", err);
            else load();
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  const STARTERS = [
    "👋 How are you doing?",
    "🙏 Praying for you!",
    "📖 What are you studying in the Word?",
    "✝️ Share a verse with me",
  ];

  // @mention autocomplete — only looks at a mention right at the end of the
  // current text (not wherever the cursor happens to be), since plain
  // RN TextInput doesn't expose cursor position without onSelectionChange
  // wiring; that covers the common "type @name while composing" case.
  function handleTextChange(v: string) {
    setText(v);
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    const match = /@([a-zA-Z0-9._]*)$/.exec(v);
    if (!match || match[1].length < 2) { setMentionResults([]); return; }
    const partial = match[1];
    mentionDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${getApiUrl()}/profiles/search?q=${encodeURIComponent(partial)}`);
        const data = await res.json();
        setMentionResults(Array.isArray(data) ? data.slice(0, 5).map((r: any) => ({ username: r.username, fullName: r.fullName })) : []);
      } catch {
        setMentionResults([]);
      }
    }, 250);
  }

  function selectMention(username: string) {
    setText((prev) => prev.replace(/@([a-zA-Z0-9._]*)$/, `@${username} `));
    setMentionResults([]);
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || !id || !user) return;
    setStartersVisible(false);
    setSending(true);
    setText("");
    setMentionResults([]);
    const { data, error } = await supabase
      .from("p2p_messages")
      .insert({ conversation_id: id, sender_id: user.id, body })
      .select("id, flagged_self_harm")
      .single();
    setSending(false);
    if (error) {
      setText(body);
      Alert.alert("Message not sent", error.message);
      return;
    }
    if (data?.flagged_self_harm) {
      Alert.alert("Help is on the way", "A crisis responder from our team has been notified and will reach out to you directly.");
    }
  }

  // Mirrors DataContext's uploadSubmissionMedia (same fetch→arrayBuffer→
  // storage.upload shape) but against the public 'voice-messages' bucket
  // (migration 070) instead of the signed-URL 'submissions' bucket, since a
  // voice note needs to render inline as soon as the message list refreshes
  // rather than requiring a signed-URL round trip per bubble.
  async function handleSendVoice(localUri: string, durationSeconds: number) {
    if (!id || !user) return;
    try {
      // On web, localUri is a blob: URL with no dot-extension at all, so a
      // plain split(".").pop() returns the ENTIRE URL (including "/" and ":"
      // characters) as "ext" — safe here against a wrong Content-Type (fixed
      // below) but it would still pollute the storage path with extra
      // segments. Validate before trusting it, same guard as mediaUpload.ts.
      const rawExt = localUri.split(".").pop()?.toLowerCase();
      const ext = rawExt && /^[a-z0-9]{2,5}$/.test(rawExt) ? rawExt : "m4a";
      const path = `${user.id}/${id}/${Date.now()}.${ext}`;
      const response = await fetch(localUri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("voice-messages")
        .upload(path, arrayBuffer, { contentType: "audio/m4a", upsert: false });
      if (uploadError) {
        Alert.alert("Voice message not sent", uploadError.message);
        setShowRecorder(false);
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from("voice-messages").getPublicUrl(path);

      const { data, error } = await supabase
        .from("p2p_messages")
        .insert({
          conversation_id: id, sender_id: user.id, message_type: "voice",
          media_url: publicUrl, media_duration_seconds: durationSeconds,
        })
        .select("id, flagged_self_harm")
        .single();
      setShowRecorder(false);
      if (error) {
        Alert.alert("Voice message not sent", error.message);
        return;
      }
      if (data?.flagged_self_harm) {
        Alert.alert("Help is on the way", "A crisis responder from our team has been notified and will reach out to you directly.");
      }
    } catch (e: any) {
      Alert.alert("Voice message not sent", e?.message ?? "Please try again.");
      setShowRecorder(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
    >
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textDark} />
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            {isDirect && <VerificationBadge isVerified={otherUserVerified} username={title} size="small" />}
            {isDirect && otherUserOfficialType && <OfficialBadge accountType={otherUserOfficialType} size="small" />}
          </View>
          {isDirect && otherUserId && !otherUserOfficialType && (
            <View style={styles.headerCallBtns}>
              <TouchableOpacity onPress={() => initiateCall("audio")} disabled={!!callingType} style={styles.headerIconBtn}>
                {callingType === "audio" ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="call-outline" size={20} color={colors.accentGreen} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => initiateCall("video")} disabled={!!callingType} style={styles.headerIconBtn}>
                {callingType === "video" ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="videocam-outline" size={22} color={colors.accentGreen} />}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {crisisType && <CrisisThreadBanner crisisType={crisisType} submittedAt={crisisSubmittedAt} />}

        {showFeedbackPrompt && (
          <TouchableOpacity
            style={styles.feedbackPrompt}
            onPress={() => {
              setShowFeedbackPrompt(false);
              router.push({
                pathname: "/feedback/admin-interaction",
                params: { conversationId: id, helpRequestId: helpRequestId ?? "", adminUserId: otherUserId ?? "" },
              } as any);
            }}
          >
            <Text style={styles.feedbackPromptText}>How was your support experience? Tap to share feedback.</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accentGreen} />
          </TouchableOpacity>
        )}

        {pinnedMessages.length > 0 && (
          <View style={styles.pinnedBar}>
            <TouchableOpacity style={styles.pinnedBarHeader} onPress={() => setPinnedExpanded((v) => !v)}>
              <Text style={styles.pinnedBarTitle}>
                📌 {pinnedMessages.length} pinned message{pinnedMessages.length === 1 ? "" : "s"}
              </Text>
              <Ionicons name={pinnedExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
            </TouchableOpacity>
            {pinnedExpanded && pinnedMessages.map((pm) => (
              <TouchableOpacity
                key={pm.id}
                style={styles.pinnedItem}
                onPress={() => {
                  const idx = messages.findIndex((m) => m.id === pm.id);
                  if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
                }}
              >
                <Text style={styles.pinnedItemMeta}>{pm.senderName ?? "Someone"} · {new Date(pm.created_at).toLocaleDateString()}</Text>
                <Text style={styles.pinnedItemBody} numberOfLines={2}>{pm.body}</Text>
                {pm.pinned_label && <Text style={styles.pinnedItemLabel}>{pm.pinned_label}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.accentGreen} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => {
              if (item.message_type === "call_summary") {
                // sender_id is the real call initiator (calls.ts /calls/end)
                // — reusing the exact same direction rule as an ordinary
                // message, per spec, rather than a centered system notice.
                const callMine = item.sender_id === user?.id;
                const callLog = item.call_log_id ? callLogsById[item.call_log_id] : undefined;
                const isVideo = callLog?.call_type === "video";
                const isGroup = (callLog?.participants?.length ?? 0) > 2;
                const iconName = isGroup ? "people" : isVideo ? "videocam" : "call";
                const callTitle = isGroup ? "Group call" : isVideo ? "Video call" : "Voice call";
                let statusText = "Call";
                if (callLog) {
                  if (callLog.status === "ended") {
                    statusText = callLog.duration_seconds ? formatCallDuration(callLog.duration_seconds) : "Ended";
                  } else if (callLog.status === "declined") statusText = "Declined";
                  else if (callLog.status === "cancelled") statusText = "Cancelled";
                  else statusText = "No answer";
                }
                return (
                  <View style={[styles.bubbleRow, callMine && styles.bubbleRowMine]}>
                    <View style={[styles.callCard, callMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Ionicons name={iconName as any} size={18} color={callMine ? "#fff" : colors.accentGreen} />
                      <View style={styles.callCardBody}>
                        <Text style={[styles.callCardTitle, callMine && styles.bubbleTextMine]}>{callTitle}</Text>
                        <View style={styles.callCardStatusRow}>
                          <Text style={[styles.callCardStatus, callMine && styles.callCardStatusMine]} numberOfLines={1}>
                            {callLog ? statusText : item.body}
                          </Text>
                          <Text style={[styles.callCardTime, callMine && styles.callCardStatusMine]}>
                            {formatCallTimestamp(item.created_at)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              }
              const mine = item.sender_id === user?.id;
              return (
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View style={styles.bubbleStack}>
                    {item.is_official_response && (
                      <View style={styles.officialResponseRow}>
                        {otherUserOfficialType && <OfficialBadge accountType={otherUserOfficialType} size="small" />}
                        <Text style={styles.officialResponseLabel} numberOfLines={1}>
                          {item.crisis_context ?? "Official Response"}
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onLongPress={() => handleLongPressMessage(item)}
                      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                    >
                      {!mine && item.senderName ? <Text style={styles.senderName}>{item.senderName}</Text> : null}
                      {item.message_type === "voice" && item.media_url ? (
                        <VoiceMessageBubble
                          mediaUrl={item.media_url}
                          durationSeconds={item.media_duration_seconds ?? null}
                          mine={mine}
                        />
                      ) : (
                        <MentionText
                          body={item.body ?? ""}
                          style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                          linkStyle={styles.mentionLink}
                        />
                      )}
                      {item.is_pinned && <Ionicons name="pin" size={11} color={mine ? "rgba(255,255,255,0.8)" : colors.textMuted} style={styles.pinIcon} />}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )}

        {!loading && messages.length === 0 && startersVisible && (
          <View style={styles.startersRow}>
            {STARTERS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={styles.starterChip}
                onPress={() => { setText(chip); setStartersVisible(false); }}
                activeOpacity={0.75}
              >
                <Text style={styles.starterChipText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {mentionResults.length > 0 && (
          <View style={styles.mentionDropdown}>
            {mentionResults.map((r) => (
              <TouchableOpacity
                key={r.username}
                style={styles.mentionRow}
                onPress={() => selectMention(r.username)}
              >
                <Text style={styles.mentionRowUsername}>@{r.username}</Text>
                {r.fullName ? <Text style={styles.mentionRowName}>{r.fullName}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showRecorder ? (
          <View style={[styles.recorderRow, { paddingBottom: insets.bottom + 10 }]}>
            <View style={{ flex: 1 }}>
              <AudioRecorder onSubmit={handleSendVoice} />
            </View>
            <TouchableOpacity style={styles.cancelRecorderBtn} onPress={() => setShowRecorder(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={handleTextChange}
              placeholder="Message..."
              placeholderTextColor={colors.textMuted}
              multiline
            />
            {text.trim() ? (
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending}>
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={() => setShowRecorder(true)}>
                <Ionicons name="mic" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerCallBtns: { flexDirection: "row", gap: 4 },
  headerIconBtn: { padding: 6, width: 34, alignItems: "center" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  callCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, minWidth: 170,
  },
  callCardBody: { flex: 1 },
  callCardTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  callCardStatusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2, gap: 8 },
  callCardStatus: { flex: 1, fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  callCardStatusMine: { color: "rgba(255,255,255,0.85)" },
  callCardTime: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleStack: { maxWidth: "78%" },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  bubbleMine: { backgroundColor: colors.accentGreen },
  senderName: { fontSize: 11, fontWeight: "600", color: colors.accentGreen, marginBottom: 2, fontFamily: "Inter_600SemiBold" },
  bubbleText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  officialResponseRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  officialResponseLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", flexShrink: 1 },
  feedbackPrompt: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginTop: 10, padding: 12,
    backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)", borderRadius: 10,
  },
  feedbackPromptText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium", flex: 1, marginRight: 8 },
  pinIcon: { position: "absolute", top: 4, right: 4 },
  pinnedBar: {
    marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, overflow: "hidden",
  },
  pinnedBarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10 },
  pinnedBarTitle: { fontSize: 12, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  pinnedItem: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderBeige },
  pinnedItemMeta: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 2 },
  pinnedItemBody: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  pinnedItemLabel: {
    fontSize: 10, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 3,
    alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  bubbleTextMine: { color: "#fff" },
  mentionLink: { color: "#3B82F6", fontFamily: "Inter_600SemiBold" },
  mentionDropdown: {
    marginHorizontal: 16, marginBottom: 4,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, overflow: "hidden",
  },
  mentionRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  mentionRowUsername: { fontSize: 13, fontWeight: "600", color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  mentionRowName: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  startersRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
    borderTopWidth: 1, borderTopColor: colors.borderBeige,
  },
  starterChip: {
    backgroundColor: "rgba(29,158,117,0.08)",
    borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
  },
  starterChipText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.borderBeige,
  },
  recorderRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.borderBeige,
  },
  cancelRecorderBtn: { padding: 6 },
  input: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
    maxHeight: 100, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center",
  },
});
