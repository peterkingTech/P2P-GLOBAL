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

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  senderName?: string;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { supabase, user } = useAuth();
  const { reportContent } = useData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [title, setTitle] = useState("Conversation");
  const [text, setText] = useState("");
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
      const { data: members } = await supabase
        .from("p2p_conversation_members")
        .select("user_id, p2p_profiles(full_name)")
        .eq("conversation_id", id)
        .neq("user_id", user.id)
        .maybeSingle();
      setTitle((members as any)?.p2p_profiles?.full_name ?? "Direct message");
    } else {
      setTitle(conv?.name ?? "Group chat");
    }

    const { data: msgs } = await supabase
      .from("p2p_messages")
      .select("id, conversation_id, sender_id, body, created_at, p2p_profiles(full_name)")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages(
      (msgs ?? []).map((m: any) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        body: m.body,
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

  function handleLongPressMessage(item: Message) {
    if (item.sender_id === user?.id) return;
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
            const err = await reportContent("profile", item.sender_id, "Reported from conversation");
            Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
          },
        },
      ]
    );
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || !id || !user) return;
    setSending(true);
    setText("");
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
          <Text style={styles.headerTitle}>{title}</Text>
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
              const mine = item.sender_id === user?.id;
              return (
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <TouchableOpacity
                    activeOpacity={mine ? 1 : 0.7}
                    onLongPress={() => handleLongPressMessage(item)}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                  >
                    {!mine && item.senderName ? <Text style={styles.senderName}>{item.senderName}</Text> : null}
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
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
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  bubbleMine: { backgroundColor: colors.accentGreen },
  senderName: { fontSize: 11, fontWeight: "600", color: colors.accentGreen, marginBottom: 2, fontFamily: "Inter_600SemiBold" },
  bubbleText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  bubbleTextMine: { color: "#fff" },
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
