import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  time: string;
}

const MOCK_MESSAGES: ChatMessage[] = [
  { id: "1", user: "Pastor James", text: "Welcome everyone. Let's open with prayer.", time: "2:01 PM" },
  { id: "2", user: "Sister Ruth", text: "Lord, open our eyes to your Word today.", time: "2:02 PM" },
  { id: "3", user: "Thomas", text: "John 15:5 — 'apart from me you can do nothing.' That's the verse for today.", time: "2:04 PM" },
  { id: "4", user: "Pastor James", text: "Exactly. What does 'abide' mean to you personally?", time: "2:06 PM" },
];

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

  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_MESSAGES);
  const [input, setInput] = useState("");

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

      {/* Chat */}
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
  verseBar: {
    flexDirection: "row", gap: 6, alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: "rgba(186,117,23,0.1)",
    borderBottomWidth: 1, borderBottomColor: colors.navBorder,
  },
  verseBarText: { color: colors.amber, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
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
