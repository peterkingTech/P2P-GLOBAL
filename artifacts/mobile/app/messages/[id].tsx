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
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { CrisisResourcesModal } from "@/components/CrisisResourcesModal";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string | null;
  created_at: string;
  senderName?: string;
  message_type?: string;
}

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
  const { reportContent } = useData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [title, setTitle] = useState("Conversation");
  const [isDirect, setIsDirect] = useState(false);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [callingType, setCallingType] = useState<"audio" | "video" | null>(null);
  const [text, setText] = useState("");
  const [mentionResults, setMentionResults] = useState<{ username: string; fullName: string | null }[]>([]);
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [startersVisible, setStartersVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showCrisisModal, setShowCrisisModal] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const { data: conv } = await supabase
      .from("p2p_conversations")
      .select("id, type, name")
      .eq("id", id)
      .maybeSingle();
    if (conv?.type === "direct") {
      setIsDirect(true);
      const { data: members } = await supabase
        .from("p2p_conversation_members")
        .select("user_id, p2p_profiles(full_name)")
        .eq("conversation_id", id)
        .neq("user_id", user.id)
        .maybeSingle();
      setOtherUserId((members as any)?.user_id ?? null);
      setTitle((members as any)?.p2p_profiles?.full_name ?? "Direct message");
    } else {
      setIsDirect(false);
      setTitle(conv?.name ?? "Group chat");
    }

    const { data: msgs } = await supabase
      .from("p2p_messages")
      .select("id, conversation_id, sender_id, body, created_at, message_type, p2p_profiles(full_name)")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages(
      (msgs ?? []).map((m: any) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        body: m.body,
        message_type: m.message_type,
        created_at: m.created_at,
        senderName: m.p2p_profiles?.full_name,
      }))
    );
    setLoading(false);

    await supabase
      .from("p2p_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", user.id);
  }, [id, supabase, user]);

  useEffect(() => {
    load();
  }, [load]);

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
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, supabase]);

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
      const startRes = await fetch(`${apiUrl}/calls/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, callType, callerId: user.id, recipientId: otherUserId, conversationId: id }),
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
    if (item.sender_id === user?.id) return;
    const senderId = item.sender_id;
    Alert.alert(
      item.senderName || "This message",
      "What would you like to report?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report message",
          onPress: async () => {
            const err = await reportContent("message", item.id, "Reported from conversation");
            Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
          },
        },
        {
          text: "Report profile",
          style: "destructive",
          onPress: async () => {
            const err = await reportContent("profile", senderId, "Reported from conversation");
            Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
          },
        },
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
      setShowCrisisModal(true);
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
          <Text style={[styles.headerTitle, { flex: 1 }]} numberOfLines={1}>{title}</Text>
          {isDirect && otherUserId && (
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
            renderItem={({ item }) => {
              if (item.message_type === "call_summary") {
                return (
                  <View style={styles.callSummaryRow}>
                    <Text style={styles.callSummaryText}>{item.body}</Text>
                  </View>
                );
              }
              const mine = item.sender_id === user?.id;
              return (
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <TouchableOpacity
                    activeOpacity={mine ? 1 : 0.7}
                    onLongPress={() => handleLongPressMessage(item)}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                  >
                    {!mine && item.senderName ? <Text style={styles.senderName}>{item.senderName}</Text> : null}
                    <MentionText
                      body={item.body ?? ""}
                      style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                      linkStyle={styles.mentionLink}
                    />
                  </TouchableOpacity>
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

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={handleTextChange}
            placeholder="Message..."
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending || !text.trim()}>
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <CrisisResourcesModal
        visible={showCrisisModal}
        onClose={() => setShowCrisisModal(false)}
        statusText="A crisis responder from our team has also been notified and will reach out to you directly."
      />
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
  callSummaryRow: { alignItems: "center", paddingVertical: 4 },
  callSummaryText: {
    fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium",
    backgroundColor: colors.cardBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
  },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  bubbleMine: { backgroundColor: colors.accentGreen },
  senderName: { fontSize: 11, fontWeight: "600", color: colors.accentGreen, marginBottom: 2, fontFamily: "Inter_600SemiBold" },
  bubbleText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
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
